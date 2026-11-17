/**
 * EL ESTADO DE UN ESTILO DE TEXTO DE VIDEOLAB (Sam, 2026-11-17).
 *
 * POST /api/text-preset-status { preset_key, brand_id, action: 'validate' | 'retire' | 'reactivate', session_token? }
 *   → { ok: true, preset_key, status, brand_override, status_changed_at, status_changed_by }
 *
 * Decisiones de Sam (2026-11-17): sólo un admin cambia el estado; vale para todas las marcas (se cambia la fila que el
 * selector le muestra a la marca, que hoy es siempre la de sistema); se incluye «Retirar»; se registra quién y cuándo
 * en `status_changed_by` / `status_changed_at` (unrlvl-iid-functions, migración 20261117183000).
 *
 * La escritura lleva ancla en el estado leído (`status=eq.<leído>`): si otra mano lo cambió entretanto, no se pisa y
 * responde 409. Ni una marca, ni un estilo con nombre propio en este archivo: todo sale de la fila.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, extractToken, SB_URL, SB_KEY } from './_calibrationShared.js';
import { fetchWithTimeout } from './_fetchWithTimeout.js';
import { requireReviewer, esAdmin } from './_reviewScope.js';
import { nextPresetStatus, presetRowToChange, PRESET_STATUS_ACTIONS } from './_pieceText.js';

const H = (extra: Record<string, string> = {}) => ({ apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Accept-Profile': 'public', ...extra });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body: { preset_key?: unknown; brand_id?: unknown; action?: unknown; session_token?: string } = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); } catch { /* vacío */ }
  const session = await requireReviewer(req, res, extractToken(req, body));
  if (!session) return;
  if (!esAdmin(session.role)) {
    return res.status(403).json({ error: 'forbidden', detail: 'Sólo un admin valida, retira o reactiva un estilo: el cambio vale para todas las marcas.' });
  }

  const presetKey = typeof body.preset_key === 'string' ? body.preset_key.trim() : '';
  const brandId = typeof body.brand_id === 'string' ? body.brand_id.trim() : '';
  if (!presetKey || !brandId) return res.status(400).json({ error: 'bad_request', detail: 'faltan preset_key o brand_id' });
  if (!(PRESET_STATUS_ACTIONS as readonly unknown[]).includes(body.action)) {
    return res.status(400).json({ error: 'bad_request', detail: `action debe ser ${PRESET_STATUS_ACTIONS.join(', ')}` });
  }

  try {
    const q = `videolab_text_presets?preset_key=eq.${encodeURIComponent(presetKey)}`
      + `&or=(brand_id.is.null,brand_id.eq.${encodeURIComponent(brandId)})&select=id,preset_key,brand_id,active,status`;
    const r = await fetchWithTimeout('db', `${SB_URL()}/rest/v1/${q}`, { headers: H() });
    if (!r.ok) throw new Error(`lectura HTTP ${r.status}`);
    const fila = presetRowToChange(await r.json(), presetKey, brandId);
    if (!fila) return res.status(404).json({ error: 'preset_not_found', detail: `no hay un estilo activo «${presetKey}» para esta marca ni de sistema` });

    const siguiente = nextPresetStatus(body.action, fila.status);
    if (!siguiente.ok) return res.status(409).json({ error: 'invalid_transition', detail: siguiente.reason, status: fila.status ?? null });

    const ahora = new Date().toISOString();
    const quien = session.sub || 'admin';
    const ancla = fila.status == null ? 'status=is.null' : `status=eq.${encodeURIComponent(fila.status)}`;
    const w = await fetchWithTimeout('db', `${SB_URL()}/rest/v1/videolab_text_presets?id=eq.${encodeURIComponent(fila.id)}&${ancla}`, {
      method: 'PATCH',
      headers: H({ 'Content-Type': 'application/json', 'Content-Profile': 'public', Prefer: 'return=representation' }),
      body: JSON.stringify({ status: siguiente.status, status_changed_at: ahora, status_changed_by: quien }),
    });
    if (!w.ok) throw new Error(`escritura HTTP ${w.status} ${(await w.text().catch(() => '')).slice(0, 200)}`);
    const escritas = await w.json().catch(() => []);
    if (!Array.isArray(escritas) || escritas.length !== 1) {
      return res.status(409).json({ error: 'status_changed', detail: 'el estado del estilo cambió mientras tanto: no se pisó. Vuelve a abrir la ventana.' });
    }
    console.log(`[text-preset-status] ${quien} ${String(body.action)} ${presetKey} (${fila.brand_id ?? 'sistema'}): ${fila.status} → ${siguiente.status}`);
    return res.status(200).json({
      ok: true, preset_key: presetKey, status: siguiente.status, brand_override: fila.brand_id === brandId,
      status_changed_at: ahora, status_changed_by: quien,
    });
  } catch (err) {
    console.error(`[text-preset-status] ${presetKey}: ${String(err)}`);
    return res.status(503).json({ error: 'preset_status_unavailable', detail: String(err instanceof Error ? err.message : err) });
  }
}
