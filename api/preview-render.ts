/**
 * UNRLVL Orchestrator — api/preview-render.ts  (B4 · Fase 1, Pieza 2)
 *
 * Renderiza el ARTEFACTO de preview de una content_piece (HTML autocontenido) y lo
 * sube al Storage CDN (`unrlvl-media`). Muestra la pieza TAL COMO SALDRÍA: marca +
 * plataforma, imagen si la hay, título, texto completo. Evaluador-agnóstico (vive en
 * el CDN, independiente de quién juzga). Regla de veracidad: literal, no re-escribe.
 *
 * Timing = LAZY (opción b del brief): se genera bajo demanda desde la bandeja la
 * primera vez que se muestra la pieza. NO toca el carril validado. Idempotente.
 *
 * Node-native `(req, res)`. Toda la lógica vive en _calibrationShared.ts (importado
 * con extensión .js — convención ESM del repo, ver calibrate.ts → _craftModules.js).
 *
 * POST /api/preview-render
 * Body: { piece_id: string, session_token?: string }   (token también vía Authorization: Bearer)
 * Returns: { ok: true, piece_id, artifact_url }         (200) · 404 si la pieza no existe.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  applyCors, extractToken, requireAdmin, ensureArtifact, PieceNotFound,
} from './_calibrationShared.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body: { piece_id?: string; session_token?: string } = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); } catch { /* keep empty */ }

  const session = requireAdmin(req, res, extractToken(req, body));
  if (!session) return; // requireAdmin ya respondió

  const pieceId = typeof body.piece_id === 'string' ? body.piece_id.trim() : '';
  if (!pieceId) return res.status(400).json({ error: 'piece_id required' });

  try {
    const { artifact_url } = await ensureArtifact(pieceId);
    return res.status(200).json({ ok: true, piece_id: pieceId, artifact_url });
  } catch (err) {
    if (err instanceof PieceNotFound) return res.status(404).json({ error: 'piece_not_found', piece_id: pieceId });
    const message = err instanceof Error ? err.message : String(err);
    console.error('[preview-render]', message);
    return res.status(500).json({ error: 'render_failed', message });
  }
}
