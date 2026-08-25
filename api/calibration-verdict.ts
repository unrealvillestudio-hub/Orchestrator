/**
 * UNRLVL Orchestrator — api/calibration-verdict.ts  (B4 · Fase 1, Pieza 3)
 *
 * Guarda UN veredicto humano en el corpus `intel.approval_calibration`.
 * El veredicto queda atado al código del output (piece_id) junto con TODO el contexto
 * copiado de la pieza y el artifact_url. Ese vínculo es el activo.
 *
 * POST /api/calibration-verdict
 *   Auth: admin JWT (Authorization: Bearer o body.session_token)
 * Body: {
 *   piece_id: string,
 *   verdict: 'approved' | 'rejected',
 *   criterion?: string,            // OPCIONAL en ambos veredictos (párrafo libre)
 *   evaluated_by?: string          // default 'sam'
 * }
 * Returns 200: { ok: true, row }   (la fila del corpus, con contexto completo)
 *
 * Reglas:
 *  · Criterio en prosa, NO categorías, y SIEMPRE opcional (CALIB-UI-01 §2/§4.4). El
 *    criterio se razona en el chat con Claude, no en la interfaz: obligar a escribirlo
 *    acá empuja a poner cualquier cosa para avanzar, y eso envenena el corpus con ruido
 *    que parece señal. Un rechazo sin criterio es una fila honesta que Claude completa
 *    después; un rechazo con criterio de relleno es una fila que miente.
 *  · UPSERT por piece_id (una pieza = una fila; re-evaluar sobrescribe).
 *  · Garantiza el artefacto (render idempotente) antes del UPSERT → artifact_url del
 *    corpus SIEMPRE apunta a un artefacto real, aunque nadie lo haya visto en la bandeja.
 *  · SIGN-01 corte A2 — LA DECISIÓN SE EJECUTA. Hasta acá este endpoint escribía el corpus y NADA
 *    más: las 6 decisiones de Sam del 2026-08-25 dejaron las 6 piezas exactamente como estaban. No
 *    había flujo, había opiniones registradas.
 *      approved → status='scheduled' + approved_at + approved_by (desde la SESIÓN)
 *      rejected → status='rejected' + discarded_at + discarded_reason (el motivo estructurado)
 *    El efecto va DESPUÉS del upsert: si el corpus falla, la pieza no se mueve — mover una pieza sin
 *    registrar por qué es el mismo defecto, del otro lado.
 *  · APROBAR SIGUE SIN PUBLICAR. Sella la habilitación, que es lo que el modo `placement` de
 *    content-scheduler exige para ver la pieza; la franja la calcula él y de ahí sale a SocialLab.
 *    No se toca scheduled_posts.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  applyCors, extractToken, requireAdmin,
  ensureArtifact, toContext, watcherRulesForCorpus, upsertVerdict, applyVerdictToPiece, PieceNotFound,
} from './_calibrationShared.js';

type Verdict = 'approved' | 'rejected';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body: { piece_id?: string; verdict?: string; criterion?: string; evaluated_by?: string; session_token?: string } = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); } catch { /* keep empty */ }

  const session = requireAdmin(req, res, extractToken(req, body));
  if (!session) return; // requireAdmin ya respondió

  const pieceId = typeof body.piece_id === 'string' ? body.piece_id.trim() : '';
  if (!pieceId) return res.status(400).json({ error: 'piece_id required' });

  const verdict = body.verdict as Verdict;
  if (verdict !== 'approved' && verdict !== 'rejected') {
    return res.status(400).json({ error: "verdict must be 'approved' or 'rejected'" });
  }

  // Criterio opcional en los dos veredictos: la DB lo deja nullable y el corpus prefiere
  // una fila sin criterio a una con relleno. Lo escribe Claude desde el chat, después.
  const criterion = typeof body.criterion === 'string' ? body.criterion.trim() : '';

  const evaluated_by = (typeof body.evaluated_by === 'string' && body.evaluated_by.trim())
    ? body.evaluated_by.trim()
    : (session.sub || 'sam');

  try {
    // Garantiza el artefacto y trae la pieza (fail-loud si no existe).
    const { artifact_url, piece } = await ensureArtifact(pieceId);
    const ctx = toContext(piece); // ya incluye artifact_url determinística (coincide con el garantizado)
    // Nivel de regla, en forma nullable para el corpus (NULL si el bloque no lo trae; nunca []).
    const corpusRules = watcherRulesForCorpus(piece);

    const row = await upsertVerdict({
      piece_id: ctx.piece_id,
      brand_id: ctx.brand_id,
      voice: ctx.voice,
      domain: ctx.domain,
      platform: ctx.platform,
      format: ctx.format,
      psycho_preset: ctx.psycho_preset,
      audience_frame: ctx.audience_frame,
      artifact_url, // el recién garantizado (idéntico a ctx.artifact_url)
      verdict,
      criterion: criterion || null, // sin criterio → NULL (nunca '' ni relleno)
      evaluated_by,
      // Primera opinión del watcher, copiada de la pieza (para comparar Sam vs watcher).
      watcher_result: ctx.watcher_result,
      watcher_gate: ctx.watcher_gate,
      // Nivel de regla: qué códigos dispararon y contra cuántas se juzgó. NULL = no registrado.
      watcher_rules: corpusRules.rules,
      watcher_rules_evaluated: corpusRules.rules_evaluated,
    });

    // SIGN-01 corte A2 — y ahora la pieza se mueve. `evaluated_by` viene de la sesión, así que el
    // sello de aprobación queda trazable hasta quien lo firmó.
    const piece_effect = await applyVerdictToPiece(pieceId, verdict, evaluated_by, criterion || null);
    if (!piece_effect) {
      // Otro operador la movió primero. El corpus ya quedó escrito —la opinión de Sam vale igual— y
      // se dice que la pieza no se tocó, en vez de fingir que sí.
      console.warn(`[calibration-verdict] ${pieceId}: corpus escrito, pieza NO movida (ya descartada por otra mano)`);
      return res.status(200).json({ ok: true, row, piece_applied: false, piece_status: null });
    }

    return res.status(200).json({
      ok: true, row,
      piece_applied: true,
      piece_status: piece_effect.status ?? null,
      // Se dice explícito porque es la confusión que este corte cierra: habilitar no es publicar.
      published: false,
      note: verdict === 'approved'
        ? 'habilitada — la franja la calcula content-scheduler mode=placement'
        : 'rechazada y descartada — sale de la bandeja',
    });
  } catch (err) {
    if (err instanceof PieceNotFound) return res.status(404).json({ error: 'piece_not_found', piece_id: pieceId });
    const message = err instanceof Error ? err.message : String(err);
    console.error('[calibration-verdict]', message);
    return res.status(500).json({ error: 'verdict_failed', message });
  }
}
