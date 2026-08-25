/**
 * publishInbox.ts — Orchestrator · PUBLISH-UI-01 (parcial de SOLO LECTURA)
 *
 * Cliente tipado de la bandeja de publicación:
 *   GET  /api/publish-queue     → piezas candidatas a salir, con canal y estado del canal
 *   POST /api/preview-render    → artefacto de una pieza (reutilizado de calibración)
 *
 * NO hay acción de aprobar. El eje de colocación de una pieza producida en la franja de su
 * canal no existe en el ecosistema (ver el cuerpo del PR); el endpoint devuelve
 * `approval.available = false` con el motivo, y la interfaz lo muestra en vez de ofrecer un
 * botón que no puede cumplir.
 *
 * Reutiliza los tipos de procedencia de `calibrationInbox.ts` — no se duplican.
 */

import {
  CalibrationError,
  type FlowGeneration,
} from './calibrationInbox';

// El error tipado es el mismo mecanismo; se reexporta para no obligar a importar de dos lados.
export { CalibrationError } from './calibrationInbox';
export type { FlowGeneration } from './calibrationInbox';

// ── Tipos ────────────────────────────────────────────────────────────────────
/**
 * Estado operativo del canal de destino.
 *   operational → hay fila activa en `intel.brand_publish_channels` para (marca, canal)
 *   inactive    → la fila existe pero está apagada
 *   missing     → no hay fila: el canal no está configurado para esa marca
 *   undeclared  → la pieza no declara canal
 */
export type ChannelStatus = 'operational' | 'inactive' | 'missing' | 'undeclared';

export interface ChannelInfo {
  platform_key: string | null;
  status: ChannelStatus;
  provider: string | null;
  /** Motivo legible cuando el canal no está operativo. */
  reason: string | null;
}

export interface PublishablePiece {
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
  watcher_result: 'PASS' | 'REJECT' | null;
  // SIGN-01 corte D — las dos bandejas comparten `toContext`, así que comparten el veredicto
  // completo. Un badge distinto por bandeja sería otra forma de que digan cosas distintas.
  watcher_verdict: 'PASS' | 'REJECT' | 'RESCHEDULE' | 'not_evaluated';
  watcher_reason: string | null;
  pass_type: string | null;
  watcher_gate: string | null;
  watcher_failed_rules: string[];
  watcher_rules_evaluated: number | null;
  // Procedencia (idéntica a la de la bandeja de calibración).
  status: string | null;
  created_at: string | null;
  queue_id: string | null;
  job_id: string | null;
  finding_id: string | null;
  watcher_verdict_at: string | null;
  attempts: number | null;
  gate_rules_evaluated: number | null;
  gate_evaluated_codes: string[];
  generation: FlowGeneration;
  cutoff_label: string | null;
  cutoff_at: string | null;
  // Canal de destino y su estado operativo.
  channel: ChannelInfo;
}

export type ChannelStatusFilter = 'all' | 'operational' | 'blocked';
export type GenerationFilter = 'all' | 'current';

export interface PublishQueueResult {
  total: number;
  by_brand: Record<string, number>;
  by_channel: Record<string, number>;
  limit: number;
  offset: number;
  channel: string;
  channel_status: ChannelStatusFilter;
  generation: GenerationFilter;
  pieces: PublishablePiece[];
  /** Por qué la bandeja no aprueba todavía. Viene del server, no de una constante del front. */
  approval: { available: boolean; reason: string };
  cutoffs_source: 'unavailable' | 'empty' | 'seeded';
  truncated?: boolean;
}

// ── Fetch ────────────────────────────────────────────────────────────────────
async function req<T>(path: string, token: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  } catch (err) {
    throw new CalibrationError('No se pudo contactar el servidor (red).', 0, { cause: String(err) });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && ((data as any).error || (data as any).message)) || `Error ${res.status}`;
    throw new CalibrationError(String(msg), res.status, data);
  }
  return data as T;
}

/** Lista las piezas candidatas a salir (paginado). Todos los parámetros son opcionales. */
export function fetchPublishQueue(
  token: string,
  opts: {
    limit?: number; offset?: number; brand?: string;
    channel?: string; channelStatus?: ChannelStatusFilter; generation?: GenerationFilter;
  } = {},
): Promise<PublishQueueResult> {
  const q = new URLSearchParams();
  if (opts.limit != null) q.set('limit', String(opts.limit));
  if (opts.offset != null) q.set('offset', String(opts.offset));
  if (opts.brand) q.set('brand', opts.brand);
  if (opts.channel) q.set('channel', opts.channel);
  if (opts.channelStatus) q.set('channel_status', opts.channelStatus);
  if (opts.generation) q.set('generation', opts.generation);
  const qs = q.toString();
  return req<PublishQueueResult>(`/api/publish-queue${qs ? `?${qs}` : ''}`, token);
}
