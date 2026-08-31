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
  type ContentPiece, type PipelineCutoff, type GenerationInfo,
} from './_calibrationShared.js';
// FIX-CARD-06 — los topes del canal y la firma esperada son DATO: se leen acá, una vez
// por request, y viajan resueltos en cada pieza. La UI no conoce ni un tope.
import { fetchPlatformLimits, fetchSignatureClosers, metricsOf } from './_pieceMetrics.js';

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

  try {
    // Se lee sin filtro de marca para que by_brand sea global y estable aunque venga
    // filtro; los cortes se leen en runtime (nunca hay fechas de corte en este código).
    const [allPieces, evaluated, cutoffsRaw, limits, closers] = await Promise.all([
      fetchCalibrationPieces(),
      fetchEvaluatedIds(),
      fetchPipelineCutoffs(),
      fetchPlatformLimits(),
      fetchSignatureClosers(),
    ]);
    const cutoffs: PipelineCutoff[] = cutoffsRaw ?? [];

    // 1. sin fila en el corpus · 2. última versión por queue_id
    const pending  = allPieces.filter((p) => !evaluated.has(p.id));
    const perPiece = latestPerQueue(pending);

    // Generación de cada pieza (se calcula una vez: filtra, ordena y viaja a la tarjeta).
    const genById = new Map<string, GenerationInfo>();
    for (const p of perPiece) genById.set(p.id, generationOf(p, cutoffs));

    // Filtros transversales (veredicto y generación) — antes de by_brand.
    let scoped = perPiece;
    if (verdict !== 'all') scoped = scoped.filter((p) => watcherOf(p).result === verdict);
    if (generation === 'current') scoped = scoped.filter((p) => genById.get(p.id)?.generation === 'current');

    const by_brand: Record<string, number> = {};
    for (const p of scoped) by_brand[p.brand_id] = (by_brand[p.brand_id] ?? 0) + 1;

    // Filtro de marca (si vino) y orden.
    const inBrand = brand ? scoped.filter((p) => p.brand_id === brand) : scoped;
    const ordered = sortPieces(inBrand, order);
    const page    = ordered.slice(offset, offset + limit);

    // Procedencia: sólo para la página visible (el `in.()` de PostgREST crece con la lista).
    const [traces, attempts] = await Promise.all([
      fetchWatcherTraces(page.map((p) => p.orchestrator_job_id ?? '')),
      fetchAttemptsByQueue(page.map((p) => p.queue_id ?? '')),
    ]);

    const pieces = page.map((p) => toContext(p, {
      trace: p.orchestrator_job_id ? traces.get(p.orchestrator_job_id) : undefined,
      attempts: p.queue_id ? (attempts.get(p.queue_id) ?? null) : null,
      generation: genById.get(p.id),
      metrics: metricsOf(p, limits, closers),
    }));

    const truncated = allPieces.length >= PIECES_CAP;
    if (truncated) {
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
      pieces,
      // Por qué la generación puede venir 'unknown': tabla ausente vs tabla vacía.
      cutoffs_source: cutoffsRaw === null ? 'unavailable' : (cutoffs.length ? 'seeded' : 'empty'),
      ...(truncated ? { truncated: true } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[calibration-queue]', message);
    return res.status(500).json({ error: 'queue_failed', message });
  }
}
