/**
 * UNRLVL Orchestrator — api/publish-queue.ts  (PUBLISH-UI-01 · parcial de SOLO LECTURA)
 *
 * Lista las piezas candidatas a salir, con su canal de destino y el estado operativo de
 * ese canal. NO aprueba, NO programa, NO publica — ver `_publishShared.ts` y el cuerpo del
 * PR: el eje de colocación de una pieza producida en la franja de su canal no existe
 * todavía en el ecosistema, y una interfaz que prometa una fecha que nadie honra es peor
 * que no tener el botón.
 *
 * Fuente y filtros:
 *   1. `content.content_pieces` con `discarded_at IS NULL`     (base común con calibración)
 *   2. estado no resuelto — fuera `scheduled/published/rejected/failed`
 *   3. la última versión por `queue_id`                        (una tarjeta por pieza)
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
  type ContentPiece, type PipelineCutoff, type GenerationInfo,
} from './_calibrationShared.js';
import {
  RESOLVED_STATUSES, fetchPublishChannels, channelOf, channelBlocks,
  type ChannelInfo, type PublishablePiece,
} from './_publishShared.js';
// FIX-CARD-06 — misma cabecera que la bandeja de calibración, mismos catálogos leídos en
// runtime. Las dos bandejas cuentan lo mismo porque llaman a la misma función.
import { fetchPlatformLimits, fetchSignatureClosers, metricsOf } from './_pieceMetrics.js';

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

  try {
    // Sin filtro de marca en la lectura: by_brand tiene que ser global y estable aunque
    // venga filtro. Los cortes se leen en runtime (cero fechas de corte en el código).
    const [allPieces, cutoffsRaw, channels, limits, closers] = await Promise.all([
      fetchLivePieces({ excludeStatuses: RESOLVED_STATUSES }),
      fetchPipelineCutoffs(),
      fetchPublishChannels(),
      fetchPlatformLimits(),
      fetchSignatureClosers(),
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

    // Procedencia: sólo para la página visible (el `in.()` de PostgREST crece con la lista).
    const [traces, attempts] = await Promise.all([
      fetchWatcherTraces(page.map((p) => p.orchestrator_job_id ?? '')),
      fetchAttemptsByQueue(page.map((p) => p.queue_id ?? '')),
    ]);

    const pieces: PublishablePiece[] = page.map((p) => ({
      ...toContext(p, {
        trace: p.orchestrator_job_id ? traces.get(p.orchestrator_job_id) : undefined,
        attempts: p.queue_id ? (attempts.get(p.queue_id) ?? null) : null,
        generation: genById.get(p.id),
        metrics: metricsOf(p, limits, closers),
      }),
      channel: channelById.get(p.id) ?? channelOf(p, channels),
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
      pieces,
      // El estado de la acción viaja en el contrato, no en una constante de la UI: cuando el
      // eje de colocación exista, se habilita acá y la interfaz lo refleja sin tocar el front.
      // SIGN-01 corte E — el motivo estaba OBSOLETO: decía que el eje de colocación no existía, y
      // existe desde PLACE-01 (content-scheduler modo `placement`, cron 66, franjas calculadas contra
      // cadencia real). Un aviso que describe un sistema que ya cambió es peor que ninguno: enseña a
      // desconfiar de los avisos.
      //
      // La bandeja de publicación sigue sin aprobar, pero por otro motivo y por diseño: aprobar es
      // del carril de CALIBRACIÓN, que es donde se juzga la pieza. Ésta muestra a dónde va y si el
      // canal está operativo.
      approval: {
        available: false,
        reason: 'Esta bandeja no aprueba por diseño: la aprobación vive en la bandeja de calibración, '
          + 'que es donde se juzga la pieza. Aprobar allá sella la habilitación y content-scheduler '
          + '(modo placement) calcula la franja. Acá se ve a dónde va cada pieza y si su canal está operativo.',
      },
      cutoffs_source: cutoffsRaw === null ? 'unavailable' : (cutoffs.length ? 'seeded' : 'empty'),
      ...(truncated ? { truncated: true } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[publish-queue]', message);
    return res.status(500).json({ error: 'publish_queue_failed', message });
  }
}
