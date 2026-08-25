/**
 * UNRLVL Orchestrator — api/_calibrationShared.ts  (B4 · Fase 1 · CALIB-UI-01)
 *
 * Helpers compartidos por los endpoints de calibración (preview-render,
 * calibration-queue, calibration-verdict, calibration-discard). Prefijo `_` = módulo,
 * NO ruta Vercel (mismo patrón que _craftModules.ts / _genomePromptBuilder.ts).
 *
 * Contiene: parse defensivo de Supabase URL, auth HS256 (admin), CORS, encode de
 * paths, construcción del artefacto HTML, y el acceso a datos vía PostgREST con
 * service_role + Accept-Profile/Content-Profile (schemas content/intel expuestos).
 *
 * NO hay RPCs SECURITY DEFINER: el diff "pendientes − corpus" se hace en JS
 * (evita la superficie confused-deputy que documenta docs/D6-crons-35-36-runbook.md).
 *
 * ── CALIB-UI-01: la fuente es content_pieces, no orchestrator_jobs ────────────────
 * Hasta este cambio la bandeja leía `content.orchestrator_jobs`. Un job NO es una
 * pieza: cada reintento sobre la misma fila de cola produce otro job, y la bandeja
 * mostraba una tarjeta por intento — cientos de versiones muertas de un puñado de
 * piezas (medido el 2026-08-23: 489 tarjetas para 15 piezas reales).
 *
 * La fuente correcta es `content.content_pieces`, con tres filtros:
 *   1. `discarded_at IS NULL`                       — lo descartado sale de la bandeja
 *   2. sin fila en `intel.approval_calibration`     — lo ya calibrado sale de la bandeja
 *   3. la última versión por `queue_id`             — una tarjeta por pieza, no por intento
 *
 * El id del corpus sigue siendo el mismo que ya usa: verificado contra la base el
 * 2026-08-23, las 9 filas de `intel.approval_calibration` referencian
 * `content_pieces.id` (0 referencian `orchestrator_jobs.id`). El cambio de fuente no
 * invalida ninguna fila existente.
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
  // Fila de cola de la que salió. Varias piezas con el mismo queue_id son VERSIONES
  // de la misma pieza: la bandeja se queda con la última (ver latestPerQueue).
  queue_id?: string | null;
  // Hallazgo que la originó (intel.iid_findings). Se expone para trazabilidad.
  finding_id?: string | null;
  // Job del carril que la produjo. Enlaza con intel.watcher_log.job_id.
  orchestrator_job_id?: string | null;
  voice?: string | null;
  platform?: string | null;
  format?: string | null;
  domain?: string | null;
  status?: string | null;
  created_at?: string | null;
  discarded_at?: string | null;
  discarded_reason?: string | null;
  // SIGN-01 corte D — `clean` frente a `assisted` (CALIB-01). Sam necesita ver de un vistazo si la
  // pieza cuenta para el objetivo del 90% o para el ratio aprovechable.
  pass_type?: string | null;
  approved_at?: string | null;
  assets?: PieceAssets | null;
}

/** Veredicto del watcher normalizado (primera opinión que Sam valida o corrige). */
export interface WatcherVerdict {
  // SIGN-01 corte D — RESCHEDULE existe desde DIV-01 (duplicación) y desde 5e-3 (ventana de
  // hermanas), y este tipo lo colapsaba a `null`: una pieza aplazada se veía igual que una que el
  // Watcher nunca evaluó. Son dos cosas distintas y la tarjeta tiene que nombrarlas.
  result: 'PASS' | 'REJECT' | 'RESCHEDULE' | null;
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
  const result = raw === 'PASS' || raw === 'REJECT' || raw === 'RESCHEDULE' ? raw : null;
  // Defensivo: solo strings no vacíos entran; cualquier otra forma → []. Nunca undefined.
  const failed_rules = Array.isArray(w?.failed_rules)
    ? w!.failed_rules.filter((c): c is string => typeof c === 'string' && c.length > 0)
    : [];
  const rules_evaluated = typeof w?.rules_evaluated === 'number' ? w.rules_evaluated : null;
  return {
    result,
    // El gate acompaña a cualquier veredicto que NO sea PASS: un RESCHEDULE también tiene gate, y
    // saber cuál es la mitad de la explicación.
    gate: (result && result !== 'PASS' ? (w?.failed_gate ?? null) : null),
    failed_rules,
    rules_evaluated,
  };
}

// ── SIGN-01 corte D · LA RAZÓN, NO SÓLO EL CÓDIGO ─────────────────────────────────
// La tarjeta mostraba una lista de códigos que ERA el conjunto EVALUADO y se leía como si fuera de
// violaciones: en `c92b2b9f` aparecían 19 códigos y el Watcher había dado OK. Con eso a la vista,
// rechazar material perfecto es lo esperable, no lo excepcional — y Sam rechazó dos piezas íntegras.
//
// La distinción se hace acá, en el server, y viaja nombrada: `violated` frente a `evaluated`.

/** Qué pasó, en una línea que un humano puede leer sin abrir el gate_detail. */
export function verdictReason(v: WatcherVerdict): string | null {
  if (!v.result) return null;
  if (v.result === 'PASS') {
    return v.rules_evaluated != null
      ? `pasó los gates · se evaluaron ${v.rules_evaluated} regla(s) y ninguna se incumplió`
      : 'pasó los gates';
  }
  const gate = v.gate ? ` en el gate ${v.gate}` : '';
  if (v.result === 'RESCHEDULE') {
    return `el sistema la APLAZÓ${gate}: no debe salir ahora, y no es un defecto de la pieza`;
  }
  return v.failed_rules.length
    ? `incumplió ${v.failed_rules.length} regla(s)${gate}: ${v.failed_rules.join(', ')}`
    : `rechazada${gate}`;
}
// ── SIGN-01 corte D:END ──

/**
 * Reglas del watcher en la forma que EL CORPUS necesita: preserva la distinción
 * NULL vs array vacío que `watcherOf()` colapsa (para el badge del front, ausente → []).
 *
 *   null → NO se registró (pieza pre-v56: `assets.watcher.failed_rules` ausente).
 *   []   → SÍ se registró y no disparó ninguna regla.
 *
 * Esa diferencia es el punto de todo el brief: una etiqueta no se recupera. Por eso el
 * corpus NO puede guardar `[]` como sustituto de "no hay dato" — solo cuando el dato
 * existe y está vacío de verdad. Se copia tal cual venga en assets (sin condicionar a
 * REJECT: un PASS con rules_evaluated=N y failed_rules=[] es información válida y buscada).
 */
export interface WatcherRulesForCorpus {
  rules: string[] | null;
  rules_evaluated: number | null;
}
export function watcherRulesForCorpus(piece: ContentPiece): WatcherRulesForCorpus {
  const w = piece.assets?.watcher;
  const rules = Array.isArray(w?.failed_rules)
    ? w!.failed_rules.filter((c): c is string => typeof c === 'string' && c.length > 0)
    : null; // ausente → NULL (nunca []): "no se registró" ≠ "no disparó ninguna"
  const rules_evaluated = typeof w?.rules_evaluated === 'number' ? w.rules_evaluated : null;
  return { rules, rules_evaluated };
}

// ── Procedencia: traza del watcher (intel.watcher_log) ────────────────────────────
/**
 * Lo que la tarjeta necesita del LOG del watcher, que no está en `assets`:
 *   verdict_at      — cuándo se emitió el veredicto (assets no lo guarda)
 *   rules_evaluated — `gate_detail->'hard_rules'->>'evaluated'`
 *   evaluated_codes — `gate_detail->'hard_rules'->'evaluated_codes'` (campo del PR #79;
 *                     ausente en filas anteriores → [])
 */
export interface WatcherTrace {
  verdict_at: string | null;
  result: 'PASS' | 'REJECT' | null;
  rules_evaluated: number | null;
  evaluated_codes: string[];
}
export const EMPTY_TRACE: WatcherTrace = { verdict_at: null, result: null, rules_evaluated: null, evaluated_codes: [] };

// ── Generación del flujo (intel.pipeline_cutoffs) ─────────────────────────────────
/**
 * Un corte de flujo: el momento desde el cual rige un arreglo. Vive en DATO
 * (`intel.pipeline_cutoffs`), nunca en código — un arreglo futuro entra sembrando una
 * fila, sin tocar ni redeployar este archivo.
 *
 * `scope`: NULL/vacío = alcance de ECOSISTEMA (aplica a toda marca); cualquier otro
 * texto se compara contra `brand_id`. No hay enumeración de marcas ni centinela.
 */
export interface PipelineCutoff {
  id?: string;
  label: string;
  effective_at: string;
  scope: string | null;
  notes?: string | null;
}

export type FlowGeneration = 'current' | 'previous' | 'unknown';

export interface GenerationInfo {
  generation: FlowGeneration;
  cutoff_label: string | null;
  cutoff_at: string | null;
}
export const UNKNOWN_GENERATION: GenerationInfo = { generation: 'unknown', cutoff_label: null, cutoff_at: null };

function millis(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * ¿Esta pieza es del flujo corregido? Corte de referencia = el corte aplicable más
 * reciente (aplicable = alcance de ecosistema, o alcance igual al brand_id de la pieza).
 * Sin cortes aplicables, o sin created_at, la respuesta honesta es `unknown` — no
 * `current`: no se afirma lo que no se sabe.
 */
export function generationOf(piece: ContentPiece, cutoffs: PipelineCutoff[]): GenerationInfo {
  const pieceAt = millis(piece.created_at);
  if (pieceAt === null) return UNKNOWN_GENERATION;

  let ref: PipelineCutoff | null = null;
  let refAt = -Infinity;
  for (const c of cutoffs) {
    const scope = typeof c.scope === 'string' ? c.scope.trim() : '';
    const applies = scope === '' || scope === piece.brand_id;
    if (!applies) continue;
    const at = millis(c.effective_at);
    if (at === null) continue;
    if (at > refAt) { refAt = at; ref = c; }
  }
  if (!ref) return UNKNOWN_GENERATION;

  return {
    generation: pieceAt >= refAt ? 'current' : 'previous',
    cutoff_label: ref.label,
    cutoff_at: ref.effective_at,
  };
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
  // SIGN-01 corte D — los cuatro estados, nombrados. `not_evaluated` NO es un cuarto veredicto del
  // Watcher: es la ausencia de veredicto, y confundirla con un PASS es lo que dejaba tarjetas mudas.
  watcher_verdict: 'PASS' | 'REJECT' | 'RESCHEDULE' | 'not_evaluated';
  watcher_reason: string | null;
  pass_type: string | null;

  // ── Procedencia (CALIB-UI-01 §4.2) ──────────────────────────────────────────
  status: string | null;
  created_at: string | null;        // content_pieces.created_at
  queue_id: string | null;
  job_id: string | null;            // content_pieces.orchestrator_job_id
  finding_id: string | null;
  watcher_verdict_at: string | null; // watcher_log.created_at (última fila del job)
  attempts: number | null;           // orchestrator_jobs con el mismo queue_id
  gate_rules_evaluated: number | null; // gate_detail->hard_rules->evaluated
  gate_evaluated_codes: string[];      // gate_detail->hard_rules->evaluated_codes (PR #79)
  // Generación del flujo (intel.pipeline_cutoffs, leída en runtime).
  generation: FlowGeneration;
  cutoff_label: string | null;
  cutoff_at: string | null;
}

/** Datos que no viven en la fila de la pieza y se resuelven aparte (traza, intentos, corte). */
export interface ContextExtras {
  trace?: WatcherTrace;
  attempts?: number | null;
  generation?: GenerationInfo;
}

export function toContext(piece: ContentPiece, extras: ContextExtras = {}): PieceContext {
  const a = piece.assets ?? {};
  const w = watcherOf(piece);
  const trace = extras.trace ?? EMPTY_TRACE;
  const gen = extras.generation ?? UNKNOWN_GENERATION;
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
    // `watcher_result` conserva su forma LEGACY (PASS | REJECT | null) porque es la que viaja al
    // corpus `intel.approval_calibration`, cuya columna significa "la primera opinión que Sam valida
    // o corrige". Un RESCHEDULE no es una opinión sobre la pieza —es "todavía no"— y además una
    // aplazada no llega a la bandeja de calibración. El veredicto COMPLETO viaja en
    // `watcher_verdict`, que es el que lee la tarjeta.
    watcher_result: w.result === 'RESCHEDULE' ? null : w.result,
    watcher_gate: w.gate,
    watcher_failed_rules: w.failed_rules,
    watcher_rules_evaluated: w.rules_evaluated,
    watcher_verdict: w.result ?? 'not_evaluated',
    watcher_reason: verdictReason(w),
    pass_type: piece.pass_type ?? null,

    status: piece.status ?? null,
    created_at: piece.created_at ?? null,
    queue_id: piece.queue_id ?? null,
    job_id: piece.orchestrator_job_id ?? null,
    finding_id: piece.finding_id ?? null,
    watcher_verdict_at: trace.verdict_at,
    attempts: extras.attempts ?? null,
    gate_rules_evaluated: trace.rules_evaluated,
    gate_evaluated_codes: trace.evaluated_codes,
    generation: gen.generation,
    cutoff_label: gen.cutoff_label,
    cutoff_at: gen.cutoff_at,
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
// Fuente = content.content_pieces (ver la nota del encabezado). Expuesta por PostgREST
// vía Accept-Profile: content.
const PIECE_SELECT = 'id,brand_id,queue_id,finding_id,orchestrator_job_id,voice,platform,format,domain,status,created_at,discarded_at,discarded_reason,pass_type,approved_at,assets';

function sbHeaders(profile: 'content' | 'intel', extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Accept-Profile': profile, ...extra };
}

/** Lee UNA pieza. null si no existe. Lanza en error de red/HTTP. */
export async function fetchPiece(pieceId: string): Promise<ContentPiece | null> {
  const url = `${SB_URL()}/rest/v1/content_pieces?id=eq.${encodeURIComponent(pieceId)}&select=${PIECE_SELECT}&limit=1`;
  const res = await fetch(url, { headers: sbHeaders('content') });
  if (!res.ok) throw new Error(`content_pieces read failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const rows = (await res.json().catch(() => [])) as ContentPiece[];
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/**
 * Piezas vivas (no descartadas), ordenadas por created_at desc. Base común de las dos
 * bandejas. El resto de los filtros (corpus, última versión por queue_id, marca, veredicto,
 * generación, canal) se aplican en JS sobre este conjunto — PostgREST no expresa cómodamente
 * el anti-join contra el corpus ni el DISTINCT ON por queue_id.
 *
 * Cap defensivo; si se supera, el llamante lo registra y marca la respuesta como truncada.
 */
export const PIECES_CAP = 2000;
export async function fetchLivePieces(
  opts: { brand?: string; excludeStatuses?: string[]; onlyStatuses?: string[] } = {},
): Promise<ContentPiece[]> {
  const brandFilter = opts.brand ? `&brand_id=eq.${encodeURIComponent(opts.brand)}` : '';
  // Exclusión por estado, opcional: la bandeja de calibración juzga cualquier pieza viva,
  // la de publicación sólo las que todavía no salieron del circuito. El eje lo decide el
  // llamante; acá sólo se traduce a PostgREST.
  const statuses = (opts.excludeStatuses ?? []).filter((s) => typeof s === 'string' && s);
  // El filtro POSITIVO gana al negativo cuando el llamante lo declara: "sólo estos estados" es una
  // afirmación más fuerte que "todos menos éstos", y mezclarlos produciría un conjunto que ninguno
  // de los dos llamantes pidió.
  const only = (opts.onlyStatuses ?? []).filter((s) => typeof s === 'string' && s);
  const statusFilter = only.length
    ? `&status=in.(${encodeURIComponent(only.map((s) => `"${s}"`).join(','))})`
    : statuses.length
    ? `&status=not.in.(${encodeURIComponent(statuses.map((s) => `"${s}"`).join(','))})`
    : '';
  const url = `${SB_URL()}/rest/v1/content_pieces?discarded_at=is.null${brandFilter}${statusFilter}`
    + `&select=${PIECE_SELECT}&order=created_at.desc&limit=${PIECES_CAP}`;
  const res = await fetch(url, { headers: sbHeaders('content') });
  if (!res.ok) throw new Error(`content_pieces read failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const rows = (await res.json().catch(() => [])) as ContentPiece[];
  return Array.isArray(rows) ? rows : [];
}

/**
 * Material de la bandeja de calibración: SÓLO lo que espera aprobación.
 *
 * SIGN-01 corte D — antes era "toda pieza viva, sin filtro de estado", y por eso la bandeja mezclaba
 * estados: mostraba piezas `deferred` (aplazadas por el sistema, DIV-01) y `challenged` (retenidas
 * por desacuerdo, CALIB-01) como si esperaran el visto bueno de Sam. `c5d542b7` y `afded574` fueron
 * RECHAZADAS estando ya apartadas por el sistema — una decisión sobre una pieza que nadie había
 * puesto a decisión.
 *
 * Las aplazadas y las retenidas tienen sus propias vistas y sus propias acciones; la de calibración
 * juzga lo que de verdad está esperando.
 */
export const CALIBRATION_STATUSES = ['awaiting_approval'];
export function fetchCalibrationPieces(brand?: string): Promise<ContentPiece[]> {
  return fetchLivePieces({ brand, onlyStatuses: CALIBRATION_STATUSES });
}

/**
 * Una tarjeta por PIEZA, no por intento: de cada `queue_id` sobrevive la versión con
 * `created_at` más alto. Una pieza sin `queue_id` no tiene versiones — es su propio grupo.
 * Empate de timestamp → gana la primera del input (el llamante lo entrega ya ordenado).
 */
export function latestPerQueue(pieces: ContentPiece[]): ContentPiece[] {
  const best = new Map<string, ContentPiece>();
  for (const p of pieces) {
    const key = p.queue_id ? `queue:${p.queue_id}` : `piece:${p.id}`;
    const cur = best.get(key);
    if (!cur) { best.set(key, p); continue; }
    const a = millis(p.created_at) ?? -Infinity;
    const b = millis(cur.created_at) ?? -Infinity;
    if (a > b) best.set(key, p);
  }
  return Array.from(best.values());
}

/** IDs de piezas ya evaluadas (existe fila en el corpus). Set para diff O(1). */
export async function fetchEvaluatedIds(): Promise<Set<string>> {
  const url = `${SB_URL()}/rest/v1/approval_calibration?select=piece_id&limit=100000`;
  const res = await fetch(url, { headers: sbHeaders('intel') });
  if (!res.ok) throw new Error(`corpus read failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const rows = (await res.json().catch(() => [])) as Array<{ piece_id: string }>;
  return new Set((Array.isArray(rows) ? rows : []).map((r) => r.piece_id));
}

/**
 * Cortes del flujo. `null` = la tabla no se pudo consultar (todavía no migrada): la
 * bandeja degrada a generación `unknown` en vez de romperse. `[]` = tabla presente y
 * vacía, que produce el mismo `unknown` pero por una razón distinta y verificable.
 */
export async function fetchPipelineCutoffs(): Promise<PipelineCutoff[] | null> {
  const url = `${SB_URL()}/rest/v1/pipeline_cutoffs?select=id,label,effective_at,scope,notes&order=effective_at.desc&limit=1000`;
  let res: Response;
  try {
    res = await fetch(url, { headers: sbHeaders('intel') });
  } catch {
    return null;
  }
  if (!res.ok) {
    // 404 / PGRST205 = la tabla aún no existe en el schema cache. No es un fallo del
    // endpoint: es un corte que todavía no se sembró.
    console.warn(`[calibration] pipeline_cutoffs no disponible (${res.status}) — generación = unknown`);
    return null;
  }
  const rows = (await res.json().catch(() => [])) as PipelineCutoff[];
  return Array.isArray(rows) ? rows : [];
}

/**
 * Traza del watcher por job. Se pide sólo para los jobs de la página visible (el `in.()`
 * de PostgREST crece con la lista). De cada job sobrevive la ÚLTIMA fila del log: un job
 * puede tener varias (verificado en base — reintentos internos del watcher).
 */
export async function fetchWatcherTraces(jobIds: string[]): Promise<Map<string, WatcherTrace>> {
  const out = new Map<string, WatcherTrace>();
  const ids = Array.from(new Set(jobIds.filter((id): id is string => typeof id === 'string' && !!id)));
  if (!ids.length) return out;

  const list = ids.map((id) => `"${id}"`).join(',');
  const url = `${SB_URL()}/rest/v1/watcher_log?job_id=in.(${encodeURIComponent(list)})`
    + `&select=job_id,result,gate_detail,created_at&order=created_at.desc&limit=${ids.length * 20}`;
  const res = await fetch(url, { headers: sbHeaders('intel') });
  if (!res.ok) {
    console.warn(`[calibration] watcher_log read failed: ${res.status} — procedencia parcial`);
    return out;
  }
  const rows = (await res.json().catch(() => [])) as Array<{
    job_id: string | null; result: string | null; gate_detail: any; created_at: string;
  }>;

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row.job_id || out.has(row.job_id)) continue; // order desc → la primera es la última
    const hard = row.gate_detail?.hard_rules ?? {};
    const evaluated = Number(hard?.evaluated);
    const codes = Array.isArray(hard?.evaluated_codes)
      ? hard.evaluated_codes.filter((c: unknown): c is string => typeof c === 'string' && !!c)
      : [];
    const raw = typeof row.result === 'string' ? row.result.toUpperCase() : null;
    out.set(row.job_id, {
      verdict_at: row.created_at ?? null,
      result: raw === 'PASS' || raw === 'REJECT' ? raw : null,
      rules_evaluated: Number.isFinite(evaluated) ? evaluated : null,
      evaluated_codes: codes,
    });
  }
  return out;
}

/**
 * Cuántos jobs se corrieron sobre cada fila de cola = cuántos INTENTOS hubo para llegar
 * a esa pieza. Es el número que explica por qué la bandeja vieja mostraba cientos de
 * tarjetas: son reintentos, no piezas.
 */
export const ATTEMPTS_CAP = 5000;
export async function fetchAttemptsByQueue(queueIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = Array.from(new Set(queueIds.filter((id): id is string => typeof id === 'string' && !!id)));
  if (!ids.length) return out;

  const list = ids.map((id) => `"${id}"`).join(',');
  const url = `${SB_URL()}/rest/v1/orchestrator_jobs?queue_id=in.(${encodeURIComponent(list)})`
    + `&select=queue_id&limit=${ATTEMPTS_CAP}`;
  const res = await fetch(url, { headers: sbHeaders('content') });
  if (!res.ok) {
    console.warn(`[calibration] orchestrator_jobs count failed: ${res.status} — intentos sin dato`);
    return out;
  }
  const rows = (await res.json().catch(() => [])) as Array<{ queue_id: string | null }>;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r.queue_id) continue;
    out.set(r.queue_id, (out.get(r.queue_id) ?? 0) + 1);
  }
  return out;
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
  // Nivel de REGLA (de assets.watcher.failed_rules / rules_evaluated). NULL ≠ [] a propósito:
  // NULL = no registrado (pre-v56); [] = registrado, sin regla disparada. Ver watcherRulesForCorpus().
  watcher_rules: string[] | null; watcher_rules_evaluated: number | null;
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

// ── SIGN-01 corte A2 · LA DECISIÓN SE EJECUTA ─────────────────────────────────────
// EL DEFECTO. Ni aprobar ni rechazar tocaban la pieza: sólo se escribía el corpus. Las 6 decisiones
// de Sam del 2026-08-25 dejaron las 6 piezas exactamente como estaban — no había flujo, había
// opiniones registradas. Es el mismo defecto que obligó a sellar una pieza a mano por la mañana.
//
// APROBAR = HABILITAR, no publicar. Sella `approved_at`, que es lo que el modo `placement` de
// content-scheduler exige para ver la pieza; la franja la calcula él. Es exactamente el contrato que
// `approve-piece` (el otro repo) ya implementaba para el carril del email — acá se aplica el MISMO
// efecto, con el gate de rol de este repo, en vez de llamar a la EF: el token de aprobación del email
// es de un solo uso y esta bandeja no lo tiene.
//
// RECHAZAR = DESCARTAR. `status='rejected'` + `discarded_at` + `discarded_reason` con el motivo
// estructurado. Sin `discarded_at` la pieza seguiría apareciendo en la bandeja después de rechazarla.
//
// LAS DOS SIGUEN ESCRIBIENDO EL CORPUS: la calibración no se pierde, se suma. Y el efecto se aplica
// DESPUÉS del upsert — si el corpus falla, la pieza no se mueve, por el mismo criterio que el
// arbitraje de CALIB-01: mover sin registrar por qué es el defecto de este brief del otro lado.
export function verdictEffect(
  verdict: 'approved' | 'rejected', nowIso: string, by: string, reason: string | null,
): Record<string, unknown> {
  return verdict === 'approved'
    ? { status: 'scheduled', approved_at: nowIso, approved_by: by }
    : { status: 'rejected', discarded_at: nowIso, discarded_reason: reason };
}

/**
 * Aplica el efecto a la pieza. Devuelve la fila actualizada, o `null` si la pieza ya no estaba
 * disponible (otro operador la movió primero): el ancla `discarded_at=is.null` hace la operación
 * segura ante dos manos a la vez, y el llamador lo reporta en vez de fingir que escribió.
 */
export async function applyVerdictToPiece(
  pieceId: string, verdict: 'approved' | 'rejected', by: string, reason: string | null,
): Promise<ContentPiece | null> {
  const url = `${SB_URL()}/rest/v1/content_pieces?id=eq.${encodeURIComponent(pieceId)}&discarded_at=is.null`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`,
      'Content-Type': 'application/json', 'Content-Profile': 'content',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(verdictEffect(verdict, new Date().toISOString(), by, reason)),
  });
  if (!res.ok) throw new Error(`piece verdict failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
  const rows = (await res.json().catch(() => [])) as ContentPiece[];
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/** Error tipado para "la pieza ya estaba descartada" (no se pisa un descarte previo). */
export class AlreadyDiscarded extends Error {
  constructor(public piece_id: string, public discarded_at: string) {
    super('already_discarded'); this.name = 'AlreadyDiscarded';
  }
}

/**
 * DESCARTAR ≠ RECHAZAR. Un rechazo dice "esto está mal" y entra al corpus; un descarte
 * dice "no voy a juzgar esto" y NO entra al corpus — sólo sella la pieza para que salga
 * de la bandeja. Confundirlos mete ruido en el material de entrenamiento.
 *
 * Esta función NO escribe en intel.approval_calibration. Sella `discarded_at` +
 * `discarded_reason` en content.content_pieces y nada más.
 */
export async function discardPiece(pieceId: string, reason: string | null): Promise<ContentPiece> {
  const piece = await fetchPiece(pieceId);
  if (!piece) throw new PieceNotFound(pieceId);
  if (piece.discarded_at) throw new AlreadyDiscarded(pieceId, piece.discarded_at);

  const url = `${SB_URL()}/rest/v1/content_pieces?id=eq.${encodeURIComponent(pieceId)}&discarded_at=is.null`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: SB_KEY(),
      Authorization: `Bearer ${SB_KEY()}`,
      'Content-Type': 'application/json',
      'Content-Profile': 'content',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ discarded_at: new Date().toISOString(), discarded_reason: reason }),
  });
  if (!res.ok) throw new Error(`discard failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
  const rows = (await res.json().catch(() => [])) as ContentPiece[];
  // Carrera con otro descarte concurrente: el filtro discarded_at=is.null no matcheó.
  if (!Array.isArray(rows) || !rows.length) {
    const fresh = await fetchPiece(pieceId);
    throw new AlreadyDiscarded(pieceId, fresh?.discarded_at ?? new Date().toISOString());
  }
  return rows[0];
}
