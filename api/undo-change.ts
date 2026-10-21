/**
 * UNRLVL Orchestrator — api/undo-change.ts  (DESHACER · 2026-10-21)
 *
 * POST /api/undo-change  { piece_id }
 *   Auth: admin JWT (Authorization: Bearer o body.session_token)
 *
 * Vuelve la pieza a la versión anterior de LO ÚLTIMO QUE CAMBIÓ: la imagen (`restore_image` del motor,
 * índice 0) o el texto (`piece-edit` con el texto anterior). Qué se deshace lo decide `planUndo`
 * (`_undo.ts`), que es puro y tiene su test.
 *
 * ── NO REIMPLEMENTA NINGUNA MUTACIÓN ─────────────────────────────────────────────────────────
 * Las dos vías ya existen y ya dejan su rastro: `restore_image` guarda la imagen deshecha en su
 * historial y escribe `piece_edits`; `piece-edit` registra el diff antes de aplicar y corre la guarda.
 * Este endpoint sólo elige cuál llamar.
 *
 * ── UNA PIEZA AGENDADA SIGUE AGENDADA ────────────────────────────────────────────────────────
 * Deshacer lo pide Sam: es su corrección de último momento. El trigger `vigila_lo_aprobado`
 * (unrlvl-iid-functions, migración 20261022010000) lo reconoce por la firma de cada vía (`restored.by`,
 * `edited_by`) y no lo manda a Arreglos. El texto de una agendada necesita la EF `piece-edit` que
 * acepta `scheduled` (mismo PR); antes de desplegarla, la EF responde 409 y aquí se propaga tal cual.
 *
 * ── SI NO SE PUEDE SABER QUÉ FUE LO ÚLTIMO, NO SE DESHACE NADA ───────────────────────────────
 * Si `piece_edits` no se puede leer, deshacer la imagen podría deshacer el cambio equivocado: 503.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, extractToken, ensureArtifact, fetchPiece, SB_URL, SB_KEY } from './_calibrationShared.js';
import { requireReviewer, guardPiece } from './_reviewScope.js';
import { callEdgeFunction, parseBody } from './_challengedShared.js';
import { fetchWithTimeout } from './_fetchWithTimeout.js';
import { planUndo, UNDO_TEXT_FIELDS, type TextEditRow } from './_undo.js';

async function readTextEdits(pieceId: string): Promise<TextEditRow[] | null> {
  const url = `${SB_URL()}/rest/v1/piece_edits?piece_id=eq.${encodeURIComponent(pieceId)}`
    + `&field=in.(${UNDO_TEXT_FIELDS.join(',')})&select=field,before_text,created_at&order=created_at.desc&limit=20`;
  try {
    const res = await fetchWithTimeout('db', url, {
      headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Accept-Profile': 'intel' },
    });
    if (!res.ok) return null;
    const rows = await res.json().catch(() => null);
    return Array.isArray(rows) ? (rows as TextEditRow[]) : null;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = parseBody(req);
  const session = await requireReviewer(req, res, extractToken(req, body));
  if (!session) return;

  const pieceId = typeof body.piece_id === 'string' ? body.piece_id.trim() : '';
  if (!pieceId) return res.status(400).json({ error: 'piece_id required' });
  if (!(await guardPiece(res, session, pieceId))) return;
  const by = session.sub || 'sam';

  try {
    const piece = await fetchPiece(pieceId);
    if (!piece) return res.status(404).json({ error: 'not_found' });
    if (piece.status === 'published') {
      return res.status(409).json({ error: 'already_published', detail: 'La pieza ya salió: deshacer en la base no cambia lo publicado.' });
    }
    if (piece.discarded_at) {
      return res.status(409).json({ error: 'piece_already_sealed', detail: 'La pieza está sellada (descartada).' });
    }

    const edits = await readTextEdits(pieceId);
    if (edits === null) {
      return res.status(503).json({
        error: 'undo_history_unavailable',
        detail: 'No se pudo leer el historial de ediciones: sin él no se sabe qué fue lo último que cambió. No se deshizo nada.',
      });
    }

    const plan = planUndo(piece.assets, edits);
    if (plan.kind === 'nothing') return res.status(409).json({ error: 'nothing_to_undo', detail: plan.reason });

    const ef = plan.kind === 'image'
      ? await callEdgeFunction('content-run-stage', { action: 'restore_image', piece_id: pieceId, index: 0, edited_by: by })
      : await callEdgeFunction('piece-edit', {
        piece_id: pieceId,
        edits: [{ field: plan.field, after_text: plan.restore_to, edit_reason: 'deshacer' }],
        edited_by: by,
        // Volver a un texto que ya estuvo publicado o aprobado no es insistir contra una regla nueva.
        acknowledge_warnings: true,
      });
    if (ef.status >= 400 || ef.body?.ok === false) {
      return res.status(ef.status >= 400 ? ef.status : 422).json({
        error: 'undo_failed', undone: plan.kind,
        detail: ef.body?.error ?? 'el motor no volvió a la versión anterior',
        server_detail: typeof ef.body?.error === 'string' ? ef.body.error : null,
      });
    }

    let html: string | null = null;
    let artifact_url: string | null = null;
    try { const art = await ensureArtifact(pieceId); html = art.html; artifact_url = art.artifact_url; }
    catch (err) { console.error(`[undo-change] ${pieceId}: deshecho pero el artefacto NO se rehízo: ${String(err)}`); }

    return res.status(200).json({
      ok: true, piece_id: pieceId,
      undone: plan.kind === 'image' ? 'image' : plan.field,
      changed_at: plan.at,
      ...(plan.kind === 'text' ? { after_text: plan.restore_to } : { image_url: ef.body?.image_url ?? null }),
      artifact_url, html, artifact_refreshed: html !== null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[undo-change]', message);
    return res.status(500).json({ error: 'undo_failed', message });
  }
}
