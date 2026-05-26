/**
 * UNRLVL Orchestrator — api/trigger-job.ts v3.0
 * Dual-mode entry point: permite a Claude/Ayra disparar un flujo completo
 * sin necesitar la UI del Orchestrator.
 *
 * POST /api/trigger-job
 * Body: {
 *   brand_id: string,
 *   prompt: string,
 *   platforms?: string[],      // default: ['INSTAGRAM', 'FACEBOOK']
 *   aspect_ratio?: string,     // default: '4:5'
 *   auto_publish?: boolean,    // default: false — si true no espera aprobación
 *   secret?: string,           // opcional si TRIGGER_SECRET está configurado
 * }
 *
 * Returns INMEDIATO: { status: 'running', job_id, brand_id, prompt }
 *
 * El pipeline corre en background (fire-and-forget):
 * - usa ctx.waitUntil() si el runtime lo expone (Edge/Cloudflare)
 * - fallback: Promise flotante sin await (Vercel Node.js serverless)
 * El resultado final se escribe en content.orchestrator_jobs cuando termina.
 * Claude puede leerlo después via Supabase.
 *
 * Env vars: TRIGGER_SECRET (opcional), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * ANTHROPIC_API_KEY (para interpret-intent)
 */

declare const process: { env: Record<string, string | undefined> };

const SB_URL  = () => process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SB_KEY  = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
const ANT_KEY = () => process.env.ANTHROPIC_API_KEY ?? '';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-trigger-secret',
};

// Lab endpoints desde Supabase
async function getLabEndpoints(): Promise<Record<string, string>> {
  try {
    const res = await fetch(
      `${SB_URL()}/rest/v1/lab_configs?select=lab_key,api_endpoint,execute_path&active=eq.true`,
      { headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}` } }
    );
    if (!res.ok) return {};
    const rows = await res.json() as Array<{ lab_key: string; api_endpoint: string; execute_path: string }>;
    return Object.fromEntries(rows.map(r => [r.lab_key, `${r.api_endpoint}${r.execute_path}`]));
  } catch { return {}; }
}

// Escribir job en Supabase para trazabilidad
async function writeJob(job: object): Promise<string | null> {
  try {
    const res = await fetch(`${SB_URL()}/rest/v1/orchestrator_jobs`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY(),
        Authorization: `Bearer ${SB_KEY()}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(job),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data[0]?.id : data?.id;
  } catch { return null; }
}

async function updateJob(id: string, data: object): Promise<void> {
  try {
    await fetch(`${SB_URL()}/rest/v1/orchestrator_jobs?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        apikey: SB_KEY(),
        Authorization: `Bearer ${SB_KEY()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
  } catch { /* non-blocking */ }
}

// Interpretar prompt usando Claude directamente
async function interpretIntent(prompt: string, brand_id: string): Promise<{
  stages: Array<{ labId: string; label: string; description: string; order: number; estimatedSeconds: number }>;
  platforms: string[];
}> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANT_KEY(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: `Eres el interpretador del Orchestrator UNRLVL. Dado un prompt de producción de contenido,
devuelve SOLO JSON válido con esta estructura exacta (sin markdown, sin explicaciones):
{
  "stages": [
    {"labId":"copylab","label":"Generar copy","description":"...","order":1,"estimatedSeconds":8},
    {"labId":"imagelab","label":"Generar imagen","description":"...","order":2,"estimatedSeconds":30},
    {"labId":"sociallab","label":"Encolar post","description":"...","order":3,"estimatedSeconds":3},
    {"labId":"meta","label":"Publicar","description":"...","order":4,"estimatedSeconds":3}
  ],
  "platforms": ["INSTAGRAM","FACEBOOK"]
}
Para un post orgánico con imagen siempre incluye copylab→imagelab→sociallab→meta en ese orden.`,
      messages: [{ role: 'user', content: `Brand: ${brand_id}\nPrompt: ${prompt}` }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = await res.json();
  const text = data.content?.[0]?.text ?? '{}';
  return JSON.parse(text);
}

// Llamar a un lab
async function callLab(
  endpoint: string,
  brandId: string,
  stage: { labId: string; label: string; description: string; order: number },
  previousOutputs: Record<string, string>,
  params: Record<string, unknown> = {},
): Promise<{ output?: string; image_data_url?: string; error?: string }> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      brandId,
      stage,
      params: { canal: 'instagram_feed', aspect_ratio: params.aspect_ratio ?? '4:5', ...params },
      previousOutputs,
      meta: { motor: 'claude', language: 'ES' },
    }),
  });
  if (!res.ok) return { error: `HTTP ${res.status}: ${await res.text()}` };
  return res.json();
}

// Upload imagen a Supabase Storage via Meta MCP
async function uploadImage(dataUrl: string, brandId: string): Promise<string | null> {
  try {
    const base64 = dataUrl.split(',')[1];
    const res = await fetch('https://unrlvl-meta-mcp.vercel.app/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64, mime_type: 'image/jpeg', folder: 'published', brand_id: brandId }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { public_url?: string };
    return data.public_url ?? null;
  } catch { return null; }
}

// Publicar via SocialLab /api/publish
async function publishPosts(brandId: string): Promise<string> {
  const res = await fetch('https://social-lab-flame.vercel.app/api/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ brand_id: brandId }),
  });
  if (!res.ok) return `Publish HTTP ${res.status}`;
  const data = await res.json() as { output?: string };
  return data.output ?? 'Publicado';
}

// ── PIPELINE (background) ─────────────────────────────────────────────────────

async function runPipeline(
  jobId: string,
  brandId: string,
  prompt: string,
  autoPublish: boolean,
  aspectRatio: string,
): Promise<void> {
  const stageResults: Array<{ labId: string; status: string; output?: string; error?: string }> = [];

  try {
    const { stages } = await interpretIntent(prompt, brandId);
    const labs = await getLabEndpoints();
    const previousOutputs: Record<string, string> = {};

    for (const stage of stages) {

      if (stage.labId === 'meta') {
        if (!autoPublish) {
          stageResults.push({ labId: 'meta', status: 'pending_approval', output: 'Listo para publicar. Llama /api/trigger-job con auto_publish:true para confirmar.' });
          break;
        }
        const publishOutput = await publishPosts(brandId);
        stageResults.push({ labId: 'meta', status: 'completed', output: publishOutput });
        previousOutputs['meta'] = publishOutput;
        continue;
      }

      const endpoint = labs[stage.labId];
      if (!endpoint) {
        stageResults.push({ labId: stage.labId, status: 'skipped', error: 'Lab no configurado en lab_configs' });
        continue;
      }

      const result = await callLab(endpoint, brandId, stage, previousOutputs, { aspect_ratio: aspectRatio });

      if (result.error) {
        stageResults.push({ labId: stage.labId, status: 'error', error: result.error });
        break;
      }

      if (stage.labId === 'imagelab' && result.image_data_url) {
        const imageUrl = await uploadImage(result.image_data_url, brandId);
        if (imageUrl) {
          previousOutputs['image_url'] = imageUrl;
          stageResults.push({ labId: stage.labId, status: 'completed', output: imageUrl });
        } else {
          stageResults.push({ labId: stage.labId, status: 'completed', output: result.output });
        }
      } else {
        if (result.output) previousOutputs[stage.labId] = result.output;
        stageResults.push({ labId: stage.labId, status: 'completed', output: result.output });
      }
    }

    await updateJob(jobId, {
      status:       'completed',
      completed_at: new Date().toISOString(),
      result:       JSON.stringify(stageResults),
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateJob(jobId, { status: 'error', error: msg, result: JSON.stringify(stageResults) });
  }
}

// ── HANDLER ───────────────────────────────────────────────────────────────────

export default async function handler(
  req: Request,
  ctx?: { waitUntil?: (p: Promise<unknown>) => void },
): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: CORS });

  // Auth opcional
  const secret = process.env.TRIGGER_SECRET;
  if (secret) {
    const auth = req.headers.get('x-trigger-secret') ?? '';
    if (auth !== secret) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
  }

  let body: {
    brand_id?: string;
    prompt?: string;
    platforms?: string[];
    aspect_ratio?: string;
    auto_publish?: boolean;
  } = {};
  try { body = await req.json(); } catch {}

  if (!body.brand_id) return new Response(JSON.stringify({ error: 'brand_id required' }), { status: 400, headers: CORS });
  if (!body.prompt)   return new Response(JSON.stringify({ error: 'prompt required' }), { status: 400, headers: CORS });

  const brandId     = body.brand_id;
  const prompt      = body.prompt;
  const autoPublish = body.auto_publish ?? false;
  const aspectRatio = body.aspect_ratio ?? '4:5';

  // 1. Insertar job inmediatamente con status running
  const jobId = await writeJob({
    brand_id:   brandId,
    prompt,
    status:     'running',
    started_at: new Date().toISOString(),
  });

  if (!jobId) {
    return new Response(JSON.stringify({ error: 'Failed to create job in Supabase' }), { status: 500, headers: CORS });
  }

  // 2. Lanzar pipeline en background
  const pipeline = runPipeline(jobId, brandId, prompt, autoPublish, aspectRatio);
  if (ctx?.waitUntil) {
    ctx.waitUntil(pipeline); // Edge / Cloudflare Workers — runtime lo mantiene vivo
  } else {
    pipeline.catch(() => {}); // Vercel Node.js serverless — Promise flotante, no bloquea response
  }

  // 3. Responder inmediatamente
  return new Response(JSON.stringify({
    status:   'running',
    job_id:   jobId,
    brand_id: brandId,
    prompt,
  }), { status: 202, headers: CORS });
}
