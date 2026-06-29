/**
 * iidExpert.ts — Orchestrator · IID Expert (Sprint #47, E3-FRONT, Vía D)
 *
 * Cliente tipado de la Edge Function `iid-expert-ocr` (v1 LIVE, smoke verde).
 * Mismo patrón de transporte que `iidInbound.ts`:
 *   - Llama directo a `${SB_URL}/functions/v1/iid-expert-ocr` — SIN /api/* intermedios.
 *   - apikey + Authorization Bearer = anon key (solo enruta el gateway de Supabase).
 *   - El `session_token` (JWT propio del IID, rol + scope) viaja en el BODY,
 *     nunca en el header Authorization.
 *
 * La EF valida server-side (fail-closed): rol, scope de marcas, presencia de frames.
 * Este módulo solo la consume — no cambia el contrato.
 *
 * Reusa `IidError` de iidInbound para mantener el mismo manejo de errores tipado.
 */

import { IidError } from './iidInbound';

const SB_URL = (import.meta as any).env.VITE_SUPABASE_URL as string;
const SB_KEY = (import.meta as any).env.VITE_SUPABASE_ANON_KEY as string;

const FN_URL = `${SB_URL}/functions/v1/iid-expert-ocr`;

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface ExpertCaptureInput {
  /** Frames extraídos en el navegador (data URLs `data:image/jpeg;base64,…`). */
  frames: string[];
  /** brand_id del scope del seeder; la EF re-valida (marca fuera de scope → 403). */
  applies_to_brands: string[];
  creator_handle?: string | null;
  /**
   * Rastro(s) de origen — jsonb libre que la EF persiste tal cual (no procesa).
   * DEBE ser array: la EF hace `Array.isArray(source_refs) ? source_refs : []`,
   * así que un objeto suelto se descartaría. Lleva los link(s) como strings y,
   * opcionalmente, el caption manual como elemento objeto `{ caption }`. Así el
   * caption se persiste sin reabrir la EF (que solo lee creator_handle/source_refs/
   * frames/applies_to_brands/tags — `captions` suelto se perdía). Encuadre anti-IP igual que Basic.
   */
  source_refs?: Array<string | { caption: string }> | null;
  tags?: string[] | null;
}

export interface ExpertCaptureResult {
  ok: true;
  technique_id: string;
  frame_count: number;
  chars_extracted: number;
}

// ── E3b-2: puente de subida server-side ────────────────────────────────────────
// El navegador NO puede escribir al bucket `iid-expert-uploads` con la anon key
// (sin policy anon-insert — decisión cerrada). El flujo es:
//   1. POST /api/sign-upload  → URL firmada server-side con service_role.
//   2. PUT del video crudo a esa URL (el permiso viaja embebido en el token).
//   3. POST /api/extract-frames → ffmpeg server-side devuelve frames base64.
// Estas tres rutas son funciones Vercel del MISMO repo (Node-native), NO la EF
// de Supabase — por eso usan rutas relativas `/api/*`, no `${SB_URL}/functions/v1`.

/** Respuesta de `/api/sign-upload`. `upload_url` ya es absoluta y lista para el PUT. */
export interface SignUploadResult {
  ok: true;
  /** Path relativo dentro del bucket (lo que después se manda a extract-frames como `video_path`). */
  path: string;
  /** URL absoluta firmada — `fetch(upload_url, { method:'PUT', body:file })` directo. */
  upload_url: string;
  /** Token firmado (informativo; el PUT ya lo lleva embebido en `upload_url`). */
  token: string | null;
}

/** Respuesta de `/api/extract-frames` (contrato E3b-1, ya en main). */
export interface ExtractFramesResult {
  ok: true;
  frames: string[];            // data URLs `data:image/jpeg;base64,…`
  frame_count: number;
  duration_sec: number | null;
  video_deleted?: boolean;
}

/** Helper común para las rutas `/api/*` Node-native del repo. Conserva el manejo IidError. */
async function callApi<T>(path: string, body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new IidError('No se pudo contactar el servidor (red).', 0, { cause: String(err) });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && (data.error || data.detail || data.message)) || `Error ${res.status}`;
    throw new IidError(String(msg), res.status, data);
  }
  return data as T;
}

/** Pide una signed upload URL para subir el video crudo (firma con service_role server-side). */
export function signUpload(token: string, filename?: string | null): Promise<SignUploadResult> {
  return callApi<SignUploadResult>('/api/sign-upload', {
    session_token: token,
    ...(filename ? { filename } : {}),
  });
}

/**
 * Sube el video a la signed upload URL vía PUT.
 * Usa XHR (no fetch) para poder reportar progreso de subida (`onProgress`, 0–100).
 * La URL lleva el permiso embebido — el navegador NUNCA usa la service_role.
 */
export function uploadToSignedUrl(
  uploadUrl: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new IidError(`No se pudo subir el video (HTTP ${xhr.status}).`, xhr.status, xhr.responseText));
    };
    xhr.onerror = () => reject(new IidError('No se pudo subir el video (red).', 0, null));
    xhr.send(file);
  });
}

/** Extrae frames server-side (ffmpeg) del video ya subido. Borra el video del bucket al terminar. */
export function extractFrames(token: string, videoPath: string): Promise<ExtractFramesResult> {
  return callApi<ExtractFramesResult>('/api/extract-frames', {
    session_token: token,
    video_path: videoPath,
  });
}

// ── Núcleo del fetch (mismo shape que iidInbound.call) ─────────────────────────

/**
 * Envía los frames + metadata a `iid-expert-ocr`.
 * El `session_token` va en el body (igual que todas las acciones del IID).
 */
export async function submitExpertCapture(
  token: string,
  input: ExpertCaptureInput,
): Promise<ExpertCaptureResult> {
  const payload: Record<string, unknown> = {
    session_token: token,
    frames: input.frames,
    applies_to_brands: input.applies_to_brands,
    ...(input.creator_handle ? { creator_handle: input.creator_handle } : {}),
    ...(input.source_refs && input.source_refs.length ? { source_refs: input.source_refs } : {}),
    ...(input.tags && input.tags.length ? { tags: input.tags } : {}),
  };

  let res: Response;
  try {
    res = await fetch(FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new IidError('No se pudo contactar el servidor (red).', 0, { cause: String(err) });
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && (data.error || data.detail)) || `Error ${res.status}`;
    throw new IidError(String(msg), res.status, data);
  }
  return data as ExpertCaptureResult;
}
