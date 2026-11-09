/**
 * UNRLVL Orchestrator — api/production-window.ts
 *
 * LA VENTANA DE PRODUCCIÓN (Sam, 2026-11-09): «Activa la producción que haga falta para lo que se
 * necesita en los próximos 7 días. El día 5 de dicha semana me preguntas si activas la producción de
 * los siguientes 7 días.» El carril produce sólo para las franjas anteriores al fin de la ventana
 * (`intel.v_carril_entrada`, migración `20261109120000` de unrlvl-iid-functions).
 *
 * GET  /api/production-window            → { window: { desde, hasta, dias_restantes, preguntar, vencida,
 *                                             activated_by, phrase } | null }
 *   Auth: cualquier sesión de revisión (el aviso se ve en todas las bandejas).
 *
 * POST /api/production-window  { phrase?: string }
 *   Auth: sólo admin. Activa los siguientes 7 días con `intel.activate_next_production_window`,
 *   firmada con la sesión y con la frase. Antes del día 5 la base responde VENTANA_YA_ACTIVA → 409.
 *
 * La regla vive en la base, no aquí: este endpoint sólo la lee y la pide.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, extractToken, SB_URL, SB_KEY } from './_calibrationShared.js';
import { requireReviewer, esAdmin } from './_reviewScope.js';
import { fetchWithTimeout } from './_fetchWithTimeout.js';

const intel = (extra: Record<string, string> = {}) => ({
  apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`,
  'Accept-Profile': 'intel', 'Content-Profile': 'intel', ...extra,
});

/** La frase por defecto del botón: dice qué se pidió, para que la fila no quede sin palabras. */
export const FRASE_DEL_BOTON = 'Activar los siguientes 7 días (botón del Orchestrator)';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'GET o POST' });

  let body: { phrase?: string; session_token?: string } = {};
  if (req.method === 'POST') {
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); } catch { /* vacío */ }
  }
  const session = await requireReviewer(req, res, extractToken(req, body));
  if (!session) return;

  if (req.method === 'GET') {
    try {
      const r = await fetchWithTimeout('db', `${SB_URL()}/rest/v1/v_production_window?select=*&limit=1`, { headers: intel() });
      // Sin la vista (migración sin aplicar) el aviso no se pinta: `window: null` + `source`.
      if (r.status === 404) return res.status(200).json({ window: null, source: 'unavailable' });
      if (!r.ok) return res.status(502).json({ error: 'window_read_failed', status: r.status });
      const rows = (await r.json().catch(() => [])) as unknown[];
      return res.status(200).json({ window: Array.isArray(rows) && rows.length ? rows[0] : null, source: 'db' });
    } catch (err) {
      return res.status(502).json({ error: 'window_read_failed', message: err instanceof Error ? err.message : String(err) });
    }
  }

  if (!esAdmin(session.role)) return res.status(403).json({ error: 'solo_admin', detail: 'Sólo Sam activa la producción.' });
  const phrase = typeof body.phrase === 'string' && body.phrase.trim() ? body.phrase.trim().slice(0, 500) : FRASE_DEL_BOTON;
  try {
    const r = await fetchWithTimeout('db', `${SB_URL()}/rest/v1/rpc/activate_next_production_window`, {
      method: 'POST',
      headers: intel({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ p_activated_by: session.sub || 'sam', p_phrase: phrase, p_days: 7 }),
    });
    const data = await r.json().catch(() => null) as { message?: string } | null;
    if (!r.ok) {
      const msg = String(data?.message ?? '');
      if (msg.includes('VENTANA_YA_ACTIVA')) return res.status(409).json({ error: 'ventana_ya_activa', detail: msg });
      return res.status(502).json({ error: 'activate_failed', status: r.status, detail: msg });
    }
    return res.status(200).json({ ok: true, window: data });
  } catch (err) {
    return res.status(502).json({ error: 'activate_failed', message: err instanceof Error ? err.message : String(err) });
  }
}
