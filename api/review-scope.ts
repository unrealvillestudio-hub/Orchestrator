/**
 * GET /api/review-scope — qué marcas puede revisar la sesión.
 *
 * Lo pregunta la interfaz al entrar, para saber si un operador que no es admin ve las bandejas. La
 * respuesta NO es la seguridad: cada endpoint de las bandejas vuelve a comprobar el alcance por su
 * cuenta (`requireReviewer` + `guardPiece`). Esto sólo decide qué se pinta.
 *
 * Returns 200: { review: '*' | string[] } · 403 si no tiene marcas asignadas para revisar.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, extractToken } from './_calibrationShared.js';
import { requireReviewer } from './_reviewScope.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const session = await requireReviewer(req, res, extractToken(req));
  if (!session) return; // requireReviewer ya respondió
  return res.status(200).json({ review: session.review });
}
