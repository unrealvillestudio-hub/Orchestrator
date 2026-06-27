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
  /** Rastro(s) de origen — NO se procesa (mismo encuadre anti-IP que Basic). */
  source_refs?: string[] | null;
  tags?: string[] | null;
  /**
   * Caption(s) manual(es) pegado(s) por el seeder — complementa el OCR.
   * Campo extra: la EF v1 solo lee lo que conoce e ignora lo demás (no rompe el contrato).
   */
  captions?: string | null;
}

export interface ExpertCaptureResult {
  ok: true;
  technique_id: string;
  frame_count: number;
  chars_extracted: number;
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
    ...(input.captions ? { captions: input.captions } : {}),
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
