/**
 * UNRLVL Orchestrator — api/sign-upload.ts  (Sprint #47 · E3b-2, Vía D server-side)
 *
 * Firma una SIGNED UPLOAD URL para el bucket `iid-expert-uploads` usando la
 * service_role server-side. El navegador (anon key) NO puede escribir al bucket
 * — y por decisión cerrada NO se abre policy anon-insert. En su lugar, esta
 * función firma una URL de subida con permiso embebido: el navegador hace un PUT
 * directo a esa URL sin ver jamás la service_role.
 *
 * Flujo (E3b-2):
 *   1. ExpertCapture → POST /api/sign-upload { session_token, filename? }
 *   2. Navegador → PUT del video a `upload_url` (esta firma)
 *   3. ExpertCapture → POST /api/extract-frames { session_token, video_path } (E3b-1)
 *
 * ── PATRÓN CICATRIZ (espejo de extract-frames.ts) ───────────────────────────────
 * Node-native `(req: VercelRequest, res: VercelResponse)` — NO la firma Web API
 * `(req: Request): Promise<Response>`, que ignora `maxDuration` → 504. Firmar tarda
 * ms (no requiere `includeFiles`), pero se mantiene la misma firma por consistencia
 * y para no arrastrar la cicatriz del 504 si la operación creciera.
 *
 * Reusa LITERAL los helpers de extract-frames.ts (auth/Storage/CORS) para no
 * divergir: normalizeSupabaseUrl, SB_URL/SB_KEY/JWT_SECRET, verifyToken (HS256
 * nativo), b64urlToBuf, applyCors, ALLOWED_ROLES, encode de path por segmento.
 *
 * Env vars (runtime serverless, SIN prefijo VITE_):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY      → firmar la URL (service_role legacy eyJ…)
 *   ORCHESTRATOR_NSCF_IID_INTEL_JWT_SECRET       → validar el JWT del seeder (HS256)
 *
 * NO toca la EF iid-expert-ocr. NO toca tablas. Solo firma una URL del bucket.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

const BUCKET = 'iid-expert-uploads';
const ALLOWED_ROLES = ['seeder', 'admin'];

// ── Supabase URL / key (mismo parse defensivo que extract-frames/trigger-job) ───
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
const SB_KEY = () => (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
// .trim() defensivo: un secret pegado en Vercel arrastra \n/espacios que rompen el HMAC.
const JWT_SECRET = () => (process.env.ORCHESTRATOR_NSCF_IID_INTEL_JWT_SECRET ?? '').trim();

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
function applyCors(res: VercelResponse) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
}

// ── Auth: verificación HS256 nativa (idéntica a extract-frames.ts) ──────────────
interface SessionUser { sub: string; role: string; brand_scope: string[]; }

function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Verifica firma HS256 + exp. Devuelve el usuario o null (fail-closed). */
function verifyToken(token: unknown, secret: string): SessionUser | null {
  if (!token || typeof token !== 'string' || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  try {
    const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest(); // Buffer
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

// ── Path / extensión ────────────────────────────────────────────────────────────
/**
 * Extensión derivada del nombre original (solo para nombrar el objeto). El nombre
 * NO se usa salvo para esto. Sanitizada a [a-z0-9], lowercase, fallback 'mp4'.
 */
function deriveExt(filename: unknown): string {
  if (typeof filename !== 'string') return 'mp4';
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return 'mp4';
  const raw = filename.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
  return raw || 'mp4';
}

/** Encodea cada segmento del path conservando los '/' (igual que objectUrl en extract-frames). */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/**
 * Normaliza la `url` que devuelve Storage a una URL absoluta lista para el PUT.
 * Storage devuelve `/object/upload/sign/<bucket>/<path>?token=…` (relativo a /storage/v1).
 * Defensivo ante variantes: absoluta tal cual, o con/ sin el prefijo /storage/v1.
 */
function toAbsoluteUploadUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = SB_URL();
  if (url.startsWith('/storage/v1')) return `${base}${url}`;
  const rel = url.startsWith('/') ? url : `/${url}`;
  return `${base}/storage/v1${rel}`;
}

// ── Storage REST: crear signed upload URL (sin @supabase/supabase-js) ────────────
async function createSignedUpload(
  path: string,
): Promise<{ ok: boolean; status: number; url?: string; token?: string; body?: string }> {
  // SIN body y SIN Content-Type: el path va en la URL. Si se declara
  // Content-Type: application/json sin body, Storage responde 400
  // ("Body cannot be empty when content-type is set to 'application/json'").
  // Mismo patrón que extract-frames.ts (downloadVideo/deleteVideo): solo apikey + Bearer.
  const res = await fetch(
    `${SB_URL()}/storage/v1/object/upload/sign/${BUCKET}/${encodePath(path)}`,
    {
      method: 'POST',
      headers: {
        apikey: SB_KEY(),
        Authorization: `Bearer ${SB_KEY()}`,
      },
    },
  );
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300);
    return { ok: false, status: res.status, body };
  }
  const json = (await res.json().catch(() => ({}))) as { url?: string; token?: string };
  return { ok: true, status: res.status, url: json.url, token: json.token };
}

// ── Handler ──────────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Env imprescindibles.
  if (!SB_URL() || !SB_KEY()) {
    return res.status(503).json({ error: 'config_missing', message: 'Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el runtime de la función' });
  }
  if (!JWT_SECRET()) {
    return res.status(503).json({ error: 'config_missing', message: 'Falta ORCHESTRATOR_NSCF_IID_INTEL_JWT_SECRET en el runtime de la función (necesario para validar el token del seeder)' });
  }

  // Body (Vercel parsea JSON; tolera string por las dudas).
  let body: { session_token?: string; filename?: string } = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); } catch { /* keep empty */ }

  // Auth fail-closed.
  const session = verifyToken(body.session_token, JWT_SECRET());
  if (!session) return res.status(401).json({ error: 'sesión inválida o expirada, vuelve a entrar' });
  if (!ALLOWED_ROLES.includes(session.role)) return res.status(403).json({ error: `forbidden: rol '${session.role}' no puede subir video` });

  // Path único por seeder. El nombre original solo aporta la extensión.
  const ext = deriveExt(body.filename);
  const path = `expert/${session.sub}/${Date.now()}_${randomUUID()}.${ext}`;

  try {
    const signed = await createSignedUpload(path);
    if (!signed.ok || !signed.url) {
      return res.status(502).json({ error: 'sign_failed', sb_status: signed.status, sb_body: signed.body ?? '' });
    }
    return res.status(200).json({
      ok: true,
      path,
      upload_url: toAbsoluteUploadUrl(signed.url),
      token: signed.token ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[sign-upload]', message);
    return res.status(500).json({ error: 'sign_failed', message });
  }
}
