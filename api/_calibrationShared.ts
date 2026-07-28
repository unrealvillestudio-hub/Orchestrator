/**
 * UNRLVL Orchestrator — api/_calibrationShared.ts  (B4 · Fase 1)
 *
 * Helpers compartidos por los 3 endpoints de calibración (preview-render,
 * calibration-queue, calibration-verdict). Prefijo `_` = módulo, NO ruta Vercel
 * (mismo patrón que _craftModules.ts / _genomePromptBuilder.ts).
 *
 * Contiene: parse defensivo de Supabase URL, auth HS256 (admin), CORS, encode de
 * paths, construcción del artefacto HTML, y el acceso a datos vía PostgREST con
 * service_role + Accept-Profile/Content-Profile (schemas content/intel expuestos).
 *
 * NO hay RPCs SECURITY DEFINER: el diff "awaiting_approval − corpus" se hace en JS
 * (evita la superficie confused-deputy que documenta docs/D6-crons-35-36-runbook.md).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const BUCKET = 'unrlvl-media';
// Calibración = gate admin (igual que las aprobaciones legacy).
export const ALLOWED_ROLES = ['admin'];

// ── Supabase URL / key (mismo parse defensivo que sign-upload/extract-frames) ───
export function normalizeSupabaseUrl(raw: string | undefined): string {
  if (!raw) return '';
  const s = raw.trim().replace(/\/+$/, '');
  if (!s) return '';
  if (s.startsWith('https://') || s.startsWith('http://')) return s;
  if (s.includes('.supabase.co')) return `https://${s}`;
  if (/^[a-z]{20}$/.test(s)) return `https://${s}.supabase.co`;
  return s;
}
export const SB_URL = () => normalizeSupabaseUrl(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL);
export const SB_KEY = () => (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
export const JWT_SECRET = () => (process.env.ORCHESTRATOR_NSCF_IID_INTEL_JWT_SECRET ?? '').trim();

// ── CORS ────────────────────────────────────────────────────────────────────────
export function applyCors(res: VercelResponse, methods: string) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ── Auth: verificación HS256 nativa (idéntica a sign-upload.ts) ─────────────────
export interface SessionUser { sub: string; role: string; brand_scope: string[]; }

function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function verifyToken(token: unknown, secret: string): SessionUser | null {
  if (!token || typeof token !== 'string' || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  try {
    const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest();
    const got = b64urlToBuf(sig);
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
    const payload = JSON.parse(b64urlToBuf(p).toString('utf8')) as Record<string, unknown>;
    if (!payload?.sub || !payload?.role) return null;
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return {
      sub: String(payload.sub),
      role: String(payload.role),
      brand_scope: Array.isArray(payload.brand_scope) ? (payload.brand_scope as string[]) : [],
    };
  } catch {
    return null;
  }
}

/** Extrae el token del header Authorization: Bearer o del body (POST). */
export function extractToken(req: VercelRequest, body: { session_token?: string } = {}): string | undefined {
  const raw = req.headers['authorization'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (header && /^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, '').trim();
  return body.session_token;
}

/**
 * Gate común: valida config + token admin. Si algo falla, responde y devuelve null.
 * El handler solo continúa si esto devuelve un SessionUser.
 */
export function requireAdmin(req: VercelRequest, res: VercelResponse, token: string | undefined): SessionUser | null {
  if (!SB_URL() || !SB_KEY()) {
    res.status(503).json({ error: 'config_missing', message: 'Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el runtime' });
    return null;
  }
  if (!JWT_SECRET()) {
    res.status(503).json({ error: 'config_missing', message: 'Falta ORCHESTRATOR_NSCF_IID_INTEL_JWT_SECRET en el runtime' });
    return null;
  }
  const session = verifyToken(token, JWT_SECRET());
  if (!session) { res.status(401).json({ error: 'sesión inválida o expirada, vuelve a entrar' }); return null; }
  if (!ALLOWED_ROLES.includes(session.role)) { res.status(403).json({ error: `forbidden: rol '${session.role}' no puede calibrar` }); return null; }
  return session;
}

// ── Path / encode / URL pública ─────────────────────────────────────────────────
/** Encodea cada segmento del path conservando los '/' (igual que sign-upload.ts). */
export function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}
/** Ruta determinística del artefacto en el bucket. Fuente única de verdad. */
export function artifactPath(brandId: string, pieceId: string): string {
  return `preview/${brandId}/${pieceId}.html`;
}
export function publicArtifactUrl(brandId: string, pieceId: string): string {
  return `${SB_URL()}/storage/v1/object/public/${BUCKET}/${encodePath(artifactPath(brandId, pieceId))}`;
}

// ── Tipos de pieza ────────────────────────────────────────────────────────────
// Fuente = content.orchestrator_jobs (superset: contiene TANTO las piezas que el
// watcher aprobó, status='awaiting_approval', COMO las que rechazó por criterio de
// marca, status='failed' + assets.watcher.result='REJECT'). content_pieces sólo tiene
// las aprobadas — insuficiente para calibrar. El id de la pieza en el corpus es el
// orchestrator_jobs.id (estable también para las rechazadas, que no tienen fila en
// content_pieces).
export interface PieceAssets {
  copy?: { aife_filtered?: string; raw?: string; title?: string };
  image?: { url?: string };
  builder_meta?: { psycho_preset?: string; audience_frame?: string };
  watcher?: {
    result?: string;
    failed_gate?: string | null;
    // P4 (content-run-stage v56+): códigos de regla BLOQUEANTES del gate que falló
    // (gate_detail[failed_gate].violated) y cuántas reglas enumeradas aplicaban a la
    // pieza (ctx.rules.length). Ausentes en piezas anteriores al deploy de v56.
    failed_rules?: string[] | null;
    rules_evaluated?: number | null;
  };
}
export interface ContentPiece {
  id: string;
  brand_id: string;
  voice?: string | null;
  platform?: string | null;
  format?: string | null;
  domain?: string | null;
  status?: string | null;
  assets?: PieceAssets | null;
}

/** Veredicto del watcher normalizado (primera opinión que Sam valida o corrige). */
export interface WatcherVerdict {
  result: 'PASS' | 'REJECT' | null;
  gate: string | null;
  // Códigos de regla incumplidos (P4). El badge los prefiere al nombre del gate. SIEMPRE
  // array (nunca undefined hacia el front); vacío en piezas previas a content-run-stage v56
  // → el badge cae a `gate`.
  failed_rules: string[];
  // Contra cuántas reglas enumeradas se juzgó la pieza (ctx.rules.length). null en piezas viejas.
  rules_evaluated: number | null;
}
export function watcherOf(piece: ContentPiece): WatcherVerdict {
  const w = piece.assets?.watcher;
  const raw = typeof w?.result === 'string' ? w.result.toUpperCase() : null;
  const result = raw === 'PASS' || raw === 'REJECT' ? raw : null;
  // Defensivo: solo strings no vacíos entran; cualquier otra forma → []. Nunca undefined.
  const failed_rules = Array.isArray(w?.failed_rules)
    ? w!.failed_rules.filter((c): c is string => typeof c === 'string' && c.length > 0)
    : [];
  const rules_evaluated = typeof w?.rules_evaluated === 'number' ? w.rules_evaluated : null;
  return {
    result,
    gate: (result === 'REJECT' ? (w?.failed_gate ?? null) : null),
    failed_rules,
    rules_evaluated,
  };
}

/**
 * Criterio EXACTO de "material de calibración" (verificado contra la DB en vivo):
 *  (a) aprobada por watcher  → status='awaiting_approval', o
 *  (b) rechazada por CRITERIO DE MARCA → status='failed' + watcher.result='REJECT'
 *      + copy.aife_filtered presente (hubo texto real que evaluar).
 * Se EXCLUYE: failed sin REJECT (fallo técnico), y cualquier pieza sin aife_filtered.
 */
export function isCalibrationMaterial(piece: ContentPiece): boolean {
  const status = piece.status ?? null;
  if (status === 'awaiting_approval') return true;
  if (status === 'failed') {
    const w = watcherOf(piece);
    const hasAife = typeof piece.assets?.copy?.aife_filtered === 'string' && piece.assets.copy.aife_filtered.length > 0;
    return w.result === 'REJECT' && hasAife;
  }
  return false;
}

/** Contexto plano de una pieza (lo que la bandeja muestra y el corpus copia). */
export interface PieceContext {
  piece_id: string;
  brand_id: string;
  voice: string | null;
  domain: string | null;
  platform: string | null;
  format: string | null;
  psycho_preset: string | null;
  audience_frame: string | null;
  title: string | null;
  artifact_url: string;
  // Primera opinión del watcher (informativa; NO condiciona los botones de Sam).
  watcher_result: 'PASS' | 'REJECT' | null;
  watcher_gate: string | null;
  // Detalle por reglas enumeradas (content-run-stage v56+). El badge muestra los códigos
  // si vienen; si no (piezas viejas), cae a watcher_gate.
  watcher_failed_rules: string[];
  watcher_rules_evaluated: number | null;
}

export function toContext(piece: ContentPiece): PieceContext {
  const a = piece.assets ?? {};
  const w = watcherOf(piece);
  return {
    piece_id: piece.id,
    brand_id: piece.brand_id,
    voice: piece.voice ?? null,
    domain: piece.domain ?? null,
    platform: piece.platform ?? null,
    format: piece.format ?? null,
    psycho_preset: a.builder_meta?.psycho_preset ?? null,
    audience_frame: a.builder_meta?.audience_frame ?? null,
    title: a.copy?.title ?? null,
    artifact_url: publicArtifactUrl(piece.brand_id, piece.id),
    watcher_result: w.result,
    watcher_gate: w.gate,
    watcher_failed_rules: w.failed_rules,
    watcher_rules_evaluated: w.rules_evaluated,
  };
}

// ── HTML autocontenido ─────────────────────────────────────────────────────────
export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Construye el artefacto tal como saldría. Regla de veracidad: literal, sin re-escribir. */
export function buildHtml(piece: ContentPiece): string {
  const assets = piece.assets ?? {};
  const title = assets.copy?.title ?? '';
  const bodyText = assets.copy?.aife_filtered ?? assets.copy?.raw ?? '';
  const imageUrl = assets.image?.url ?? '';
  const brand = piece.brand_id ?? '';
  const platform = piece.platform ?? '';
  const format = piece.format ?? '';

  const imageBlock = imageUrl
    ? `<div class="media"><img src="${esc(imageUrl)}" alt="preview" /></div>`
    : `<div class="media media--none">Sin imagen (canal solo-texto)</div>`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Preview · ${esc(brand)} · ${esc(piece.id)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; background: #050508; color: #e4e4e7;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.55; }
  .card { max-width: 560px; margin: 0 auto; background: #0b0b10; border: 1px solid #26262b; border-radius: 18px; overflow: hidden; }
  .head { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid #1c1c22;
    font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #a1a1aa;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .head .brand { color: #FFAB00; font-weight: 700; }
  .head .sep { color: #3f3f46; }
  .media img { display: block; width: 100%; height: auto; }
  .media--none { padding: 40px 16px; text-align: center; color: #52525b; font-size: 12px;
    font-family: ui-monospace, monospace; background: #08080c; }
  .body { padding: 18px 18px 22px; }
  .title { font-size: 17px; font-weight: 700; color: #fafafa; margin: 0 0 10px; }
  .text { white-space: pre-wrap; word-break: break-word; font-size: 14px; color: #d4d4d8; }
  .meta { margin-top: 16px; padding-top: 12px; border-top: 1px dashed #26262b; font-size: 10px;
    font-family: ui-monospace, monospace; color: #52525b; display: flex; flex-wrap: wrap; gap: 4px 12px; }
  .meta b { color: #71717a; font-weight: 600; }
</style>
</head>
<body>
  <div class="card">
    <div class="head">
      <span class="brand">${esc(brand)}</span>
      <span class="sep">·</span>
      <span>${esc(platform)}</span>
      ${format ? `<span class="sep">·</span><span>${esc(format)}</span>` : ''}
    </div>
    ${imageBlock}
    <div class="body">
      ${title ? `<h1 class="title">${esc(title)}</h1>` : ''}
      <div class="text">${esc(bodyText)}</div>
      <div class="meta">
        <span><b>piece_id</b> ${esc(piece.id)}</span>
        ${piece.voice ? `<span><b>voice</b> ${esc(piece.voice)}</span>` : ''}
        ${piece.domain ? `<span><b>domain</b> ${esc(piece.domain)}</span>` : ''}
        ${assets.builder_meta?.psycho_preset ? `<span><b>psycho</b> ${esc(assets.builder_meta.psycho_preset)}</span>` : ''}
        ${assets.builder_meta?.audience_frame ? `<span><b>audience</b> ${esc(assets.builder_meta.audience_frame)}</span>` : ''}
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ── Acceso a datos (PostgREST, service_role) ──────────────────────────────────────
// Fuente = content.orchestrator_jobs (ver nota en "Tipos de pieza"). Expuesta por
// PostgREST vía Accept-Profile: content.
const PIECE_SELECT = 'id,brand_id,voice,platform,format,domain,status,assets';

/** Lee UN orchestrator_job. null si no existe. Lanza en error de red/HTTP. */
export async function fetchPiece(pieceId: string): Promise<ContentPiece | null> {
  const url = `${SB_URL()}/rest/v1/orchestrator_jobs?id=eq.${encodeURIComponent(pieceId)}&select=${PIECE_SELECT}&limit=1`;
  const res = await fetch(url, {
    headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Accept-Profile': 'content' },
  });
  if (!res.ok) throw new Error(`orchestrator_jobs read failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const rows = (await res.json().catch(() => [])) as ContentPiece[];
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/**
 * Lee las piezas candidatas a calibración (opcionalmente por marca), ordenadas por
 * created_at asc: status in (awaiting_approval, failed). El criterio fino
 * (isCalibrationMaterial: failed exige REJECT + aife) se aplica en JS — PostgREST no
 * expresa cómodamente el AND sobre jsonb + el OR con status. En Fase 1 el volumen lo
 * permite (docenas). Cap defensivo; si se supera, el llamante lo registra.
 */
export const AWAITING_CAP = 2000;
export async function fetchCalibrationPieces(brand?: string): Promise<ContentPiece[]> {
  const brandFilter = brand ? `&brand_id=eq.${encodeURIComponent(brand)}` : '';
  const url = `${SB_URL()}/rest/v1/orchestrator_jobs?status=in.(awaiting_approval,failed)${brandFilter}`
    + `&select=${PIECE_SELECT}&order=created_at.asc&limit=${AWAITING_CAP}`;
  const res = await fetch(url, {
    headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Accept-Profile': 'content' },
  });
  if (!res.ok) throw new Error(`orchestrator_jobs read failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const rows = (await res.json().catch(() => [])) as ContentPiece[];
  // Filtro fino: sólo material de calibración real (excluye fallos técnicos y sin-copy).
  return (Array.isArray(rows) ? rows : []).filter(isCalibrationMaterial);
}

/** IDs de piezas ya evaluadas (existe fila en el corpus). Set para diff O(1). */
export async function fetchEvaluatedIds(): Promise<Set<string>> {
  const url = `${SB_URL()}/rest/v1/approval_calibration?select=piece_id&limit=100000`;
  const res = await fetch(url, {
    headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Accept-Profile': 'intel' },
  });
  if (!res.ok) throw new Error(`corpus read failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const rows = (await res.json().catch(() => [])) as Array<{ piece_id: string }>;
  return new Set((Array.isArray(rows) ? rows : []).map((r) => r.piece_id));
}

/**
 * Sube el HTML al bucket público (idempotente vía x-upsert).
 * Content-Type EXACTAMENTE 'text/html' (sin '; charset=utf-8'): Storage compara el
 * header COMPLETO contra allowed_mime_types=['text/html'] y el sufijo charset da
 * 415 invalid_mime_type. El charset ya va en el <meta charset> del propio HTML.
 */
export async function uploadArtifact(brandId: string, pieceId: string, html: string): Promise<void> {
  const path = encodePath(artifactPath(brandId, pieceId));
  const res = await fetch(`${SB_URL()}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY(),
      Authorization: `Bearer ${SB_KEY()}`,
      'Content-Type': 'text/html',
      'x-upsert': 'true',
    },
    body: html,
  });
  if (!res.ok) throw new Error(`storage upload failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
}

/** Error tipado para "pieza no existe" (fail-loud). */
export class PieceNotFound extends Error {
  constructor(public piece_id: string) { super('piece_not_found'); this.name = 'PieceNotFound'; }
}

/**
 * Genera (o regenera) el artefacto de una pieza: lo sube al CDN (durable, evaluador-
 * agnóstico — es el artifact_url del corpus) y devuelve TAMBIÉN el HTML crudo.
 *
 * El HTML se devuelve porque Supabase sirve los objetos públicos como
 * `text/plain` + `X-Content-Type-Options: nosniff` (medida de seguridad de la
 * plataforma: no se puede servir HTML vivo desde supabase.co). Por eso la bandeja NO
 * puede embeber el artefacto con `<iframe src={cdn_url}>` (mostraría el código); lo
 * renderiza con `<iframe srcdoc={html}>`, que dibuja el HTML directo sin depender del
 * content-type con que el CDN lo sirva.
 *
 * Lanza PieceNotFound si la pieza no existe.
 */
export async function ensureArtifact(pieceId: string): Promise<{ artifact_url: string; piece: ContentPiece; html: string }> {
  const piece = await fetchPiece(pieceId);
  if (!piece) throw new PieceNotFound(pieceId);
  const html = buildHtml(piece);
  await uploadArtifact(piece.brand_id, piece.id, html);
  return { artifact_url: publicArtifactUrl(piece.brand_id, piece.id), piece, html };
}

/**
 * UPSERT del veredicto en intel.approval_calibration (on_conflict piece_id).
 * Copia TODO el contexto de la pieza. Devuelve la fila guardada.
 */
export async function upsertVerdict(row: {
  piece_id: string; brand_id: string; voice: string | null; domain: string | null;
  platform: string | null; format: string | null; psycho_preset: string | null;
  audience_frame: string | null; artifact_url: string; verdict: 'approved' | 'rejected';
  criterion: string | null; evaluated_by: string;
  // Primera opinión del watcher, copiada de la pieza para poder comparar después.
  watcher_result: 'PASS' | 'REJECT' | null; watcher_gate: string | null;
}): Promise<Record<string, unknown>> {
  const url = `${SB_URL()}/rest/v1/approval_calibration?on_conflict=piece_id`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SB_KEY(),
      Authorization: `Bearer ${SB_KEY()}`,
      'Content-Type': 'application/json',
      'Content-Profile': 'intel',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`corpus upsert failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
  const rows = (await res.json().catch(() => [])) as Array<Record<string, unknown>>;
  return Array.isArray(rows) && rows.length ? rows[0] : {};
}
