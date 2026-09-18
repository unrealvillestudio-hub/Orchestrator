/**
 * UNRLVL Orchestrator — api/calibration-queue.ts  (B4 · Fase 1 · CALIB-UI-01)
 *
 * Cola de calibración: la bandeja lista PIEZAS, una tarjeta por pieza.
 *
 * Antes listaba `content.orchestrator_jobs`, que es la tabla de INTENTOS: cada reintento
 * sobre la misma fila de cola producía otra tarjeta, y la bandeja mostraba cientos de
 * versiones muertas de un puñado de piezas (medido el 2026-08-23: 489 tarjetas para 15
 * piezas reales). La fuente correcta es `content.content_pieces`, con tres filtros:
 *
 *   1. `discarded_at IS NULL`                    — lo descartado sale de la bandeja
 *   2. sin fila en `intel.approval_calibration`  — lo ya calibrado sale de la bandeja
 *   3. última versión por `queue_id`             — una tarjeta por pieza, no por intento
 *
 * El diff contra el corpus y el DISTINCT ON por queue_id se hacen en JS (sin RPC
 * SECURITY DEFINER). Paginado en bloques para que Sam evalúe, cierre y vuelva donde quedó.
 *
 * GET /api/calibration-queue?limit=50&offset=0&brand=&order=&verdict=&generation=
 *   Auth: admin JWT vía `Authorization: Bearer <session_token>` (NO en query — privacidad).
 *
 *   order      recent (default) | oldest | brand | verdict
 *   verdict    all (default) | PASS | REJECT     — primera opinión del watcher
 *   generation all (default) | current           — sólo piezas posteriores al último corte
 *
 * Returns 200: {
 *   total_pending, by_brand, limit, offset, pieces[], cutoffs_source
 * }
 *   by_brand se calcula tras los filtros de veredicto y generación, pero ANTES del de
 *   marca: las pastillas de marca muestran lo que cada una daría con los filtros puestos.
 *
 * NO publica, NO muta piezas. Solo lee.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  applyCors, extractToken, requireAdmin,
  fetchCalibrationPieces, fetchEvaluatedIds, fetchPipelineCutoffs,
  fetchWatcherTraces, fetchAttemptsByQueue,
  latestPerQueue, generationOf, watcherOf, toContext, PIECES_CAP,
  parsePieceSearch, idMatchesSearch, SearchTooShort, SearchNotAnId, SEARCH_MIN_PREFIX,
  pendingStateOf, type PendingState,
  type ContentPiece, type PieceContext, type PipelineCutoff, type GenerationInfo,
  type PieceSearch,
} from './_calibrationShared.js';

/**
 * U-7 — LAS PLATAFORMAS PRESENTES EN UN LOTE, ordenadas. Sale del dato, nunca de una lista
 * en el código: es lo mismo que ya hace `by_brand` con las marcas, y es lo que permite que
 * una marca nueva de otro rubro traiga su plataforma sin que nadie edite este archivo.
 */
function platformsOf(pieces: ContentPiece[]): string[] {
  const set = new Set<string>();
  for (const p of pieces) { const v = (p.platform ?? '').trim(); if (v) set.add(v); }
  return [...set].sort();
}
// FIX-CARD-06 — los topes del canal y la firma esperada son DATO: se leen acá, una vez
// por request, y viajan resueltos en cada pieza. La UI no conoce ni un tope.
import { fetchPlatformLimits, fetchSignatureClosers, metricsOf } from './_pieceMetrics.js';
import { fetchBrandLanguages, readingLanguageOf } from './_brandLanguage.js';
// PR-C — la PREVISIÓN de fecha: dónde caería esta pieza si se aprobara ahora. Se resuelve
// en el server, en la misma pasada que arma la bandeja, y NO reserva nada.
import {
  fetchBrandTimezones, fetchNextFreeSlots, forecastFor, type ForecastSlot,
} from './_publishSlots.js';

/**
 * Lo que viaja a la tarjeta de calibración: el contexto de la pieza más su PREVISIÓN de
 * fecha. La previsión es de esta bandeja y de ninguna otra — la cola de publicación muestra
 * `slot`, que es un compromiso. Dos cosas distintas, dos nombres distintos, a propósito.
 */
type CalibrationInboxPiece = PieceContext & {
  forecast_slot: ForecastSlot | null;
  /** Eje de pendiente: la tarjeta lo pinta. Ver `pendingStateOf`. */
  pending_state: PendingState;
};

// Ejes de orden y filtro. Son del SISTEMA (una pieza tiene fecha, marca y veredicto en
// cualquier marca), no de ningún caso particular.
const ORDERS = ['recent', 'oldest', 'brand', 'verdict'] as const;
type Order = (typeof ORDERS)[number];

const VERDICT_FILTERS = ['all', 'PASS', 'REJECT'] as const;
type VerdictFilter = (typeof VERDICT_FILTERS)[number];

const GENERATION_FILTERS = ['all', 'current'] as const;
type GenerationFilter = (typeof GENERATION_FILTERS)[number];

function intParam(v: unknown, def: number, min: number, max: number): number {
  const n = Array.isArray(v) ? v[0] : v;
  const parsed = typeof n === 'string' ? parseInt(n, 10) : NaN;
  if (!Number.isFinite(parsed)) return def;
  return Math.min(max, Math.max(min, parsed));
}
function strParam(v: unknown): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.trim() ? s.trim() : undefined;
}
function enumParam<T extends string>(v: unknown, allowed: readonly T[], def: T): T {
  const s = strParam(v);
  return (s && (allowed as readonly string[]).includes(s)) ? (s as T) : def;
}

function ms(iso: string | null | undefined): number {
  if (!iso) return -Infinity;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : -Infinity;
}

// Orden por veredicto: primero lo que el watcher RECHAZÓ (es donde el criterio de Sam
// más informa), después lo que aprobó, al final lo que no tiene veredicto. Dentro de
// cada grupo, lo más reciente primero.
const VERDICT_RANK: Record<string, number> = { REJECT: 0, PASS: 1 };
function verdictRank(p: ContentPiece): number {
  const r = watcherOf(p).result;
  return r ? VERDICT_RANK[r] : 2;
}

function sortPieces(pieces: ContentPiece[], order: Order): ContentPiece[] {
  const out = pieces.slice();
  switch (order) {
    case 'oldest':
      return out.sort((a, b) => ms(a.created_at) - ms(b.created_at));
    case 'brand':
      return out.sort((a, b) =>
        a.brand_id.localeCompare(b.brand_id) || ms(b.created_at) - ms(a.created_at));
    case 'verdict':
      return out.sort((a, b) =>
        verdictRank(a) - verdictRank(b) || ms(b.created_at) - ms(a.created_at));
    case 'recent':
    default:
      return out.sort((a, b) => ms(b.created_at) - ms(a.created_at));
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const session = requireAdmin(req, res, extractToken(req));
  if (!session) return; // requireAdmin ya respondió

  const limit      = intParam(req.query.limit, 20, 1, 200);
  const offset     = intParam(req.query.offset, 0, 0, 10_000_000);
  const brand      = strParam(req.query.brand);
  const order      = enumParam<Order>(req.query.order, ORDERS, 'recent');
  const verdict    = enumParam<VerdictFilter>(req.query.verdict, VERDICT_FILTERS, 'all');
  const generation = enumParam<GenerationFilter>(req.query.generation, GENERATION_FILTERS, 'all');
  // U-7 — la PLATAFORMA DE LA PIEZA. No confundir con el `channel` de `publish-queue`, que
  // filtra el CANAL OPERATIVO de la marca: son dos ejes distintos y por eso llevan nombres
  // distintos. Unificarlos a la fuerza haría que un filtro dijera lo que el otro hace.
  const platform   = strParam(req.query.platform);

  // U-7 — buscar por id. Se resuelve ANTES de nada porque un `q` inválido es un 400, no una
  // lista vacía: «no existe» y «no supe buscar eso» no se pueden leer igual.
  let search: PieceSearch | null;
  try {
    search = parsePieceSearch(req.query.q);
  } catch (err) {
    if (err instanceof SearchTooShort) {
      return res.status(400).json({
        error: 'search_too_short',
        detail: `Para buscar por id hacen falta al menos ${SEARCH_MIN_PREFIX} caracteres. `
          + 'Un prefijo más corto devolvería medio catálogo.',
      });
    }
    if (err instanceof SearchNotAnId) {
      return res.status(400).json({
        error: 'search_not_an_id',
        detail: 'La búsqueda es por id de pieza (o por su prefijo), no por texto libre.',
      });
    }
    throw err;
  }

  try {
    // Se lee sin filtro de marca para que by_brand sea global y estable aunque venga
    // filtro; los cortes se leen en runtime (nunca hay fechas de corte en este código).
    const [allPieces, evaluated, cutoffsRaw, limits, closers, brandLangs, brandZones, freeSlots] = await Promise.all([
      fetchCalibrationPieces(),
      fetchEvaluatedIds(),
      fetchPipelineCutoffs(),
      fetchPlatformLimits(),
      fetchSignatureClosers(),
      fetchBrandLanguages(),
      fetchBrandTimezones(),
      // Las franjas LIBRES futuras: son el horizonte sembrado (decenas de filas), no una
      // tabla de piezas, así que se traen enteras una vez y se indexan por (marca, canal).
      fetchNextFreeSlots(),
    ]);
    const cutoffs: PipelineCutoff[] = cutoffsRaw ?? [];

    // EL CORPUS YA NO EXCLUYE: ANOTA. (Regla de Sam, 2026-09-18.)
    //
    // Antes esta línea era `filter((p) => !evaluated.ids.has(p.id))`, y escondía toda pieza con fila
    // en `intel.approval_calibration`. Para una pieza SELLADA eso es correcto y sigue siéndolo — pero
    // el sellado ya la saca por `status` y `discarded_at`, así que ese filtro no aportaba nada ahí.
    // A quien escondía de verdad era a la pieza que se juzgó, SE CORRIGIÓ y volvió a la bandeja: vive,
    // está pendiente, y desaparecía. Medido el 2026-09-18: `5aeb27e3` y `7a7a8a58`, devueltas el
    // 2026-09-15 con su corrección registrada en `intel.piece_edits`, invisibles desde entonces.
    //
    // «Ya calibrada» es historia de la pieza, no su estado actual. Viaja como eje —`pendingStateOf`—
    // y la tarjeta la distingue por color; no la borra de la lista.
    const perPiece = latestPerQueue(allPieces);
    const yaCalibrada = (id: string) => evaluated.ids.has(id);

    // Generación de cada pieza (se calcula una vez: filtra, ordena y viaja a la tarjeta).
    const genById = new Map<string, GenerationInfo>();
    for (const p of perPiece) genById.set(p.id, generationOf(p, cutoffs));

    // Filtros transversales (veredicto y generación) — antes de by_brand.
    let scoped = perPiece;
    if (verdict !== 'all') scoped = scoped.filter((p) => watcherOf(p).result === verdict);
    if (generation === 'current') scoped = scoped.filter((p) => genById.get(p.id)?.generation === 'current');
    // U-7 — buscar y filtrar por plataforma van ACÁ, antes de `by_brand` y antes de paginar.
    // El orden importa: buscar después de paginar haría que el resultado dependiera de en qué
    // página estabas, que es la forma más silenciosa de que una búsqueda mienta.
    if (search) scoped = scoped.filter((p) => idMatchesSearch(p.id, search));
    if (platform) scoped = scoped.filter((p) => (p.platform ?? '') === platform);

    // UNA MARCA NO DESAPARECE: DECLARA CERO. (Regla de Sam, 2026-09-18.)
    //
    // `by_brand` se contaba sólo sobre `scoped`, el conjunto YA filtrado, así que una marca cuyas
    // piezas caían todas por un filtro se esfumaba de la interfaz sin que nada lo señalara — y
    // «no hay pestaña» se lee como «esa marca no existe», no como «no hay nada con estos filtros».
    // Le pasó a LucienSael, cuya única pieza viva estaba oculta por el corpus.
    //
    // Omitir y mostrar cero son dos afirmaciones distintas. Las marcas salen del conjunto SIN
    // filtrar y los conteos del filtrado: quien tenga 0 con los filtros puestos lo dice con un 0.
    const by_brand: Record<string, number> = {};
    for (const p of perPiece) by_brand[p.brand_id] = 0;
    for (const p of scoped)   by_brand[p.brand_id] = (by_brand[p.brand_id] ?? 0) + 1;

    // Filtro de marca (si vino) y orden.
    const inBrand = brand ? scoped.filter((p) => p.brand_id === brand) : scoped;
    const ordered = sortPieces(inBrand, order);
    const page    = ordered.slice(offset, offset + limit);

    // Procedencia: sólo para la página visible (el `in.()` de PostgREST crece con la lista).
    const [traces, attempts] = await Promise.all([
      fetchWatcherTraces(page.map((p) => p.orchestrator_job_id ?? '')),
      fetchAttemptsByQueue(page.map((p) => p.queue_id ?? '')),
    ]);

    const pieces: CalibrationInboxPiece[] = page.map((p) => ({
      ...toContext(p, {
        trace: p.orchestrator_job_id ? traces.get(p.orchestrator_job_id) : undefined,
        attempts: p.queue_id ? (attempts.get(p.queue_id) ?? null) : null,
        generation: genById.get(p.id),
        metrics: metricsOf(p, limits, closers),
        reading_language: readingLanguageOf(p.brand_id, brandLangs),
      }),
      // PREVISIÓN, no compromiso. La pieza todavía no está aprobada, así que no tiene
      // franja: esto es dónde caería si se aprobara ahora, y otra pieza aprobada antes se
      // la lleva. Por eso NO se llama `slot` — el nombre distingue las dos cosas.
      forecast_slot: forecastFor(p, freeSlots, brandZones),
      // EN QUÉ ESTADO DE PENDIENTE ESTÁ. Es lo que la tarjeta pinta para que cuatro situaciones
      // distintas no se lean iguales — que es el defecto que SIGN-01 corte D intentó resolver
      // escondiéndolas.
      pending_state: pendingStateOf(p.status, yaCalibrada(p.id)),
    }));

    // U-8 — DOS LOTES PUEDEN CORTARSE, Y CORTARSE MIENTE DE DOS MANERAS DISTINTAS.
    // El de piezas corta por abajo: falta una pieza que existe. El del corpus corta por
    // arriba: reaparece una pieza YA JUZGADA, como si nadie la hubiera mirado. Las dos
    // hacen que esta respuesta no sea completa, así que las dos encienden `truncated`.
    const piezasTruncadas = allPieces.length >= PIECES_CAP;
    const truncated = piezasTruncadas || evaluated.truncated;
    if (piezasTruncadas) {
      console.warn(`[calibration-queue] content_pieces hit cap ${PIECES_CAP} — la cola puede estar truncada`);
    }

    return res.status(200).json({
      total_pending: ordered.length,
      by_brand,
      limit,
      offset,
      order,
      verdict,
      generation,
      platform: platform ?? '',
      // U-7 — las plataformas PRESENTES EN EL LOTE, para que el selector salga del dato.
      // Nunca una lista escrita en el código: una marca nueva con una plataforma nueva
      // aparece sola, sin tocar una línea.
      platforms: platformsOf(perPiece),
      /**
       * U-7 — qué se buscó y si el lote se cortó. `truncated:true` significa que una pieza
       * que existe pudo quedarse fuera, y entonces una lista vacía NO es «no existe».
       * Un uuid completo nunca se trunca: va como filtro directo.
       *
       * U-8 — acá va `piezasTruncadas`, NO el `truncated` de arriba. El corte del corpus
       * hace que SOBRE una pieza, no que falte: decir «pudo quedarse fuera» por esa causa
       * sería una afirmación falsa sobre la búsqueda, en el único campo que existe para no
       * mentir sobre ella.
       */
      search: search ? { q: search.q, mode: search.mode, truncated: search.mode === 'prefix' && piezasTruncadas } : null,
      pieces,
      // Por qué la generación puede venir 'unknown': tabla ausente vs tabla vacía.
      cutoffs_source: cutoffsRaw === null ? 'unavailable' : (cutoffs.length ? 'seeded' : 'empty'),
      // PR-C — por qué la previsión puede venir `null`: «no hay franja libre» y «no se pudo
      // leer» son dos cosas distintas, y la primera es una afirmación sobre el canal.
      slots_source: freeSlots === null ? 'unavailable' : 'ok',
      ...(truncated ? { truncated: true } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[calibration-queue]', message);
    return res.status(500).json({ error: 'queue_failed', message });
  }
}
