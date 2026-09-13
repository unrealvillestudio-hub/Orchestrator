/**
 * UNRLVL Orchestrator — api/publish-queue.ts  (PUBLISH-UI-01 · parcial de SOLO LECTURA)
 *
 * Lista las piezas candidatas a salir, con su canal de destino, el estado operativo de ese
 * canal y —desde PR-C— la FRANJA RESERVADA de cada una. **Este endpoint es de SOLO
 * LECTURA**: no programa, no publica y no escribe. Las acciones sobre una pieza —aprobar
 * incluida— las ejecutan sus propios endpoints, y qué acciones admite cada pieza viaja en
 * `pieces[].actions` desde U-4.
 *
 * U-9 — LO QUE ESTA LÍNEA DECÍA ANTES, Y LA REGLA QUE DEJA ESCRITA. Decía que «aprobar es
 * del carril de calibración (ver `approval.reason`)», y las dos mitades llevaban días
 * siendo falsas: esta bandeja aprueba desde U-5, y el campo `approval` se retiró en U-6.
 * Fue la tercera aparición en tres días de la misma clase de defecto.
 *
 * La regla, para que no haya una cuarta: **un docstring que describe OTRA pantalla o un
 * campo AJENO caduca sin que nadie lo note**, porque quien cambia ese campo no viene a
 * leer este archivo. Si un texto afirma algo sobre disponibilidad, sale del contrato o no
 * se escribe.
 *
 * Fuente y filtros:
 *   1. `content.content_pieces` con `discarded_at IS NULL`     (base común con calibración)
 *   2. estado no resuelto — fuera `published/rejected/failed`
 *   3. la última versión por `queue_id`                        (una tarjeta por pieza)
 *
 * PR-C — `scheduled` DEJÓ de estar en el punto 2, y el motivo no es un ajuste de filtro:
 * con PLACE-01 ese estado pasó a significar «aprobada y con franja reservada», que es
 * exactamente lo que una cola de publicación tiene que listar. La constante se había
 * quedado describiendo el sistema anterior. Ver `_publishShared.RESOLVED_STATUSES`.
 *
 * NO filtra por veredicto del watcher: no haría falta. Una fila de `content_pieces` sólo
 * se crea cuando el watcher dio PASS — verificado contra la base el 2026-08-23, las 24
 * filas existentes tienen PASS y ninguna REJECT. La restricción la impone la FUENTE, no la
 * consulta; escribir un `where result='PASS'` daría la ilusión de una selección que ya
 * está garantizada aguas arriba.
 *
 * Tampoco filtra por el corpus de calibración: calificar una pieza y publicarla son ejes
 * independientes (una pieza puede pasar por las dos bandejas, o por ninguna).
 *
 * GET /api/publish-queue?limit=&offset=&brand=&channel=&channel_status=&generation=
 *   Auth: admin JWT vía `Authorization: Bearer <session_token>`.
 *
 *   channel         '' (todos) | <platform_key>       — descubierto del dato, nunca enumerado
 *   channel_status  all (default) | operational | blocked
 *   generation      all (default) | current
 *
 * Orden: más reciente primero, fijo. La bandeja de publicación no pide los cuatro órdenes
 * de la de calibración.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  applyCors, extractToken, requireAdmin,
  fetchLivePieces, fetchPipelineCutoffs, fetchWatcherTraces, fetchAttemptsByQueue,
  latestPerQueue, generationOf, toContext, PIECES_CAP,
  parsePieceSearch, idMatchesSearch, SearchTooShort, SearchNotAnId, SEARCH_MIN_PREFIX,
  type ContentPiece, type PipelineCutoff, type GenerationInfo, type PieceSearch,
} from './_calibrationShared.js';
import {
  RESOLVED_STATUSES, fetchPublishChannels, channelOf, channelBlocks,
  type ChannelInfo, type PublishablePiece,
} from './_publishShared.js';
// FIX-CARD-06 — misma cabecera que la bandeja de calibración, mismos catálogos leídos en
// runtime. Las dos bandejas cuentan lo mismo porque llaman a la misma función.
import { fetchPlatformLimits, fetchSignatureClosers, metricsOf } from './_pieceMetrics.js';
import { fetchBrandLanguages, readingLanguageOf } from './_brandLanguage.js';
// PR-C — la franja RESERVADA de cada pieza y el huso de su marca, resueltos EN EL SERVER
// junto al resto de la fila. Nunca una llamada extra desde el navegador por cada tarjeta.
import { fetchBrandTimezones, fetchSlotsByPiece, slotOf } from './_publishSlots.js';

/**
 * U-7 — LOS ESTADOS PRESENTES EN UN LOTE, ordenados. Sale del dato, nunca de una lista en el
 * código: `RESOLVED_STATUSES` dice cuáles se EXCLUYEN —los que ya salieron del circuito—, y
 * cuáles quedan es una consecuencia del carril, no una decisión de este archivo. Si mañana
 * el carril produce un estado nuevo, aparece en el selector solo.
 */
function statusesOf(pieces: ContentPiece[]): string[] {
  const set = new Set<string>();
  for (const p of pieces) { const v = (p.status ?? '').trim(); if (v) set.add(v); }
  return [...set].sort();
}

const CHANNEL_STATUS_FILTERS = ['all', 'operational', 'blocked'] as const;
type ChannelStatusFilter = (typeof CHANNEL_STATUS_FILTERS)[number];

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const session = requireAdmin(req, res, extractToken(req));
  if (!session) return; // requireAdmin ya respondió

  const limit         = intParam(req.query.limit, 20, 1, 200);
  const offset        = intParam(req.query.offset, 0, 0, 10_000_000);
  const brand         = strParam(req.query.brand);
  const channelKey    = strParam(req.query.channel);
  const channelStatus = enumParam<ChannelStatusFilter>(req.query.channel_status, CHANNEL_STATUS_FILTERS, 'all');
  const generation    = enumParam<GenerationFilter>(req.query.generation, GENERATION_FILTERS, 'all');
  // U-7 — EL ESTADO DE LA PIEZA. Va acá y no en calibración, y no es indiferente: la bandeja
  // de calibración lista UN SOLO estado por contrato (`CALIBRATION_STATUSES`), así que darle
  // un filtro de estado exigiría ampliar lo que esa bandeja ES — y entonces duplicaría a
  // ésta, que ya lista cinco y desde U-5 tiene todos los botones. El filtro se pone donde
  // hay estados que filtrar.
  const status        = strParam(req.query.status);

  // U-7 — buscar por id. Un `q` inválido es 400, no una lista vacía: «no existe» y «no supe
  // buscar eso» no se pueden leer igual.
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
    // Sin filtro de marca en la lectura: by_brand tiene que ser global y estable aunque
    // venga filtro. Los cortes se leen en runtime (cero fechas de corte en el código).
    const [allPieces, cutoffsRaw, channels, limits, closers, brandLangs, brandZones] = await Promise.all([
      fetchLivePieces({ excludeStatuses: RESOLVED_STATUSES }),
      fetchPipelineCutoffs(),
      fetchPublishChannels(),
      fetchPlatformLimits(),
      fetchSignatureClosers(),
      fetchBrandLanguages(),
      fetchBrandTimezones(),
    ]);
    const cutoffs: PipelineCutoff[] = cutoffsRaw ?? [];

    const perPiece = latestPerQueue(allPieces);

    // Canal y generación de cada pieza: se calculan una vez y sirven para filtrar y para
    // la tarjeta.
    const genById     = new Map<string, GenerationInfo>();
    const channelById = new Map<string, ChannelInfo>();
    for (const p of perPiece) {
      genById.set(p.id, generationOf(p, cutoffs));
      channelById.set(p.id, channelOf(p, channels));
    }

    // Filtros transversales — antes de by_brand, para que las pastillas digan la verdad.
    let scoped = perPiece;
    if (channelKey) {
      scoped = scoped.filter((p) => channelById.get(p.id)?.platform_key === channelKey);
    }
    if (channelStatus !== 'all') {
      scoped = scoped.filter((p) => {
        const info = channelById.get(p.id);
        if (!info) return false;
        return channelStatus === 'operational' ? !channelBlocks(info) : channelBlocks(info);
      });
    }
    if (generation === 'current') {
      scoped = scoped.filter((p) => genById.get(p.id)?.generation === 'current');
    }
    // U-7 — buscar y filtrar por estado son transversales igual que los de arriba, así que
    // van en el mismo sitio: ANTES de `by_brand`, para que las pastillas digan la verdad, y
    // antes de paginar, porque buscar después de paginar haría que el resultado dependiera
    // de en qué página estabas.
    if (search) scoped = scoped.filter((p) => idMatchesSearch(p.id, search));
    if (status) scoped = scoped.filter((p) => (p.status ?? '') === status);

    const by_brand: Record<string, number> = {};
    const by_channel: Record<string, number> = {};
    for (const p of scoped) {
      by_brand[p.brand_id] = (by_brand[p.brand_id] ?? 0) + 1;
      const key = channelById.get(p.id)?.platform_key;
      if (key) by_channel[key] = (by_channel[key] ?? 0) + 1;
    }

    const inBrand: ContentPiece[] = brand ? scoped.filter((p) => p.brand_id === brand) : scoped;
    const ordered = inBrand.slice().sort((a, b) => ms(b.created_at) - ms(a.created_at));
    const page    = ordered.slice(offset, offset + limit);

    // Procedencia y franja: sólo para la página visible (el `in.()` de PostgREST crece con
    // la lista). La fecha se resuelve acá, junto al resto de la fila — nunca con una llamada
    // extra desde el navegador por cada tarjeta.
    const [traces, attempts, slots] = await Promise.all([
      fetchWatcherTraces(page.map((p) => p.orchestrator_job_id ?? '')),
      fetchAttemptsByQueue(page.map((p) => p.queue_id ?? '')),
      fetchSlotsByPiece(page.map((p) => p.id)),
    ]);

    const pieces: PublishablePiece[] = page.map((p) => ({
      ...toContext(p, {
        trace: p.orchestrator_job_id ? traces.get(p.orchestrator_job_id) : undefined,
        attempts: p.queue_id ? (attempts.get(p.queue_id) ?? null) : null,
        generation: genById.get(p.id),
        metrics: metricsOf(p, limits, closers),
        reading_language: readingLanguageOf(p.brand_id, brandLangs),
      }),
      channel: channelById.get(p.id) ?? channelOf(p, channels),
      // El COMPROMISO de esta pieza: la franja que tiene reservada. `null` = no tiene, que
      // es un estado real. La tarjeta decide qué decir de ese `null` mirando `approved_at`.
      slot: slotOf(p, slots, brandZones),
    }));

    const truncated = allPieces.length >= PIECES_CAP;
    if (truncated) {
      console.warn(`[publish-queue] content_pieces hit cap ${PIECES_CAP} — la cola puede estar truncada`);
    }

    return res.status(200).json({
      total: ordered.length,
      by_brand,
      by_channel,
      limit,
      offset,
      channel: channelKey ?? '',
      channel_status: channelStatus,
      generation,
      status: status ?? '',
      // U-7 — los estados PRESENTES EN EL LOTE. Sale del dato, como `by_brand`: si el carril
      // empieza a producir un estado nuevo, aparece en el selector solo. Se calcula sobre el
      // lote COMPLETO, no sobre el filtrado — si no, elegir un estado dejaría el selector con
      // una sola opción y sin forma de volver.
      statuses: statusesOf(perPiece),
      /**
       * U-7 — qué se buscó y si el lote se cortó. `truncated:true` significa que una pieza
       * que existe pudo quedarse fuera, y entonces una lista vacía NO es «no existe».
       * Un uuid completo nunca se trunca: va como filtro directo.
       */
      search: search ? { q: search.q, mode: search.mode, truncated: search.mode === 'prefix' && truncated } : null,
      pieces,
      // PR-C — si las franjas no se pudieron leer, la pantalla tiene que decir que las
      // fechas FALTAN, no que estén vacías: `slot: null` significaría «sin franja» y el
      // aviso «Aprobada sin franja asignada» se dispararía en todas las tarjetas aprobadas
      // a la vez. Mismo mecanismo que `cutoffs_source`: la ausencia se declara.
      slots_source: slots === null ? 'unavailable' : 'ok',
      // ── EL CAMPO `approval` SE RETIRÓ ACÁ · U-6, 2026-09-13 ──────────────────────
      // NACIÓ en SIGN-01 corte E como un booleano DE BANDEJA: decía si esta pantalla entera
      // podía aprobar. U-4 lo marcó `deprecated:true` al mover la respuesta al nivel de la
      // PIEZA (`pieces[].actions`, una entrada por acción con su motivo), U-5 le quitó el
      // último lector, y U-6 lo borra porque ya no lo lee nadie [barrido sobre `src/`].
      //
      // Lo que queda escrito, que es lo que se pierde al borrar sin nota: la disponibilidad
      // NUNCA fue una propiedad de la bandeja. Lo que se puede hacer con una pieza depende
      // de SU ESTADO, no de la pantalla donde se la mire — y un campo de nivel superior que
      // afirme lo contrario vuelve a meter la decisión en el front por la puerta de atrás.
      //
      // Y la lección de método: un campo `deprecated` que nadie retira deja de ser una señal
      // y pasa a ser decoración. Éste duró dos cortes, que es lo que tenía que durar.
      cutoffs_source: cutoffsRaw === null ? 'unavailable' : (cutoffs.length ? 'seeded' : 'empty'),
      ...(truncated ? { truncated: true } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[publish-queue]', message);
    return res.status(500).json({ error: 'publish_queue_failed', message });
  }
}
