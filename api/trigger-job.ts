/**
 * UNRLVL Orchestrator — api/trigger-job.ts v4.0
 *
 * Thin wrapper: valida input + INSERT en public.lab_jobs + 202 inmediato.
 * Todo el pipeline corre en lab-worker EF de Supabase (job_type='orchestrator').
 * El pg_net trigger sobre lab_jobs despierta a lab-worker automáticamente.
 *
 * POST /api/trigger-job
 * Body: {
 *   brand_id: string,
 *   prompt: string,
 *   platforms?: string[],      // default: ['INSTAGRAM', 'FACEBOOK']
 *   aspect_ratio?: string,     // default: '4:5'
 *   auto_publish?: boolean,    // default: false — si true salta approval gate
 *   secret?: string,           // opcional si TRIGGER_SECRET está configurado
 * }
 *
 * Returns: { job_id, status: 'queued' }  (202 Accepted)
 *
 * Claude lee resultado en lab_jobs:
 *   - status='pending_approval' → presentar approval_payload a Sam
 *   - status='completed'        → leer output_parsed (post final publicado)
 *   - status='failed'           → leer error_msg + failed_at_stage
 *   - status='rejected'         → leer rejected_reason
 */

declare const process: { env: Record<string, string | undefined> };

const SB_URL = () => process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SB_KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-trigger-secret',
};

interface TriggerBody {
  brand_id?:     string;
  prompt?:       string;
  platforms?:    string[];
  aspect_ratio?: string;
  auto_publish?: boolean;
}

async function insertOrchestratorJob(payload: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch(`${SB_URL()}/rest/v1/lab_jobs`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY(),
        Authorization: `Bearer ${SB_KEY()}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error('[trigger-job] insert failed', res.status, await res.text());
      return null;
    }
    const data = await res.json();
    return Array.isArray(data) ? data[0]?.id ?? null : data?.id ?? null;
  } catch (err) {
    console.error('[trigger-job] insert exception', err);
    return null;
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: CORS });
  }

  // Auth opcional
  const secret = process.env.TRIGGER_SECRET;
  if (secret) {
    const auth = req.headers.get('x-trigger-secret') ?? '';
    if (auth !== secret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
    }
  }

  let body: TriggerBody = {};
  try { body = await req.json(); } catch { /* keep empty */ }

  if (!body.brand_id) {
    return new Response(JSON.stringify({ error: 'brand_id required' }), { status: 400, headers: CORS });
  }
  if (!body.prompt) {
    return new Response(JSON.stringify({ error: 'prompt required' }), { status: 400, headers: CORS });
  }

  const platforms    = body.platforms    ?? ['INSTAGRAM', 'FACEBOOK'];
  const aspect_ratio = body.aspect_ratio ?? '4:5';
  const auto_publish = body.auto_publish ?? false;

  // INSERT lab_jobs. pg_net trigger despierta a lab-worker → processOrchestratorJob.
  const jobId = await insertOrchestratorJob({
    job_type:     'orchestrator',
    brand_id:     body.brand_id,
    prompt:       body.prompt,
    platforms,
    aspect_ratio,
    auto_publish,
    status:       'queued',
    stage_outputs: {},
  });

  if (!jobId) {
    return new Response(
      JSON.stringify({ error: 'Failed to enqueue job in Supabase' }),
      { status: 500, headers: CORS }
    );
  }

  return new Response(
    JSON.stringify({
      job_id:   jobId,
      status:   'queued',
      brand_id: body.brand_id,
      prompt:   body.prompt,
      note:     'Pipeline corriendo. Lee public.lab_jobs WHERE id=job_id para status.',
    }),
    { status: 202, headers: CORS }
  );
}
