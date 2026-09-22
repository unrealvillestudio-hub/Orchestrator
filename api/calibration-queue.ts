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
  pendingStateOf, PENDING_STATES, type PendingState,
  type ContentPiece, type PieceContext, type PipelineCutoff, type GenerationInfo,
  type PieceSearch,
} from './_calibrationShared.js';
// LO-CORREGIDO-01 — el circuito de arreglos: qué pidió Sam, qué se hizo desde entonces y por qué
// versión va. Enriquece la tarjeta; nunca decide si la pieza aparece. Ver `_fixFlow.ts`.
import { fetchPieceEdits, fixFlowOf, type FixFlow } from './_fixFlow.js';

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
  urgentChannels, isUrgentPiece, URGENCY_HOURS_DEFAULT, URGENCY_HOURS_MAX, type UrgentChannel,
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
  /**
   * LO-CORREGIDO-01 — el circuito de arreglos. Viaja en TODA pieza, no sólo en las corregidas: una
   * pieza sin reto lo trae con `challenged_at:null` y `version:1`, que es una afirmación útil («no
   * se tocó») y no un hueco. Poner el campo sólo cuando aplica obligaría a la tarjeta a distinguir
   * «no vino» de «no hay», y esas dos cosas ya se confundieron una vez en este repositorio.
   */
  fix: FixFlow;
};

// Ejes de orden y filtro. Son del SISTEMA (una pieza tiene fecha, marca y veredicto en
// cualquier marca), no de ningún caso particular.
const ORDERS = ['recent', 'oldest', 'brand', 'verdict'] as const;
type Order = (typeof ORDERS)[number];

const VERDICT_FILTERS = ['all', 'PASS', 'REJECT'] as const;
type VerdictFilter = (typeof VERDICT_FILTERS)[number];

const GENERATION_FILTERS = ['all', 'current'] as const;
type GenerationFilter = (typeof GENERATION_FILTERS)[number];

// U-9 — LO URGENTE ES DEL CANAL, NO DE LA PIEZA. Ver el bloque de urgencia en `_publishSlots.ts`
// para por qué: filtrar por la PREVISIÓN de cada pieza habría marcado como urgentes las doce
// candidatas de un canal que sólo puede publicar una. Acá el eje es el mismo que el de `platform`
// y `verdict`: un filtro transversal que se aplica ANTES de `by_brand`.
const URGENCY_FILTERS = ['all', 'urgent'] as const;
type UrgencyFilter = (typeof URGENCY_FILTERS)[number];

/**
 * LO-CORREGIDO-01 — FILTRAR POR EL EJE DE PENDIENTE, que es lo que convierte «otro tab» en algo
 * que no duplica una línea de la bandeja.
 *
 * Sam pidió una pestaña para las corregidas. Una pestaña es un CONJUNTO, y acá ya había un eje que
 * define conjuntos: `pending_state`. Construir un módulo aparte habría significado una segunda
 * tarjeta, una segunda barra de acciones y una segunda forma de leer una pieza — tres cosas que
 * divergen en el primer cambio. Con el filtro, la pestaña es esta misma bandeja con su alcance
 * puesto, y todo lo que se arregle acá se arregla allá.
 *
 * Los valores salen de `PENDING_STATES`, no de una lista escrita acá: un eje nuevo entra en el
 * filtro solo, y TypeScript falla si alguien lo añade en un sitio y lo olvida en el otro.
 *
 * ── ES UN CONJUNTO, NO UN VALOR ─────────────────────────────────────────────────
 * `state` admite varios ejes separados por coma (`state=por_arreglar,corregida`) porque el
 * circuito de arreglos tiene DOS mitades —lo que espera arreglo y lo que volvió arreglado— y una
 * pestaña que sólo enseñara una de las dos escondería la otra. Un valor único habría obligado a
 * inventar un séptimo nombre para «las dos», y un nombre que agrupa ejes deja de ser un eje.
 *
 * Un valor desconocido en la lista se IGNORA y los válidos siguen aplicando; si no queda ninguno,
 * el filtro es `all`. Nunca una lista vacía: un filtro roto que devuelve cero se lee como «no hay
 * nada», que es la mentira más cara de esta bandeja.
 */
function parseStates(v: unknown): PendingState[] {
  const raw = strParam(v);
  if (!raw || raw === 'all') return [];
  const pedidos = raw.split(',').map((x) => x.trim()).filter(Boolean);
  const validos = pedidos.filter((x): x is PendingState =>
    (PENDING_STATES as readonly string[]).includes(x));
  return Array.from(new Set(validos));
}

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
  // U-9 — el filtro y su ventana viajan separados: `urgency=urgent` dice QUÉ se pide y
  // `urgency_hours` CUÁNTO cuenta como cerca. Sam declaró 24-48 h; el defecto es el extremo ancho,
  // porque un filtro que esconde una franja de mañana es peor que uno que muestra una de pasado.
  const urgency = enumParam<UrgencyFilter>(req.query.urgency, URGENCY_FILTERS, 'all');
  const urgencyHours = intParam(req.query.urgency_hours, URGENCY_HOURS_DEFAULT, 1, URGENCY_HOURS_MAX);
  // LO-CORREGIDO-01 — el alcance de la pestaña. Vacío = `all`, que es toda la bandeja.
  const states = parseStates(req.query.state);
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

    // LO-CORREGIDO-01 — EL EJE SE RESUELVE SOBRE TODO LO PENDIENTE, no sobre la página.
    //
    // Hasta acá se calculaba dentro del `.map()` final, es decir DESPUÉS de filtrar, ordenar y
    // paginar. Servía mientras sólo pintaba un color. En el momento en que el eje FILTRA, hacerlo
    // ahí significaría filtrar por un valor que todavía no existe — y contar `by_state` sobre
    // veinte tarjetas en vez de sobre las ciento y pico que hay.
    const stateById = new Map<string, PendingState>();
    for (const p of perPiece) {
      stateById.set(p.id, pendingStateOf(
        p.status,
        yaCalibrada(p.id),
        // RETADA = lleva la marca del reto en su historia. La marca no se borra al volver, y eso
        // es precisamente lo que permite reconocer una pieza corregida meses después.
        Boolean(p.challenged_at),
      ));
    }

    // Filtros transversales (veredicto y generación) — antes de by_brand.
    let scoped = perPiece;
    if (verdict !== 'all') scoped = scoped.filter((p) => watcherOf(p).result === verdict);
    if (generation === 'current') scoped = scoped.filter((p) => genById.get(p.id)?.generation === 'current');
    // U-7 — buscar y filtrar por plataforma van ACÁ, antes de `by_brand` y antes de paginar.
    // El orden importa: buscar después de paginar haría que el resultado dependiera de en qué
    // página estabas, que es la forma más silenciosa de que una búsqueda mienta.
    if (search) scoped = scoped.filter((p) => idMatchesSearch(p.id, search));
    if (platform) scoped = scoped.filter((p) => (p.platform ?? '') === platform);

    // U-9 — los canales cuya próxima franja libre vence dentro de la ventana. Se calculan SIEMPRE,
    // no sólo cuando el filtro está puesto: la bandeja los declara en la respuesta para que la
    // interfaz pueda decir «este canal necesita 1 pieza» sin pedir nada más. Con `slots_source`
    // caído el mapa viene vacío y el filtro no esconde nada por una lectura fallida — lo dice.
    const urgentes = urgentChannels(freeSlots, urgencyHours);
    if (urgency === 'urgent') scoped = scoped.filter((p) => isUrgentPiece(p, urgentes));

    // LO-CORREGIDO-01 — el alcance de la pestaña, con los demás transversales y ANTES de `by_brand`:
    // las pastillas de marca tienen que contar lo que esta pestaña daría, no lo que daría la bandeja
    // entera. Es el mismo orden que ya siguen el veredicto, la plataforma y la urgencia.
    if (states.length) scoped = scoped.filter((p) => states.includes(stateById.get(p.id)!));

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

    // LO-CORREGIDO-01 — CUÁNTAS HAY EN CADA EJE. Es lo que deja que la pestaña muestre su número
    // sin una segunda petición, y lo que impide que «no hay pestaña» se lea como «no existe eso».
    //
    // Se cuenta sobre `perPiece` —TODO lo pendiente—, no sobre `scoped`: si se contara sobre el
    // conjunto ya filtrado, entrar en la pestaña de corregidas pondría a cero el número de todas
    // las demás, y el contador diría que la bandeja se vació. Es el mismo razonamiento por el que
    // `urgent_channels.candidates` se cuenta sobre `perPiece`. Los seis ejes se declaran siempre,
    // incluso en cero: una pestaña que desaparece cuando no tiene piezas es una pestaña que nadie
    // vuelve a buscar.
    const by_state: Record<PendingState, number> = Object.fromEntries(
      PENDING_STATES.map((e) => [e, 0])) as Record<PendingState, number>;
    for (const p of perPiece) by_state[stateById.get(p.id)!] += 1;

    // Filtro de marca (si vino) y orden.
    const inBrand = brand ? scoped.filter((p) => p.brand_id === brand) : scoped;
    const ordered = sortPieces(inBrand, order);
    const page    = ordered.slice(offset, offset + limit);

    // Procedencia: sólo para la página visible (el `in.()` de PostgREST crece con la lista).
    const [traces, attempts, edits] = await Promise.all([
      fetchWatcherTraces(page.map((p) => p.orchestrator_job_id ?? '')),
      fetchAttemptsByQueue(page.map((p) => p.queue_id ?? '')),
      // LO-CORREGIDO-01 — sólo la página visible, igual que las otras dos: el `in.()` de PostgREST
      // crece con la lista y el historial completo de ciento y pico piezas no cabe en una tarjeta.
      fetchPieceEdits(page.map((p) => p.id)),
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
      // EN QUÉ ESTADO DE PENDIENTE ESTÁ. Es lo que la tarjeta pinta para que seis situaciones
      // distintas no se lean iguales — que es el defecto que SIGN-01 corte D intentó resolver
      // escondiéndolas. Sale del mapa, resuelto arriba sobre TODO lo pendiente.
      pending_state: stateById.get(p.id)!,
      // LO-CORREGIDO-01 — la propuesta de Sam, lo que cambió desde el reto y por qué versión va.
      fix: fixFlowOf(p, edits.get(p.id) ?? []),
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
      urgency,
      urgency_hours: urgencyHours,
      /**
       * LO-CORREGIDO-01 — el alcance pedido, DEVUELTO. Va como lista y no como la cadena cruda
       * para que la interfaz lea lo que de verdad se aplicó: si alguien pide `state=inventado`,
       * acá vuelve `[]` —es decir, `all`— y la pantalla puede decirlo en vez de enseñar la bandeja
       * entera bajo el título de una pestaña vacía.
       */
      state: states,
      by_state,
      /**
       * U-9 — LOS CANALES QUE VENCEN, con cuántas candidatas tiene cada uno.
       *
       * `needs` es SIEMPRE 1: una franja la ocupa una pieza. Va explícito y no implícito porque es
       * justo el número que se pierde al mirar una lista de doce tarjetas — y sin él la bandeja
       * vuelve a decir «doce urgentes» cuando la decisión es una.
       *
       * `candidates` se cuenta sobre `perPiece` (todo lo pendiente), NO sobre `scoped`: si se
       * contara sobre el conjunto ya filtrado, poner un filtro de marca cambiaría cuántas
       * candidatas dice tener el canal, y eso no es cierto — el canal tiene las que tiene.
       */
      urgent_channels: [...urgentes.values()]
        .sort((a, b) => a.hours_left - b.hours_left)
        .map((c: UrgentChannel) => ({
          ...c,
          needs: 1,
          candidates: perPiece.filter(
            (p) => p.brand_id === c.brand_id && (p.platform ?? '') === c.platform).length,
        })),
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
