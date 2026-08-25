/**
 * challengedInbox.ts — Orchestrator · CALIB-01-E (bandeja de retenidas)
 *
 * Cliente tipado de los endpoints Node del Orchestrator (mismo origen, `/api/*`):
 *   GET  /api/challenged-queue   → arbitrajes PENDIENTES, con su pieza y su regla
 *   POST /api/challenge-verdict  → arbitra uno (idempotente por id)
 *   POST /api/piece-edit         → edita un campo de una pieza y guarda el diff
 *
 * El token de sesión (JWT admin de iid-inbound) viaja en `Authorization: Bearer`.
 * Estos endpoints corren server-side con service_role y validan el JWT + rol admin.
 *
 * Espejo estructural de `calibrationInbox.ts` — mismo `req<T>`, mismo error tipado.
 * Se reusa `CalibrationError` en vez de declarar una clase gemela: dos jerarquías de error
 * con el mismo contrato obligarían a cada consumidor a atrapar las dos.
 */

import { CalibrationError } from './calibrationInbox';

// ── Tipos (contrato de CALIB-01 §2) ──────────────────────────────────────────
export type ChallengeVerdict = 'judge_was_right' | 'rule_failed';

export interface ChallengedPiece {
  id: string;
  title: string | null;
  body: string | null;
  platform: string | null;
  domain: string | null;
  status: string | null;
  pass_type: string | null;
  challenged_at: string | null;
  edited_at: string | null;
  edited_by: string | null;
  created_at: string | null;
}

/** Una fila de la bandeja ES UN ARBITRAJE, no una pieza: el grano es (pieza, regla). */
export interface ChallengedRow {
  id: string;
  piece_id: string | null;
  brand_id: string;
  created_at: string;
  rule_code: string;
  rule_statement: string | null;
  verify_pattern: string | null;
  pattern_found: boolean;
  /** La razón de la retención en una línea, redactada por el server. */
  reason: string;
  piece: ChallengedPiece | null;
}

export interface ChallengedResult {
  total: number;
  by_brand: Record<string, number>;
  by_rule: Record<string, number>;
  limit: number;
  offset: number;
  rows: ChallengedRow[];
  /**
   * Si la tabla de arbitrajes existe todavía. `available:false` es un estado ESPERADO
   * mientras CALIB-01 (cortes A–D) no esté desplegado: la bandeja lo dice en pantalla en
   * vez de mostrar un vacío que parece un fallo.
   */
  contract: { available: boolean; reason: string | null };
  truncated?: boolean;
}

export interface VerdictResult {
  ok: true;
  id: string;
  /** true = ya estaba decidido; la idempotencia devolvió el estado vigente, no un error. */
  already_decided: boolean;
  verdict: ChallengeVerdict | null;
  decided_by?: string | null;
  decided_at?: string | null;
}

/** Un aviso de la guarda determinista. NUNCA bloquea: la edición ya se guardó. */
export interface GuardHit {
  code: string;
  field: string;
  pattern: string;
  fragment: string;
}

export interface EditResult {
  ok: boolean;
  piece_id: string;
  status: string;
  pass_type: string;
  edited: Array<{ field: string; edit_reason: string | null }>;
  guard: {
    blocking: false;
    hits: GuardHit[];
    unusable: Array<{ code: string; detail: string }>;
    acknowledged: boolean;
    rules_checked: number;
  };
  rejudged: false;
  errors: string[];
}

// ── Núcleo del fetch (idéntico al de calibrationInbox) ───────────────────────
async function req<T>(
  path: string,
  token: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch (err) {
    throw new CalibrationError('No se pudo contactar el servidor (red).', 0, { cause: String(err) });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `Error ${res.status}`;
    throw new CalibrationError(String(msg), res.status, data);
  }
  return data as T;
}

// ── Acciones ─────────────────────────────────────────────────────────────────

export function fetchChallengedQueue(
  token: string,
  opts: { limit?: number; offset?: number; brand?: string; rule?: string } = {},
): Promise<ChallengedResult> {
  const q = new URLSearchParams();
  if (opts.limit != null) q.set('limit', String(opts.limit));
  if (opts.offset != null) q.set('offset', String(opts.offset));
  if (opts.brand) q.set('brand', opts.brand);
  if (opts.rule) q.set('rule', opts.rule);
  const qs = q.toString();
  return req<ChallengedResult>(`/api/challenged-queue${qs ? `?${qs}` : ''}`, token);
}

/**
 * Arbitra un desacuerdo. IDEMPOTENTE por `id` — es lo que hace barato el `undo`: reenviar
 * el mismo id no puede duplicar ni pisar nada, así que la bandeja puede optimizar la
 * respuesta visual sin arriesgar el dato.
 *
 * `decided_by` NO se manda: lo pone el server desde la sesión. Un arbitraje firmable con el
 * nombre de otro no sería auditable.
 */
export function saveChallengeVerdict(
  token: string,
  input: { id: string; verdict: ChallengeVerdict; note?: string | null },
): Promise<VerdictResult> {
  return req('/api/challenge-verdict', token, {
    method: 'POST',
    body: { id: input.id, verdict: input.verdict, note: input.note ?? null },
  });
}

/**
 * Edita UN campo de la pieza. El diff se guarda antes que el texto: si el registro falla,
 * la edición no se aplica.
 *
 * `acknowledge_warnings` sólo se manda cuando Sam ya vio los avisos de la guarda y decidió
 * guardar igual — eso registra que insistió, que también es dato de calibración.
 */
export function savePieceEdit(
  token: string,
  input: {
    piece_id: string; field: 'title' | 'body'; after_text: string;
    edit_reason?: string | null; acknowledge_warnings?: boolean;
  },
): Promise<EditResult> {
  return req('/api/piece-edit', token, {
    method: 'POST',
    body: {
      piece_id: input.piece_id,
      field: input.field,
      after_text: input.after_text,
      edit_reason: input.edit_reason ?? null,
      acknowledge_warnings: input.acknowledge_warnings === true,
    },
  });
}

/**
 * Clases de defecto EDITORIAL. Lista cerrada en la UI y texto libre en la tabla: mañana
 * serán siete y no queremos una migración por cada una. Son clases de defecto, nunca
 * marcas — le sirven igual a una marca de cosmética que a una de servicios.
 */
export const EDIT_REASONS = [
  { value: 'titulo_ambiguo',  label: 'Título ambiguo' },
  { value: 'dato_incorrecto', label: 'Dato incorrecto' },
  { value: 'registro',        label: 'Registro' },
  { value: 'longitud',        label: 'Longitud' },
  { value: 'otro',            label: 'Otro' },
] as const;
