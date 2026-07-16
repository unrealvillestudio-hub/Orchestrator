/**
 * UNRLVL Orchestrator — api/approve-job.ts v3.1
 *
 * Dual-mode handler:
 *
 *   GET  /api/approve-job?token=<token>&action=approve|reject
 *        → flujo legacy email approval (UI HTML).
 *        → Delega a Supabase EF approve-piece (no se toca).
 *
 *   POST /api/approve-job
 *        Body: { job_id: string, decision: 'approved'|'rejected', notes?: string, approved_by?: string }
 *        → flujo nuevo Claude/Ayra dual-mode.
 *        → UPDATE public.lab_jobs según decisión.
 *        → Si approved: INSERT lab_jobs (job_type='orchestrator_publish', parent_job_id=job_id,
 *                                        approval_payload=<copia del padre>) para arrancar Stage 5+6.
 *        → CORS * para que Claude/Vercel MCP pueda llamar desde Anthropic.
 *
 * Runtime: Node.js (default Vercel serverless).
 *
 * v3.1 (2026-05-27): Migrado de Edge a Node runtime.
 *   El Edge bundle no capturaba SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   en runtime — process.env devolvía '' y todas las requests a Supabase
 *   resultaban en 401 Invalid API key. trigger-job.ts ya corre en Node y
 *   lee las mismas vars sin problema. No hay razón para usar Edge en este
 *   endpoint (no usa waitUntil, no es streaming, no requiere baja latencia
 *   global).
 *
 * ── PATRÓN CICATRIZ (v3.2, 2026-07-17) ──────────────────────────────────────
 * v3.1 migró el runtime a Node pero SE QUEDÓ con la firma Web API
 * `(req: Request): Promise<Response>`, y cerraba afirmando "Web APIs
 * (Request/Response/URL/fetch) funcionan en Node 18+". La afirmación mezcla dos
 * cosas: esas APIs EXISTEN en Node 18+, pero Vercel no te las PASA al handler —
 * invoca con `(IncomingMessage, ServerResponse)`. Así que v3.1 dejó los DOS modos
 * muertos, cada uno a su manera. Verificado en producción (2026-07-16):
 *   GET  → `TypeError: req.headers.get is not a function` (approve-job.ts:81) → 500.
 *          Revienta fuera de todo try/catch, por eso falla rápido.
 *   POST → cuelga >50s: `await req.json()` revienta, el catch devuelve un objeto
 *          `Response` que nadie consume, y sin `res.end()` la función cuelga hasta
 *          el timeout. El approval por email lleva caído desde v3.1.
 *
 * v3.2 migra a la firma Node-native `(req: VercelRequest, res: VercelResponse)`,
 * la de extract-frames.ts / sign-upload.ts. Cambia SOLO la cáscara: el router
 * (POST→JSON, resto→HTML legacy), la delegación a la EF approve-piece y el INSERT
 * del child orchestrator_publish quedan idénticos. El carril lab_jobs no se jubila.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

// Normalize SUPABASE_URL — tolerates bare project ref, bare hostname, or
// full URL. See trigger-job.ts for the full explanation.
function normalizeSupabaseUrl(raw: string | undefined): string {
  if (!raw) return '';
  const s = raw.trim().replace(/\/+$/, '');
  if (!s) return '';
  if (s.startsWith('https://') || s.startsWith('http://')) return s;
  if (s.includes('.supabase.co')) return `https://${s}`;
  if (/^[a-z]{20}$/.test(s)) return `https://${s}.supabase.co`;
  return s;
}

const SB_URL = () => normalizeSupabaseUrl(process.env.SUPABASE_URL);
const SB_KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// Content-Type lo pone res.json() (JSON) o sendHtml() (legacy GET) — aquí solo CORS.
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
function applyCors(res: VercelResponse) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
}

/** Respuesta HTML del flujo legacy. Sin encadenar: setHeader() devuelve
 *  ServerResponse (no VercelResponse), así que .send() no existe en la cadena. */
function sendHtml(res: VercelResponse, status: number, html: string) {
  res.setHeader('Content-Type', 'text/html');
  return res.status(status).send(html);
}

// ── HTML legacy (email approvals) ────────────────────────────────────────────
function htmlPage(title: string, message: string, color: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — UNRLVL</title>
<style>
  body { background:#06080A; color:#CDD5E0; font-family:'Segoe UI',Arial,sans-serif;
         display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0 }
  .card { max-width:480px; padding:48px 40px; text-align:center }
  .icon { font-size:48px; margin-bottom:20px }
  .label { font-family:monospace; font-size:10px; letter-spacing:0.2em;
           text-transform:uppercase; color:${color}; margin-bottom:12px }
  h1 { font-size:22px; font-weight:700; color:#F2F0EC; margin:0 0 12px }
  p  { font-size:13px; color:#4A5E70; line-height:1.6; margin:0 }
</style>
</head><body>
<div class="card">
  <div class="icon">${color === '#00FFD1' ? '✓' : '✗'}</div>
  <div class="label">UNRLVL · Content Queue</div>
  <h1>${title}</h1>
  <p>${message}</p>
</div>
</body></html>`;
}

async function handleLegacyGet(req: VercelRequest, res: VercelResponse) {
  // En Node runtime de Vercel, req.url es una path relativa (ej '/api/approve-job?token=...').
  // new URL() exige URL absoluta o base. Usamos el header 'host' como base, o placeholder.
  // (v3.1 hacía req.headers.get('host') — eso es la API de Headers, no la de Node:
  //  req.headers es un objeto plano y no tiene .get(). Ahí reventaba con TypeError.)
  const hostRaw = req.headers.host;
  const host = (Array.isArray(hostRaw) ? hostRaw[0] : hostRaw) ?? 'orchestrator-unrlvl.vercel.app';
  const url    = new URL(req.url ?? '', `https://${host}`);
  const token  = url.searchParams.get('token');
  const action = url.searchParams.get('action');

  if (!token)
    return sendHtml(res, 400, htmlPage('Token inválido', 'El link no contiene un token válido.', '#FF4444'));

  if (action !== 'approve' && action !== 'reject')
    return sendHtml(res, 400, htmlPage('Acción inválida', 'Solo se permiten: approve o reject.', '#FF4444'));

  const efUrl = `${SB_URL()}/functions/v1/approve-piece?token=${encodeURIComponent(token)}&action=${action}`;
  let result: { error?: string; status?: string; ok?: boolean; published?: boolean; note?: string } = {};
  try {
    // efRes, no res: `res` ya es el VercelResponse del handler. El fetch saliente
    // sí usa Web fetch — eso existe en Node 18+; lo que no existe es que Vercel
    // te pase un Request al handler.
    const efRes = await fetch(efUrl, {
      headers: { Authorization: `Bearer ${SB_KEY()}`, 'Content-Type': 'application/json' },
    });
    result = await efRes.json();
  } catch {
    return sendHtml(res, 200, htmlPage('Error de conexión', 'No se pudo contactar el servidor. Intenta de nuevo.', '#FFB020'));
  }

  if (result.error === 'not_found')
    return sendHtml(res, 404, htmlPage('Link expirado', 'Este link no existe o ya fue procesado.', '#FF4444'));

  if (result.error === 'already_processed') {
    const msg = result.status === 'approved' ? 'Esta pieza ya fue publicada.' : 'Esta pieza fue rechazada previamente.';
    return sendHtml(res, 200, htmlPage('Ya procesado', msg, '#FFB020'));
  }

  if (action === 'reject')
    return sendHtml(res, 200, htmlPage('Rechazado', 'La pieza fue rechazada. No se publicará.', '#FF4444'));

  if (result.published)
    return sendHtml(res, 200, htmlPage('Publicado ✓', 'Aprobado y enviado a SocialLab para publicación.', '#00FFD1'));

  return sendHtml(res, 200,
    htmlPage('Aprobado — publicación pendiente',
      'La pieza fue aprobada. La publicación se procesará cuando OAuth esté configurado.', '#FFB020'));
}

// ── JSON POST (Claude / Ayra) ────────────────────────────────────────────────
// public.lab_jobs es la tabla canónica. PostgREST resuelve /rest/v1/<tabla> al
// schema 'public' por default — sin necesidad de Accept-Profile / Content-Profile.
// (Esos headers, añadidos como defensa preventiva en el commit anterior,
// causaban 406 Not Acceptable en algunos setups donde 'public' no estaba listado
// explícitamente en Exposed Schemas. El bug enmascaraba todo como '404 job_not_found'.)
//
// Las tres funciones ahora devuelven un objeto rico con el outcome real para que
// el handler distinga entre: not_found (job real ausente) vs supabase_error
// (problema técnico: 4xx/5xx, env vars vacías, RLS, etc.).

interface SbResult<T> {
  data:        T | null;
  status:      number;
  body:        string;
  ok:          boolean;
  envMissing?: boolean;
}

function checkEnv(): { ok: boolean; missing: string[]; reason?: string } {
  const missing: string[] = [];
  const url = SB_URL();
  const key = SB_KEY();
  if (!url) missing.push('SUPABASE_URL');
  if (!key) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) return { ok: false, missing };
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, missing: ['SUPABASE_URL'], reason: `SUPABASE_URL no tiene protocolo (valor='${url.slice(0, 50)}...'). Debe empezar con https://` };
  }
  return { ok: true, missing: [] };
}

// Timeout defensivo para fetches a Supabase — si la URL es malformada o hay
// problema de red, evita que la function de Vercel se cuelgue hasta el 504.
const SB_FETCH_TIMEOUT_MS = 8000;

function sbFetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), SB_FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

async function sbFetchJob(jobId: string): Promise<SbResult<Record<string, unknown>>> {
  const env = checkEnv();
  if (!env.ok) {
    return { data: null, status: 0, body: env.reason ?? `env missing: ${env.missing.join(',')}`, ok: false, envMissing: true };
  }
  const url = `${SB_URL()}/rest/v1/lab_jobs?id=eq.${encodeURIComponent(jobId)}&limit=1`;
  let res: Response;
  try {
    res = await sbFetchWithTimeout(url, {
      headers: {
        apikey:        SB_KEY(),
        Authorization: `Bearer ${SB_KEY()}`,
        Accept:        'application/json',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[approve-job sbFetchJob] network', msg);
    return { data: null, status: 0, body: `network: ${msg}`, ok: false };
  }
  const bodyText = await res.text();
  if (!res.ok) {
    console.error(`[approve-job sbFetchJob] ${res.status}`, bodyText.slice(0, 500));
    return { data: null, status: res.status, body: bodyText, ok: false };
  }
  try {
    const arr = JSON.parse(bodyText);
    const row = Array.isArray(arr) && arr.length ? arr[0] : null;
    return { data: row, status: res.status, body: bodyText, ok: true };
  } catch (err) {
    return { data: null, status: res.status, body: bodyText, ok: false };
  }
}

async function sbPatchJob(jobId: string, body: Record<string, unknown>): Promise<SbResult<true>> {
  const env = checkEnv();
  if (!env.ok) {
    return { data: null, status: 0, body: env.reason ?? `env missing: ${env.missing.join(',')}`, ok: false, envMissing: true };
  }
  let res: Response;
  try {
    res = await sbFetchWithTimeout(`${SB_URL()}/rest/v1/lab_jobs?id=eq.${encodeURIComponent(jobId)}`, {
      method: 'PATCH',
      headers: {
        apikey:         SB_KEY(),
        Authorization:  `Bearer ${SB_KEY()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[approve-job sbPatchJob] network', msg);
    return { data: null, status: 0, body: `network: ${msg}`, ok: false };
  }
  const bodyText = await res.text();
  if (!res.ok) {
    console.error(`[approve-job sbPatchJob] ${res.status}`, bodyText.slice(0, 500));
    return { data: null, status: res.status, body: bodyText, ok: false };
  }
  return { data: true, status: res.status, body: bodyText, ok: true };
}

async function sbInsertPublishChild(payload: Record<string, unknown>): Promise<SbResult<string>> {
  const env = checkEnv();
  if (!env.ok) {
    return { data: null, status: 0, body: env.reason ?? `env missing: ${env.missing.join(',')}`, ok: false, envMissing: true };
  }
  let res: Response;
  try {
    res = await sbFetchWithTimeout(`${SB_URL()}/rest/v1/lab_jobs`, {
      method: 'POST',
      headers: {
        apikey:         SB_KEY(),
        Authorization:  `Bearer ${SB_KEY()}`,
        'Content-Type': 'application/json',
        Prefer:         'return=representation',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[approve-job sbInsertPublishChild] network', msg);
    return { data: null, status: 0, body: `network: ${msg}`, ok: false };
  }
  const bodyText = await res.text();
  if (!res.ok) {
    console.error(`[approve-job sbInsertPublishChild] ${res.status}`, bodyText.slice(0, 500));
    return { data: null, status: res.status, body: bodyText, ok: false };
  }
  try {
    const data = JSON.parse(bodyText);
    const id = Array.isArray(data) ? data[0]?.id ?? null : data?.id ?? null;
    return { data: id, status: res.status, body: bodyText, ok: true };
  } catch (err) {
    return { data: null, status: res.status, body: bodyText, ok: false };
  }
}

interface ApprovePostBody {
  job_id?:      string;
  decision?:    'approved' | 'rejected';
  notes?:       string;
  approved_by?: string;
}

async function handleJsonPost(req: VercelRequest, res: VercelResponse) {
  // Pre-check env vars. Si faltan, devolvemos 500 explícito en vez de 404 enmascarado.
  const env = checkEnv();
  if (!env.ok) {
    return res.status(500).json({
      error:   'env_missing',
      missing: env.missing,
      message: `Vercel serverless function no recibió env vars: ${env.missing.join(', ')}. Verifica que estén configuradas para el environment activo (Production/Preview/Development) y que el último deploy las incluya.`,
    });
  }

  // Vercel parsea el JSON body; tolera string por las dudas (igual que sign-upload.ts).
  // Un body ausente o ilegible se trata como {} y cae en las validaciones de abajo,
  // que devuelven el mismo 400 'job_id required' que devolvía el 'Invalid JSON' de v3.1.
  let body: ApprovePostBody = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  if (!body.job_id)
    return res.status(400).json({ error: 'job_id required' });
  if (body.decision !== 'approved' && body.decision !== 'rejected')
    return res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });

  const fetchResult = await sbFetchJob(body.job_id);

  // Distinguir: error de Supabase vs job realmente no existe.
  if (!fetchResult.ok) {
    return res.status(500).json({
      error:       'supabase_error',
      message:     'No se pudo leer lab_jobs desde Supabase',
      sb_status:   fetchResult.status,
      sb_body:     fetchResult.body.slice(0, 500),
      job_id:      body.job_id,
      env_missing: fetchResult.envMissing ?? false,
    });
  }

  const job = fetchResult.data;
  if (!job)
    return res.status(404).json({ error: 'job_not_found', job_id: body.job_id });

  const currentStatus = job.status as string;
  if (currentStatus !== 'pending_approval') {
    return res.status(409).json({
      error:           'invalid_state',
      message:         `job ${body.job_id} está en status='${currentStatus}', solo se puede decidir cuando es 'pending_approval'`,
      current_status:  currentStatus,
    });
  }

  const nowIso = new Date().toISOString();

  if (body.decision === 'rejected') {
    const patchResult = await sbPatchJob(body.job_id, {
      status:          'rejected',
      rejected_reason: body.notes ?? 'rechazado sin notas',
      decision_notes:  body.notes ?? null,
      approved_by:     body.approved_by ?? null,
      completed_at:    nowIso,
    });
    if (!patchResult.ok)
      return res.status(500).json({
        error:     'patch_failed',
        sb_status: patchResult.status,
        sb_body:   patchResult.body.slice(0, 500),
      });

    return res.status(200).json({
      ok:      true,
      job_id:  body.job_id,
      status:  'rejected',
      next:    'pipeline cancelado — no se publicará nada',
    });
  }

  // decision === 'approved'
  const patchResult = await sbPatchJob(body.job_id, {
    status:         'approved',
    approved_at:    nowIso,
    approved_by:    body.approved_by ?? 'sam',
    decision_notes: body.notes ?? null,
  });
  if (!patchResult.ok)
    return res.status(500).json({
      error:     'patch_failed',
      sb_status: patchResult.status,
      sb_body:   patchResult.body.slice(0, 500),
    });

  // Disparar Stage 5+6 vía INSERT child job.
  // El pg_net trigger sobre lab_jobs despierta a lab-worker → processOrchestratorPublishJob.
  const insertResult = await sbInsertPublishChild({
    job_type:         'orchestrator_publish',
    parent_job_id:    body.job_id,
    brand_id:         job.brand_id,
    prompt:           job.prompt ?? null,
    platforms:        job.platforms ?? ['INSTAGRAM', 'FACEBOOK'],
    approval_payload: job.approval_payload ?? null,
    status:           'queued',
    stage_outputs:    {},
  });

  if (!insertResult.ok || !insertResult.data) {
    // El padre quedó aprobado pero el hijo no se creó. Reportamos el fallo a Claude.
    await sbPatchJob(body.job_id, {
      status:    'failed',
      error_msg: `approve-job: no se pudo crear job hijo orchestrator_publish (sb_status=${insertResult.status})`,
      failed_at_stage: 'sociallab',
    });
    return res.status(500).json({
      ok:        false,
      error:     'publish_child_insert_failed',
      job_id:    body.job_id,
      sb_status: insertResult.status,
      sb_body:   insertResult.body.slice(0, 500),
    });
  }

  return res.status(200).json({
    ok:               true,
    job_id:           body.job_id,
    status:           'approved',
    publish_job_id:   insertResult.data,
    next:             'orchestrator_publish job disparado — lee status del publish_job_id',
  });
}

// ── Router ──────────────────────────────────────────────────────────────────
// Ramas idénticas a v3.1; solo cambia la cáscara (firma Node-native).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'POST') return handleJsonPost(req, res);

  // GET y cualquier otro método → flujo legacy HTML (email approvals).
  return handleLegacyGet(req, res);
}
