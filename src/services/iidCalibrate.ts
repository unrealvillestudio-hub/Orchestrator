/**
 * iidCalibrate.ts — Orchestrator · IID #47 Fase 2 · E5b FRONT (#65)
 *
 * Cliente tipado de la función Vercel `api/calibrate.ts` (bucle Boids de calibración
 * de voz). Patrón de transporte = `callApi` de iidExpert.ts:
 *   - Rutas relativas `/api/*` (función Vercel Node-native del MISMO repo), NO
 *     `${SB_URL}/functions/v1/...` (ese es el patrón de iidInbound para EFs de Supabase).
 *   - session_token NO viaja: `api/calibrate.ts` corre server-side con service_role y
 *     no valida JWT del IID. El scope-gating (Marisol nunca calibra Lucien/UNRLVL) lo
 *     impone el FRONT limitando el <select> de marca a listOptions(session_token).
 *   - IidError reutilizado de iidInbound → mismo manejo tipado por status HTTP.
 *
 * Distinción de errores por status (gobernanza, ver §4 del brief E5b):
 *   502 generation_failed → fallo de generación (Anthropic upstream). Sesión/veredicto
 *       INTACTO y reintentable. El front ofrece "Reintentar" (err.status === 502).
 *   500 → error de Supabase/interno. Terminal para ese intento.
 *   409 invalid_state → sesión no 'active' (p.ej. ya convergió). Mostrar estado real.
 *   404 → session_id/brand_id inexistente.
 *   400 → input inválido.
 */

import { IidError } from './iidInbound';

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface CalibrationSessionSummary {
  id: string;
  brand_id: string;
  intent_label: string | null;
  entry_gate: 'from_genome' | 'from_scratch';
  status: 'active' | 'converged' | 'abandoned';
  operator: string;
  has_founder_axis: boolean;
  turn_count: number;
  created_at: string;
}

/** Turno a juzgar — solo lo que el front necesita pintar (no técnica, no veredicto interno). */
export interface CalibrationTurn {
  turn_number: number;
  proposed_text: string;
}

/**
 * Sprint CRAFT-01: artefacto de destino declarado. `mode` selecciona el módulo de canal del
 * arsenal (written|oral) en el backend. El FRONT lo deriva del canal elegido — nunca el
 * backend por adivinación (§3). Guion de video/TikTok/podcast → 'oral'; el resto → 'written'.
 */
export interface TargetArtifact {
  channel: string;
  format: string;
  length_hint: string;
  mode: 'written' | 'oral';
}

/** Las 4 familias psicológicas reales (TAG_TO_FAMILY). Selector del módulo psy_<FAMILIA>. */
export type PsyFamily = 'CONVERSION' | 'COMMUNITY' | 'AUTHORITY' | 'BRIDGE';

/** Los 4 tipos de voz. Hoy solo 'conversion' tiene módulo; los otros degradan limpiamente. */
export type VoiceType = 'conversion' | 'editorial' | 'educative' | 'professional';

/** Progreso que devuelve el server tras un veredicto (solo reflejo — el front no lo recomputa). */
export interface CalibrationProgress {
  turns_done: number;
  consecutive_si: number;
  /**
   * E5c: el umbral (≥10 turnos juzgados Y racha final de 3 SÍ) HABILITA cerrar, ya no
   * cierra solo. true → el front ofrece "Cerrar y calibrar voz". Reflejo del server; el
   * front nunca lo recomputa. Vuelve a false si una racha se rompe (voto NO).
   */
  can_converge: boolean;
}

/** Respuesta de `start` / retomada (turno vigente + estado). */
export interface StartResult {
  session_id: string;
  turn: CalibrationTurn;
  status: string;
  /** E5c: presente al reanudar por session_id (una sesión reanudada puede estar en umbral). */
  progress?: CalibrationProgress;
  /** CRAFT-01 §5.4: avisos NO bloqueantes del modo degradado (dato de contexto no declarado). */
  craft_warnings?: string[];
}

/** Respuesta de `verdict`: turno siguiente (active) O cierre (converged). El front bifurca por `status`. */
export type VerdictResult =
  | { turn: CalibrationTurn; status: 'active'; progress: CalibrationProgress; craft_warnings?: string[] }
  | { status: 'converged'; total_turns: number; message: string };

/** Respuesta de `status`: cabecera cruda + turnos (para reconstruir una sesión al retomar). */
export interface StatusResult {
  session: {
    id: string;
    brand_id: string;
    intent_label: string | null;
    entry_gate: 'from_genome' | 'from_scratch';
    founder_axis: Record<string, unknown> | null;
    source_technique_id: string | null;
    status: 'active' | 'converged' | 'abandoned';
    operator: string;
    [k: string]: unknown;
  };
  turns: Array<{
    id: string;
    turn_number: number;
    proposed_text: string;
    technique_used: string | null;
    verdict_voice: 'si' | 'no' | null;
    notes_intent: string | null;
    is_convergence_marker: boolean;
    [k: string]: unknown;
  }>;
  /** E5c: progreso derivado (turns_done + consecutive_si + can_converge) para saber al retomar si ya se puede cerrar. */
  progress?: CalibrationProgress;
}

// ── Núcleo del fetch (idéntico al callApi de iidExpert.ts) ───────────────────────

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

// ── Acciones ─────────────────────────────────────────────────────────────────────

/** list — enumera las sesiones de una marca (default status='active'). Solo cabecera. */
export function listSessions(
  brandId: string,
  status: string = 'active',
): Promise<{ sessions: CalibrationSessionSummary[] }> {
  return callApi<{ sessions: CalibrationSessionSummary[] }>('/api/calibrate', {
    action: 'list',
    brand_id: brandId,
    status,
  });
}

/**
 * start — crea una sesión nueva (from_scratch) O reanuda una existente por session_id.
 *   nueva:   { brand_id, operator, intent_label, founder_axis } → entry_gate fijo 'from_scratch'.
 *   reanuda: { session_id } → si ya tiene turno 1, lo devuelve idempotente; si no, lo genera.
 */
export function startCalibration(
  input:
    | {
        brand_id: string;
        operator: string;
        intent_label: string;
        founder_axis: Record<string, unknown>;
        // CRAFT-01: los 3 selectores declarados. Opcionales — el operador puede no elegir y
        // la sesión corre en modo degradado (§7). null se manda explícito (nunca se adivina).
        voice_type?: VoiceType | null;
        target_artifact?: TargetArtifact | null;
        psy_family?: PsyFamily | null;
      }
    | { session_id: string },
): Promise<StartResult> {
  const body: Record<string, unknown> =
    'session_id' in input
      ? { action: 'start', session_id: input.session_id }
      : {
          action: 'start',
          entry_gate: 'from_scratch',
          brand_id: input.brand_id,
          operator: input.operator,
          intent_label: input.intent_label,
          founder_axis: input.founder_axis,
          voice_type: input.voice_type ?? null,
          target_artifact: input.target_artifact ?? null,
          psy_family: input.psy_family ?? null,
        };
  return callApi<StartResult>('/api/calibrate', body);
}

/**
 * verdict — juzga el turno vigente. verdict_operator SIEMPRE presente (session.sub del
 * logueado = Marisol). Devuelve turno siguiente (active) o cierre (converged).
 */
export function submitVerdict(input: {
  session_id: string;
  turn_number: number;
  verdict_voice: 'si' | 'no';
  notes_intent: string | null;
  verdict_operator: string;
}): Promise<VerdictResult> {
  return callApi<VerdictResult>('/api/calibrate', {
    action: 'verdict',
    session_id: input.session_id,
    turn_number: input.turn_number,
    verdict_voice: input.verdict_voice,
    notes_intent: input.notes_intent,
    verdict_operator: input.verdict_operator,
  });
}

/**
 * converge — E5c: cierre EXPLÍCITO del operador. Solo válido cuando el server habilitó
 * `can_converge` (≥10 turnos + racha de 3 SÍ). Devuelve el mismo shape `converged` que un
 * verdict que cerraba antes, así el front reusa `applyVerdictResult`. El backend valida el
 * umbral: si el front llamara desincronizado, responde 409 `not_convergeable` (no cierra).
 * NO destila genoma (E6 es chat-only) — solo marca la sesión como calibrada.
 */
export function convergeSession(sessionId: string, verdictOperator: string): Promise<VerdictResult> {
  return callApi<VerdictResult>('/api/calibrate', {
    action: 'converge',
    session_id: sessionId,
    verdict_operator: verdictOperator,
  });
}

/** status — reconstruye una sesión (cabecera + turnos) para reanudarla. */
export function getStatus(sessionId: string): Promise<StatusResult> {
  return callApi<StatusResult>('/api/calibrate', {
    action: 'status',
    session_id: sessionId,
  });
}
