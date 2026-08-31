/**
 * UNRLVL Orchestrator — api/calibration-verdict.ts  (B4 · Fase 1, Pieza 3)
 *
 * Guarda UN veredicto humano en el corpus `intel.approval_calibration`.
 * El veredicto queda atado al código del output (piece_id) junto con TODO el contexto
 * copiado de la pieza y el artifact_url. Ese vínculo es el activo.
 *
 * POST /api/calibration-verdict
 *   Auth: admin JWT (Authorization: Bearer o body.session_token)
 * Body: {
 *   piece_id: string,
 *   verdict: 'approved' | 'rejected' | 'fixable',
 *   criterion?: string,            // OPCIONAL en los tres veredictos (párrafo libre)
 *   fix_proposal?: string,         // OBLIGATORIO con 'fixable', ignorado en los otros dos
 *   evaluated_by?: string          // default 'sam'
 * }
 * Returns 200: { ok: true, row }   (la fila del corpus, con contexto completo)
 *
 * Reglas:
 *  · Criterio en prosa, NO categorías, y SIEMPRE opcional (CALIB-UI-01 §2/§4.4). El
 *    criterio se razona en el chat con Claude, no en la interfaz: obligar a escribirlo
 *    acá empuja a poner cualquier cosa para avanzar, y eso envenena el corpus con ruido
 *    que parece señal. Un rechazo sin criterio es una fila honesta que Claude completa
 *    después; un rechazo con criterio de relleno es una fila que miente.
 *  · UPSERT por piece_id (una pieza = una fila; re-evaluar sobrescribe).
 *  · Garantiza el artefacto (render idempotente) antes del UPSERT → artifact_url del
 *    corpus SIEMPRE apunta a un artefacto real, aunque nadie lo haya visto en la bandeja.
 *  · SIGN-01 corte A2 — LA DECISIÓN SE EJECUTA. Hasta acá este endpoint escribía el corpus y NADA
 *    más: las 6 decisiones de Sam del 2026-08-25 dejaron las 6 piezas exactamente como estaban. No
 *    había flujo, había opiniones registradas.
 *      approved → status='scheduled' + approved_at + approved_by (desde la SESIÓN)
 *      rejected → status='rejected' + discarded_at + discarded_reason (el motivo estructurado)
 *      fixable  → EL MISMO EFECTO QUE rejected. No es un olvido: la bandeja lista
 *                 `awaiting_approval` con `discarded_at IS NULL`, así que un veredicto que no
 *                 sella deja la pieza viva y reaparece mañana — una nota que no se aplica, que
 *                 es el defecto A2 otra vez. La diferencia vive ENTERA en el corpus: etiqueta
 *                 `fixable` + `fix_proposal` con lo que Sam propone para aprovecharla.
 *    El efecto va DESPUÉS del upsert: si el corpus falla, la pieza no se mueve — mover una pieza sin
 *    registrar por qué es el mismo defecto, del otro lado.
 *  · LA PROPUESTA ES OBLIGATORIA con `fixable` (400 si falta o viene vacía). Un `fixable` sin
 *    propuesta es un rechazo con otro nombre, y contaminaría el corpus con una etiqueta que no
 *    significa lo que dice.
 *  · APROBAR SIGUE SIN PUBLICAR. Sella la habilitación, que es lo que el modo `placement` de
 *    content-scheduler exige para ver la pieza; la franja la calcula él y de ahí sale a SocialLab.
 *    No se toca scheduled_posts.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  applyCors, extractToken, requireAdmin,
  ensureArtifact, toContext, watcherRulesForCorpus, upsertVerdict, applyVerdictToPiece, PieceNotFound,
  CorpusColumnMissing, type CalibrationVerdict,
} from './_calibrationShared.js';

const VERDICTS: readonly CalibrationVerdict[] = ['approved', 'rejected', 'fixable'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body: {
    piece_id?: string; verdict?: string; criterion?: string; fix_proposal?: string;
    evaluated_by?: string; session_token?: string;
  } = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); } catch { /* keep empty */ }

  const session = requireAdmin(req, res, extractToken(req, body));
  if (!session) return; // requireAdmin ya respondió

  const pieceId = typeof body.piece_id === 'string' ? body.piece_id.trim() : '';
  if (!pieceId) return res.status(400).json({ error: 'piece_id required' });

  const verdict = body.verdict as CalibrationVerdict;
  if (!VERDICTS.includes(verdict)) {
    return res.status(400).json({ error: `verdict must be one of: ${VERDICTS.join(', ')}` });
  }

  // La propuesta de corrección: obligatoria con `fixable`, descartada en los otros dos. Se valida
  // acá y no en la DB por el mismo criterio que el resto del endpoint — la regla es de negocio, no
  // de esquema — y se rechaza con 400 ANTES de tocar nada: un `fixable` sin propuesta no debe
  // llegar ni al corpus ni a la pieza.
  const proposal = typeof body.fix_proposal === 'string' ? body.fix_proposal.trim() : '';
  if (verdict === 'fixable' && !proposal) {
    return res.status(400).json({
      error: 'fix_proposal required',
      detail: "un 'fixable' sin propuesta es un rechazo con otro nombre",
    });
  }
  const fix_proposal = verdict === 'fixable' ? proposal : null;

  // Criterio opcional en los TRES veredictos: la DB lo deja nullable y el corpus prefiere
  // una fila sin criterio a una con relleno. Lo escribe Claude desde el chat, después.
  const criterion = typeof body.criterion === 'string' ? body.criterion.trim() : '';

  const evaluated_by = (typeof body.evaluated_by === 'string' && body.evaluated_by.trim())
    ? body.evaluated_by.trim()
    : (session.sub || 'sam');

  try {
    // Garantiza el artefacto y trae la pieza (fail-loud si no existe).
    const { artifact_url, piece } = await ensureArtifact(pieceId);
    const ctx = toContext(piece); // ya incluye artifact_url determinística (coincide con el garantizado)
    // Nivel de regla, en forma nullable para el corpus (NULL si el bloque no lo trae; nunca []).
    const corpusRules = watcherRulesForCorpus(piece);

    const row = await upsertVerdict({
      piece_id: ctx.piece_id,
      brand_id: ctx.brand_id,
      voice: ctx.voice,
      domain: ctx.domain,
      platform: ctx.platform,
      format: ctx.format,
      psycho_preset: ctx.psycho_preset,
      audience_frame: ctx.audience_frame,
      artifact_url, // el recién garantizado (idéntico a ctx.artifact_url)
      verdict,
      criterion: criterion || null, // sin criterio → NULL (nunca '' ni relleno)
      // Qué propone Sam para aprovecharla. NULL salvo en `fixable`, donde ya se validó no vacía.
      fix_proposal,
      evaluated_by,
      // Primera opinión del watcher, copiada de la pieza (para comparar Sam vs watcher).
      watcher_result: ctx.watcher_result,
      watcher_gate: ctx.watcher_gate,
      // Nivel de regla: qué códigos dispararon y contra cuántas se juzgó. NULL = no registrado.
      watcher_rules: corpusRules.rules,
      watcher_rules_evaluated: corpusRules.rules_evaluated,
    });

    // SIGN-01 corte A2 — y ahora la pieza se mueve. `evaluated_by` viene de la sesión, así que el
    // sello de aprobación queda trazable hasta quien lo firmó.
    // La propuesta baja TAMBIÉN a la pieza, en `discarded_reason` con su marcador. El corpus se
    // archiva; `content_pieces` no. Sin esto, una fila `fixable` archivada dejaría la pieza
    // indistinguible de un rechazo para siempre.
    const piece_effect = await applyVerdictToPiece(pieceId, verdict, evaluated_by, criterion || null, fix_proposal);
    if (!piece_effect) {
      // Otro operador la movió primero. El corpus ya quedó escrito —la opinión de Sam vale igual— y
      // se dice que la pieza no se tocó, en vez de fingir que sí.
      console.warn(`[calibration-verdict] ${pieceId}: corpus escrito, pieza NO movida (ya descartada por otra mano)`);
      return res.status(200).json({ ok: true, row, piece_applied: false, piece_status: null });
    }

    return res.status(200).json({
      ok: true, row,
      piece_applied: true,
      piece_status: piece_effect.status ?? null,
      // Se dice explícito porque es la confusión que este corte cierra: habilitar no es publicar.
      published: false,
      note: verdict === 'approved'
        ? 'habilitada — la franja la calcula content-scheduler mode=placement'
        : verdict === 'fixable'
          ? 'marcada como fixable — sale de la bandeja igual que un rechazo; la propuesta queda en el corpus'
          : 'rechazada y descartada — sale de la bandeja',
    });
  } catch (err) {
    if (err instanceof PieceNotFound) return res.status(404).json({ error: 'piece_not_found', piece_id: pieceId });

    // LA VENTANA SE DICE, NO SE DISFRAZA DE FALLO. Mientras la migración del veredicto no esté
    // aplicada, la columna no existe y un 500 genérico es indistinguible de un fallo real: el
    // operador no puede saber que no hay nada roto y que el arreglo es aplicar la migración.
    // Mismo criterio que `challenged-queue` con su tabla ausente («está vacía porque no hay de
    // dónde leer, no porque no haya retenidas»). 503 y no 500: no es un error del servidor, es
    // una capacidad que todavía no está desplegada.
    if (err instanceof CorpusColumnMissing) {
      console.warn(`[calibration-verdict] ${pieceId}: ${err.message} — migración del veredicto sin aplicar`);
      return res.status(503).json({
        error: 'corpus_column_missing',
        column: err.column,
        detail: `El corpus todavía no tiene la columna '${err.column}': la migración del veredicto `
          + 'fixable no está aplicada. No se guardó nada y la pieza NO se movió — no hay nada roto. '
          + 'Aprobar y rechazar siguen funcionando con normalidad.',
        server_detail: err.server_detail,
      });
    }

    const message = err instanceof Error ? err.message : String(err);
    console.error('[calibration-verdict]', message);
    // `message` viaja con el texto del server: la interfaz lo muestra en vez de colapsarlo en
    // `verdict_failed`, que no dice nada de lo que pasó.
    return res.status(500).json({ error: 'verdict_failed', message });
  }
}
