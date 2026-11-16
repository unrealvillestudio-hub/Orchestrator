/**
 * UNRLVL Orchestrator — api/piece-text.ts (2026-11-16 · contrato «Texto en pantalla» v1, §4)
 *
 * EL TEXTO EN PANTALLA DE UNA PIEZA: PROPONER, APLICAR Y RECOGER.
 *
 * POST /api/piece-text { piece_id, action: 'propose', goal? }
 *   → CopyLab (`short_video_text`) con el copy de la pieza, las afirmaciones de su hallazgo, el elenco y el guion del
 *     video y los patrones de gancho de las últimas 8 piezas de la misma marca y plataforma (regla N = 8).
 *   200: { ok, medium, has_clean_video, clean_video_note, proposals, meta, presets, presets_error, accent_options,
 *          strip_options, cast, current: { text_layers, hook }, duration_ms, pending }
 *   En una pieza de imagen sólo se piden ganchos (`medium: 'image'`) y no se leen presets de video.
 *
 * POST /api/piece-text { piece_id, action: 'apply', text_layers }
 *   → VideoLab (`mode: text_layers`) sobre `assets.video.clean_video.url` con `assets.video.timeline`. Guarda
 *     `assets.video.pending_text_job = { job_id, requested_at, text_layers }`.
 *   202: { ok, job_id, status: 'running' }
 *
 * GET /api/piece-text?piece_id=
 *   → sondea `lab_jobs` del pedido pendiente. Terminado: el video de ahora pasa a `assets.video_history[]` y la pieza
 *     queda con el nuevo (versión siguiente, `text_layers`, `hook_pattern_key`) y el artefacto rehecho. Fallido: se
 *     quita el pendiente y se devuelve su `error_label`.
 *   200: { ok, status: 'idle' | 'running' | 'completed' | 'failed', video?, html?, error_label?, detail? }
 *
 * ── REGLA LABS ───────────────────────────────────────────────────────────────────────────────────
 * Esta ruta no escribe un gancho ni dibuja una letra: llama a cada lab por `lab_configs.api_endpoint` (nunca una URL
 * escrita aquí) y guarda lo que devuelven. `lab_configs.active` de VideoLab describe el carril automático, que sigue
 * apagado a propósito: aquí no se lee ni se cambia, sólo se lee dónde vive el lab.
 *
 * ── PATRÓN CICATRIZ ──────────────────────────────────────────────────────────────────────────────
 * Firma Node-native `(req: VercelRequest, res: VercelResponse)`, como `recompose-image.ts`.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, extractToken, ensureArtifact, fetchPiece, SB_URL, SB_KEY } from './_calibrationShared.js';
import { emphasisColorOptions, identityColorOptions } from './_overlayText.js';
import { fetchWithTimeout } from './_fetchWithTimeout.js';
import { requireReviewer, guardPiece, VISTAS_DE_PIEZA } from './_reviewScope.js';
import {
  assetsAfterFailedJob, assetsAfterTextJob, buildCopyLabBody, buildCopyLabSource, buildVideoLabBody, castOf,
  copyLabLanguageOf, errorLabelOf, goalOf, groupPresets, hasCleanVideo, labExecuteUrl, mediumOf, NO_CLEAN_VIDEO,
  RECENT_PIECES_N, recentPatternKeysOf, validateTextLayers, type PresetsByLayer,
} from './_pieceText.js';

const headers = (profile: 'public' | 'content' | 'intel', extra: Record<string, string> = {}) =>
  ({ apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Accept-Profile': profile, ...extra });

async function leer(path: string, profile: 'public' | 'content' | 'intel' = 'public'): Promise<any> {
  const r = await fetchWithTimeout('db', `${SB_URL()}/rest/v1/${path}`, { headers: headers(profile) });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`), { status: r.status });
  return r.json();
}

/** Dónde vive un lab, de `lab_configs`. Sin fila o sin endpoint, `null`: quien llama lo dice y no inventa una URL. */
async function labUrl(labKey: string): Promise<string | null> {
  const rows = await leer(`lab_configs?lab_key=eq.${encodeURIComponent(labKey)}&select=lab_key,api_endpoint,execute_path&limit=1`);
  return labExecuteUrl(Array.isArray(rows) ? rows[0] : null);
}

/**
 * Escribe `assets` con ancla en el video que se leyó: si entre la lectura y la escritura otra mano cambió el video,
 * no se pisa nada y vuelve `false`.
 */
async function guardarAssets(pieceId: string, assets: unknown, anclaUrl: string): Promise<boolean> {
  const url = `${SB_URL()}/rest/v1/content_pieces?id=eq.${encodeURIComponent(pieceId)}`
    + `&assets->video->>url=eq.${encodeURIComponent(anclaUrl)}&select=id`;
  const r = await fetchWithTimeout('db', url, {
    method: 'PATCH',
    headers: headers('content', { 'Content-Type': 'application/json', 'Content-Profile': 'content', Prefer: 'return=representation' }),
    body: JSON.stringify({ assets }),
  });
  if (!r.ok) throw new Error(`content_pieces assets ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`);
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

/** Los colores que la marca ofrece para el acento de los subtítulos y para la franja: los mismos del editor de imagen. */
async function coloresDeMarca(brandId: string) {
  const b = encodeURIComponent(brandId);
  const [tokens, palette] = await Promise.all([
    leer(`imagelab_overlay_tokens?or=(brand_id.eq.${b},brand_id.is.null)&active=eq.true&select=brand_id,canal,tokens`),
    leer(`brand_palette?brand_id=eq.${b}&select=role,hex`),
  ]);
  return { accent: emphasisColorOptions(tokens, palette, brandId), strip: identityColorOptions(tokens, palette, brandId) };
}

/** Los presets de VideoLab de la marca y del sistema. Si la tabla aún no existe, se dice en vez de inventarlos. */
async function presetsDe(brandId: string): Promise<{ presets: PresetsByLayer | null; error: string | null }> {
  try {
    const rows = await leer(`videolab_text_presets?or=(brand_id.is.null,brand_id.eq.${encodeURIComponent(brandId)})`
      + '&active=eq.true&select=preset_key,layer,name,description,brand_id,active,sort,status&order=sort.asc');
    return { presets: groupPresets(rows, brandId), error: null };
  } catch (err) {
    return { presets: null, error: `No se pudieron leer los presets de VideoLab (videolab_text_presets): ${String(err instanceof Error ? err.message : err)}` };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') return recoger(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

  let body: { piece_id?: string; action?: string; text_layers?: unknown; goal?: unknown; session_token?: string } = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); } catch { /* vacío */ }
  const session = await requireReviewer(req, res, extractToken(req, body), VISTAS_DE_PIEZA);
  if (!session) return;
  const pieceId = typeof body.piece_id === 'string' ? body.piece_id.trim() : '';
  if (!pieceId) return res.status(400).json({ error: 'piece_id required' });
  if (!(await guardPiece(res, session, pieceId))) return;
  if (body.action !== 'propose' && body.action !== 'apply') {
    return res.status(400).json({ error: 'invalid action', detail: "action debe ser 'propose' o 'apply'" });
  }

  try {
    const piece = await fetchPiece(pieceId);
    if (!piece) return res.status(404).json({ error: 'piece_not_found', detail: `la pieza ${pieceId} no existe` });
    if (piece.discarded_at) {
      return res.status(409).json({ error: 'piece_already_sealed', detail: 'la pieza ya está sellada: su texto ya no se edita', discarded_at: piece.discarded_at });
    }
    return body.action === 'propose' ? proponer(res, piece, body.goal) : aplicar(res, piece, body.text_layers);
  } catch (err) {
    console.error(`[piece-text] ${body.action} ${pieceId}: ${String(err)}`);
    return res.status(503).json({ error: 'piece_text_unavailable', detail: String(err instanceof Error ? err.message : err) });
  }
}

// ── PROPONER ───────────────────────────────────────────────────────────────────────────────────

async function proponer(res: VercelResponse, piece: any, goalRaw: unknown) {
  const brandId = String(piece.brand_id ?? '');
  const b = encodeURIComponent(brandId);
  const assets = piece.assets ?? {};
  const medium = mediumOf(assets);

  const [brandRows, findingRows, recientes] = await Promise.all([
    leer(`brands?id=eq.${b}&select=language_primary,voicelab_language&limit=1`),
    piece.finding_id ? leer(`iid_findings?id=eq.${encodeURIComponent(piece.finding_id)}&select=claims&limit=1`, 'intel') : Promise.resolve([]),
    piece.platform
      ? leer(`content_pieces?brand_id=eq.${b}&platform=eq.${encodeURIComponent(piece.platform)}&id=neq.${encodeURIComponent(piece.id)}`
        + `&select=id,assets&order=created_at.desc&limit=${RECENT_PIECES_N}`, 'content')
      : Promise.resolve([]),
  ]);
  const marca = Array.isArray(brandRows) ? brandRows[0] : null;
  const language = copyLabLanguageOf(marca?.language_primary) ?? copyLabLanguageOf(marca?.voicelab_language);
  if (!language) {
    return res.status(422).json({ error: 'brand_language_unknown', detail: `la marca ${brandId} no declara un idioma que CopyLab admita (es | en) en public.brands` });
  }

  const source = buildCopyLabSource(piece, Array.isArray(findingRows) ? findingRows[0]?.claims : null);
  const recentPatternKeys = recentPatternKeysOf(Array.isArray(recientes) ? recientes : [], piece.id);
  const copylab = await labUrl('copylab');
  if (!copylab) return res.status(503).json({ error: 'lab_not_configured', detail: 'lab_configs no declara api_endpoint para copylab' });

  const pedido = buildCopyLabBody({ brandId, medium, language, source, goal: goalOf(goalRaw), recentPatternKeys });
  const r = await fetchWithTimeout('model', copylab, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pedido),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data?.success === false) {
    return res.status(r.status >= 400 ? r.status : 502).json({
      error: 'copylab_failed', error_label: data?.error_label ?? null,
      detail: data?.error ?? data?.detail ?? `CopyLab respondió ${r.status}`,
    });
  }
  const output = data?.output ?? {};

  // Los colores y los presets sólo hacen falta para editar un video.
  const [colores, presets] = medium === 'video'
    ? await Promise.all([coloresDeMarca(brandId), presetsDe(brandId)])
    : [{ accent: [], strip: [] }, { presets: null, error: null }];
  const conLimpio = medium === 'video' && hasCleanVideo(assets);
  const durS = Number(assets?.video?.duration_s);

  return res.status(200).json({
    ok: true, piece_id: piece.id, brand_id: brandId, medium,
    has_clean_video: conLimpio,
    clean_video_note: medium === 'video' && !conLimpio ? NO_CLEAN_VIDEO : null,
    proposals: {
      hooks: Array.isArray(output.hooks) ? output.hooks : [],
      key_phrases: medium === 'video' && Array.isArray(output.key_phrases) ? output.key_phrases : [],
      share_ctas: medium === 'video' && Array.isArray(output.share_ctas) ? output.share_ctas : [],
    },
    meta: data?.meta ?? null,
    recent_pattern_keys: recentPatternKeys,
    presets: presets.presets, presets_error: presets.error,
    accent_options: colores.accent, strip_options: colores.strip,
    cast: medium === 'video' ? castOf(assets) : [],
    current: { text_layers: assets?.video?.text_layers ?? null, hook: source.current_hook },
    duration_ms: Number.isFinite(durS) && durS > 0 ? Math.round(durS * 1000) : null,
    pending: assets?.video?.pending_text_job ?? null,
  });
}

// ── APLICAR ────────────────────────────────────────────────────────────────────────────────────

async function aplicar(res: VercelResponse, piece: any, raw: unknown) {
  const brandId = String(piece.brand_id ?? '');
  const assets = piece.assets ?? {};
  if (mediumOf(assets) !== 'video') {
    return res.status(409).json({ error: 'not_a_video_piece', detail: 'el texto en pantalla se aplica a piezas de video; en una imagen se edita el titular en «Texto de la imagen»' });
  }
  if (!hasCleanVideo(assets)) return res.status(409).json({ error: 'no_clean_video', detail: NO_CLEAN_VIDEO });
  if (assets.video.pending_text_job?.job_id) {
    return res.status(409).json({ error: 'text_job_pending', detail: 'ya hay un cambio de texto en curso para este video: espera a que termine', job_id: assets.video.pending_text_job.job_id });
  }
  if (!piece.platform) return res.status(409).json({ error: 'piece_without_platform', detail: 'la pieza no declara plataforma: VideoLab no sabe qué zona segura usar' });

  const [colores, presets] = await Promise.all([coloresDeMarca(brandId), presetsDe(brandId)]);
  if (!presets.presets) return res.status(503).json({ error: 'presets_unavailable', detail: presets.error });
  const durS = Number(assets.video.duration_s);
  const v = validateTextLayers(raw, {
    presets: presets.presets,
    accentRoles: colores.accent.map((c) => c.role),
    stripRoles: colores.strip.map((c) => c.role),
    durationMs: Number.isFinite(durS) && durS > 0 ? Math.round(durS * 1000) : null,
    castIds: castOf(assets).map((c) => c.person_id),
  });
  if (!v.ok) return res.status(400).json({ error: 'invalid text_layers', detail: v.errors.join(' · '), errors: v.errors });

  const videolab = await labUrl('videolab');
  if (!videolab) return res.status(503).json({ error: 'lab_not_configured', detail: 'lab_configs no declara api_endpoint para videolab' });
  const pedido = buildVideoLabBody({
    brandId, pieceId: piece.id, platform: piece.platform, parentJobId: piece.orchestrator_job_id ?? null,
    cleanVideoUrl: assets.video.clean_video.url, timeline: assets.video.timeline, textLayers: v.value,
  });
  const r = await fetchWithTimeout('edge', videolab, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pedido),
  });
  const data = await r.json().catch(() => ({}));
  const jobId = typeof data?.job_id === 'string' ? data.job_id : null;
  if (!r.ok || !jobId) {
    return res.status(r.status >= 400 ? r.status : 502).json({
      error: 'videolab_failed', error_label: data?.error_label ?? null, detail: data?.error ?? `VideoLab respondió ${r.status} sin job_id`,
    });
  }

  const nuevos = { ...assets, video: { ...assets.video, pending_text_job: { job_id: jobId, requested_at: new Date().toISOString(), text_layers: v.value } } };
  const guardado = await guardarAssets(piece.id, nuevos, assets.video.url);
  if (!guardado) {
    return res.status(409).json({ error: 'video_changed', detail: 'el video de la pieza cambió mientras se pedía el texto: el render sigue, pero no quedó enlazado a la pieza', job_id: jobId });
  }
  return res.status(202).json({ ok: true, piece_id: piece.id, job_id: jobId, status: 'running' });
}

// ── RECOGER ────────────────────────────────────────────────────────────────────────────────────

async function recoger(req: VercelRequest, res: VercelResponse) {
  const session = await requireReviewer(req, res, extractToken(req), VISTAS_DE_PIEZA);
  if (!session) return;
  const pieceId = typeof req.query?.piece_id === 'string' ? req.query.piece_id.trim() : '';
  if (!pieceId) return res.status(400).json({ error: 'piece_id required' });
  if (!(await guardPiece(res, session, pieceId))) return;
  try {
    const piece = await fetchPiece(pieceId);
    if (!piece) return res.status(404).json({ error: 'piece_not_found', detail: `la pieza ${pieceId} no existe` });
    const assets = (piece.assets ?? {}) as any;
    const pending = assets?.video?.pending_text_job ?? null;
    if (!pending?.job_id) {
      return res.status(200).json({ ok: true, status: 'idle', video: assets?.video ?? null, last_error: assets?.video?.last_text_job_error ?? null });
    }
    const jobs = await leer(`lab_jobs?id=eq.${encodeURIComponent(pending.job_id)}&select=id,status,output_parsed,error_msg&limit=1`);
    const job = Array.isArray(jobs) ? jobs[0] : null;
    if (!job) return res.status(200).json({ ok: true, status: 'running', job_id: pending.job_id, note: 'el job todavía no aparece en lab_jobs' });
    const ahora = new Date().toISOString();

    if (job.status === 'failed' || job.status === 'error') {
      const fallo = errorLabelOf(job);
      await guardarAssets(pieceId, assetsAfterFailedJob(assets, { ...fallo, job_id: job.id }, ahora), assets.video.url);
      return res.status(200).json({ ok: true, status: 'failed', job_id: job.id, ...fallo });
    }
    if (job.status !== 'completed' || !job.output_parsed?.video?.url) {
      return res.status(200).json({ ok: true, status: 'running', job_id: job.id });
    }

    const nuevos = assetsAfterTextJob(assets, job, ahora);
    const guardado = await guardarAssets(pieceId, nuevos, assets.video.url);
    if (!guardado) return res.status(409).json({ error: 'video_changed', detail: 'el video de la pieza cambió mientras se renderizaba el texto: no se pisó' });
    let html: string | null = null;
    let artifact_url: string | null = null;
    try { const art = await ensureArtifact(pieceId); html = art.html; artifact_url = art.artifact_url; }
    catch (err) { console.error(`[piece-text] ${pieceId}: video nuevo guardado pero el artefacto NO se rehízo: ${String(err)}`); }
    return res.status(200).json({ ok: true, status: 'completed', job_id: job.id, video: nuevos.video, html, artifact_url, artifact_refreshed: html !== null });
  } catch (err) {
    console.error(`[piece-text] GET ${pieceId}: ${String(err)}`);
    return res.status(503).json({ error: 'piece_text_unavailable', detail: String(err instanceof Error ? err.message : err) });
  }
}
