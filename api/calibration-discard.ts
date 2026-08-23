/**
 * UNRLVL Orchestrator — api/calibration-discard.ts  (CALIB-UI-01 §4.4)
 *
 * DESCARTAR ≠ RECHAZAR.
 *   Rechazar dice "esto está mal"       → entra al corpus como `rejected`.
 *   Descartar dice "no voy a juzgar esto" → NO entra al corpus.
 * Confundirlos mete ruido en el material de entrenamiento: un descarte registrado como
 * rechazo enseña un criterio que nadie sostuvo.
 *
 * Este endpoint sella `discarded_at` + `discarded_reason` en `content.content_pieces`
 * y NADA MÁS. No escribe en `intel.approval_calibration`, no publica, no toca el carril.
 * La pieza sale de la bandeja porque la consulta filtra `discarded_at IS NULL`.
 *
 * Las columnas ya existían (con GRANT a service_role y el índice parcial
 * `content_pieces_pendientes_calibracion_idx`); este PR no las crea.
 *
 * POST /api/calibration-discard
 *   Auth: admin JWT (Authorization: Bearer o body.session_token)
 * Body: { piece_id: string, reason?: string }   — reason OPCIONAL (párrafo libre)
 * Returns 200: { ok: true, piece_id, discarded_at, discarded_reason }
 *         404 piece_not_found · 409 already_discarded (no se pisa un descarte previo)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  applyCors, extractToken, requireAdmin,
  discardPiece, PieceNotFound, AlreadyDiscarded,
} from './_calibrationShared.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body: { piece_id?: string; reason?: string; session_token?: string } = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); } catch { /* keep empty */ }

  const session = requireAdmin(req, res, extractToken(req, body));
  if (!session) return; // requireAdmin ya respondió

  const pieceId = typeof body.piece_id === 'string' ? body.piece_id.trim() : '';
  if (!pieceId) return res.status(400).json({ error: 'piece_id required' });

  // Motivo opcional: obligar a escribir empuja a poner cualquier cosa para avanzar.
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;

  try {
    const piece = await discardPiece(pieceId, reason);
    return res.status(200).json({
      ok: true,
      piece_id: piece.id,
      discarded_at: piece.discarded_at ?? null,
      discarded_reason: piece.discarded_reason ?? null,
    });
  } catch (err) {
    if (err instanceof PieceNotFound) return res.status(404).json({ error: 'piece_not_found', piece_id: pieceId });
    if (err instanceof AlreadyDiscarded) {
      return res.status(409).json({ error: 'already_discarded', piece_id: pieceId, discarded_at: err.discarded_at });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error('[calibration-discard]', message);
    return res.status(500).json({ error: 'discard_failed', message });
  }
}
