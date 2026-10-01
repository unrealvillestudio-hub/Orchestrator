/**
 * UNRLVL Orchestrator — api/manual-queue.ts  (PUBLICACIÓN MANUAL · SOLO LECTURA)
 *
 * Lo que Sam tiene que publicar A MANO: las franjas con pieza de los canales cuyo camino de
 * publicación es manual, con el texto completo y las fotos de cada una. No escribe nada.
 *
 * Qué canal es manual lo dice `intel.brand_publish_channels.publication_path` — dato, no código.
 * Entran las franjas `manual_pending` (la hora ya pasó y el drenaje la dejó para Sam) y las
 * `reserved` de esos mismos canales (la que viene, para prepararla). Ver `_manualShared.ts`.
 *
 * GET /api/manual-queue?brand=&channel=
 *   Auth: admin JWT vía `Authorization: Bearer <session_token>`.
 *   `by_brand` y `by_channel` se cuentan ANTES de filtrar: las pastillas dicen siempre el total.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, extractToken, requireAdmin, SB_URL, SB_KEY } from './_calibrationShared.js';
import { fetchWithTimeout } from './_fetchWithTimeout.js';
import { fetchBrandTimezones } from './_publishSlots.js';
import {
  buildManualItems, manualChannelKey,
  type ManualPieceInput, type ManualSlotRow,
} from './_manualShared.js';

const CAP = 1000;
/** Estados de franja con pieza que todavía no salió. Son estados del carril, no de una marca. */
const SLOT_STATUSES = ['manual_pending', 'reserved'];

function headers(profile: 'intel' | 'content'): Record<string, string> {
  return { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Accept-Profile': profile };
}

async function getJson<T>(url: string, profile: 'intel' | 'content', what: string): Promise<T> {
  const res = await fetchWithTimeout('db', url, { headers: headers(profile) });
  if (!res.ok) throw new Error(`${what} read failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return (await res.json().catch(() => [])) as T;
}

function strParam(v: unknown): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.trim() ? s.trim() : undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const session = requireAdmin(req, res, extractToken(req));
  if (!session) return;

  const brand = strParam(req.query.brand);
  const channel = strParam(req.query.channel);

  try {
    const [channels, slots, timezones] = await Promise.all([
      getJson<Array<{ brand_id: string; platform_key: string }>>(
        `${SB_URL()}/rest/v1/brand_publish_channels?publication_path=eq.manual&active=is.true`
          + `&select=brand_id,platform_key&limit=${CAP}`,
        'intel', 'brand_publish_channels'),
      getJson<ManualSlotRow[]>(
        `${SB_URL()}/rest/v1/brand_publish_slots?status=in.(${SLOT_STATUSES.join(',')})&piece_id=not.is.null`
          + `&select=id,brand_id,platform_key,slot_at,status,piece_id&order=slot_at.asc&limit=${CAP}`,
        'intel', 'brand_publish_slots'),
      fetchBrandTimezones(),
    ]);

    const manual = new Set(channels.map((c) => manualChannelKey(c.brand_id, c.platform_key)));
    const enManual = slots.filter((s) => manual.has(manualChannelKey(s.brand_id, s.platform_key)));

    const ids = Array.from(new Set(enManual.map((s) => s.piece_id).filter((x): x is string => !!x)));
    const pieces = new Map<string, ManualPieceInput>();
    if (ids.length) {
      const list = encodeURIComponent(ids.map((id) => `"${id}"`).join(','));
      const rows = await getJson<ManualPieceInput[]>(
        `${SB_URL()}/rest/v1/content_pieces?id=in.(${list})&discarded_at=is.null`
          + `&select=id,brand_id,platform,format,assets&limit=${CAP}`,
        'content', 'content_pieces');
      for (const p of rows) pieces.set(p.id, p);
    }

    const all = buildManualItems(enManual, manual, pieces, timezones, new Date());

    const by_brand: Record<string, number> = {};
    const by_channel: Record<string, number> = {};
    for (const it of all) {
      by_brand[it.brand_id] = (by_brand[it.brand_id] ?? 0) + 1;
      by_channel[it.platform_key] = (by_channel[it.platform_key] ?? 0) + 1;
    }

    const items = all.filter((it) =>
      (!brand || it.brand_id === brand) && (!channel || it.platform_key === channel));

    return res.status(200).json({ total: items.length, by_brand, by_channel, items });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[manual-queue]', message);
    return res.status(500).json({ error: 'manual_queue_failed', message });
  }
}
