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
 *  · NO publica: no toca content_pieces.status ni scheduled_posts. Fail-loud si no existe.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  applyCors, extractToken, requireAdmin,
  ensureArtifact, toContext, watcherRulesForCorpus, upsertVerdict, PieceNotFound,
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

    return res.status(200).json({ ok: true, row });
  } catch (err) {
    if (err instanceof PieceNotFound) return res.status(404).json({ error: 'piece_not_found', piece_id: pieceId });
    const message = err instanceof Error ? err.message : String(err);
    console.error('[calibration-verdict]', message);
    return res.status(500).json({ error: 'verdict_failed', message });
  }
}
