/**
 * UNRLVL Orchestrator — api/manual-published.ts  (PUBLICACIÓN MANUAL · «Publicada»)
 *
 * Sam publicó a mano la pieza de una franja y lo dice aquí, con el link del post como prueba.
 * Deja el mismo rastro que deja el drenaje cuando publica:
 *   1. la franja → `published` (sólo si seguía `manual_pending` o `reserved`: no se pisa nada);
 *   2. la pieza  → `published`, con `published_at` y `post_url`;
 *   3. una fila `PUBLISHED` en `intel.brand_publish_drain_log` con el link en `platform_post_id`
 *      (es la que lee el resto del carril, y dispara el acuse `PUBLISH_OK`);
 *   4. el aviso `MANUAL_PUBLICATION_PENDING` de esa franja se cierra: «es lo único que lo cierra»
 *      decía su remediación, y marcar la pieza publicada es exactamente ese gesto.
 *
 * Sólo canales cuyo `publication_path` es manual. Una franja de un canal del drenaje no se marca
 * desde aquí: el drenaje la publicaría igual y saldría dos veces.
 *
 * POST /api/manual-published   { slot_id, link }
 *   Auth: admin JWT. 200 { ok, slot_id, piece_id, published_at, warnings[] }
 *   400 link inválido · 404 franja inexistente · 409 la franja ya no está pendiente o no es manual.
 */

import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, extractToken, requireAdmin, SB_URL, SB_KEY } from './_calibrationShared.js';
import { fetchWithTimeout } from './_fetchWithTimeout.js';
import { cleanPostLink, manualDrainRow, MARKABLE_SLOT_STATUSES } from './_manualShared.js';

type Schema = 'intel' | 'content' | 'alerting';

async function rest<T>(schema: Schema, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetchWithTimeout('db', `${SB_URL()}/rest/v1/${path}`, {
    method: init.method ?? 'GET',
    headers: {
      apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`,
      'Accept-Profile': schema, 'Content-Profile': schema,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const txt = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`${schema}/${path.split('?')[0]} ${res.status}: ${txt.slice(0, 200)}`);
  return (txt ? JSON.parse(txt) : []) as T;
}

interface SlotRow { id: string; brand_id: string; platform_key: string; slot_at: string; status: string; piece_id: string | null }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body: { slot_id?: string; link?: string; session_token?: string } = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); } catch { /* vacío */ }

  const session = requireAdmin(req, res, extractToken(req, body));
  if (!session) return;

  const slotId = typeof body.slot_id === 'string' ? body.slot_id.trim() : '';
  if (!/^[0-9a-f-]{36}$/i.test(slotId)) return res.status(400).json({ error: 'slot_id required' });
  const link = cleanPostLink(body.link);
  if (!link) {
    return res.status(400).json({ error: 'link_required', detail: 'Pega el link del post publicado (https://…). Es la prueba de que salió.' });
  }

  try {
    const [slot] = await rest<SlotRow[]>('intel', `brand_publish_slots?id=eq.${slotId}&select=id,brand_id,platform_key,slot_at,status,piece_id&limit=1`);
    if (!slot) return res.status(404).json({ error: 'slot_not_found' });
    if (!slot.piece_id || !(MARKABLE_SLOT_STATUSES as readonly string[]).includes(slot.status)) {
      return res.status(409).json({ error: 'slot_not_pending', detail: `La franja está en estado «${slot.status}»: ya no espera publicación.` });
    }
    const manual = await rest<unknown[]>('intel',
      `brand_publish_channels?brand_id=eq.${encodeURIComponent(slot.brand_id)}&platform_key=eq.${encodeURIComponent(slot.platform_key)}`
      + `&publication_path=eq.manual&select=brand_id&limit=1`);
    if (!manual.length) {
      return res.status(409).json({ error: 'channel_not_manual', detail: 'Este canal lo publica el drenaje; marcarlo a mano lo publicaría dos veces.' });
    }

    const at = new Date().toISOString();
    const pieceId = slot.piece_id;

    // 1 · La franja. El filtro de estado es la guarda: si otra pestaña ya la marcó, no hay fila.
    const sealed = await rest<SlotRow[]>('intel',
      `brand_publish_slots?id=eq.${slotId}&piece_id=eq.${pieceId}&status=in.(${MARKABLE_SLOT_STATUSES.join(',')})`,
      { method: 'PATCH', body: { status: 'published', published_at: at, failed_reason: null, updated_at: at } });
    if (!sealed.length) return res.status(409).json({ error: 'slot_not_pending', detail: 'La franja cambió mientras tanto: ya no espera publicación.' });

    const warnings: string[] = [];

    // 2 · La pieza.
    try {
      const p = await rest<unknown[]>('content', `content_pieces?id=eq.${pieceId}&status=eq.scheduled`,
        { method: 'PATCH', body: { status: 'published', published_at: at, post_url: link } });
      if (!p.length) warnings.push('La pieza no estaba en `scheduled`: su estado no se cambió.');
    } catch (e) { warnings.push(`PIECE_NOT_SEALED: ${String(e instanceof Error ? e.message : e)}`); }

    // 3 · La bitácora.
    try {
      await rest('intel', 'brand_publish_drain_log', {
        method: 'POST',
        body: manualDrainRow({ ...slot, piece_id: pieceId }, link, randomUUID(), at),
      });
    } catch (e) { warnings.push(`DRAIN_LOG_NOT_WRITTEN: ${String(e instanceof Error ? e.message : e)}`); }

    // 4 · El aviso de esa franja.
    try {
      const closed = await rest<Array<{ id: string; public_ref: string | null }>>('alerting',
        `alert_events?rule_code=eq.MANUAL_PUBLICATION_PENDING&dedupe_key=eq.${slotId}&state=not.in.(resolved,expired)`,
        { method: 'PATCH', body: { state: 'resolved', resolved_at: at, next_notify_at: null } });
      for (const ev of closed) {
        await rest('alerting', 'alert_action_log', {
          method: 'POST',
          body: { event_id: ev.id, action: 'admin', accepted: true, from_ref: 'orchestrator',
            reason: `Publicada a mano y marcada desde el Orchestrator (${ev.public_ref ?? ev.id})` },
        }).catch(() => {});
      }
    } catch (e) { warnings.push(`ALERT_NOT_CLOSED: ${String(e instanceof Error ? e.message : e)}`); }

    if (warnings.length) console.warn(`[manual-published] slot=${slotId} ${warnings.join(' | ')}`);
    return res.status(200).json({ ok: true, slot_id: slotId, piece_id: pieceId, published_at: at, warnings });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[manual-published]', message);
    return res.status(500).json({ error: 'manual_published_failed', message });
  }
}
