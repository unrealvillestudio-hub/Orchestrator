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
 *   edit_reason?: string,          // en palabras de quien la pide, si se quiere registrar
 *   mode?: 'edit_from_current' | 'same_scene' | 'regenerate_full'   // BRIEF-IMG-01 fase 4 (2026-09-27); same_scene 2026-10-20
 *   restore_index?: number         // 2026-10-20 — volver a una imagen anterior (sin generar): ver `volverALaAnterior`
 *   slide_text?: { n, headline?, subheadline?, eyebrow?, steps?, text_place? }   // 2026-10-22 — el texto de la lámina
 *                                  // n (2..N) de un carrusel, sin generar: ver `textoDeLaLamina` y `_carouselText.ts`
 *   text_place?: 'top' | 'bottom' | 'auto' | null   // 2026-10-22 — la ubicación del texto de la imagen (y de la portada
 *                                  // de un carrusel), sola o con `overlay_override`, sin generar: ver `_textPlace.ts`
 * }
 * GET /api/recompose-image?piece_id= → { options (colores del resaltado), cast (En la escena), history (anteriores), overlay (texto vigente),
 *   shadow (la sombra de la marca), rule_options (colores del filete), identity_options (colores de la barra lateral),
 *   carousel (2026-10-22: las láminas con su texto, o null si la pieza no es un carrusel),
 *   text_place (2026-10-22: la ubicación del texto guardada en la imagen, o null) }
 *
 * ─── LOS DOS MODOS (BRIEF-IMG-01 fase 4) ─────────────────────────────────────────────
 * `edit_from_current` CORRIGE SOBRE LA IMAGEN ACTUAL: el generador recibe la imagen limpia vigente
 * como punto de partida y el prompt entero con todas las directrices acumuladas, así que cada
 * corrección continúa la anterior en vez de empezar de cero. `regenerate_full` REPINTA la escena.
 * Sin `mode`, el de siempre según el caso: con imagen, corregir sobre ella; sin imagen, repintar
 * (no hay de qué partir). Hasta el 2026-09-27 esta ruta no mandaba modo y el motor repintaba
 * siempre, aunque el modo de edición existía en ImageLab y en el carril desde la fase 3.
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
  applyCors, extractToken, ensureArtifact, fetchPiece, PieceNotFound, SB_URL, SB_KEY,
} from './_calibrationShared.js';
import { emphasisColorOptions, identityColorOptions, imageOverlayOf, ruleColorOptions, shadowOptionOf } from './_overlayText.js';
import { sceneCastOf, imageHistoryOf } from './_sceneCast.js';
import { fetchWithTimeout } from './_fetchWithTimeout.js';
// Quién puede usar este endpoint y sobre qué marcas: admin todo; un revisor, sólo las suyas.
import { requireReviewer, guardPiece, VISTAS_DE_PIEZA } from './_reviewScope.js';
import { callEdgeFunction } from './_challengedShared.js';
import { carouselTextViewOf, readSlideTextRequest } from './_carouselText.js';
import { readTextPlaceRequest, textPlaceOfImage } from './_textPlace.js';
import { readTextColumnRequest, textColumnOfImage } from './_textColumn.js';
import { readTextScaleRequest, textScaleOfImage } from './_textScale.js';
import { subBreaksOf, textColorOptions } from './_textStyle.js';
import { textStyleWantsItalic, textStyleWantsColor } from './_textStyleShape.js';

/**
 * Mismo techo que declara el motor (`SCENE_DIRECTIVE_MAX_CHARS` en content-run-stage). Se valida
 * aquí TAMBIÉN para que quien escribe lo sepa antes de pagar el viaje, no para sustituir al motor:
 * el rechazo de verdad lo hace él, que es donde la regla vive.
 */
export const DIRECTIVE_MAX_CHARS = 600;

// 2026-10-20 — 'same_scene': OTRA PERSONA, MISMA ESCENA (content-run-stage y ImageLab). Ver `MODE_HELP` en _sceneCast.
export const IMAGE_MODES = ['edit_from_current', 'same_scene', 'regenerate_full'] as const;
export type ImageMode = (typeof IMAGE_MODES)[number];

/** El modo que viaja al motor. Sin imagen no hay de qué partir: siempre se repinta. */
export function resolveRecomposeMode(requested: string | null, hasImage: boolean): ImageMode {
  if (!hasImage) return 'regenerate_full';
  if (requested === 'regenerate_full' || requested === 'same_scene') return requested;
  return 'edit_from_current';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  // 2026-10-19 — GET ?piece_id= : los colores que la marca de la pieza declara para el resaltado.
  if (req.method === 'GET') return coloresDelResaltado(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

  let body: {
    piece_id?: string; visual_directive?: string; edit_reason?: string; session_token?: string;
    mode?: string;
    // 2026-10-19 — el texto de la imagen escrito en la bandeja: { headline, subheadline?, emphasis? } o null.
    overlay_override?: unknown;
    // 2026-10-20 — volver a la imagen anterior número N (0 = la última que se reemplazó).
    restore_index?: unknown;
    // 2026-10-22 — el texto de una lámina 2..N de un carrusel (la portada va por `overlay_override`).
    slide_text?: unknown;
    // 2026-10-22 — la ubicación del texto de la imagen: 'top' | 'bottom' | 'auto' | null (ver `_textPlace.ts`).
    text_place?: unknown;
    // 2026-10-24 — la columna del texto de la imagen: 'left' | 'center' | 'right' | null (ver `_textColumn.ts`).
    text_column?: unknown;
    // 2026-10-28 — el tamaño del texto de la imagen: un número de 0,7 a 1,3 o null (ver `_textScale.ts`).
    text_scale?: unknown;
  } = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); } catch { /* keep empty */ }

  const session = await requireReviewer(req, res, extractToken(req, body), VISTAS_DE_PIEZA);
  if (!session) return; // requireReviewer ya respondió

  const pieceId = typeof body.piece_id === 'string' ? body.piece_id.trim() : '';
  if (!pieceId) return res.status(400).json({ error: 'piece_id required' });
  // ALCANCE DE REVISIÓN — la pieza tiene que ser de una de sus marcas. Admin pasa sin leer nada.
  if (!(await guardPiece(res, session, pieceId))) return;

  // La directriz es obligatoria CUANDO HAY UNA IMAGEN QUE CORREGIR, y va al revés que el criterio
  // de un veredicto. No es una incoherencia: un criterio explica un juicio ya tomado y puede llegar
  // después, mientras que aquí la directriz ES la operación. Regenerar sin ella devuelve la misma
  // imagen con el mismo defecto y cobra una generación por no cambiar nada.
  //
  // SIN-IMAGEN-01 (2026-09-22) — Y ESE ARGUMENTO NO APLICA A UNA PIEZA QUE NO TIENE IMAGEN.
  // No hay «la misma imagen» que devolver ni defecto que repetir: la generación produce algo donde
  // no había nada, y el motor ya sabe qué pintar —lo arma con el título y la cabeza del copy más la
  // `visual_directive` del dominio, que es exactamente lo que el stage 3 habría usado—.
  //
  // Exigirla ahí convertía una regla de ahorro en una puerta cerrada. Se comprueba DESPUÉS de leer
  // la pieza, porque hasta leerla no se sabe cuál de los dos casos es. El techo de caracteres sí se
  // valida aquí: vale para las dos, y quien escribe de más tiene que saberlo antes de pagar el viaje.
  const directive = typeof body.visual_directive === 'string' ? body.visual_directive.trim() : '';
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

    // 2026-10-20 — VOLVER A LA IMAGEN ANTERIOR. Sin directriz ni generación: sólo dato (0 USD).
    if (body.restore_index !== undefined) return volverALaAnterior(res, pieceId, body.restore_index, session.sub || 'sam');

    // 2026-10-22 — EL TEXTO DE UNA LÁMINA DEL CARRUSEL. Sin directriz ni generación (0 USD): el motor la recompone
    // sobre su imagen limpia (`carousel_recompose` con `slides_text`).
    if (body.slide_text !== undefined) return textoDeLaLamina(res, piece, body.slide_text, editReason, session.sub || 'sam');

    // SIN-IMAGEN-01 — la directriz se exige sólo si hay una imagen que corregir. Ver arriba.
    const tieneImagen = typeof piece.assets?.image?.url === 'string' && !!piece.assets.image.url;

    const conTexto = Object.prototype.hasOwnProperty.call(body, 'overlay_override');
    // 2026-10-22 — LA UBICACIÓN DEL TEXTO: sola o con el texto escrito, por la misma vía sin generar (0 USD).
    const conUbicacion = Object.prototype.hasOwnProperty.call(body, 'text_place');
    const ubicacion = conUbicacion ? readTextPlaceRequest(body.text_place) : null;
    if (ubicacion && !ubicacion.ok) return res.status(400).json({ error: 'invalid text_place', detail: ubicacion.error });
    // 2026-10-24 — LA COLUMNA DEL TEXTO: el mismo trato que la ubicación.
    const conColumna = Object.prototype.hasOwnProperty.call(body, 'text_column');
    const columna = conColumna ? readTextColumnRequest(body.text_column) : null;
    if (columna && !columna.ok) return res.status(400).json({ error: 'invalid text_column', detail: columna.error });
    // 2026-10-28 — EL TAMAÑO DEL TEXTO: el mismo trato que la columna.
    const conTamano = Object.prototype.hasOwnProperty.call(body, 'text_scale');
    const tamano = conTamano ? readTextScaleRequest(body.text_scale) : null;
    if (tamano && !tamano.ok) return res.status(400).json({ error: 'invalid text_scale', detail: tamano.error });
    if (tieneImagen && !directive && !conTexto && !conUbicacion && !conColumna && !conTamano) {
      return res.status(400).json({
        error: 'visual_directive required',
        detail: 'regenerar sin directriz devuelve el mismo defecto y cobra una generación por no cambiar nada. '
          + 'Sólo una pieza que TODAVÍA no tiene imagen puede pedirla sin directriz: ahí no hay defecto que repetir.',
      });
    }

    // 2026-10-19 — EL TEXTO DE LA IMAGEN, SIN TOCAR LA ESCENA. Con `overlay_override` en el cuerpo no hay
    // directriz ni generación: se recompone sobre la escena limpia que ya existe (0 USD). El motor valida el
    // texto antes de componer; aquí sólo se exige que haya una imagen sobre la que escribir.
    if (conTexto || conUbicacion || conColumna || conTamano) {
      if (!tieneImagen) {
        return res.status(409).json({ error: 'no_image', detail: 'la pieza no tiene imagen: primero hay que generarla, después se escribe su texto' });
      }
      const ef = await callEdgeFunction('content-run-stage', {
        action: 'recompose', piece_id: pieceId, regenerate_image: false,
        // Cada clave viaja sólo si se pidió: su ausencia no toca lo guardado en la pieza.
        ...(conTexto ? { overlay_override: body.overlay_override ?? null } : {}),
        ...(ubicacion && ubicacion.ok ? { text_place: ubicacion.value } : {}),
        ...(columna && columna.ok ? { text_column: columna.value } : {}),
        ...(tamano && tamano.ok ? { text_scale: tamano.value } : {}),
        edit_reason: editReason || null, edited_by: session.sub || 'sam',
      });
      if (!ef.body?.ok) {
        return res.status(ef.status >= 400 ? ef.status : 422).json({
          error: 'recompose_failed', detail: ef.body?.error ?? 'el motor no recompuso la imagen',
          server_detail: typeof ef.body?.error === 'string' ? ef.body.error : null,
        });
      }
      // El motor tiene que ACUSAR que aplicó el texto: uno anterior al soporte de `overlay_override` respondería
      // «ok» habiéndolo ignorado, y la pantalla diría que se aplicó algo que no se aplicó.
      if (conTexto && ef.body.overlay_override_applied !== true) {
        return res.status(409).json({
          error: 'overlay_override_unsupported',
          detail: 'el motor recompuso la imagen pero no aplicó el texto escrito: falta desplegar content-run-stage con overlay_override (unrlvl-iid-functions#411)',
        });
      }
      // 2026-10-23 — lo elegido por bloque (color del texto, bajada, grosor de la sombra): el motor lo acusa sólo si el
      // compositor que compuso sabe de él (ImageLab ≥ 1.16.0). Sin acuse, la pantalla diría que se aplicó algo que no.
      const conEstilo = conTexto && !!body.overlay_override && typeof body.overlay_override === 'object'
        && !!(body.overlay_override as Record<string, unknown>).text_style;
      if (conEstilo && ef.body.text_style_applied !== true) {
        return res.status(409).json({
          error: 'text_style_unsupported',
          detail: 'el motor recompuso la imagen pero no aplicó el color del texto, la bajada ni el grosor de la sombra: falta desplegar content-run-stage (unrlvl-iid-functions#469) o ImageLab con el compositor 1.16.0 (ImageLab#79)',
        });
      }
      // 2026-10-28 — la cursiva por tramo: el motor la acusa sólo si el compositor que compuso sabe de ella (ImageLab ≥ 1.18.0).
      if (conEstilo && textStyleWantsItalic((body.overlay_override as Record<string, unknown>).text_style) && ef.body.text_italic_applied !== true) {
        return res.status(409).json({
          error: 'text_italic_unsupported',
          detail: 'el motor recompuso la imagen pero no aplicó la cursiva: falta desplegar content-run-stage con italic_spans o ImageLab con el compositor 1.18.0',
        });
      }
      // 2026-10-30 — el color por tramo (`*así*`), igual (ImageLab ≥ 1.21.0).
      if (conEstilo && textStyleWantsColor((body.overlay_override as Record<string, unknown>).text_style) && ef.body.text_color_applied !== true) {
        return res.status(409).json({
          error: 'text_color_unsupported',
          detail: 'el motor recompuso la imagen pero no aplicó el color por tramo: falta desplegar content-run-stage con color_spans (unrlvl-iid-functions#538) o ImageLab con el compositor 1.21.0 (ImageLab#85)',
        });
      }
      // Lo mismo con la ubicación: un motor anterior recompondría en el lugar de siempre y respondería «ok».
      if (conUbicacion && ef.body.text_place_applied !== true) {
        return res.status(409).json({
          error: 'text_place_unsupported',
          detail: 'el motor recompuso la imagen pero no aplicó la ubicación del texto: falta desplegar content-run-stage con text_place',
        });
      }
      // 2026-10-24 — la columna, igual: el motor la acusa sólo si el compositor que compuso sabe de ella (ImageLab ≥ 1.17.0).
      if (conColumna && ef.body.text_column_applied !== true) {
        return res.status(409).json({
          error: 'text_column_unsupported',
          detail: 'el motor recompuso la imagen pero no aplicó la columna del texto: falta desplegar content-run-stage con text_column o ImageLab con el compositor 1.17.0',
        });
      }
      // 2026-10-28 — la bajada con líneas aparte: el motor la acusa sólo si el compositor que compuso las respeta (ImageLab ≥ 1.20.0).
      const subConSaltos = conTexto && !!body.overlay_override && typeof body.overlay_override === 'object'
        && subBreaksOf((body.overlay_override as Record<string, unknown>).subheadline).includes('\n');
      if (subConSaltos && ef.body.text_sub_breaks_applied !== true) {
        return res.status(409).json({
          error: 'text_sub_breaks_unsupported',
          detail: 'el motor recompuso la imagen pero no respetó las líneas aparte de la bajada: falta desplegar content-run-stage con los saltos de la bajada o ImageLab con el compositor 1.20.0',
        });
      }
      // 2026-10-28 — el tamaño, igual: el motor lo acusa sólo si el compositor que compuso sabe de él (ImageLab ≥ 1.19.0).
      if (conTamano && ef.body.text_scale_applied !== true) {
        return res.status(409).json({
          error: 'text_scale_unsupported',
          detail: 'el motor recompuso la imagen pero no aplicó el tamaño del texto: falta desplegar content-run-stage con text_scale o ImageLab con el compositor 1.19.0',
        });
      }
      let html: string | null = null;
      let artifact_url: string | null = null;
      try { const art = await ensureArtifact(pieceId); html = art.html; artifact_url = art.artifact_url; }
      catch (err) { console.error(`[recompose-image] ${pieceId}: texto recompuesto pero el artefacto NO se rehízo: ${String(err)}`); }
      return res.status(200).json({
        ok: true, piece_id: pieceId, image_url: ef.body.image_url ?? null,
        visual_directive_domain: null, visual_directive_piece: null, mode_switched: null,
        composed: ef.body.composed === true, scheduled_posts_updated: ef.body.scheduled_posts_updated ?? 0,
        // 2026-10-22 — en un carrusel, el motor recompone también la portada con este texto: `true`, o el motivo
        // por el que no pudo (la pantalla lo dice). Ausente = la pieza no es un carrusel.
        carousel_recomposed: ef.body.carousel_recomposed ?? null,
        // 2026-10-22 — la ubicación que quedó guardada (o null: la de la marca).
        text_place: ef.body.text_place ?? null,
        // 2026-10-24 — la columna que quedó guardada (o null: la de la marca).
        text_column: ef.body.text_column ?? null,
        // 2026-10-28 — el tamaño del texto que quedó guardado (o null: el de la marca).
        text_scale: ef.body.text_scale ?? null,
        artifact_url, html, artifact_refreshed: html !== null,
      });
    }

    const modeRaw = typeof body.mode === 'string' ? body.mode.trim() : '';
    if (modeRaw && !IMAGE_MODES.includes(modeRaw as ImageMode)) {
      return res.status(400).json({ error: 'invalid mode', detail: `mode debe ser ${IMAGE_MODES.join(' o ')}` });
    }
    const mode = resolveRecomposeMode(modeRaw || null, tieneImagen);

    const ef = await callEdgeFunction('content-run-stage', {
      action: 'recompose',
      piece_id: pieceId,
      // Explícito, aunque el motor ya lo deduzca de la directriz: quien lea este cuerpo en un log
      // tiene que poder saber que esto CUESTA una generación, sin ir a leer el motor.
      regenerate_image: true,
      // SIN-IMAGEN-01 — `null`, no `''`. Sin directriz de pieza el motor compone la escena con la
      // del DOMINIO y nada más, que es lo que el stage 3 habría hecho. Una cadena vacía viajaría
      // como una directriz que no dice nada, y `normalizeSceneDirective` tendría que adivinar si
      // alguien quiso borrar la del dominio o simplemente no escribió nada.
      visual_directive: directive || null,
      edit_reason: editReason || null,
      edited_by: session.sub || 'sam',
      mode,
    });

    // El status de la EF se propaga sin traducir, igual que en `callEdgeFunction`: el motor ya
    // distingue la directriz demasiado larga, la contradicción con `regenerate_image` y el fallo de
    // generación, y re-mapearlos aquí obligaría a la interfaz a adivinar cuál de los tres pasó.
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
      // 2026-10-19 — si el motor cambió el modo pedido (p. ej. editar no puede cambiar a una persona), lo dice.
      mode_switched: ef.body.mode_switched ?? null,
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

/**
 * 2026-10-19 — LOS COLORES DEL RESALTADO de la marca de una pieza (ver `emphasisColorOptions`). Lo pide el editor
 * del texto de la imagen al abrirse. Sin opciones, la pantalla no ofrece el selector y todo sigue como antes.
 */
async function coloresDelResaltado(req: VercelRequest, res: VercelResponse) {
  const session = await requireReviewer(req, res, extractToken(req), VISTAS_DE_PIEZA);
  if (!session) return;
  const pieceId = typeof req.query?.piece_id === 'string' ? req.query.piece_id.trim() : '';
  if (!pieceId) return res.status(400).json({ error: 'piece_id required' });
  if (!(await guardPiece(res, session, pieceId))) return;
  try {
    const piece = await fetchPiece(pieceId);
    if (!piece) return res.status(404).json({ error: 'piece_not_found', detail: `la pieza ${pieceId} no existe` });
    const brandId = String(piece.brand_id ?? '');
    const leer = async (path: string) => {
      const r = await fetchWithTimeout('db', `${SB_URL()}/rest/v1/${path}`, { headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}` } });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`);
      return r.json();
    };
    const b = encodeURIComponent(brandId);
    const [tokens, palette, personLinks, places] = await Promise.all([
      // 2026-10-20 — también la capa global: la sombra de una marca sin sombra propia sale de ahí.
      leer(`imagelab_overlay_tokens?or=(brand_id.eq.${b},brand_id.is.null)&active=eq.true&select=brand_id,canal,tokens`),
      leer(`brand_palette?brand_id=eq.${b}&select=role,hex`),
      // 2026-10-20 — EN LA ESCENA: las personas y los lugares de la marca que se pueden poner en ella.
      leer(`brand_persons?brand_id=eq.${b}&active=eq.true&select=person_blueprint_id`),
      leer(`brand_locations?brand_id=eq.${b}&active=eq.true&select=aliases`),
    ]);
    const ids = (Array.isArray(personLinks) ? personLinks : []).map((l: any) => String(l?.person_blueprint_id ?? '')).filter(Boolean);
    const persons = ids.length
      ? await leer(`person_blueprints?blueprint_id=in.(${ids.map((i) => `"${encodeURIComponent(i)}"`).join(',')})&active=eq.true&select=display_name`)
      : [];
    const image = piece.assets?.image ?? null;
    return res.status(200).json({
      ok: true, brand_id: brandId, options: emphasisColorOptions(tokens, palette, brandId),
      cast: sceneCastOf(persons, places, image), history: imageHistoryOf(image),
      // 2026-10-20 — el texto que la imagen lleva AHORA: el editor se siembra con esto, no con lo que la tarjeta trajo al cargar.
      overlay: imageOverlayOf(piece.assets),
      // 2026-10-20 — la sombra de la marca y los colores posibles del filete (ImageLab ≥ 1.9.0).
      shadow: shadowOptionOf(tokens, brandId), rule_options: ruleColorOptions(tokens, palette, brandId),
      identity_options: identityColorOptions(tokens, palette, brandId),
      // 2026-10-23 — los colores posibles del texto de cada bloque (ImageLab ≥ 1.16.0), con el de siempre de cada uno.
      text_colors: textColorOptions(tokens, palette, brandId),
      // 2026-10-22 — las láminas del carrusel con su texto: el editor ofrece el selector de lámina con esto.
      carousel: carouselTextViewOf(piece),
      // 2026-10-22 — la ubicación del texto que la imagen tiene guardada: el selector abre con ella.
      text_place: textPlaceOfImage(piece.assets),
      // 2026-10-24 — la columna del texto guardada en la imagen.
      text_column: textColumnOfImage(piece.assets),
      // 2026-10-28 — el tamaño del texto guardado en la imagen (null = el de la marca).
      text_scale: textScaleOfImage(piece.assets),
    });
  } catch (err) {
    console.error(`[recompose-image] GET colores ${pieceId}: ${String(err)}`);
    return res.status(503).json({ error: 'emphasis_colors_unavailable', detail: String(err instanceof Error ? err.message : err) });
  }
}

/**
 * 2026-10-20 — VOLVER A LA IMAGEN ANTERIOR. El motor intercambia la imagen actual con la elegida del historial
 * (`restore_image`), así que volver también se deshace. El artefacto se rehace sobre la pieza ya cambiada.
 */
async function volverALaAnterior(res: VercelResponse, pieceId: string, raw: unknown, by: string) {
  const index = Number(raw);
  if (!Number.isInteger(index) || index < 0 || index > 20) {
    return res.status(400).json({ error: 'invalid restore_index', detail: 'restore_index es la posición de la imagen anterior (0 = la última)' });
  }
  const ef = await callEdgeFunction('content-run-stage', { action: 'restore_image', piece_id: pieceId, index, edited_by: by });
  if (!ef.body?.ok) {
    return res.status(ef.status >= 400 ? ef.status : 422).json({
      error: 'restore_failed', detail: ef.body?.error ?? 'el motor no volvió a la imagen anterior',
      server_detail: typeof ef.body?.error === 'string' ? ef.body.error : null,
    });
  }
  let html: string | null = null;
  let artifact_url: string | null = null;
  try { const art = await ensureArtifact(pieceId); html = art.html; artifact_url = art.artifact_url; }
  catch (err) { console.error(`[recompose-image] ${pieceId}: imagen restaurada pero el artefacto NO se rehízo: ${String(err)}`); }
  return res.status(200).json({
    ok: true, piece_id: pieceId, image_url: ef.body.image_url ?? null, restored: true,
    visual_directive_domain: null, visual_directive_piece: null, mode_switched: null,
    artifact_url, html, artifact_refreshed: html !== null,
  });
}

/**
 * 2026-10-22 — EL TEXTO DE UNA LÁMINA 2..N DE UN CARRUSEL. El motor mezcla el texto en la lámina, la recompone sobre
 * su imagen limpia (sin generar) y deja una fila por campo en `intel.piece_edits` con quien lo pidió. Tiene que
 * ACUSAR `slides_text_applied`: un motor anterior respondería «ok» recomponiendo con el texto viejo.
 */
async function textoDeLaLamina(res: VercelResponse, piece: any, raw: unknown, editReason: string, by: string) {
  const pieceId = String(piece.id);
  const vista = carouselTextViewOf(piece);
  if (!vista) return res.status(409).json({ error: 'not_carousel', detail: 'la pieza no es un carrusel de dos o más láminas' });
  const pedido = readSlideTextRequest(raw);
  if (!pedido.ok) return res.status(400).json({ error: 'invalid slide_text', detail: pedido.error });
  if (!vista.slides.some((s) => s.n === pedido.value.n)) {
    return res.status(400).json({ error: 'invalid slide_text', detail: `la lámina ${pedido.value.n} no existe; el carrusel tiene ${vista.total}` });
  }
  const ef = await callEdgeFunction('content-run-stage', {
    action: 'carousel_recompose', piece_id: pieceId, slides_text: [pedido.value],
    edit_reason: editReason || null, edited_by: by,
  });
  if (!ef.body?.ok) {
    return res.status(ef.status >= 400 ? ef.status : 422).json({
      error: 'slide_text_failed', detail: ef.body?.error ?? 'el motor no recompuso la lámina',
      server_detail: typeof ef.body?.error === 'string' ? ef.body.error : null,
    });
  }
  // Con la ubicación, el motor también tiene que acusarla: uno anterior rechaza el campo, uno nuevo dice que la aplicó.
  if (ef.body.slides_text_applied !== true) {
    return res.status(409).json({
      error: 'slides_text_unsupported',
      detail: 'el motor respondió sin aplicar el texto de la lámina: falta desplegar content-run-stage con slides_text',
    });
  }
  // 2026-10-23 — lo elegido por bloque en la lámina, igual que en la imagen de la pieza.
  // 2026-10-24 — la columna de la lámina, igual que en la imagen de la pieza.
  if ('text_column' in pedido.value && ef.body.text_column_applied !== true) {
    return res.status(409).json({
      error: 'text_column_unsupported',
      detail: 'el motor recompuso la lámina pero no aplicó la columna del texto: falta desplegar content-run-stage con text_column o ImageLab con el compositor 1.17.0',
    });
  }
  if (textStyleWantsItalic(pedido.value.text_style) && ef.body.text_italic_applied !== true) {
    return res.status(409).json({
      error: 'text_italic_unsupported',
      detail: 'el motor recompuso la lámina pero no aplicó la cursiva: falta desplegar content-run-stage con italic_spans o ImageLab con el compositor 1.18.0',
    });
  }
  // 2026-10-30 — el color por tramo de la lámina, igual (ImageLab ≥ 1.21.0).
  if (textStyleWantsColor(pedido.value.text_style) && ef.body.text_color_applied !== true) {
    return res.status(409).json({
      error: 'text_color_unsupported',
      detail: 'el motor recompuso la lámina pero no aplicó el color por tramo: falta desplegar content-run-stage con color_spans (unrlvl-iid-functions#538) o ImageLab con el compositor 1.21.0 (ImageLab#85)',
    });
  }
  // 2026-10-28 — la bajada con líneas aparte, igual (ImageLab ≥ 1.20.0).
  if (subBreaksOf(pedido.value.subheadline).includes('\n') && ef.body.text_sub_breaks_applied !== true) {
    return res.status(409).json({
      error: 'text_sub_breaks_unsupported',
      detail: 'el motor recompuso la lámina pero no respetó las líneas aparte de la bajada: falta desplegar content-run-stage con los saltos de la bajada o ImageLab con el compositor 1.20.0',
    });
  }
  if (pedido.value.text_style && ef.body.text_style_applied !== true) {
    return res.status(409).json({
      error: 'text_style_unsupported',
      detail: 'el motor recompuso la lámina pero no aplicó el color del texto, la bajada ni el grosor de la sombra: falta desplegar content-run-stage (unrlvl-iid-functions#469) o ImageLab con el compositor 1.16.0 (ImageLab#79)',
    });
  }
  let html: string | null = null;
  let artifact_url: string | null = null;
  try { const art = await ensureArtifact(pieceId); html = art.html; artifact_url = art.artifact_url; }
  catch (err) { console.error(`[recompose-image] ${pieceId}: lámina recompuesta pero el artefacto NO se rehízo: ${String(err)}`); }
  return res.status(200).json({
    ok: true, piece_id: pieceId, slide_n: pedido.value.n, image_url: null,
    visual_directive_domain: null, visual_directive_piece: null, mode_switched: null,
    composed: true, unchanged: ef.body.unchanged === true, text_edits: Number(ef.body.text_edits ?? 0),
    scheduled_posts_updated: 0, artifact_url, html, artifact_refreshed: html !== null,
  });
}
