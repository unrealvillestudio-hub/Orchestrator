/**
 * publishInbox.ts — Orchestrator · PUBLISH-UI-01 (parcial de SOLO LECTURA)
 *
 * Cliente tipado de la bandeja de publicación:
 *   GET  /api/publish-queue     → piezas candidatas a salir, con canal y estado del canal
 *   POST /api/preview-render    → artefacto de una pieza (reutilizado de calibración)
 *
 * NO hay acción de aprobar, y es por DISEÑO: aprobar es del carril de CALIBRACIÓN, que es
 * donde se juzga la pieza. El endpoint devuelve `approval.available = false` con el motivo
 * y la interfaz lo muestra, en vez de ofrecer un botón que pertenece a otra bandeja.
 *
 * PR-C — cada pieza trae además su FRANJA RESERVADA (`slot`): cuándo sale, en la hora de su
 * marca. Es un compromiso, no una previsión; la previsión vive en `calibrationInbox.ts` y
 * se llama `forecast_slot` para que las dos no se puedan confundir.
 *
 * Reutiliza los tipos de procedencia de `calibrationInbox.ts` — no se duplican.
 */

import {
  CalibrationError,
  type FlowGeneration,
  type PieceMetrics,
} from './calibrationInbox';

// El error tipado es el mismo mecanismo; se reexporta para no obligar a importar de dos lados.
export { CalibrationError } from './calibrationInbox';
export type { FlowGeneration, PieceMetrics } from './calibrationInbox';

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

/**
 * PR-C · el COMPROMISO de una pieza: la franja que tiene RESERVADA.
 *
 * La resuelve el server desde `intel.brand_publish_slots` por `piece_id`. `null` en el
 * contrato = la pieza no tiene franja, que es un estado real y visible, no un hueco de
 * datos: en una pieza APROBADA es una anomalía y la tarjeta la avisa; en una que todavía no
 * se aprobó es lo esperado y no se dice nada.
 *
 * No confundir con `ForecastSlot` (bandeja de calibración), que es una PREVISIÓN y puede
 * cambiar. Dos cosas distintas, dos nombres distintos.
 */
export interface PieceSlot {
  /** Instante UTC, ISO-8601. La pantalla nunca lo muestra crudo: lo sitúa en `timezone`. */
  slot_at: string;
  /** Estado de la franja tal como lo declara la tabla (`free`, `reserved`, `published`, …). */
  status: string;
  /**
   * Huso de la marca, nombre IANA, desde `public.brands.publish_timezone`. `null` = la marca
   * no lo tiene sembrado, y entonces la hora NO se sitúa: se dice qué falta por sembrar.
   * El nombre IANA es la única forma que sobrevive al cambio de horario — nunca un desfase.
   */
  timezone: string | null;
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
  /**
   * En qué idioma se lee esta pieza en voz alta (BCP-47 o prefijo). Lo resuelve el server desde
   * `public.brands` por `brand_id`; `null` = sin dato, y el lector usa la voz del sistema.
   * Ni un idioma escrito en el código: la lista de idiomas es la del operador y la del catálogo.
   */
  reading_language: string | null;
  watcher_gate: string | null;
  watcher_failed_rules: string[];
  watcher_rules_evaluated: number | null;
  // Procedencia (idéntica a la de la bandeja de calibración).
  status: string | null;
  created_at: string | null;
  approved_at: string | null;
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
  // FIX-CARD-06 — la MISMA cabecera que la bandeja de calibración: las dos llaman a
  // `metricsOf` en el server, así que no pueden contar distinto la misma pieza.
  metrics: PieceMetrics | null;
  // Canal de destino y su estado operativo.
  channel: ChannelInfo;
  /**
   * PR-C — la franja RESERVADA de esta pieza. Etiqueta en pantalla: «Publica:». `null` =
   * sin franja; la tarjeta sólo lo avisa cuando la pieza está aprobada (ver `approved_at`).
   */
  slot: PieceSlot | null;
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
  /**
   * PR-C — si las franjas se pudieron leer. `unavailable` NO significa que las piezas no
   * tengan fecha: significa que la fecha falta por no haberse podido consultar, y la pantalla
   * dice eso en vez de avisar «Aprobada sin franja asignada» en cada tarjeta aprobada.
   */
  slots_source: 'ok' | 'unavailable';
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
    // EL MENSAJE DEL SERVER NO SE COLAPSA. `error` es un código para la máquina y no le dice
    // nada al operador; `detail` y `message` son la frase que explica qué pasó. Mismo orden que
    // `calibrationInbox.req` y `evaluatedHistory.req`: que una bandeja explique y otra no es la
    // divergencia que se vuelve permanente en el primer cambio. El crudo sigue entero en `body`.
    const d = data as { detail?: unknown; message?: unknown; error?: unknown };
    const msg = d?.detail || d?.message || d?.error || `Error ${res.status}`;
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
