/**
 * UNRLVL Orchestrator — api/recompose-image.ts (BRIEF-N05 cambio 2)
 *
 * REGENERAR LA IMAGEN DE UNA PIEZA, SIN SALIR DE LA BANDEJA Y SIN EMITIR VEREDICTO.
 *
 * POST /api/recompose-image
 *   Auth: admin JWT (Authorization: Bearer o body.session_token)
 * Body: {
 *   piece_id: string,
 *   visual_directive: string,      // la directriz redactada para el generador
 *   edit_reason?: string           // en palabras de quien la pide, si se quiere registrar
 * }
 * Returns 200: { ok, piece_id, image_url, artifact_url, html,
 *                visual_directive_domain, visual_directive_piece }
 *
 * ─── POR QUÉ ESTA RUTA NO TOCA EL VEREDICTO ──────────────────────────────────────────
 * `fixable` SELLA la pieza: `verdictEffect` le escribe `status:'rejected'` y `discarded_at`,
 * y la bandeja lista `discarded_at IS NULL`. Una corrección que pasara por ahí entregaría la
 * imagen nueva sobre una pieza que ya nadie va a publicar. Por eso la regeneración va ANTES
 * del veredicto y es independiente de los tres: se corrige, se mira, y RECIÉN DESPUÉS se vota.
 * Decisión de Sam del 2026-09-06, opción (C).
 *
 * ─── POR QUÉ SE VUELVE A RENDERIZAR EL ARTEFACTO ─────────────────────────────────────
 * La tarjeta embebe el artefacto, no la imagen: sin re-render, la pieza tendría la imagen
 * nueva en la base y la vieja en pantalla, y quien mira concluiría que la corrección no
 * funcionó. `ensureArtifact` es idempotente y reconstruye el HTML desde la pieza ya
 * actualizada, así que el `html` que vuelve es el de la imagen corregida.
 *
 * ─── PATRÓN CICATRIZ ─────────────────────────────────────────────────────────────────
 * Firma Node-native `(req: VercelRequest, res: VercelResponse)`, la misma de trigger-job.ts
 * v4.2. La firma Web API `(req: Request): Promise<Response>` NO existe en el runtime Node de
 * Vercel: el handler cuelga hasta el timeout de 300 s. Verificado en producción el 2026-07-16.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  applyCors, extractToken, requireAdmin, ensureArtifact, fetchPiece, PieceNotFound,
} from './_calibrationShared.js';
import { callEdgeFunction } from './_challengedShared.js';

/**
 * Mismo techo que declara el motor (`SCENE_DIRECTIVE_MAX_CHARS` en content-run-stage). Se valida
 * acá TAMBIÉN para que quien escribe lo sepa antes de pagar el viaje, no para sustituir al motor:
 * el rechazo de verdad lo hace él, que es donde la regla vive.
 */
export const DIRECTIVE_MAX_CHARS = 600;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body: {
    piece_id?: string; visual_directive?: string; edit_reason?: string; session_token?: string;
  } = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); } catch { /* keep empty */ }

  const session = requireAdmin(req, res, extractToken(req, body));
  if (!session) return; // requireAdmin ya respondió

  const pieceId = typeof body.piece_id === 'string' ? body.piece_id.trim() : '';
  if (!pieceId) return res.status(400).json({ error: 'piece_id required' });

  // La directriz es OBLIGATORIA, y va al revés que el criterio de un veredicto. No es una
  // incoherencia: un criterio explica un juicio ya tomado y puede llegar después, mientras que
  // aquí la directriz ES la operación. Regenerar sin ella devuelve la misma imagen con el mismo
  // defecto y cobra una generación por no cambiar nada.
  const directive = typeof body.visual_directive === 'string' ? body.visual_directive.trim() : '';
  if (!directive) {
    return res.status(400).json({
      error: 'visual_directive required',
      detail: 'regenerar sin directriz devuelve el mismo defecto y cobra una generación por no cambiar nada',
    });
  }
  if (directive.length > DIRECTIVE_MAX_CHARS) {
    return res.status(400).json({
      error: 'visual_directive too long',
      detail: `${directive.length} caracteres, el techo es ${DIRECTIVE_MAX_CHARS}. Se rechaza entera en vez de recortarla: `
        + 'media directriz corrige media cosa y lo parecería todo.',
    });
  }

  const editReason = typeof body.edit_reason === 'string' ? body.edit_reason.trim() : '';

  try {
    // Fail-loud ANTES de gastar una generación: una pieza que no existe, o que ya está sellada,
    // no se corrige. Regenerar sobre una pieza descartada dejaría una imagen nueva colgada de algo
    // que nadie va a publicar — que es exactamente el defecto que la opción (C) vino a evitar.
    const piece = await fetchPiece(pieceId);
    if (!piece) throw new PieceNotFound(pieceId);
    if (piece.discarded_at) {
      return res.status(409).json({
        error: 'piece_already_sealed',
        detail: 'la pieza ya está sellada (descartada o con veredicto): la corrección va ANTES del veredicto, no después',
        discarded_at: piece.discarded_at,
      });
    }

    const ef = await callEdgeFunction('content-run-stage', {
      action: 'recompose',
      piece_id: pieceId,
      // Explícito, aunque el motor ya lo deduzca de la directriz: quien lea este cuerpo en un log
      // tiene que poder saber que esto CUESTA una generación, sin ir a leer el motor.
      regenerate_image: true,
      visual_directive: directive,
      edit_reason: editReason || null,
      edited_by: session.sub || 'sam',
    });

    // El status de la EF se propaga sin traducir, igual que en `callEdgeFunction`: el motor ya
    // distingue la directriz demasiado larga, la contradicción con `regenerate_image` y el fallo de
    // generación, y re-mapearlos acá obligaría a la interfaz a adivinar cuál de los tres pasó.
    if (!ef.body?.ok) {
      return res.status(ef.status >= 400 ? ef.status : 422).json({
        error: 'recompose_failed',
        detail: ef.body?.error ?? 'el motor no devolvió una imagen',
        server_detail: typeof ef.body?.error === 'string' ? ef.body.error : null,
      });
    }

    // El artefacto se rehace DESPUÉS y desde la pieza ya actualizada. Si esto fallara, la imagen
    // corregida ya está en la base: se dice, y no se finge que la operación entera falló.
    let html: string | null = null;
    let artifact_url: string | null = null;
    try {
      const art = await ensureArtifact(pieceId);
      html = art.html;
      artifact_url = art.artifact_url;
    } catch (err) {
      console.error(`[recompose-image] ${pieceId}: imagen regenerada pero el artefacto NO se rehízo: ${String(err)}`);
    }

    return res.status(200).json({
      ok: true,
      piece_id: pieceId,
      image_url: ef.body.image_url ?? null,
      visual_directive_domain: ef.body.visual_directive_domain ?? null,
      visual_directive_piece: ef.body.visual_directive_piece ?? null,
      composed: ef.body.composed === true,
      scheduled_posts_updated: ef.body.scheduled_posts_updated ?? 0,
      artifact_url,
      html,
      // Que el artefacto no se haya podido rehacer NO es que la imagen no cambió. Son dos cosas
      // distintas y la interfaz tiene que poder decir cuál pasó.
      artifact_refreshed: html !== null,
    });
  } catch (err) {
    if (err instanceof PieceNotFound) {
      return res.status(404).json({ error: 'piece_not_found', detail: `la pieza ${pieceId} no existe` });
    }
    console.error(`[recompose-image] ${pieceId}: ${String(err)}`);
    return res.status(500).json({ error: 'recompose_failed', detail: String(err instanceof Error ? err.message : err) });
  }
}
