/**
 * UNRLVL Orchestrator — api/research-cases.ts  (INVESTIGAR, 2026-10-05)
 *
 * El caso de investigación de UNA pieza: abrirlo («Investigar») y leer su estado.
 *
 * POST /api/research-cases
 *   Auth: la misma que `calibration-verdict` (`requireReviewer` + alcance de revisión de la pieza).
 *   Body: { piece_id: string, question: string, criterion?: string, evaluated_by?: string }
 *   Returns 200: { ok: true, row, research_case, piece_applied, piece_status, slot_release }
 *           400: falta la pregunta, o pasa de 2000 caracteres
 *           409: la acción no está disponible, o la pieza YA tiene un caso abierto (`research_case_open`)
 *           503: la migración 20261005230000 no está aplicada (`research_cases_missing` /
 *                `research_verdict_missing`) — se dice qué falta y que NO se escribió nada.
 *
 * GET /api/research-cases?piece_id=<uuid>
 *   Returns 200: { ok: true, cases: Array<ResearchCase & { new_piece_artifact_url }> } — los casos
 *                abiertos SOBRE la pieza y el caso que la CREÓ (`new_piece_id` = esta pieza). Más
 *                reciente primero.
 *
 * QUÉ HACE «INVESTIGAR», en este orden, y por qué el orden:
 *   1. lee los casos de la pieza: si ya hay uno abierto, 409 SIN escribir nada; si la tabla no
 *      existe, 503 SIN escribir nada. Es la lectura que evita dejar un veredicto sin caso;
 *   2. escribe el corpus con el veredicto `research` y la pregunta en `fix_proposal` — igual que
 *      `calibration-verdict` escribe un `fixable` con su propuesta;
 *   3. abre el caso en `intel.research_cases` (el índice único parcial cubre la carrera: 409);
 *   4. reta la pieza con «Investigación pendiente: <pregunta>» y libera su franja, si tenía.
 *
 * El caso lo investiga `iid-research` (modo caso, con el agente de la marca) y lo consume
 * `content-run-stage`, que crea la pieza NUEVA por el carril normal o devuelve la original a
 * Arreglos. Las dos EF viven en `unrlvl-iid-functions`. La tabla es de `intel`, sin `anon` ni
 * `authenticated`: se llega con la llave de servicio, sólo desde aquí.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  actionsFor, applyCors, extractToken,
  ensureArtifact, toContext, watcherRulesForCorpus, upsertVerdict, applyVerdictToPiece, PieceNotFound,
  CorpusColumnMissing,
  insertResearchCase, fetchResearchCases, isOpenResearchCase, publicArtifactUrl,
  ResearchCasesMissing, ResearchCaseOpen, type ResearchCase,
} from './_calibrationShared.js';
import { requireReviewer, guardPiece, signerOf } from './_reviewScope.js';
import { releaseSlotsForPiece, type SlotRelease } from './_publishSlots.js';

/** El tope de la pregunta: el mismo CHECK de `research_cases.question`. */
export const RESEARCH_QUESTION_MAX = 2000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') return leer(req, res);
  if (req.method === 'POST') return investigar(req, res);
  return res.status(405).json({ error: 'GET or POST only' });
}

// ── GET · el estado ──────────────────────────────────────────────────────────────────
async function leer(req: VercelRequest, res: VercelResponse) {
  const session = await requireReviewer(req, res, extractToken(req));
  if (!session) return;

  const raw = Array.isArray(req.query.piece_id) ? req.query.piece_id[0] : req.query.piece_id;
  const pieceId = typeof raw === 'string' ? raw.trim() : '';
  if (!/^[0-9a-f-]{36}$/i.test(pieceId)) return res.status(400).json({ error: 'piece_id required (uuid)' });
  if (!(await guardPiece(res, session, pieceId))) return;

  try {
    // La vista previa de la pieza nueva viaja con el caso: es el enlace que la tarjeta ofrece.
    const cases = (await fetchResearchCases(pieceId)).map((c) => ({
      ...c,
      new_piece_artifact_url: c.new_piece_id ? publicArtifactUrl(c.brand_id, c.new_piece_id) : null,
    }));
    return res.status(200).json({ ok: true, cases });
  } catch (err) {
    if (err instanceof ResearchCasesMissing) {
      return res.status(503).json({ error: 'research_cases_missing', server_detail: err.server_detail });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error('[research-cases] GET', message);
    return res.status(500).json({ error: 'research_cases_failed', message });
  }
}

// ── POST · «Investigar» ──────────────────────────────────────────────────────────────
async function investigar(req: VercelRequest, res: VercelResponse) {
  let body: {
    piece_id?: string; question?: string; criterion?: string; evaluated_by?: string; session_token?: string;
  } = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); } catch { /* keep empty */ }

  const session = await requireReviewer(req, res, extractToken(req, body));
  if (!session) return;

  const pieceId = typeof body.piece_id === 'string' ? body.piece_id.trim() : '';
  if (!pieceId) return res.status(400).json({ error: 'piece_id required' });
  if (!(await guardPiece(res, session, pieceId))) return;

  // La pregunta es el encargo de la investigación: sin ella no hay qué investigar. Se valida ANTES
  // de tocar nada, como la propuesta de un `fixable`.
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) {
    return res.status(400).json({
      error: 'question required',
      detail: 'Investigar necesita la pregunta: qué escenario deja fuera la pieza y qué hay que averiguar.',
    });
  }
  if (question.length > RESEARCH_QUESTION_MAX) {
    return res.status(400).json({ error: 'question too long', detail: `la pregunta admite hasta ${RESEARCH_QUESTION_MAX} caracteres` });
  }
  const criterion = typeof body.criterion === 'string' ? body.criterion.trim() : '';
  const evaluated_by = signerOf(session, body.evaluated_by);

  try {
    const { artifact_url, piece } = await ensureArtifact(pieceId);

    // El server cumple el mismo contrato de acciones que pinta la tarjeta.
    const permitida = actionsFor(piece).research;
    if (!permitida.available) {
      return res.status(409).json({
        error: 'action_not_available', action: 'research',
        detail: permitida.reason ?? 'La pieza ya no admite esta acción.', status: piece.status ?? null,
      });
    }

    // 1 · ANTES DE ESCRIBIR: ¿ya hay un caso abierto? ¿existe la tabla? Las dos respuestas cortan
    // aquí, sin dejar un veredicto `research` en el corpus que ningún caso respalde.
    const previos = await fetchResearchCases(pieceId);
    const abierto = previos.find((c) => c.piece_id === pieceId && isOpenResearchCase(c)) ?? null;
    if (abierto) {
      return res.status(409).json({
        error: 'research_case_open',
        detail: 'Esta pieza ya tiene una investigación abierta: no se abre otra.',
        research_case: abierto,
      });
    }

    // 2 · El corpus: el veredicto `research` con su pregunta.
    const ctx = toContext(piece);
    const corpusRules = watcherRulesForCorpus(piece);
    const row = await upsertVerdict({
      piece_id: ctx.piece_id, brand_id: ctx.brand_id, voice: ctx.voice, domain: ctx.domain,
      platform: ctx.platform, format: ctx.format, psycho_preset: ctx.psycho_preset,
      audience_frame: ctx.audience_frame, artifact_url,
      verdict: 'research',
      criterion: criterion || null,
      fix_proposal: question,
      evaluated_by,
      watcher_result: ctx.watcher_result, watcher_gate: ctx.watcher_gate,
      watcher_rules: corpusRules.rules, watcher_rules_evaluated: corpusRules.rules_evaluated,
    });

    // 3 · El caso. Si otra pestaña lo abrió entre 1 y 3, el índice único lo rechaza: 409.
    let research_case: ResearchCase;
    try {
      research_case = await insertResearchCase({ piece_id: ctx.piece_id, brand_id: ctx.brand_id, question, requested_by: evaluated_by });
    } catch (e) {
      if (!(e instanceof ResearchCaseOpen)) throw e;
      return res.status(409).json({
        error: 'research_case_open',
        detail: 'Esta pieza ya tiene una investigación abierta: no se abre otra.',
        research_case: e.open_case,
      });
    }

    // 4 · La pieza: retada con «Investigación pendiente: <pregunta>». Su franja, si tenía, se libera
    // DESPUÉS de moverla, igual que con un `fixable` (U-3).
    const piece_effect = await applyVerdictToPiece(pieceId, 'research', evaluated_by, criterion || null, question);
    const slot_release: SlotRelease = await releaseSlotsForPiece(pieceId);
    if (!slot_release.ok) {
      console.error(`[research-cases] ${pieceId}: caso abierto, FRANJA NO LIBERADA — ${slot_release.error ?? ''}`);
    }
    if (!piece_effect) {
      // Otra mano la selló primero. El caso está abierto y el carril NO la va a reescribir: una pieza
      // que ya no espera el caso se cierra como `failed` en la reescritura.
      console.warn(`[research-cases] ${pieceId}: caso ${research_case.id} abierto, pieza NO movida (ya sellada por otra mano)`);
      return res.status(200).json({ ok: true, row, research_case, piece_applied: false, piece_status: null, slot_release });
    }
    return res.status(200).json({
      ok: true, row, research_case,
      piece_applied: true,
      piece_status: piece_effect.status ?? null,
      slot_release,
      note: 'en investigación — RETADA con «Investigación pendiente»; el agente de la marca investiga la pregunta '
        + 'y, con material, nace una pieza nueva del mismo tema en Calibración; sin material, vuelve a Arreglos.',
    });
  } catch (err) {
    if (err instanceof PieceNotFound) return res.status(404).json({ error: 'piece_not_found', piece_id: pieceId });
    // La tabla de casos todavía no existe: la lectura del paso 1 lo detecta antes de escribir.
    if (err instanceof ResearchCasesMissing) {
      return res.status(503).json({
        error: 'research_cases_missing',
        detail: 'La base todavía no tiene la tabla de casos de investigación. No se guardó nada y la pieza no se movió. '
          + 'Se arregla aplicando la migración 20261005230000.',
        server_detail: err.server_detail,
      });
    }
    const m = err instanceof Error ? err.message : String(err);
    // El corpus todavía no admite `research`: el upsert lo rechaza antes de abrir el caso.
    if (/approval_calibration_verdict_check/.test(m)) {
      return res.status(503).json({
        error: 'research_verdict_missing',
        detail: "El corpus todavía no admite el veredicto 'research'. No se guardó nada y la pieza no se movió. "
          + 'Se arregla aplicando la migración 20261005230000.',
        server_detail: m.slice(0, 300),
      });
    }
    if (err instanceof CorpusColumnMissing) {
      return res.status(503).json({
        error: 'corpus_column_missing', column: err.column,
        detail: `El corpus no tiene la columna '${err.column}'. No se guardó nada y la pieza no se movió.`,
        server_detail: err.server_detail,
      });
    }
    console.error('[research-cases] POST', m);
    return res.status(500).json({ error: 'research_failed', message: m });
  }
}
