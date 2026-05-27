/**
 * UNRLVL Orchestrator — api/approve-job.ts v3.0
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
 * Runtime: edge.
 */

declare const process: { env: Record<string, string | undefined> };
export const config = { runtime: 'edge' };

const SB_URL = () => process.env.SUPABASE_URL ?? '';
const SB_KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const JSON_CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

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

async function handleLegacyGet(req: Request): Promise<Response> {
  const url    = new URL(req.url);
  const token  = url.searchParams.get('token');
  const action = url.searchParams.get('action');

  if (!token)
    return new Response(htmlPage('Token inválido', 'El link no contiene un token válido.', '#FF4444'),
      { status: 400, headers: { 'Content-Type': 'text/html' } });

  if (action !== 'approve' && action !== 'reject')
    return new Response(htmlPage('Acción inválida', 'Solo se permiten: approve o reject.', '#FF4444'),
      { status: 400, headers: { 'Content-Type': 'text/html' } });

  const efUrl = `${SB_URL()}/functions/v1/approve-piece?token=${encodeURIComponent(token)}&action=${action}`;
  let result: { error?: string; status?: string; ok?: boolean; published?: boolean; note?: string } = {};
  try {
    const res = await fetch(efUrl, {
      headers: { Authorization: `Bearer ${SB_KEY()}`, 'Content-Type': 'application/json' },
    });
    result = await res.json();
  } catch {
    return new Response(htmlPage('Error de conexión', 'No se pudo contactar el servidor. Intenta de nuevo.', '#FFB020'),
      { status: 200, headers: { 'Content-Type': 'text/html' } });
  }

  if (result.error === 'not_found')
    return new Response(htmlPage('Link expirado', 'Este link no existe o ya fue procesado.', '#FF4444'),
      { status: 404, headers: { 'Content-Type': 'text/html' } });

  if (result.error === 'already_processed') {
    const msg = result.status === 'approved' ? 'Esta pieza ya fue publicada.' : 'Esta pieza fue rechazada previamente.';
    return new Response(htmlPage('Ya procesado', msg, '#FFB020'),
      { status: 200, headers: { 'Content-Type': 'text/html' } });
  }

  if (action === 'reject')
    return new Response(htmlPage('Rechazado', 'La pieza fue rechazada. No se publicará.', '#FF4444'),
      { status: 200, headers: { 'Content-Type': 'text/html' } });

  if (result.published)
    return new Response(htmlPage('Publicado ✓', 'Aprobado y enviado a SocialLab para publicación.', '#00FFD1'),
      { status: 200, headers: { 'Content-Type': 'text/html' } });

  return new Response(
    htmlPage('Aprobado — publicación pendiente',
      'La pieza fue aprobada. La publicación se procesará cuando OAuth esté configurado.', '#FFB020'),
    { status: 200, headers: { 'Content-Type': 'text/html' } }
  );
}

// ── JSON POST (Claude / Ayra) ────────────────────────────────────────────────
// Headers Accept-Profile / Content-Profile fuerzan el schema 'public' explícitamente.
// Defensa por si en el futuro PostgREST añade otros schemas (intel, content) al db.schemas
// y el default cambia. La tabla canónica es public.lab_jobs.

async function sbFetchJob(jobId: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(
    `${SB_URL()}/rest/v1/lab_jobs?id=eq.${jobId}&limit=1`,
    {
      headers: {
        apikey:           SB_KEY(),
        Authorization:    `Bearer ${SB_KEY()}`,
        'Accept-Profile': 'public',
      },
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return Array.isArray(data) && data.length ? data[0] : null;
}

async function sbPatchJob(jobId: string, body: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(`${SB_URL()}/rest/v1/lab_jobs?id=eq.${jobId}`, {
    method: 'PATCH',
    headers: {
      apikey:            SB_KEY(),
      Authorization:     `Bearer ${SB_KEY()}`,
      'Content-Type':    'application/json',
      'Content-Profile': 'public',
    },
    body: JSON.stringify(body),
  });
  return res.ok;
}

async function sbInsertPublishChild(payload: Record<string, unknown>): Promise<string | null> {
  const res = await fetch(`${SB_URL()}/rest/v1/lab_jobs`, {
    method: 'POST',
    headers: {
      apikey:            SB_KEY(),
      Authorization:     `Bearer ${SB_KEY()}`,
      'Content-Type':    'application/json',
      'Content-Profile': 'public',
      Prefer:            'return=representation',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return Array.isArray(data) ? data[0]?.id ?? null : data?.id ?? null;
}

interface ApprovePostBody {
  job_id?:      string;
  decision?:    'approved' | 'rejected';
  notes?:       string;
  approved_by?: string;
}

async function handleJsonPost(req: Request): Promise<Response> {
  let body: ApprovePostBody = {};
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: JSON_CORS });
  }

  if (!body.job_id)
    return new Response(JSON.stringify({ error: 'job_id required' }), { status: 400, headers: JSON_CORS });
  if (body.decision !== 'approved' && body.decision !== 'rejected')
    return new Response(JSON.stringify({ error: "decision must be 'approved' or 'rejected'" }),
      { status: 400, headers: JSON_CORS });

  const job = await sbFetchJob(body.job_id);
  if (!job)
    return new Response(JSON.stringify({ error: 'job_not_found', job_id: body.job_id }),
      { status: 404, headers: JSON_CORS });

  const currentStatus = job.status as string;
  if (currentStatus !== 'pending_approval') {
    return new Response(
      JSON.stringify({
        error:           'invalid_state',
        message:         `job ${body.job_id} está en status='${currentStatus}', solo se puede decidir cuando es 'pending_approval'`,
        current_status:  currentStatus,
      }),
      { status: 409, headers: JSON_CORS }
    );
  }

  const nowIso = new Date().toISOString();

  if (body.decision === 'rejected') {
    const ok = await sbPatchJob(body.job_id, {
      status:          'rejected',
      rejected_reason: body.notes ?? 'rechazado sin notas',
      decision_notes:  body.notes ?? null,
      approved_by:     body.approved_by ?? null,
      completed_at:    nowIso,
    });
    if (!ok)
      return new Response(JSON.stringify({ error: 'patch_failed' }), { status: 500, headers: JSON_CORS });

    return new Response(JSON.stringify({
      ok:      true,
      job_id:  body.job_id,
      status:  'rejected',
      next:    'pipeline cancelado — no se publicará nada',
    }), { status: 200, headers: JSON_CORS });
  }

  // decision === 'approved'
  const okPatch = await sbPatchJob(body.job_id, {
    status:         'approved',
    approved_at:    nowIso,
    approved_by:    body.approved_by ?? 'sam',
    decision_notes: body.notes ?? null,
  });
  if (!okPatch)
    return new Response(JSON.stringify({ error: 'patch_failed' }), { status: 500, headers: JSON_CORS });

  // Disparar Stage 5+6 vía INSERT child job.
  // El pg_net trigger sobre lab_jobs despierta a lab-worker → processOrchestratorPublishJob.
  const childId = await sbInsertPublishChild({
    job_type:         'orchestrator_publish',
    parent_job_id:    body.job_id,
    brand_id:         job.brand_id,
    prompt:           job.prompt ?? null,
    platforms:        job.platforms ?? ['INSTAGRAM', 'FACEBOOK'],
    approval_payload: job.approval_payload ?? null,
    status:           'queued',
    stage_outputs:    {},
  });

  if (!childId) {
    // El padre quedó aprobado pero el hijo no se creó. Reportamos el fallo a Claude.
    await sbPatchJob(body.job_id, {
      status:    'failed',
      error_msg: 'approve-job: no se pudo crear job hijo orchestrator_publish',
      failed_at_stage: 'sociallab',
    });
    return new Response(JSON.stringify({
      ok:     false,
      error:  'publish_child_insert_failed',
      job_id: body.job_id,
    }), { status: 500, headers: JSON_CORS });
  }

  return new Response(JSON.stringify({
    ok:               true,
    job_id:           body.job_id,
    status:           'approved',
    publish_job_id:   childId,
    next:             'orchestrator_publish job disparado — lee status del publish_job_id',
  }), { status: 200, headers: JSON_CORS });
}

// ── Router ──────────────────────────────────────────────────────────────────
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: JSON_CORS });

  if (req.method === 'POST') return handleJsonPost(req);

  // GET y cualquier otro método → flujo legacy HTML (email approvals).
  return handleLegacyGet(req);
}
