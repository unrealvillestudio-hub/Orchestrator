/**
 * calibrationInbox.ts — Orchestrator · B4 Fase 1 · CALIB-UI-01 (bandeja de calibración)
 *
 * Cliente tipado de los endpoints Node del Orchestrator (mismo origen, `/api/*`):
 *   GET  /api/calibration-queue    → PIEZAS pendientes de evaluar (paginado, orden y filtros)
 *   POST /api/calibration-verdict  → guarda un veredicto en el corpus (UPSERT por piece_id)
 *   POST /api/calibration-discard  → sella la pieza como descartada (NO entra al corpus)
 *   POST /api/preview-render       → renderiza el artefacto de una pieza al CDN (lazy, idempotente)
 *
 * El token de sesión (JWT admin de iid-inbound) viaja en `Authorization: Bearer`.
 * Estos endpoints corren server-side con service_role y validan el JWT + rol admin.
 *
 * Espejo estructural de services/iidInbound.ts (mismo estilo de error tipado).
 */

// ── Tipos ────────────────────────────────────────────────────────────────────
/**
 * Los tres veredictos de la calibración. Son estados de DECISIÓN:
 *   approved → sirve como está
 *   rejected → no sirve
 *   fixable  → no sirve tal como está, pero hay algo que aprovechar y Sam escribe qué propone
 *
 * `fixable` sella la pieza IGUAL que `rejected` —sale de la bandeja— y se diferencia sólo en el
 * corpus. Un veredicto que no sella deja la pieza viva y reaparece mañana: sería una nota, no un
 * veredicto. El contrato completo está en `api/calibration-verdict.ts`.
 */
export type Verdict = 'approved' | 'rejected' | 'fixable';

/** Orden de la bandeja. Ejes del sistema: toda pieza tiene fecha, marca y veredicto. */
export type QueueOrder = 'recent' | 'oldest' | 'brand' | 'verdict';
/** Filtro por primera opinión del watcher. */
export type VerdictFilter = 'all' | 'PASS' | 'REJECT';
/** Filtro por generación del flujo (ver `FlowGeneration`). */
export type GenerationFilter = 'all' | 'current';

/**
 * ¿La pieza es del flujo corregido? Se calcula contra `intel.pipeline_cutoffs`, leída en
 * runtime — ninguna fecha de corte vive en el código.
 *   current  → posterior al último corte que le aplica
 *   previous → anterior: la juzga un flujo que ya se arregló
 *   unknown  → no hay corte aplicable (tabla vacía o todavía sin migrar)
 */
export type FlowGeneration = 'current' | 'previous' | 'unknown';

/**
 * FIX-CARD-06 — LO QUE LA CABECERA DE UNA PIEZA DICE SIN ABRIR NADA.
 *
 * Los topes NO viven acá: salen de `public.platform_configs` por canal (`char_limit`,
 * `char_target`, `hashtag_limit`) y la firma esperada de `brand_voice_genome`, resueltos
 * en el server (`api/_pieceMetrics.ts`). Este archivo declara la FORMA del contrato; ni
 * un número de tope, ni un nombre de canal, ni un nombre de marca.
 */

/** Qué texto se contó: el adaptado al canal, o el maestro cuando no hay adaptación. */
export type TextSource = 'channel_adapted' | 'master_copy' | 'empty';

/**
 * Estado de un conteo contra su tope. `no_data` NUNCA se pinta verde: un tope sin sembrar
 * es una ausencia, y una ausencia con forma de aprobación es lo que hace aprobar a ciegas.
 */
export type LimitStatus = 'ok' | 'over_target' | 'over_limit' | 'no_data';

export interface CountAgainstLimit {
  count: number;
  target: number | null;
  limit: number | null;
  status: LimitStatus;
  /** Qué falta y dónde se siembra. null cuando hay dato. */
  reason: string | null;
}

/** La firma es una COMPARACIÓN entre lo que el genoma declara y lo que la pieza estampa. */
export type SignatureStatus = 'match' | 'mismatch' | 'not_declared' | 'no_voice' | 'no_data';

export interface SignatureCheck {
  /** `signature_closer` del genoma, por `brand_id`/`voice_id`. */
  expected: string | null;
  /** Con qué cierra la pieza de verdad. */
  stamped: string | null;
  status: SignatureStatus;
  reason: string | null;
}

export interface PieceMetrics {
  chars: CountAgainstLimit;
  hashtags: CountAgainstLimit;
  signature: SignatureCheck;
  platform: string | null;
  text_source: TextSource;
}

/**
 * SIGN-01 corte E — MOTIVOS DE RECHAZO, lista cerrada en la UI y texto libre en la columna.
 *
 * Hoy Sam escribe el criterio a mano y esos motivos NO son agregables: para saber que el 40% de los
 * rechazos son "falta la firma" hay que leerlos uno por uno — y eso es exactamente lo que pasó, dos
 * piezas íntegras rechazadas por un defecto del sistema que nadie podía contar.
 *
 * El valor viaja en `criterion` con un prefijo estable (`motivo:<clave>`), así que una consulta puede
 * agrupar por él sin dejar de aceptar la prosa que ya hay en las 12 filas anteriores. La columna no
 * cambia de tipo ni gana CHECK: mañana serán ocho clases y no queremos una migración por cada una.
 *
 * Son clases de defecto, NUNCA marcas: le sirven igual a una marca de cosmética en Florida.
 */
export const REJECT_REASONS = [
  { value: 'falta_firma',     label: 'Falta la firma' },
  { value: 'texto_truncado',  label: 'Texto truncado' },
  { value: 'dato_incorrecto', label: 'Dato incorrecto' },
  // La etiqueta se aclaró («Registro» se leía a la vez como tono y como alta/suscripción, y
  // un chip ambiguo agrupa mal, que es para lo que existe). EL VALOR NO CAMBIA: viaja dentro
  // del texto libre con su prefijo estable, y tocarlo huérfanaría las filas que ya lo usan.
  { value: 'registro',        label: 'Tono y registro' },
  { value: 'titulo',          label: 'Título' },
  { value: 'otro',            label: 'Otro' },
] as const;

export const REASON_PREFIX = 'motivo:';
/** `motivo:<clave>` + la prosa opcional. Sin clave, el criterio queda como siempre. */
export function buildCriterion(reason: string | null | undefined, prose: string | null | undefined): string | null {
  const r = (reason ?? '').trim();
  const p = (prose ?? '').trim();
  if (!r) return p || null;
  return p ? `${REASON_PREFIX}${r} · ${p}` : `${REASON_PREFIX}${r}`;
}

/**
 * PR-C · PREVISIÓN de fecha, NO compromiso.
 *
 * Dónde CAERÍA esta pieza si se aprobara ahora: la próxima franja libre de su marca × canal,
 * resuelta por el server contra `intel.brand_publish_slots`. Puede cambiar — otra pieza
 * aprobada antes se la lleva. La franja COMPROMETIDA se llama `slot`, vive en el contrato de
 * la bandeja de publicación y significa otra cosa; los dos nombres existen justamente para
 * que no se puedan confundir.
 *
 * `null` = no hay franja libre futura para ese canal, o el canal no tiene política sembrada.
 * Es información, no error.
 */
export interface ForecastSlot {
  /** Instante UTC, ISO-8601. La pantalla nunca lo muestra crudo: lo sitúa en `timezone`. */
  slot_at: string;
  /**
   * Huso de la marca, nombre IANA, desde `public.brands.publish_timezone`. `null` = la marca
   * no lo tiene sembrado, y entonces la hora NO se sitúa: se dice qué falta por sembrar.
   */
  timezone: string | null;
}

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
  // Detalle por reglas enumeradas (piezas post content-run-stage v56). El badge muestra
  // los códigos de regla; cae a watcher_gate cuando failed_rules viene vacío (piezas viejas).
  watcher_failed_rules: string[];
  watcher_rules_evaluated: number | null;
  // SIGN-01 corte D — los cuatro estados nombrados, la razón en prosa y el tipo de pase.
  watcher_verdict: 'PASS' | 'REJECT' | 'RESCHEDULE' | 'not_evaluated';
  watcher_reason: string | null;
  pass_type: string | null;
  /**
   * En qué idioma se lee esta pieza en voz alta (BCP-47 o prefijo). Lo resuelve el server desde
   * `public.brands` por `brand_id`; `null` = sin dato, y el lector usa la voz del sistema.
   * Ni un idioma escrito en el código: la lista de idiomas es la del operador y la del catálogo.
   */
  reading_language: string | null;

  // ── Procedencia ────────────────────────────────────────────────────────────
  status: string | null;
  created_at: string | null;           // cuándo se creó la pieza
  approved_at: string | null;          // cuándo se aprobó, o null si todavía no
  queue_id: string | null;
  job_id: string | null;               // job del carril que la produjo
  finding_id: string | null;           // hallazgo que la originó
  watcher_verdict_at: string | null;   // cuándo se emitió el veredicto
  attempts: number | null;             // intentos sobre esa fila de cola
  gate_rules_evaluated: number | null; // reglas evaluadas por el watcher
  gate_evaluated_codes: string[];      // códigos evaluados
  generation: FlowGeneration;
  cutoff_label: string | null;         // corte de referencia usado
  cutoff_at: string | null;
  // FIX-CARD-06 — conteos contra los topes del canal y comparación de la firma. `null` =
  // el server no resolvió los catálogos: ausencia declarada, no un cero que parezca medido.
  metrics: PieceMetrics | null;
  /**
   * PR-C — dónde caería esta pieza si se aprobara ahora. PREVISIÓN, no compromiso: la
   * etiqueta en pantalla es «Fecha prevista de publicación», nunca «fecha de publicación».
   */
  forecast_slot: ForecastSlot | null;
}

export interface QueueResult {
  total_pending: number;
  by_brand: Record<string, number>;
  limit: number;
  offset: number;
  order: QueueOrder;
  verdict: VerdictFilter;
  generation: GenerationFilter;
  pieces: CalibrationPiece[];
  /** Por qué la generación puede venir 'unknown': tabla ausente vs vacía vs sembrada. */
  cutoffs_source: 'unavailable' | 'empty' | 'seeded';
  /**
   * PR-C — si las franjas se pudieron leer. `unavailable` NO significa «sin franja libre»:
   * significa que no se pudo consultar, y la pantalla lo dice en vez de afirmar algo sobre
   * el canal que nadie midió.
   */
  slots_source: 'ok' | 'unavailable';
  truncated?: boolean;
}

export interface VerdictRow {
  id: string;
  piece_id: string;
  brand_id: string;
  verdict: Verdict;
  criterion: string | null;
  /** Qué propone Sam para aprovechar la pieza. Sólo con `fixable`; NULL en los otros dos. */
  fix_proposal: string | null;
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
    // EL MENSAJE DEL SERVER NO SE COLAPSA. `error` es un código para la máquina (`verdict_failed`,
    // `corpus_column_missing`) y no le dice NADA al operador; `detail` y `message` son la frase que
    // sí explica qué pasó y qué hacer. Se prefiere la explicación y el código queda de respaldo.
    // El cuerpo crudo sigue entero en `body` para diagnosticar.
    const msg = (data && (data.detail || data.message || data.error)) || `Error ${res.status}`;
    throw new CalibrationError(String(msg), res.status, data);
  }
  return data as T;
}

// ── Acciones ─────────────────────────────────────────────────────────────────

/** Lista pendientes (paginado). Todos los parámetros son opcionales. */
export function fetchQueue(
  token: string,
  opts: {
    limit?: number; offset?: number; brand?: string;
    order?: QueueOrder; verdict?: VerdictFilter; generation?: GenerationFilter;
  } = {},
): Promise<QueueResult> {
  const q = new URLSearchParams();
  if (opts.limit != null) q.set('limit', String(opts.limit));
  if (opts.offset != null) q.set('offset', String(opts.offset));
  if (opts.brand) q.set('brand', opts.brand);
  if (opts.order) q.set('order', opts.order);
  if (opts.verdict) q.set('verdict', opts.verdict);
  if (opts.generation) q.set('generation', opts.generation);
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
 * BRIEF-N05 — REGENERAR LA IMAGEN DE UNA PIEZA, SIN EMITIR VEREDICTO.
 *
 * No es un cuarto veredicto y por eso no vive junto a `saveVerdict`: la pieza NO se sella, no
 * entra al corpus y no sale de la bandeja. Se corrige la imagen, se mira, y recién después se
 * vota — que es la única forma de que un `fixable` de imagen se arregle sin salir de la
 * herramienta, porque `fixable` sella la pieza igual que un rechazo.
 *
 * `visual_directive` es OBLIGATORIA, al revés que el criterio de un veredicto: aquí la directriz
 * ES la operación, y regenerar sin ella devuelve el mismo defecto cobrando una generación.
 *
 * Devuelve el HTML del artefacto ya rehecho, para que la tarjeta muestre la imagen corregida sin
 * recargar. `artifact_refreshed:false` significa que la imagen SÍ cambió pero el artefacto no se
 * pudo rehacer: son dos cosas distintas y la interfaz tiene que poder decir cuál pasó.
 */
export function recomposeImage(
  token: string,
  input: { piece_id: string; visual_directive: string; edit_reason?: string | null },
): Promise<{
  ok: true; piece_id: string; image_url: string | null; composed: boolean;
  visual_directive_domain: string | null; visual_directive_piece: string | null;
  scheduled_posts_updated: number;
  artifact_url: string | null; html: string | null; artifact_refreshed: boolean;
}> {
  return req('/api/recompose-image', token, {
    method: 'POST',
    body: {
      piece_id: input.piece_id,
      visual_directive: input.visual_directive,
      edit_reason: input.edit_reason ?? null,
    },
  });
}

/**
 * Guarda un veredicto en el corpus. `criterion` es OPCIONAL en los tres veredictos: el
 * criterio se dicta en el chat con Claude, no acá. Obligarlo en la interfaz empuja a
 * escribir relleno para avanzar, y eso envenena el corpus.
 *
 * `fix_proposal` es la excepción y va al revés: OBLIGATORIA con `fixable` —el endpoint
 * devuelve 400 sin ella— y `null` con los otros dos. No es una incoherencia con lo anterior:
 * el criterio explica un juicio ya tomado y puede llegar después, mientras que la propuesta
 * ES el veredicto — un `fixable` sin propuesta no dice nada que un rechazo no diga ya.
 */
export function saveVerdict(
  token: string,
  input: { piece_id: string; verdict: Verdict; criterion?: string | null; fix_proposal?: string | null },
): Promise<{ ok: true; row: VerdictRow; piece_applied: boolean; piece_status: string | null; note?: string }> {
  return req('/api/calibration-verdict', token, {
    method: 'POST',
    body: {
      piece_id: input.piece_id,
      verdict: input.verdict,
      criterion: input.criterion ?? null,
      fix_proposal: input.fix_proposal ?? null,
    },
  });
}

/**
 * Descarta una pieza: sale de la bandeja y NO entra al corpus. Descartar no es rechazar
 * — un rechazo dice "esto está mal", un descarte dice "no voy a juzgar esto".
 */
export function discardPiece(
  token: string,
  input: { piece_id: string; reason?: string | null },
): Promise<{ ok: true; piece_id: string; discarded_at: string | null; discarded_reason: string | null }> {
  return req('/api/calibration-discard', token, {
    method: 'POST',
    body: { piece_id: input.piece_id, reason: input.reason ?? null },
  });
}
