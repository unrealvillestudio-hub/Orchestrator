/**
 * UNRLVL Orchestrator — api/piece-edit.ts  (CALIB-01-E · corte 1)
 *
 * Edición in-line de una pieza retenida o pendiente de aprobación.
 *
 * POST /api/piece-edit
 *   Auth: admin JWT (Authorization: Bearer o body.session_token)
 * Body: { piece_id, field: 'title' | 'body', after_text, edit_reason?, acknowledge_warnings? }
 *
 * ── LA EDICIÓN ES DATO DE CALIBRACIÓN, NO UNA EXCEPCIÓN ──────────────────────────
 * Lo que un humano edita, comparado con lo que produjo la máquina, no dice "esto está mal":
 * dice "así se arregla". El 2026-08-24 se corrigió a mano el título de una pieza y se
 * publicó, y del cambio no quedó ni qué se tocó ni por qué.
 *
 * ── NO REIMPLEMENTA LA MUTACIÓN ──────────────────────────────────────────────────
 * Delega en la Edge Function `piece-edit` (CALIB-01 corte D), donde ya viven el orden
 * diff→texto→guarda (si el diff no se registra, la edición NO se aplica), la escritura en
 * las dos caras del copy, la poda del no-cambio, y la GUARDA DETERMINISTA con el espejo del
 * corrector que un test compara byte a byte. Reescribir eso acá sería exactamente el
 * defecto que CALIB-01 combatió con ese espejo.
 *
 * ── LA GUARDA AVISA Y NO BLOQUEA ─────────────────────────────────────────────────
 * La EF corre los `verify_pattern` de las reglas de la marca contra el texto nuevo y
 * devuelve `guard.blocking:false` con los avisos. Este endpoint los propaga SIN convertir
 * ninguno en error: si acá se devolviera 4xx por un aviso, la guarda pasaría a bloquear por
 * la puerta de atrás. Un sistema que le impide a Sam publicar lo que quiere publicar en su
 * propia marca está roto.
 *
 * `acknowledge_warnings:true` registra que insistió — y esa insistencia también es dato:
 * una regla contra la que se insiste es una regla en discusión.
 *
 * ── UN CAMPO POR LLAMADA ─────────────────────────────────────────────────────────
 * El contrato de la EF acepta una LISTA de campos; acá se expone uno solo porque la UI
 * edita un campo a la vez y un `piece_edits` por campo tocado es el grano que hace legible
 * el ratio de ediciones POR CAMPO — que es lo que dice dónde falla el generador. La lista
 * queda disponible del lado de la EF para cuando entren las alternativas generadas.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, extractToken, requireAdmin } from './_calibrationShared.js';
import { callEdgeFunction, parseBody } from './_challengedShared.js';

/**
 * Los campos editables. Espejo del contrato de la EF; si divergieran, la UI ofrecería un
 * campo que el otro lado rechaza. Cero marcas: son partes de una pieza.
 */
const EDITABLE_FIELDS = ['title', 'body'] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = parseBody(req);
  const session = requireAdmin(req, res, extractToken(req, body));
  if (!session) return; // requireAdmin ya respondió

  const piece_id = typeof body.piece_id === 'string' ? body.piece_id.trim() : '';
  if (!piece_id) return res.status(400).json({ error: 'piece_id required' });

  const field = body.field as EditableField;
  if (!EDITABLE_FIELDS.includes(field)) {
    return res.status(400).json({ error: `field must be one of: ${EDITABLE_FIELDS.join(', ')}` });
  }

  if (typeof body.after_text !== 'string') {
    return res.status(400).json({ error: 'after_text required (string; vaciar un campo es una edición legítima)' });
  }

  // `edit_reason` es OPCIONAL, y tiene que seguir siéndolo: obligarlo empuja a elegir
  // cualquier clase para avanzar, y eso envenena la serie igual que un criterio de relleno
  // envenena el corpus de calibración. La lista cerrada vive en la UI; la tabla registra lo
  // que se eligió, sin CHECK, para que añadir una clase no cueste una migración.
  const edit_reason = typeof body.edit_reason === 'string' && body.edit_reason.trim()
    ? body.edit_reason.trim()
    : null;

  try {
    const out = await callEdgeFunction('piece-edit', {
      piece_id,
      edits: [{ field, after_text: body.after_text, edit_reason }],
      // De la sesión, igual que el arbitraje: sin firma no hay calibración auditable.
      edited_by: session.sub || 'sam',
      acknowledge_warnings: body.acknowledge_warnings === true,
    });

    // Los avisos de la guarda viajan DENTRO de una respuesta 200. No se convierten en 4xx
    // ni acá ni en la UI: la EF ya guardó cuando emite el aviso.
    return res.status(out.status).json(out.body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[piece-edit]', message);
    return res.status(500).json({ error: 'edit_failed', message });
  }
}
