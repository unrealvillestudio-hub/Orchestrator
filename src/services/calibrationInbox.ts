/**
 * calibrationInbox.ts — Orchestrator · B4 Fase 1 (bandeja de calibración)
 *
 * Cliente tipado de los endpoints Node del Orchestrator (mismo origen, `/api/*`):
 *   GET  /api/calibration-queue    → piezas pendientes de evaluar (paginado, filtro brand)
 *   POST /api/calibration-verdict  → guarda un veredicto en el corpus (UPSERT por piece_id)
 *   POST /api/preview-render       → renderiza el artefacto de una pieza al CDN (lazy, idempotente)
 *
 * El token de sesión (JWT admin de iid-inbound) viaja en `Authorization: Bearer`.
 * Estos endpoints corren server-side con service_role y validan el JWT + rol admin.
 *
 * Espejo estructural de services/iidInbound.ts (mismo estilo de error tipado).
 */

// ── Tipos ────────────────────────────────────────────────────────────────────
export type Verdict = 'approved' | 'rejected';

export interface CalibrationPiece {
  piece_id: string;
  brand_id: string;
  voice: string | null;
  domain: string | null;
  platform: string | null;
  format: string | null;
  psycho_preset: string | null;
  audience_frame: string | null;
  title: string | null;
  artifact_url: string;
  // Primera opinión del watcher (informativa; no condiciona los botones de Sam).
  watcher_result: 'PASS' | 'REJECT' | null;
  watcher_gate: string | null;
}

export interface QueueResult {
  total_pending: number;
  by_brand: Record<string, number>;
  limit: number;
  offset: number;
  pieces: CalibrationPiece[];
  truncated?: boolean;
}

export interface VerdictRow {
  id: string;
  piece_id: string;
  brand_id: string;
  verdict: Verdict;
  criterion: string | null;
  evaluated_by: string | null;
  created_at: string;
  [k: string]: unknown;
}

/** Error tipado: conserva el status HTTP y el cuerpo crudo del endpoint. */
export class CalibrationError extends Error {
  status: number;
  body: any;
  constructor(message: string, status: number, body: any) {
    super(message);
    this.name = 'CalibrationError';
    this.status = status;
    this.body = body;
  }
}

// ── Núcleo del fetch ─────────────────────────────────────────────────────────
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

/** Lista pendientes (paginado). brand opcional para filtrar por marca. */
export function fetchQueue(
  token: string,
  opts: { limit?: number; offset?: number; brand?: string } = {},
): Promise<QueueResult> {
  const q = new URLSearchParams();
  if (opts.limit != null) q.set('limit', String(opts.limit));
  if (opts.offset != null) q.set('offset', String(opts.offset));
  if (opts.brand) q.set('brand', opts.brand);
  const qs = q.toString();
  return req<QueueResult>(`/api/calibration-queue${qs ? `?${qs}` : ''}`, token);
}

/**
 * Garantiza el artefacto de una pieza (render lazy). Devuelve su URL pública en el CDN
 * (artifact_url, durable) y el HTML crudo (para render vía <iframe srcdoc>, porque el
 * CDN sirve los objetos como text/plain y no se pueden embeber con src).
 */
export function renderArtifact(token: string, piece_id: string): Promise<{ ok: true; piece_id: string; artifact_url: string; html: string }> {
  return req('/api/preview-render', token, { method: 'POST', body: { piece_id } });
}

/**
 * Guarda un veredicto. criterion obligatorio si verdict='rejected' (el server lo
 * revalida con 422; acá también lo exigimos en la UI).
 */
export function saveVerdict(
  token: string,
  input: { piece_id: string; verdict: Verdict; criterion?: string | null },
): Promise<{ ok: true; row: VerdictRow }> {
  return req('/api/calibration-verdict', token, {
    method: 'POST',
    body: {
      piece_id: input.piece_id,
      verdict: input.verdict,
      criterion: input.criterion ?? null,
    },
  });
}
