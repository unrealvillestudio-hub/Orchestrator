/**
 * UNRLVL Orchestrator — api/production-window.ts
 *
 * LA VENTANA DE PRODUCCIÓN. Sam, 2026-11-09: «Activa la producción que haga falta para lo que se
 * necesita en los próximos 7 días.» Sam, 2026-11-17: «la función me permita activarla para los próximos
 * 3 días... no 7», y sólo para las marcas que elija. El carril produce para cada marca sólo hasta el fin
 * de su ventana (`intel.v_carril_entrada`, migraciones `20261109120000` y `20261117210000` de
 * unrlvl-iid-functions).
 *
 * GET  /api/production-window
 *   → { window: <global> | null, brands: BrandWindow[] | null, source }
 *   `brands` sale de `intel.v_production_windows_by_brand` (una fila por marca con canal activo). Sin esa
 *   vista (migración sin aplicar) `brands` es null y el aviso pinta sólo la global, como antes.
 *   Auth: cualquier sesión de revisión (el aviso se ve en todas las bandejas).
 *
 * POST /api/production-window  { brand_ids?: string[], phrase?: string }
 *   Auth: sólo admin. Con `brand_ids`, activa la siguiente ventana de cada marca; sin ellas, la global.
 *   NO manda `p_days`: la duración vive en la base (`intel.production_window_days()`, 3 días).
 *   Una marca que aún no está en la víspera responde VENTANA_YA_ACTIVA y las demás siguen.
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
export const FRASE_DEL_BOTON = 'Activar los siguientes días de producción (botón del Orchestrator)';

type Resultado = { brand_id: string | null; ok: boolean; window?: unknown; error?: string; detail?: string };

async function leer(vista: string): Promise<{ status: number; rows: unknown[] }> {
  const r = await fetchWithTimeout('db', `${SB_URL()}/rest/v1/${vista}?select=*`, { headers: intel() });
  if (!r.ok) return { status: r.status, rows: [] };
  const rows = (await r.json().catch(() => [])) as unknown[];
  return { status: r.status, rows: Array.isArray(rows) ? rows : [] };
}

async function activar(brandId: string | null, by: string, phrase: string): Promise<Resultado> {
  const args: Record<string, unknown> = { p_activated_by: by, p_phrase: phrase };
  if (brandId) args.p_brand_id = brandId;
  const r = await fetchWithTimeout('db', `${SB_URL()}/rest/v1/rpc/activate_next_production_window`, {
    method: 'POST',
    headers: intel({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(args),
  });
  const data = await r.json().catch(() => null) as { message?: string } | null;
  if (r.ok) return { brand_id: brandId, ok: true, window: data };
  const msg = String(data?.message ?? '');
  if (msg.includes('VENTANA_YA_ACTIVA')) return { brand_id: brandId, ok: false, error: 'ventana_ya_activa', detail: msg };
  return { brand_id: brandId, ok: false, error: 'activate_failed', detail: msg || `HTTP ${r.status}` };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'GET o POST' });

  let body: { phrase?: string; brand_ids?: unknown; session_token?: string } = {};
  if (req.method === 'POST') {
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); } catch { /* vacío */ }
  }
  const session = await requireReviewer(req, res, extractToken(req, body));
  if (!session) return;

  if (req.method === 'GET') {
    try {
      const [global, porMarca] = await Promise.all([leer('v_production_window'), leer('v_production_windows_by_brand')]);
      // Sin la vista global (migración sin aplicar) el aviso no se pinta: `window: null` + `source`.
      if (global.status === 404) return res.status(200).json({ window: null, brands: null, source: 'unavailable' });
      if (global.status >= 400) return res.status(502).json({ error: 'window_read_failed', status: global.status });
      return res.status(200).json({
        window: global.rows[0] ?? null,
        brands: porMarca.status < 400 ? porMarca.rows : null,
        source: 'db',
      });
    } catch (err) {
      return res.status(502).json({ error: 'window_read_failed', message: err instanceof Error ? err.message : String(err) });
    }
  }

  if (!esAdmin(session.role)) return res.status(403).json({ error: 'solo_admin', detail: 'Sólo Sam activa la producción.' });
  const phrase = typeof body.phrase === 'string' && body.phrase.trim() ? body.phrase.trim().slice(0, 500) : FRASE_DEL_BOTON;
  const by = session.sub || 'sam';

  const pedidas = Array.isArray(body.brand_ids)
    ? [...new Set(body.brand_ids.filter((b): b is string => typeof b === 'string' && b.trim() !== '').map((b) => b.trim()))]
    : null;

  try {
    if (!pedidas) {
      const r = await activar(null, by, phrase);
      if (r.ok) return res.status(200).json({ ok: true, window: r.window, results: [r] });
      return res.status(r.error === 'ventana_ya_activa' ? 409 : 502).json({ error: r.error, detail: r.detail, results: [r] });
    }
    if (pedidas.length === 0) return res.status(400).json({ error: 'sin_marcas', detail: 'Elige al menos una marca.' });

    // Sólo marcas que la base conoce como marcas con canal activo: un nombre mal escrito no crea una fila.
    const conocidas = await leer('v_production_windows_by_brand');
    if (conocidas.status >= 400) {
      return res.status(502).json({ error: 'brands_unavailable', detail: 'La vista por marca no está disponible: falta aplicar la migración 20261117210000.' });
    }
    const validas = new Set((conocidas.rows as { brand_id?: string }[]).map((r) => r.brand_id).filter(Boolean));
    const desconocidas = pedidas.filter((b) => !validas.has(b));
    if (desconocidas.length) return res.status(400).json({ error: 'marca_desconocida', detail: desconocidas.join(', ') });

    const results: Resultado[] = [];
    for (const b of pedidas) results.push(await activar(b, by, phrase));
    const algunaOk = results.some((r) => r.ok);
    const todasYaActivas = results.every((r) => r.error === 'ventana_ya_activa');
    return res.status(algunaOk ? 200 : todasYaActivas ? 409 : 502).json({ ok: algunaOk, results });
  } catch (err) {
    return res.status(502).json({ error: 'activate_failed', message: err instanceof Error ? err.message : String(err) });
  }
}
