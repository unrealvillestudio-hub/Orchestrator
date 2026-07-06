/**
 * api/calibrate.ts — Orchestrator · IID #47 Fase 2 (bucle Boids de calibración de voz)
 *
 * Endpoint STATELESS que orquesta el bucle de calibración. Toda la memoria vive en D1
 * (intel.calibration_sessions + intel.calibration_turns). En cada llamada el endpoint
 * LEE el estado de la DB, actúa (genera / evalúa convergencia), PERSISTE y devuelve.
 * El front nunca toca las tablas — todo pasa por aquí.
 *
 * Firma NODE-NATIVE (req: VercelRequest, res: VercelResponse) + res.status().json(),
 * igual que sign-upload/trigger-job/extract-frames. NO se usa la firma Web-standard
 * (req: Request): Promise<Response> — esa cuelga en este proyecto Vercel (504
 * FUNCTION_INVOCATION_TIMEOUT; el runtime Node no emite el Response devuelto).
 *
 * Del patrón de interpret-intent se conserva solo la lógica de motor (NO su firma rota):
 *   - process.env.ANTHROPIC_API_KEY server-side (tipos de @vercel/node).
 *   - normalizeSupabaseUrl() + SB_URL() + SB_KEY() (service_role).
 *   - fetch directo a https://api.anthropic.com/v1/messages (headers x-api-key,
 *     anthropic-version: 2023-06-01) + limpieza de fences ```json antes de JSON.parse.
 *   - abierto server-side con key (sin gating; corre en Vercel, no es EF, no aplica verify-JWT).
 *
 * Modelo canónico (jul-2026): claude-sonnet-5. NO usar IDs retirados (gen ≤4).
 *
 * D1 vía PostgREST con service_role. El schema `intel` está expuesto a PostgREST
 * (pgrst.db_schemas=public,intel,content) → se selecciona con Accept-Profile (lecturas)
 * y Content-Profile (escrituras).
 *
 * 3 acciones (discriminadas por body.action): start | verdict | status.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const MODEL = 'claude-sonnet-5';

// Convergencia (leída de DB, no de estado en memoria):
const MIN_TURNS = 10;   // mínimo de turnos con veredicto
const FINAL_SI = 3;     // los últimos N turnos (por turn_number) todos 'si'

// Normalize SUPABASE_URL — tolerates bare project ref, bare hostname, or full URL.
function normalizeSupabaseUrl(raw: string | undefined): string {
  if (!raw) return '';
  const s = raw.trim().replace(/\/+$/, '');
  if (!s) return '';
  if (s.startsWith('https://') || s.startsWith('http://')) return s;
  if (s.includes('.supabase.co')) return `https://${s}`;
  if (/^[a-z]{20}$/.test(s)) return `https://${s}.supabase.co`;
  return s;
}
const SB_URL = () => normalizeSupabaseUrl(process.env.SUPABASE_URL);
const SB_KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// ── Tipos internos ──────────────────────────────────────────────────────────────
interface SessionRow {
  id: string;
  brand_id: string;
  intent_label: string | null;
  entry_gate: 'from_genome' | 'from_scratch';
  founder_axis: Record<string, unknown> | null;
  source_technique_id: string | null;
  status: 'active' | 'converged' | 'abandoned';
  operator: string;
}
interface TurnRow {
  id: string;
  turn_number: number;
  proposed_text: string;
  technique_used: string | null;
  verdict_voice: 'si' | 'no' | null;
  notes_intent: string | null;
  is_convergence_marker: boolean;
}
interface TechniqueRow {
  id: string;
  technique_summary: string | null;
  raw_material: unknown;
}
// Fila cruda del SELECT de handleList: cabecera + founder_axis (interno, para derivar
// has_founder_axis — NO se devuelve al front). El turn_count sale de un segundo select.
interface SessionListRow {
  id: string;
  brand_id: string;
  intent_label: string | null;
  entry_gate: 'from_genome' | 'from_scratch';
  status: 'active' | 'converged' | 'abandoned';
  operator: string;
  founder_axis: Record<string, unknown> | null;
  created_at: string;
}

class SbError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'SbError';
    this.status = status;
    this.body = body;
  }
}
class GenError extends Error {}

// ── PostgREST helpers (schema intel, service_role) ───────────────────────────────
function readHeaders(): Record<string, string> {
  return {
    apikey: SB_KEY(),
    Authorization: `Bearer ${SB_KEY()}`,
    'Accept-Profile': 'intel',
  };
}
function writeHeaders(): Record<string, string> {
  return {
    apikey: SB_KEY(),
    Authorization: `Bearer ${SB_KEY()}`,
    'Content-Type': 'application/json',
    'Content-Profile': 'intel',
    Prefer: 'return=representation',
  };
}

async function sbSelect<T>(path: string): Promise<T[]> {
  const res = await fetch(`${SB_URL()}/rest/v1/${path}`, { headers: readHeaders() });
  if (!res.ok) throw new SbError(`select ${path}`, res.status, (await res.text().catch(() => '')).slice(0, 400));
  return (await res.json()) as T[];
}
async function sbInsert<T>(table: string, row: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SB_URL()}/rest/v1/${table}`, {
    method: 'POST',
    headers: writeHeaders(),
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new SbError(`insert ${table}`, res.status, (await res.text().catch(() => '')).slice(0, 400));
  const data = await res.json();
  return (Array.isArray(data) ? data[0] : data) as T;
}
async function sbPatch(path: string, patch: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${SB_URL()}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: writeHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new SbError(`patch ${path}`, res.status, (await res.text().catch(() => '')).slice(0, 400));
}

const getSession = async (id: string): Promise<SessionRow | null> =>
  (await sbSelect<SessionRow>(`calibration_sessions?id=eq.${id}&limit=1`))[0] ?? null;

const getTurns = async (sessionId: string): Promise<TurnRow[]> =>
  sbSelect<TurnRow>(
    `calibration_turns?session_id=eq.${sessionId}` +
    `&select=id,turn_number,proposed_text,technique_used,verdict_voice,notes_intent,is_convergence_marker` +
    `&order=turn_number.asc`,
  );

const getTechnique = async (id: string): Promise<TechniqueRow | null> =>
  (await sbSelect<TechniqueRow>(`captured_techniques?id=eq.${id}&select=id,technique_summary,raw_material&limit=1`))[0] ?? null;

// ── Convergencia + marcadores (recomputados desde DB) ────────────────────────────
/**
 * Recalcula is_convergence_marker: los turnos que forman la RACHA FINAL de 'si'
 * (desde el turn_number más alto hacia atrás, se corta con un 'no' o null).
 * Devuelve consecutive_si (largo de la racha). Reset a false + set true en la racha.
 */
async function recomputeMarkers(sessionId: string, turns: TurnRow[]): Promise<number> {
  const sorted = [...turns].sort((a, b) => a.turn_number - b.turn_number);
  const runIds: string[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].verdict_voice === 'si') runIds.push(sorted[i].id);
    else break;
  }
  await sbPatch(`calibration_turns?session_id=eq.${sessionId}`, { is_convergence_marker: false });
  if (runIds.length) {
    await sbPatch(`calibration_turns?id=in.(${runIds.join(',')})`, { is_convergence_marker: true });
  }
  return runIds.length;
}

// ── Generador (Opción X: lee de DB) ──────────────────────────────────────────────
function renderFounderAxis(axis: unknown): string {
  if (!axis || typeof axis !== 'object') return '(sin eje fundador definido)';
  const entries = Object.entries(axis as Record<string, unknown>);
  if (!entries.length) return '(sin eje fundador definido)';
  return entries
    .map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n');
}

function buildSystemPrompt(session: SessionRow, technique: TechniqueRow | null, priorTurns: TurnRow[]): string {
  const founderProse = renderFounderAxis(session.founder_axis);
  const usedTechniques = priorTurns.map((t) => t.technique_used).filter(Boolean) as string[];
  const usedBlock = usedTechniques.length ? usedTechniques.join(', ') : '(ninguna todavía)';

  let genomeBlock = '';
  if (session.entry_gate === 'from_genome' && technique) {
    const raw = typeof technique.raw_material === 'string'
      ? technique.raw_material
      : JSON.stringify(technique.raw_material ?? {}, null, 2);
    genomeBlock =
      `\nMATERIAL DE REFERENCIA (técnica capturada de un experto — insumo de aprendizaje de\n` +
      `MÉTODO, NUNCA a reescribir ni republicar):\n` +
      `${technique.technique_summary ?? '(sin resumen)'}\n${raw.slice(0, 2000)}\n`;
  }

  let historyBlock = '';
  if (priorTurns.length) {
    const lines = priorTurns.map((t) => {
      const v = t.verdict_voice === 'si' ? 'SÍ' : t.verdict_voice === 'no' ? 'NO' : '(sin veredicto)';
      return `Turno ${t.turn_number} | veredicto: ${v} | operador dijo: ${t.notes_intent ?? '—'} | técnica usada: ${t.technique_used ?? '—'}`;
    });
    historyBlock =
      `\nHISTORIA DE LA CALIBRACIÓN (turnos previos con el juicio del operador):\n` +
      `${lines.join('\n')}\n` +
      `- Los SÍ confirman qué funciona: refuérzalo.\n` +
      `- Los NO + su porqué corrigen: NO repitas lo que el operador rechazó.\n`;
  }

  return (
`Eres el mejor comunicador de marca del mundo. Tu tarea: generar UNA sola pieza breve
que encarne una HIPÓTESIS de la voz de esta marca, para que un experto de dominio la
juzgue SÍ (suena a la marca) o NO (no suena), y te explique por qué.

MARCA: ${session.brand_id}
INTENCIÓN DE VOZ BUSCADA: ${session.intent_label ?? '(no especificada)'}
EJE FUNDADOR (el motor de esta voz — qué defiende, contra qué, para quién):
${founderProse}
${genomeBlock}${historyBlock}
TECHO DE PRODUCCIÓN — VOZ CONSTANTE, TÉCNICA VARIABLE:
La VOZ (identidad, léxico, temperamento) es constante. La TÉCNICA de comunicación DEBE
variar en cada pieza. Técnicas ya usadas en esta sesión (NO las repitas): ${usedBlock}.
Elige una técnica DISTINTA (escena, contraste, analogía, dato-ancla, reencuadre,
objeción anticipada, testimonio, diagnóstico, principio invertido, etc.).

IDIOMA: escribe la pieza en el idioma que corresponda a la INTENCIÓN y al EJE FUNDADOR;
no traduzcas ni cambies de idioma sin motivo.

SALIDA — respondé ÚNICAMENTE con el objeto JSON, empezando por { y terminando por },
sin texto antes ni después y sin markdown:
{ "proposed_text": "la pieza, breve, lista para juzgar", "technique_used": "nombre corto de la técnica que usaste" }`
  );
}

/** Llama a Claude y parsea { proposed_text, technique_used }. Lanza GenError si falla. */
async function generateTurn(
  session: SessionRow,
  technique: TechniqueRow | null,
  priorTurns: TurnRow[],
): Promise<{ proposed_text: string; technique_used: string }> {
  if (!ANTHROPIC_API_KEY) throw new GenError('ANTHROPIC_API_KEY ausente en el runtime');
  const system = buildSystemPrompt(session, technique, priorTurns);

  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system,
        messages: [{ role: 'user', content: 'Genera la siguiente pieza siguiendo las instrucciones del sistema.' }],
      }),
    });
  } catch (err) {
    throw new GenError(`red hacia Anthropic: ${String(err)}`);
  }
  if (!res.ok) {
    const errBody = (await res.text().catch(() => '')).slice(0, 400);
    throw new GenError(`Anthropic API ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  // Concatenar TODOS los bloques de texto: claude-sonnet-5 puede anteponer bloques
  // no-texto (p.ej. thinking), así que leer solo content[0] daría vacío.
  const blocks: any[] = Array.isArray(data?.content) ? data.content : [];
  const rawText: string = blocks.filter((b) => b?.type === 'text').map((b) => b?.text ?? '').join('').trim();
  if (!rawText) {
    const types = blocks.map((b) => b?.type).join(',') || '(sin content)';
    throw new GenError(`Anthropic sin texto (stop=${String(data?.stop_reason)}; blocks=[${types}])`);
  }
  // claude-sonnet-5 a veces envuelve la pieza creativa en prosa: extraer el objeto JSON
  // exterior (primer '{' … último '}') antes de parsear. Limpia fences por si acaso.
  const cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
  const startIdx = cleaned.indexOf('{');
  const endIdx = cleaned.lastIndexOf('}');
  const jsonText = startIdx >= 0 && endIdx > startIdx ? cleaned.slice(startIdx, endIdx + 1) : cleaned.trim();

  let parsed: { proposed_text?: unknown; technique_used?: unknown };
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new GenError(`respuesta de Anthropic no es JSON parseable: ${jsonText.slice(0, 200)}`);
  }
  const proposed = String(parsed.proposed_text ?? '').trim();
  const technique_used = String(parsed.technique_used ?? '').trim();
  if (!proposed) throw new GenError('proposed_text vacío');
  return { proposed_text: proposed, technique_used };
}

// ── Respuesta JSON helper ────────────────────────────────────────────────────────
// Descriptor { status, body } que el handler top-level emite con res.status().json().
// Así las sub-acciones siguen con `return json(...)` (lógica intacta) y solo el
// wrapper HTTP cambia a Node-native.
interface Reply { status: number; body: unknown; }
function json(status: number, body: unknown): Reply {
  return { status, body };
}

// ── Acción: start ────────────────────────────────────────────────────────────────
async function handleStart(body: Record<string, any>): Promise<Reply> {
  // Reanudación: si viene session_id de un start previo que falló en generar el turno 1
  // (red de seguridad), se reusa esa sesión en vez de crear una nueva (evita huérfanas).
  let session: SessionRow | null = null;

  if (body.session_id) {
    session = await getSession(String(body.session_id));
    if (!session) return json(404, { error: 'not_found', detail: 'session_id no existe' });
    if (session.status !== 'active') return json(409, { error: 'invalid_state', detail: `sesión en estado '${session.status}'` });
    const existing = await getTurns(session.id);
    if (existing.length) {
      // Ya tiene turno 1 (idempotente): devolverlo tal cual.
      const t1 = existing[0];
      return json(200, { session_id: session.id, turn: { turn_number: t1.turn_number, proposed_text: t1.proposed_text }, status: session.status });
    }
  } else {
    const brand_id = String(body.brand_id ?? '').trim();
    const operator = String(body.operator ?? '').trim();
    const entry_gate = String(body.entry_gate ?? '').trim();
    if (!brand_id) return json(400, { error: 'invalid_input', detail: 'brand_id requerido' });
    if (!operator) return json(400, { error: 'invalid_input', detail: 'operator requerido' });
    if (entry_gate !== 'from_genome' && entry_gate !== 'from_scratch') {
      return json(400, { error: 'invalid_input', detail: "entry_gate debe ser 'from_genome' | 'from_scratch'" });
    }
    if (entry_gate === 'from_genome' && !body.source_technique_id) {
      return json(400, { error: 'invalid_input', detail: 'source_technique_id requerido con entry_gate=from_genome' });
    }
    session = await sbInsert<SessionRow>('calibration_sessions', {
      brand_id,
      operator,
      entry_gate,
      intent_label: body.intent_label ?? null,
      founder_axis: body.founder_axis ?? {},
      source_technique_id: body.source_technique_id ?? null,
    });
  }

  // Técnica de referencia para el generador (solo from_genome).
  let technique: TechniqueRow | null = null;
  if (session.entry_gate === 'from_genome' && session.source_technique_id) {
    technique = await getTechnique(session.source_technique_id);
  }

  // Generar turno 1. La sesión ya está persistida (red de seguridad): si Anthropic falla,
  // NO se rompe — se devuelve generation_failed + session_id y se puede reintentar
  // (llamando start de nuevo con este session_id → reanuda sin crear otra sesión).
  let gen: { proposed_text: string; technique_used: string };
  try {
    gen = await generateTurn(session, technique, []);
  } catch (err) {
    console.error('[calibrate] generation_failed (start)', session.id, String(err));
    // 502: fallo de generación (upstream Anthropic). La sesión sigue 'active' y
    // reintentable — el status HTTP distingue esto de un turno generado con éxito (200)
    // sin que el front tenga que inspeccionar el body.
    return json(502, {
      error: 'generation_failed',
      session_id: session.id,
      retry_hint: 'Reintentá la acción start enviando este session_id para regenerar el turno 1.',
    });
  }

  const turn = await sbInsert<TurnRow>('calibration_turns', {
    session_id: session.id,
    turn_number: 1,
    proposed_text: gen.proposed_text,
    technique_used: gen.technique_used, // interno, anti-repetición — NO se devuelve al front
    verdict_voice: null,
  });

  return json(200, {
    session_id: session.id,
    turn: { turn_number: turn.turn_number, proposed_text: turn.proposed_text },
    status: 'active',
  });
}

// ── Acción: verdict ──────────────────────────────────────────────────────────────
async function handleVerdict(body: Record<string, any>): Promise<Reply> {
  const session_id = String(body.session_id ?? '').trim();
  const turn_number = Number(body.turn_number);
  const verdict_voice = String(body.verdict_voice ?? '').trim();

  if (!session_id) return json(400, { error: 'invalid_input', detail: 'session_id requerido' });
  if (!Number.isInteger(turn_number)) return json(400, { error: 'invalid_input', detail: 'turn_number requerido (entero)' });
  if (verdict_voice !== 'si' && verdict_voice !== 'no') {
    return json(400, { error: 'invalid_input', detail: "verdict_voice debe ser 'si' | 'no'" });
  }

  const session = await getSession(session_id);
  if (!session) return json(404, { error: 'not_found', detail: 'session_id no existe' });
  if (session.status !== 'active') return json(409, { error: 'invalid_state', detail: `sesión en estado '${session.status}'` });

  const turns0 = await getTurns(session_id);
  const target = turns0.find((t) => t.turn_number === turn_number);
  if (!target) return json(400, { error: 'invalid_state', detail: `turno ${turn_number} no existe en la sesión` });

  // 1 · UPDATE del turno actual: veredicto + notas + operador que juzga.
  // verdict_operator (plan A): quién JUZGA este turno (Marisol al retomar), distinto
  // del session.operator (quién sembró = Sam). Opcional en el contrato: si el front no
  // lo manda → null (no rompe filas previas ni el flujo). El front SÍ lo manda siempre.
  await sbPatch(`calibration_turns?id=eq.${target.id}`, {
    verdict_voice,
    notes_intent: body.notes_intent ?? null,
    verdict_operator: String(body.verdict_operator ?? '').trim() || null,
  });

  // 2 · Recalcular estado desde DB.
  const turns = await getTurns(session_id);
  const consecutiveSi = await recomputeMarkers(session_id, turns);
  const totalVerdict = turns.filter((t) => t.verdict_voice !== null).length;

  // 3 · ¿Convergió? (≥10 turnos con veredicto Y racha final de 3 'si').
  if (totalVerdict >= MIN_TURNS && consecutiveSi >= FINAL_SI) {
    await sbPatch(`calibration_sessions?id=eq.${session_id}`, {
      status: 'converged',
      converged_at: new Date().toISOString(),
    });
    return json(200, {
      status: 'converged',
      total_turns: turns.length,
      message: 'Voz calibrada: convergió tras una racha de 3 SÍ con ≥10 turnos juzgados.',
    });
  }

  // 4 · No convergió → turno siguiente. Idempotencia: si ya existe (reintento tras
  // fallo de red en la respuesta), devolverlo en vez de regenerar/duplicar.
  const nextNumber = turn_number + 1;
  const existingNext = turns.find((t) => t.turn_number === nextNumber);
  if (existingNext) {
    return json(200, {
      turn: { turn_number: existingNext.turn_number, proposed_text: existingNext.proposed_text },
      status: 'active',
      progress: { turns_done: totalVerdict, consecutive_si: consecutiveSi },
    });
  }

  let technique: TechniqueRow | null = null;
  if (session.entry_gate === 'from_genome' && session.source_technique_id) {
    technique = await getTechnique(session.source_technique_id);
  }

  let gen: { proposed_text: string; technique_used: string };
  try {
    gen = await generateTurn(session, technique, turns);
  } catch (err) {
    console.error('[calibrate] generation_failed (verdict)', session_id, String(err));
    // El veredicto ya quedó guardado (red de seguridad). Reintentar la misma acción
    // verdict re-evalúa convergencia (idempotente) y regenera el turno siguiente.
    // 502: mismo criterio que en start — el status distingue el fallo de generación
    // (reintentable, sesión intacta) de un turno generado con éxito.
    return json(502, {
      error: 'generation_failed',
      session_id,
      retry_hint: 'Reintentá la acción verdict con el mismo turn_number; el veredicto ya quedó guardado.',
    });
  }

  const next = await sbInsert<TurnRow>('calibration_turns', {
    session_id,
    turn_number: nextNumber,
    proposed_text: gen.proposed_text,
    technique_used: gen.technique_used,
    verdict_voice: null,
  });

  return json(200, {
    turn: { turn_number: next.turn_number, proposed_text: next.proposed_text },
    status: 'active',
    progress: { turns_done: totalVerdict, consecutive_si: consecutiveSi },
  });
}

// ── Acción: status ───────────────────────────────────────────────────────────────
async function handleStatus(body: Record<string, any>): Promise<Reply> {
  const session_id = String(body.session_id ?? '').trim();
  if (!session_id) return json(400, { error: 'invalid_input', detail: 'session_id requerido' });

  const session = await getSession(session_id);
  if (!session) return json(404, { error: 'not_found', detail: 'session_id no existe' });

  const turns = await getTurns(session_id);
  return json(200, { session, turns });
}

// ── Acción: list (aditiva) ───────────────────────────────────────────────────────
// Enumera las sesiones de una marca (default status='active'). Devuelve SOLO cabecera
// —nunca turnos ni el founder_axis completo— para que el front pinte el selector sin
// tocar tablas. turn_count sale de UN segundo select (no N+1) — se evita el count
// embebido de PostgREST porque los agregados pueden estar deshabilitados server-side.
async function handleList(body: Record<string, any>): Promise<Reply> {
  const brand_id = String(body.brand_id ?? '').trim();
  if (!brand_id) return json(400, { error: 'invalid_input', detail: 'brand_id requerido' });

  const status = String(body.status ?? 'active').trim() || 'active';
  if (status !== 'active' && status !== 'converged' && status !== 'abandoned') {
    return json(400, { error: 'invalid_input', detail: "status debe ser 'active' | 'converged' | 'abandoned'" });
  }

  const rows = await sbSelect<SessionListRow>(
    `calibration_sessions` +
    `?brand_id=eq.${encodeURIComponent(brand_id)}` +
    `&status=eq.${status}` +
    `&select=id,brand_id,intent_label,entry_gate,status,operator,founder_axis,created_at` +
    `&order=created_at.desc`,
  );

  // turn_count: un solo select de los session_id de todos los turnos de estas sesiones,
  // contados en memoria (evita N+1 y no depende de agregados de PostgREST).
  const counts = new Map<string, number>();
  if (rows.length) {
    const ids = rows.map((r) => r.id).join(',');
    const turnRows = await sbSelect<{ session_id: string }>(
      `calibration_turns?session_id=in.(${ids})&select=session_id`,
    );
    for (const t of turnRows) counts.set(t.session_id, (counts.get(t.session_id) ?? 0) + 1);
  }

  const sessions = rows.map((r) => {
    // has_founder_axis: eje no nulo y no {} (distingue sembradas con motor real de vacías).
    // El founder_axis completo NO se devuelve (material de criterio; el front no lo edita).
    const axis = r.founder_axis;
    const has_founder_axis = !!axis && typeof axis === 'object' && Object.keys(axis).length > 0;
    return {
      id: r.id,
      brand_id: r.brand_id,
      intent_label: r.intent_label,
      entry_gate: r.entry_gate,
      status: r.status,
      operator: r.operator,
      has_founder_axis,
      turn_count: counts.get(r.id) ?? 0,
      created_at: r.created_at,
    };
  });

  return json(200, { sessions });
}

// ── Handler (Node-native: (req, res) → res.status().json()) ──────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const emit = (r: Reply) => { res.status(r.status).json(r.body); };

  if (req.method !== 'POST') return emit(json(405, { error: 'Method not allowed' }));

  if (!SB_URL() || !SB_KEY()) {
    return emit(json(503, { error: 'config_missing', detail: 'Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY' }));
  }

  // Vercel Node runtime ya parsea el JSON; tolera string por las dudas (igual que sign-upload).
  let body: Record<string, any> = {};
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  } catch {
    return emit(json(400, { error: 'Invalid JSON' }));
  }

  const action = String(body?.action ?? '').trim();
  try {
    switch (action) {
      case 'start':   return emit(await handleStart(body));
      case 'verdict': return emit(await handleVerdict(body));
      case 'status':  return emit(await handleStatus(body));
      case 'list':    return emit(await handleList(body));
      default:        return emit(json(400, { error: 'invalid_input', detail: "action debe ser 'start' | 'verdict' | 'status' | 'list'" }));
    }
  } catch (err) {
    if (err instanceof SbError) {
      console.error('[calibrate] supabase_error', err.status, err.body);
      return emit(json(500, { error: 'supabase_error', status: err.status, detail: err.body }));
    }
    console.error('[calibrate] error', err);
    return emit(json(500, { error: 'internal_error', detail: String(err) }));
  }
}
