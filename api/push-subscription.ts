/**
 * UNRLVL Orchestrator — api/push-subscription.ts
 *
 * AVISOS PUSH PROPIOS (Sam, 2026-11-12). La campanita del Orchestrator suscribe este dispositivo al push propio.
 *
 * GET    /api/push-subscription                → { public_key: string | null, source }
 *   La llave PÚBLICA de firma del canal `web_push` (`alerting.alert_channels.config.vapid_public_key`). `null`
 *   si el canal aún no existe (migración sin aplicar): la campanita lo dice y no intenta suscribir.
 * POST   /api/push-subscription  { subscription, user_agent? } → { ok: true }
 *   Guarda o renueva la suscripción de ESTE dispositivo para el operador de la sesión (upsert por endpoint).
 * DELETE /api/push-subscription  { endpoint }   → { ok: true }
 *   La desactiva (no la borra: queda la historia de entregas). Sólo la del propio operador.
 *
 * Auth: cualquier sesión de revisión. Quién recibe avisos no lo decide esta ruta: lo decide la ruta de alertas
 * del operador (`alerting.alert_routes`). El `operator_sub` sale de la sesión verificada, nunca del cuerpo.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, extractToken, SB_URL, SB_KEY } from './_calibrationShared.js';
import { requireReviewer } from './_reviewScope.js';
import { fetchWithTimeout } from './_fetchWithTimeout.js';
import { filaDeSuscripcion, llavePublicaDelCanal, type SuscripcionDelNavegador } from './_pushSubscription.js';

const alerting = (extra: Record<string, string> = {}) => ({
  apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`,
  'Accept-Profile': 'alerting', 'Content-Profile': 'alerting', ...extra,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'POST', 'DELETE'].includes(req.method ?? '')) return res.status(405).json({ error: 'GET, POST o DELETE' });

  let body: { subscription?: SuscripcionDelNavegador; user_agent?: string; endpoint?: string; session_token?: string } = {};
  if (req.method !== 'GET') {
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); } catch { /* vacío */ }
  }
  const session = await requireReviewer(req, res, extractToken(req, body));
  if (!session) return;

  try {
    if (req.method === 'GET') {
      const r = await fetchWithTimeout('db',
        `${SB_URL()}/rest/v1/alert_channels?transport=eq.web_push&active=eq.true&select=config&limit=1`,
        { headers: alerting() });
      if (!r.ok) return res.status(200).json({ public_key: null, source: 'unavailable', status: r.status });
      const key = llavePublicaDelCanal(await r.json().catch(() => []));
      return res.status(200).json({ public_key: key, source: key ? 'db' : 'unavailable' });
    }

    if (req.method === 'POST') {
      const v = filaDeSuscripcion(session.sub, body.subscription, body.user_agent);
      if ('error' in v) return res.status(400).json({ error: 'suscripcion_invalida', detail: v.error });
      const r = await fetchWithTimeout('db', `${SB_URL()}/rest/v1/push_subscriptions?on_conflict=endpoint`, {
        method: 'POST',
        headers: alerting({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(v.fila),
      });
      if (!r.ok) {
        return res.status(502).json({ error: 'suscripcion_no_guardada', status: r.status, detail: (await r.text()).slice(0, 200) });
      }
      return res.status(200).json({ ok: true });
    }

    // DELETE
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : '';
    if (!endpoint) return res.status(400).json({ error: 'falta_endpoint' });
    const r = await fetchWithTimeout('db',
      `${SB_URL()}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}` +
      `&operator_sub=eq.${encodeURIComponent(session.sub)}`, {
        method: 'PATCH',
        headers: alerting({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
        body: JSON.stringify({ active: false }),
      });
    if (!r.ok) return res.status(502).json({ error: 'baja_no_guardada', status: r.status });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(502).json({ error: 'push_subscription_failed', message: err instanceof Error ? err.message : String(err) });
  }
}
