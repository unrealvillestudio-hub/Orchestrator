/**
 * iidInbound.ts — Orchestrator · IID Seeds (T4 E4)
 *
 * Cliente tipado de la Edge Function `iid-inbound` (Sembrador IID, v6 LIVE).
 * Patrón SB_URL existente (igual que sequenceBridge / EcosystemIntelModule):
 *   - Llama directo a `${SB_URL}/functions/v1/iid-inbound` — SIN /api/* intermedios.
 *   - apikey + Authorization Bearer = anon key (solo para enrutar el gateway de Supabase).
 *   - El `session_token` (JWT propio de iid-inbound, rol + scope) viaja en el BODY,
 *     nunca en el header Authorization.
 *
 * Matriz de roles (re-validada server-side, fail-closed):
 *   capture / list / list_options → seeder + admin
 *   approve / reject              → admin
 *
 * La EF ya está verde en prod; este módulo solo la consume.
 */

const SB_URL = (import.meta as any).env.VITE_SUPABASE_URL as string;
const SB_KEY = (import.meta as any).env.VITE_SUPABASE_ANON_KEY as string;

const FN_URL = `${SB_URL}/functions/v1/iid-inbound`;

// ── Tipos ────────────────────────────────────────────────────────────────────

export type IidRole = 'seeder' | 'admin';

export interface IidSession {
  session_token: string;
  sub: string;
  role: IidRole;
  brand_scope: string[]; // ['*'] = todas las marcas
  expires_in: number;    // segundos
}

export interface DistillNotes {
  summary: string | null;
  confidence: number | null;
  alternatives: Array<{ domain?: string; brand_id?: string; why?: string }>;
}

export type SeedStatus =
  | 'captured'
  | 'awaiting_approval'
  | 'approved'
  | 'dispatched'
  | 'failed'
  | 'rejected';

export interface Seed {
  id: string;
  source_url: string;
  handle: string | null;
  raw_signal: string;
  seeder_rationale: string | null;
  seeder_brand_suggestion?: string | null; // pista del seeder (NO el mapeo real); la EF la sirve tras su PR
  captured_by: string;
  neutral_topic: string | null;
  mapped_brand_id: string | null;
  mapped_domain: string | null;
  distill_notes: DistillNotes | null;
  lane: string;
  status: SeedStatus;
  finding_id: string | null;
  rejected_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListOptions {
  domains: string[];
  brands: Array<{ id: string; name: string }>;
}

export interface CaptureResult {
  seed_id: string;
  neutral_topic: string | null;
  mapped_domain: string | null;
  mapped_brand_id: string | null;
  status: 'awaiting_approval';
}

export interface ApproveResult {
  seed_id: string;
  finding_id: string;
  queue_entries: number;
  status: 'dispatched';
  out_of_scope: boolean;
}

export interface RejectResult {
  seed_id: string;
  status: 'rejected';
}

/** Error tipado: conserva el status HTTP y el cuerpo crudo de la EF. */
export class IidError extends Error {
  status: number;
  body: any;
  constructor(message: string, status: number, body: any) {
    super(message);
    this.name = 'IidError';
    this.status = status;
    this.body = body;
  }
}

// ── Núcleo del fetch ─────────────────────────────────────────────────────────

async function call<T>(payload: Record<string, unknown>): Promise<T> {
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
  return data as T;
}

// ── Acciones ─────────────────────────────────────────────────────────────────

/** Login solo password → JWT de sesión con rol + scope. */
export function login(password: string): Promise<IidSession> {
  return call<IidSession>({ action: 'login', password });
}

/** Captura una semilla. captured_by lo deriva la EF del JWT (no del body). */
export function capture(
  token: string,
  input: {
    source_url: string;
    raw_signal: string;
    seeder_rationale?: string | null;
    seeder_brand_suggestion?: string | null;
    handle?: string | null;
    lane?: string;
    /** E5a: texto OCR del post (persist:false de iid-expert-ocr). La EF lo destila. */
    ocr_text?: string | null;
    /** E5a: qué se captura del post — ['tema'] | ['metodo'] | ambos. */
    capture_intent?: string[] | null;
  },
): Promise<CaptureResult> {
  return call<CaptureResult>({
    action: 'capture',
    session_token: token,
    source_url: input.source_url,
    raw_signal: input.raw_signal,
    seeder_rationale: input.seeder_rationale ?? null,
    seeder_brand_suggestion: input.seeder_brand_suggestion ?? null,
    handle: input.handle ?? null,
    ...(input.lane ? { lane: input.lane } : {}),
    ...(input.ocr_text !== undefined ? { ocr_text: input.ocr_text } : {}),
    ...(input.capture_intent !== undefined ? { capture_intent: input.capture_intent } : {}),
  });
}

/**
 * Lista semillas por status (default 'awaiting_approval').
 * seeder = solo las suyas y en scope; admin = todas.
 */
export async function list(token: string, status: SeedStatus = 'awaiting_approval'): Promise<Seed[]> {
  const r = await call<{ status: SeedStatus; count: number; seeds: Seed[] }>({
    action: 'list',
    session_token: token,
    status,
  });
  return r.seeds ?? [];
}

/** Domains + brands para los selects del approve. Respeta scope. */
export function listOptions(token: string): Promise<ListOptions> {
  return call<ListOptions>({ action: 'list_options', session_token: token });
}

/** Aprueba (admin): override opcional de domain/brand/topic → handoff a iid-core. */
export function approve(
  token: string,
  input: { seed_id: string; mapped_domain?: string; mapped_brand_id?: string | null; neutral_topic?: string },
): Promise<ApproveResult> {
  return call<ApproveResult>({
    action: 'approve',
    session_token: token,
    seed_id: input.seed_id,
    ...(input.mapped_domain !== undefined ? { mapped_domain: input.mapped_domain } : {}),
    ...(input.mapped_brand_id !== undefined ? { mapped_brand_id: input.mapped_brand_id } : {}),
    ...(input.neutral_topic !== undefined ? { neutral_topic: input.neutral_topic } : {}),
  });
}

/** Rechaza (admin): motivo obligatorio. */
export function reject(token: string, seed_id: string, rejected_reason: string): Promise<RejectResult> {
  return call<RejectResult>({ action: 'reject', session_token: token, seed_id, rejected_reason });
}
