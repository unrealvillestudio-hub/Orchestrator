/**
 * UNRLVL Orchestrator — api/trigger-job.ts v4.2
 *
 * Thin wrapper: valida input + INSERT en public.lab_jobs + 202 inmediato.
 * Todo el pipeline corre en lab-worker EF de Supabase. El pg_net trigger
 * sobre lab_jobs despierta a lab-worker automáticamente.
 *
 * ── PATRÓN CICATRIZ (v4.2, 2026-07-17) ────────────────────────────────────
 * Hasta v4.1 este handler usaba la firma Web API `(req: Request): Promise<Response>`.
 * En el runtime Node de Vercel ESA FIRMA NO EXISTE: Vercel invoca al handler con
 * `(IncomingMessage, ServerResponse)`. El código hacía `await req.json()` —que no es
 * un método de IncomingMessage—, el `catch` devolvía un objeto `Response`, y ese
 * Response no lo consumía nadie porque nunca se llamó `res.end()`. Resultado: la
 * función colgaba hasta el timeout. Verificado en producción (2026-07-16):
 *   OPTIONS/POST → cuelgan >50s; runtime log → "Task timed out after 300 seconds".
 * El header de v4.1 afirmaba "Web APIs funcionan en Node 18+". Existen en Node, sí;
 * lo que no existe es que Vercel te las PASE al handler. Es la misma cicatriz que ya
 * documentan extract-frames.ts y sign-upload.ts.
 *
 * v4.2 migra a la firma Node-native `(req: VercelRequest, res: VercelResponse)`,
 * la misma de extract-frames.ts / sign-upload.ts (los dos endpoints del repo que
 * SÍ responden). El carril lab_jobs → lab-worker NO se jubila: el desacople async
 * es correcto y es el que usa Ayra. Se cura la firma, se conserva el diseño.
 *
 * POST /api/trigger-job
 * Body: {
 *   brand_id:     string,
 *   prompt:       string,
 *   platforms?:   string[],                          // default: ['INSTAGRAM', 'FACEBOOK']
 *   aspect_ratio?: string,                           // default: '4:5'
 *   auto_publish?: boolean,                          // default: false (true salta approval gate)
 *   job_type?:    'content' | 'teaser' | 'announcement', // default: 'content'
 *   language?:    'EN' | 'ES' | 'EN+ES',             // default: 'EN'
 *   secret?:      string,                            // opcional si TRIGGER_SECRET configurado
 * }
 *
 * ─── ASPECT RATIOS ────────────────────────────────────────────────────────
 * Vertex AI Imagen acepta solo: 1:1, 3:4, 4:3, 9:16, 16:9.
 * lab-worker mapea automáticamente antes de llamar a ImageLab:
 *   4:5  → 3:4   (Instagram feed estándar)
 *   5:4  → 4:3
 *   otros → 1:1  (fallback seguro)
 * El job se INSERTA con el aspect_ratio original; el mapeo ocurre en EF.
 *
 * ─── JOB_TYPE ─────────────────────────────────────────────────────────────
 *   'content'      → flow normal: CopyLab interpretativo + ImageLab + SocialLab.
 *   'teaser'       → CopyLab en mode='literal': prompt se respeta como copy
 *                    inamovible, solo se generan caption + hashtags.
 *   'announcement' → idéntico a teaser.
 *
 * ─── LANGUAGE ─────────────────────────────────────────────────────────────
 *   'EN'    → todo el output en inglés.
 *   'ES'    → todo el output en español.
 *   'EN+ES' → bilingual (relevante sobre todo en literal mode).
 *
 * Returns: { job_id, status: 'queued' }  (202 Accepted)
 *
 * Claude lee resultado en lab_jobs:
 *   - status='pending_approval' → presentar approval_payload a Sam
 *   - status='completed'        → leer output_parsed (post final publicado)
 *   - status='failed'           → leer error_msg + failed_at_stage
 *   - status='rejected'         → leer rejected_reason
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

// Normalize SUPABASE_URL — same defensive parse used by ImageLab and CopyLab.
// Tolerates the three shapes commonly pasted into Vercel env panels:
//   1) bare project ref     "amlvyycfepwhiindxgzw"
//   2) bare hostname        "amlvyycfepwhiindxgzw.supabase.co"
//   3) full url             "https://amlvyycfepwhiindxgzw.supabase.co"
// All three end up as `https://{ref}.supabase.co`. Prevents silent fetch
// failures when the env was saved without a protocol.
function normalizeSupabaseUrl(raw: string | undefined): string {
  if (!raw) return '';
  const s = raw.trim().replace(/\/+$/, '');
  if (!s) return '';
  if (s.startsWith('https://') || s.startsWith('http://')) return s;
  if (s.includes('.supabase.co')) return `https://${s}`;
  if (/^[a-z]{20}$/.test(s)) return `https://${s}.supabase.co`;
  return s;
}

const SB_URL = () => normalizeSupabaseUrl(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL);
const SB_KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// Content-Type lo pone res.json() — aquí solo van las cabeceras CORS.
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-trigger-secret',
};
function applyCors(res: VercelResponse) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
}

type JobType  = 'content' | 'teaser' | 'announcement';
type Language = 'EN' | 'ES' | 'EN+ES';

interface TriggerBody {
  brand_id?:     string;
  prompt?:       string;
  platforms?:    string[];
  aspect_ratio?: string;
  auto_publish?: boolean;
  job_type?:     JobType;
  language?:     Language;
  // Canal de publicación. ImageLab usa este valor para resolver imagelab_presets
  // (lookup por brand_id+canal). Convención UPPERCASE:
  //   INSTAGRAM_FEED · INSTAGRAM_REEL · INSTAGRAM_STORY ·
  //   FACEBOOK_FEED · TIKTOK · YOUTUBE_SHORT · ...
  // Default: 'INSTAGRAM_FEED'.
  canal?:        string;
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  // Auth opcional.
  // Node baja los nombres de header a minúsculas y puede devolver string[] si el
  // header viene repetido; normalizamos a un único string antes de comparar.
  const secret = process.env.TRIGGER_SECRET;
  if (secret) {
    const raw = req.headers['x-trigger-secret'];
    const auth = (Array.isArray(raw) ? raw[0] : raw) ?? '';
    if (auth !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  // Vercel parsea el JSON body; tolera string por las dudas (igual que sign-upload.ts).
  let body: TriggerBody = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); } catch { /* keep empty */ }

  if (!body.brand_id) {
    return res.status(400).json({ error: 'brand_id required' });
  }
  if (!body.prompt) {
    return res.status(400).json({ error: 'prompt required' });
  }

  const platforms    = body.platforms    ?? ['INSTAGRAM', 'FACEBOOK'];
  const aspect_ratio = body.aspect_ratio ?? '4:5';
  const auto_publish = body.auto_publish ?? false;
  const job_type: JobType  = body.job_type ?? 'content';
  const language: Language = body.language ?? 'EN';
  const canal              = (body.canal ?? 'INSTAGRAM_FEED').toUpperCase();

  // INSERT lab_jobs. pg_net trigger despierta a lab-worker.
  // lab-worker v3.2+ usa el canal para forward a ImageLab → ImageLab hace
  // lookup en imagelab_presets por (brand_id, canal) y construye un prompt
  // brand-specific (composición, lighting, color grading, mood, brand_dna…)
  // en vez de generar imágenes genéricas con personas AI-look.
  const jobId = await insertOrchestratorJob({
    job_type,
    brand_id:     body.brand_id,
    prompt:       body.prompt,
    platforms,
    aspect_ratio,
    auto_publish,
    language,
    canal,
    status:       'queued',
    stage_outputs: {},
  });

  if (!jobId) {
    return res.status(500).json({ error: 'Failed to enqueue job in Supabase' });
  }

  return res.status(202).json({
    job_id:   jobId,
    status:   'queued',
    brand_id: body.brand_id,
    prompt:   body.prompt,
    note:     'Pipeline corriendo. Lee public.lab_jobs WHERE id=job_id para status.',
  });
}
