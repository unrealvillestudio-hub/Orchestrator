/**
 * UNRLVL Orchestrator — api/calibration-queue.ts  (B4 · Fase 1, Pieza 3)
 *
 * Cola de calibración: piezas en `content.content_pieces` con status
 * `awaiting_approval` que AÚN no tienen fila en `intel.approval_calibration`
 * (= pendientes de evaluar). La fuente de verdad de "ya evaluada" es la existencia
 * de la fila en el corpus — no un flag en content_pieces.
 *
 * El diff (awaiting − corpus) se hace en JS (sin RPC SECURITY DEFINER). Paginado en
 * bloques (default 50) para que Sam evalúe, cierre y vuelva donde quedó.
 *
 * GET /api/calibration-queue?limit=50&offset=0&brand=<opcional>
 *   Auth: admin JWT vía `Authorization: Bearer <session_token>` (NO en query — privacidad).
 * Returns 200: {
 *   total_pending: number,
 *   by_brand: { [brand_id]: number },     // desglose sobre TODAS las pendientes (sin filtro brand)
 *   limit, offset,
 *   pieces: PieceContext[]                 // el bloque pedido (con artifact_url determinística)
 * }
 *
 * NO publica, NO muta piezas. Solo lee.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  applyCors, extractToken, requireAdmin,
  fetchAwaitingPieces, fetchEvaluatedIds, toContext, AWAITING_CAP,
  type ContentPiece,
} from './_calibrationShared.js';

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const session = requireAdmin(req, res, extractToken(req));
  if (!session) return; // requireAdmin ya respondió

  const limit = intParam(req.query.limit, 50, 1, 200);
  const offset = intParam(req.query.offset, 0, 0, 10_000_000);
  const brand = strParam(req.query.brand);

  try {
    // Diff en JS: awaiting_approval − corpus. Evaluated se lee completo (todos los brands)
    // para que el desglose by_brand sea global y estable aunque venga filtro de marca.
    const [awaitingAll, evaluated] = await Promise.all([
      fetchAwaitingPieces(),   // sin filtro → base para by_brand + total
      fetchEvaluatedIds(),
    ]);

    const pendingAll: ContentPiece[] = awaitingAll.filter((p) => !evaluated.has(p.id));

    const by_brand: Record<string, number> = {};
    for (const p of pendingAll) by_brand[p.brand_id] = (by_brand[p.brand_id] ?? 0) + 1;

    // Filtro de marca (si vino) sobre las pendientes, preservando el orden created_at asc.
    const pendingScoped = brand ? pendingAll.filter((p) => p.brand_id === brand) : pendingAll;

    const pagepieces = pendingScoped.slice(offset, offset + limit).map(toContext);

    if (awaitingAll.length >= AWAITING_CAP) {
      console.warn(`[calibration-queue] awaiting hit cap ${AWAITING_CAP} — la cola puede estar truncada`);
    }

    return res.status(200).json({
      total_pending: brand ? pendingScoped.length : pendingAll.length,
      by_brand,
      limit,
      offset,
      pieces: pagepieces,
      ...(awaitingAll.length >= AWAITING_CAP ? { truncated: true } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[calibration-queue]', message);
    return res.status(500).json({ error: 'queue_failed', message });
  }
}
