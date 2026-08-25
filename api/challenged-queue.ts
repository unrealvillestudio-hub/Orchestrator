/**
 * UNRLVL Orchestrator — api/challenged-queue.ts  (CALIB-01-E · corte 1)
 *
 * Bandeja de RETENIDAS: lista los arbitrajes PENDIENTES (`verdict IS NULL`) de
 * `intel.judge_calibration`, con la pieza y la regla en disputa.
 *
 * GET /api/challenged-queue?limit=20&offset=0&brand=&rule=
 *   Auth: admin JWT vía `Authorization: Bearer <session_token>` (NO en query — privacidad).
 *
 * Returns 200: { total, by_brand, by_rule, limit, offset, rows[], contract }
 *
 * `by_brand` y `by_rule` se calculan ANTES del filtro homónimo: las pastillas muestran lo
 * que cada opción daría, que es el mismo criterio que ya aplica `calibration-queue`.
 *
 * `contract.available:false` cuando `intel.judge_calibration` todavía no existe — el estado
 * ESPERADO hasta que CALIB-01 (cortes A–D) se despliegue. La bandeja lo dice en pantalla en
 * vez de renderizar un vacío ambiguo: una bandeja sin retenidas y una bandeja sin tabla son
 * dos cosas distintas, y confundirlas es cómo se depura durante una hora un fallo que no
 * existe.
 *
 * NO muta nada. Solo lee.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, extractToken, requireAdmin } from './_calibrationShared.js';
import {
  fetchPendingChallenges, fetchPiecesByIds, fetchRuleStatements, toChallengedRow,
  CHALLENGED_CAP,
} from './_challengedShared.js';

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

  const limit  = intParam(req.query.limit, 20, 1, 200);
  const offset = intParam(req.query.offset, 0, 0, 10_000_000);
  const brand  = strParam(req.query.brand);
  const rule   = strParam(req.query.rule);

  try {
    // Se lee SIN filtro de marca para que los contadores sean estables aunque haya filtro
    // puesto — mismo criterio que calibration-queue con `by_brand`.
    const all = await fetchPendingChallenges();
    if (all === null) {
      return res.status(200).json({
        total: 0, by_brand: {}, by_rule: {}, limit, offset, rows: [],
        contract: {
          available: false,
          reason: 'intel.judge_calibration todavía no existe: CALIB-01 (cortes A–D) no está desplegado. La bandeja está vacía porque no hay de dónde leer, no porque no haya retenidas.',
        },
      });
    }

    const by_brand: Record<string, number> = {};
    const by_rule: Record<string, number> = {};
    for (const r of all) {
      by_brand[r.brand_id] = (by_brand[r.brand_id] ?? 0) + 1;
      by_rule[r.rule_code] = (by_rule[r.rule_code] ?? 0) + 1;
    }

    let scoped = all;
    if (brand) scoped = scoped.filter((r) => r.brand_id === brand);
    if (rule)  scoped = scoped.filter((r) => r.rule_code === rule);

    const page = scoped.slice(offset, offset + limit);

    // Pieza y enunciado sólo para la página visible: el `in.()` de PostgREST crece con la
    // lista, y el cuerpo de la pieza es lo más pesado de la respuesta.
    const [pieces, statements] = await Promise.all([
      fetchPiecesByIds(page.map((r) => r.piece_id ?? '')),
      fetchRuleStatements(page.map((r) => r.rule_code)),
    ]);

    const rows = page.map((r) => toChallengedRow(r, pieces, statements));

    const truncated = all.length >= CHALLENGED_CAP;
    if (truncated) console.warn(`[challenged-queue] judge_calibration hit cap ${CHALLENGED_CAP} — la bandeja puede estar truncada`);

    return res.status(200).json({
      total: scoped.length,
      by_brand, by_rule, limit, offset, rows,
      contract: { available: true, reason: null },
      ...(truncated ? { truncated: true } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[challenged-queue]', message);
    return res.status(500).json({ error: 'queue_failed', message });
  }
}
