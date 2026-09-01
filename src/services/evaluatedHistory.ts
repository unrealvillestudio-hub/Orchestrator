/**
 * evaluatedHistory.ts — Orchestrator · BRIEF-02 (historial de piezas evaluadas)
 *
 * Cliente tipado del historial:
 *   GET  /api/evaluated-history  → piezas ya evaluadas, del corpus vivo y del archivo
 *   POST /api/preview-render     → artefacto de una pieza (reutilizado de calibración)
 *
 * SÓLO LECTURA. No hay aprobar, rechazar, descartar ni editar: el historial mira, no toca.
 *
 * Espejo estructural de `publishInbox.ts` — mismo `req<T>` y **el mismo `CalibrationError`**,
 * que se reexporta en vez de declarar una clase gemela: dos jerarquías de error con el mismo
 * contrato obligarían a cada consumidor a atrapar las dos.
 */

import { CalibrationError } from './calibrationInbox';

export { CalibrationError } from './calibrationInbox';

// ── Tipos ────────────────────────────────────────────────────────────────────

/**
 * De qué tabla salió la fila, que en este tab ES el eje de generación: lo archivado es, por
 * construcción, de una generación anterior a su corte.
 */
export type HistorySource = 'live' | 'archived';
export type HistorySourceFilter = 'all' | HistorySource;

export interface EvaluatedRow {
  piece_id: string;
  brand_id: string;
  voice: string | null;
  domain: string | null;
  platform: string | null;
  format: string | null;
  psycho_preset: string | null;
  audience_frame: string | null;
  /**
   * El veredicto TAL COMO está guardado. Deliberadamente `string` y no una unión cerrada: el
   * eje ya se amplió una vez (`fixable`) y volverá a hacerlo. Un tipo cerrado obligaría a
   * editar este archivo en cada ampliación, y una fila con un valor desconocido dejaría de
   * mostrarse — que es justo lo que un historial no puede hacer.
   */
  verdict: string;
  criterion: string | null;
  /** La propuesta de corrección, cuando el veredicto la trae. */
  fix_proposal: string | null;
  evaluated_by: string | null;
  created_at: string | null;
  artifact_url: string | null;
  watcher_result: string | null;
  watcher_gate: string | null;
  watcher_rules: string[] | null;
  watcher_rules_evaluated: number | null;
  source: HistorySource;
  /** Idioma en que se lee la pieza en voz alta, resuelto por el server desde la marca. */
  reading_language: string | null;
  /** Sólo en `archived`. */
  archived_at: string | null;
  archived_reason: string | null;
}

export interface EvaluatedHistoryResult {
  total: number;
  /** Facetas DESCUBIERTAS del dato: ninguna marca, canal ni veredicto vive en el código. */
  by_brand: Record<string, number>;
  by_channel: Record<string, number>;
  by_verdict: Record<string, number>;
  limit: number;
  offset: number;
  rows: EvaluatedRow[];
  /** La lectura topó el límite del server: el historial mostrado puede no estar completo. */
  truncated?: boolean;
}

// ── Núcleo del fetch ─────────────────────────────────────────────────────────
async function req<T>(path: string, token: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  } catch (err) {
    throw new CalibrationError('No se pudo contactar el servidor (red).', 0, { cause: String(err) });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // El mensaje del server NO se colapsa: `error` es un código para la máquina y no le dice
    // nada al operador; `detail` y `message` son la frase que explica qué pasó. Mismo criterio
    // que `calibrationInbox.req`. El cuerpo crudo sigue entero en `body`.
    const d = data as { detail?: unknown; message?: unknown; error?: unknown };
    const msg = d?.detail || d?.message || d?.error || `Error ${res.status}`;
    throw new CalibrationError(String(msg), res.status, data);
  }
  return data as T;
}

// ── Acciones ─────────────────────────────────────────────────────────────────

/**
 * Lista el historial (paginado). Todos los parámetros son opcionales.
 *
 * `verdict` viaja como texto libre a propósito: el server lo compara exacto y `all` no filtra.
 * Así, un veredicto nuevo se puede filtrar sin tocar ni esta función ni el endpoint.
 */
export function fetchEvaluatedHistory(
  token: string,
  opts: {
    limit?: number; offset?: number;
    from?: string; to?: string;
    brand?: string; channel?: string;
    verdict?: string; source?: HistorySourceFilter;
  } = {},
): Promise<EvaluatedHistoryResult> {
  const q = new URLSearchParams();
  if (opts.limit != null) q.set('limit', String(opts.limit));
  if (opts.offset != null) q.set('offset', String(opts.offset));
  if (opts.from) q.set('from', opts.from);
  if (opts.to) q.set('to', opts.to);
  if (opts.brand) q.set('brand', opts.brand);
  if (opts.channel) q.set('channel', opts.channel);
  if (opts.verdict) q.set('verdict', opts.verdict);
  if (opts.source) q.set('source', opts.source);
  const qs = q.toString();
  return req<EvaluatedHistoryResult>(`/api/evaluated-history${qs ? `?${qs}` : ''}`, token);
}
