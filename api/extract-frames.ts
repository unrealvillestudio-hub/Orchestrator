/**
 * UNRLVL Orchestrator — api/extract-frames.ts  (Sprint #47 · E3b-1, Vía D server-side)
 *
 * Extracción de frames SERVER-SIDE con ffmpeg. Nace porque la extracción canvas en
 * el navegador (Vía D original) FALLÓ con video HEVC/H.265 — Chrome no lo decodifica.
 * ffmpeg decodifica cualquier códec, así que el trabajo se mueve al servidor.
 *
 * Flujo: { session_token, video_path } → descarga el video del bucket
 * `iid-expert-uploads` (service role) a /tmp → ffmpeg extrae N frames (≈720px JPEG)
 * → los devuelve en base64 → BORRA el video del bucket → limpia /tmp.
 * Los frames base64 se mandan luego a la EF iid-expert-ocr (que acepta data URL o crudo).
 *
 * ── PATRÓN CICATRIZ (importante) ───────────────────────────────────────────────
 * Las otras /api del repo usan la firma Web API `(req: Request): Promise<Response>`,
 * que IGNORA `maxDuration` → 504 en operaciones lentas. ffmpeg tarda (cold start +
 * descarga + decode), así que esta función usa la firma NODE-NATIVE
 * `(req: VercelRequest, res: VercelResponse)`, única que respeta `maxDuration`.
 * `maxDuration` + `includeFiles` (para bundlear el binario de ffmpeg) se setean en
 * `vercel.json` — no se puede combinar `vercel.json functions` con `export const config`.
 *
 * Env vars (runtime serverless, SIN prefijo VITE_ — los VITE_ son build-time → undefined):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY      → leer/borrar del bucket
 *   ORCHESTRATOR_NSCF_IID_INTEL_JWT_SECRET       → validar el JWT del seeder (mismo
 *                                                   secret HS256 que iid-inbound / iid-expert-ocr)
 *
 * NO toca la EF iid-expert-ocr. NO toca tablas. Solo lee/borra del bucket.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { spawn } from 'node:child_process';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ffmpegStatic from 'ffmpeg-static';

// El default export de ffmpeg-static es la RUTA del binario (string) o null.
// Bajo el typecheck de Vercel (@vercel/node) el default import se tipa como el
// módulo y no como string → TS2769 al pasarlo a spawn. En runtime (esbuild) el
// valor ya es el string; este const explícito alinea el tipo con la realidad.
const ffmpegPath: string | null = ffmpegStatic as unknown as string | null;

// ── Parámetros configurables ───────────────────────────────────────────────────
const MAX_FRAMES = 15;      // tope de frames a extraer
const TARGET_WIDTH = 720;   // ancho máximo (no se upscalea; alto por aspect ratio)
const JPEG_QV = 3;          // -q:v de ffmpeg (2=mejor … 31=peor; 3 ≈ calidad 0.8)
const BUCKET = 'iid-expert-uploads';
const FFMPEG_TIMEOUT_MS = 50_000; // safety < maxDuration (60s)
const ALLOWED_ROLES = ['seeder', 'admin'];

// ── Supabase URL / key (mismo parse defensivo que trigger-job/approve-job) ──────
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
const JWT_SECRET = () => process.env.ORCHESTRATOR_NSCF_IID_INTEL_JWT_SECRET ?? '';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
function applyCors(res: VercelResponse) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
}

// ── Auth: verificación HS256 nativa (mismo esquema HMAC-SHA256 que la EF) ────────
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

// ── Storage REST (sin @supabase/supabase-js, para mantener el bundle chico) ──────
function objectUrl(videoPath: string): string {
  // Conserva los '/' como separadores de path, encodea cada segmento.
  const safe = videoPath.split('/').map(encodeURIComponent).join('/');
  return `${SB_URL()}/storage/v1/object/${BUCKET}/${safe}`;
}

async function downloadVideo(videoPath: string): Promise<{ ok: boolean; status: number; buf?: Buffer }> {
  const res = await fetch(objectUrl(videoPath), {
    headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}` },
  });
  if (!res.ok) return { ok: false, status: res.status };
  const buf = Buffer.from(await res.arrayBuffer());
  return { ok: true, status: res.status, buf };
}

async function deleteVideo(videoPath: string): Promise<boolean> {
  try {
    const res = await fetch(objectUrl(videoPath), {
      method: 'DELETE',
      headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── ffmpeg ──────────────────────────────────────────────────────────────────────
function runFfmpeg(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg binary no disponible (ffmpeg-static path null)'));
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('ffmpeg timeout')); }, FFMPEG_TIMEOUT_MS);
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
    proc.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stderr }); });
  });
}

/** Lee la duración (segundos) parseando el stderr de `ffmpeg -i input`. 0 si no se pudo. */
async function probeDuration(inputPath: string): Promise<number> {
  // Sin output, ffmpeg sale != 0 pero igual imprime "Duration: HH:MM:SS.ss" en stderr.
  const { stderr } = await runFfmpeg(['-hide_banner', '-i', inputPath]).catch((e) => ({ stderr: String(e), code: -1 }));
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
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
  let body: { session_token?: string; video_path?: string } = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); } catch { /* keep empty */ }

  // Auth fail-closed.
  const session = verifyToken(body.session_token, JWT_SECRET());
  if (!session) return res.status(401).json({ error: 'sesión inválida o expirada, vuelve a entrar' });
  if (!ALLOWED_ROLES.includes(session.role)) return res.status(403).json({ error: `forbidden: rol '${session.role}' no puede extraer frames` });

  const videoPath = (body.video_path ?? '').trim();
  if (!videoPath) return res.status(400).json({ error: 'video_path required' });

  const work = join(tmpdir(), `extract-${randomUUID()}`);
  const inputPath = join(work, 'input');
  let downloaded = false;

  try {
    await mkdir(work, { recursive: true });

    // 1 · Descargar el video del bucket.
    const dl = await downloadVideo(videoPath);
    if (!dl.ok || !dl.buf) {
      if (dl.status === 404) return res.status(404).json({ error: 'video_not_found', video_path: videoPath });
      return res.status(502).json({ error: 'download_failed', sb_status: dl.status, video_path: videoPath });
    }
    downloaded = true;
    await writeFile(inputPath, dl.buf);

    // 2 · Duración → fps para ~MAX_FRAMES equiespaciados (fallback 1fps si no se pudo leer).
    const duration = await probeDuration(inputPath);
    const fps = duration > 0 ? MAX_FRAMES / duration : 1;

    // 3 · Extraer frames: fps primero (decodifica menos), luego scale sin upscalear.
    const out = join(work, 'frame-%03d.jpg');
    const ff = await runFfmpeg([
      '-hide_banner', '-loglevel', 'error',
      '-i', inputPath,
      '-vf', `fps=${fps.toFixed(6)},scale='min(${TARGET_WIDTH},iw)':-2`,
      '-frames:v', String(MAX_FRAMES),
      '-q:v', String(JPEG_QV),
      '-y', out,
    ]);
    if (ff.code !== 0) {
      throw new Error(`ffmpeg exit ${ff.code}: ${ff.stderr.slice(0, 400)}`);
    }

    // 4 · Leer los frames → base64 (data URL).
    const files = (await readdir(work)).filter((f) => /^frame-\d+\.jpg$/.test(f)).sort();
    const frames: string[] = [];
    for (const f of files) {
      const b = await readFile(join(work, f));
      frames.push(`data:image/jpeg;base64,${b.toString('base64')}`);
    }
    if (frames.length === 0) {
      throw new Error('ffmpeg no produjo frames (video sin pista de video legible?)');
    }

    // 5 · Borrar el video del bucket (ya extrajimos lo que necesitábamos).
    const videoDeleted = await deleteVideo(videoPath);

    return res.status(200).json({
      ok: true,
      frames,
      frame_count: frames.length,
      duration_sec: duration || null,
      video_deleted: videoDeleted, // si false, el video quedó en el bucket (limpieza manual)
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[extract-frames]', message);
    // Intentar no dejar el video huérfano: si llegamos a descargarlo, borrarlo.
    let videoDeleted = false;
    if (downloaded) videoDeleted = await deleteVideo(videoPath);
    return res.status(500).json({ error: 'extract_failed', message, video_deleted: videoDeleted });
  } finally {
    // 6 · Limpiar /tmp siempre.
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
