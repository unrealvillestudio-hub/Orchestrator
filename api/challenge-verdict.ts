/**
 * UNRLVL Orchestrator — api/challenge-verdict.ts  (CALIB-01-E · corte 1)
 *
 * Arbitra UN desacuerdo entre el juez y la verificación determinista.
 *
 * POST /api/challenge-verdict
 *   Auth: admin JWT (Authorization: Bearer o body.session_token)
 * Body: { id: string, verdict: 'judge_was_right' | 'rule_failed', note?: string }
 *
 *   judge_was_right → el patrón es incompleto; el incumplimiento era real y la pieza se
 *                     descarta.
 *   rule_failed     → falso positivo; se acumula contra la regla y la pieza sigue a
 *                     aprobación como `pass_type='assisted'`.
 *
 * ── NO REIMPLEMENTA LA MUTACIÓN ──────────────────────────────────────────────────
 * Delega en la Edge Function `judge-arbitration` (CALIB-01 corte C), donde ya viven la
 * idempotencia por id, el anclaje a `verdict IS NULL` (dos árbitros simultáneos no se
 * pisan) y la regla de que si el arbitraje no se registra la pieza NO se mueve. Duplicar
 * eso acá sería una segunda fuente de verdad que divergiría en el primer cambio.
 *
 * Lo que este endpoint aporta es lo que la EF no puede: el gate de rol admin. La EF corre
 * con service_role y no ve quién es Sam; acá se verifica el JWT y `decided_by` sale de la
 * SESIÓN, no del body — un arbitraje que se pudiera firmar con el nombre de otro no sería
 * auditable, y la calibración vale por ser trazable hasta quien la firmó.
 *
 * ── IDEMPOTENTE, que es lo que hace barato el `undo` ─────────────────────────────
 * Un segundo POST sobre un arbitraje ya decidido NO lo pisa: la EF responde 409 con el
 * veredicto vigente y acá se propaga tal cual, con `already_decided:true` para que la
 * bandeja lo muestre sin tratarlo como un fallo.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, extractToken, requireAdmin } from './_calibrationShared.js';
import {
  CHALLENGE_VERDICTS, callEdgeFunction, fetchChallenge, parseBody,
  type ChallengeVerdict,
} from './_challengedShared.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = parseBody(req);
  const session = requireAdmin(req, res, extractToken(req, body));
  if (!session) return; // requireAdmin ya respondió

  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) return res.status(400).json({ error: 'id required' });

  const verdict = body.verdict as ChallengeVerdict;
  if (!CHALLENGE_VERDICTS.includes(verdict)) {
    return res.status(400).json({ error: `verdict must be one of: ${CHALLENGE_VERDICTS.join(', ')}` });
  }

  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;

  try {
    const out = await callEdgeFunction('judge-arbitration', {
      calibration_id: id,
      verdict,
      // De la SESIÓN, nunca del body: un arbitraje firmable con el nombre de otro no es
      // auditable, y toda la calibración se apoya en esa trazabilidad.
      decided_by: session.sub || 'sam',
      note,
    });

    if (out.status === 409) {
      // Ya decidido: no es un fallo, es la idempotencia funcionando. Se devuelve el estado
      // vigente para que la bandeja lo refleje en vez de dejar la fila en un limbo.
      const row = await fetchChallenge(id);
      return res.status(200).json({
        ok: true, already_decided: true, id,
        verdict: row?.verdict ?? out.body?.verdict ?? null,
        decided_by: row?.decided_by ?? null,
        decided_at: row?.decided_at ?? null,
      });
    }

    if (out.status !== 200) return res.status(out.status).json(out.body);

    return res.status(200).json({ ok: true, already_decided: false, id, verdict, ...out.body });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[challenge-verdict]', message);
    return res.status(500).json({ error: 'verdict_failed', message });
  }
}
