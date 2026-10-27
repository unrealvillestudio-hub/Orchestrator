/**
 * UNRLVL Orchestrator — api/media-tray.ts  (LA BANDEJA DE MEDIOS · SOLO LECTURA)
 *
 * Lo que un agente subió a `staging/` y espera una decisión humana. No escribe nada.
 *
 * QUÉ ACOMPAÑA A CADA IMAGEN, Y POR QUÉ ESO Y NO OTRA COSA. La tarjeta muestra el artefacto —la
 * imagen misma— y a su lado sólo lo que el agente NO puede falsificar: qué principal pidió el
 * permiso con el que se subió, cuándo, cuánto pesa y cuántos días lleva esperando. Una descripción
 * escrita por quien subió el archivo convertiría la aprobación en aprobar sus palabras.
 *
 * GET /api/media-tray
 *   Auth: JWT de sesión. Vista `media_promotion`; admin ve todo, un revisor sólo sus marcas.
 *   200 { total, esperando, by_brand, items[], decisiones_legibles, aviso? }
 *
 * `decisiones_legibles: false` significa que el registro de decisiones todavía no existe —esta ruta
 * se despliega ANTES de su DDL, a propósito—. La bandeja se lee igual, pero no se puede decidir, y
 * lo dice en vez de parecer vacía de pendientes.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, extractToken, SB_URL, SB_KEY } from './_calibrationShared.js';
import { requireReviewer, filterByReviewScope } from './_reviewScope.js';
import { fetchWithTimeout } from './_fetchWithTimeout.js';
import { BUCKET, objetosBajo } from './_mediaStore.js';
import {
  ZONA_DE_ENTRADA, marcaDeLaRuta, urlDelObjeto, diasEsperando, type EnBandeja,
} from './_mediaTray.js';

const CAP = 500;

/** Lee de PostgREST devolviendo `null` cuando la relación no existe todavía — no cuando falla. */
async function leerIntel<T>(path: string): Promise<{ filas: T[] | null; ausente: boolean }> {
  const res = await fetchWithTimeout('db', `${SB_URL()}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Accept-Profile': 'intel' },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    // 404 y el `42P01` de PostgREST son «esa relación no existe», que es el estado esperado entre
    // este despliegue y su migración. Un fallo de lectura NO es lo mismo y no se disfraza de vacío.
    const ausente = res.status === 404 || txt.includes('42P01');
    if (ausente) return { filas: null, ausente: true };
    throw new Error(`${path.split('?')[0]} → ${res.status} ${txt.slice(0, 200)}`);
  }
  return { filas: (await res.json().catch(() => [])) as T[], ausente: false };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const session = await requireReviewer(req, res, extractToken(req), ['media_promotion']);
  if (!session) return;

  try {
    const objetos = (await objetosBajo(ZONA_DE_ENTRADA)).slice(0, CAP);

    // Quién pidió el permiso de cada objeto. Es dato del corredor, escrito por el corredor.
    const rutas = objetos.map((o) => o.name);
    let concesiones: Array<{ object_path: string; principal_key: string; issued_at: string }> = [];
    let decididos = new Map<string, { decision: string; outcome: string; decided_at: string }>();
    let decisionesLegibles = true;

    if (rutas.length) {
      const lista = encodeURIComponent(rutas.map((r) => `"${r}"`).join(','));
      const [g, d] = await Promise.all([
        leerIntel<{ object_path: string; principal_key: string; issued_at: string }>(
          `media_grants?object_path=in.(${lista})&outcome=eq.GRANTED`
          + `&select=object_path,principal_key,issued_at&order=issued_at.desc&limit=${CAP}`),
        leerIntel<{ object_path: string; decision: string; outcome: string; decided_at: string }>(
          `media_promotion_decisions?object_path=in.(${lista})`
          + `&select=object_path,decision,outcome,decided_at&order=decided_at.desc&limit=${CAP}`),
      ]);
      concesiones = g.filas ?? [];
      decisionesLegibles = !d.ausente;
      // La primera por objeto es la más reciente: es el estado que importa.
      for (const fila of d.filas ?? []) if (!decididos.has(fila.object_path)) decididos.set(fila.object_path, fila);
    }

    const porRuta = new Map(concesiones.map((c) => [c.object_path, c]));
    const ahora = Date.now();

    const todos = objetos
      .map((o) => {
        const marca = marcaDeLaRuta(o.name);
        if (!marca) return null;                       // una ruta que no se entiende no se decide
        const c = porRuta.get(o.name);
        const previo = decididos.get(o.name);
        const fila: EnBandeja & { brand_id: string; decidido?: unknown } = {
          object_path: o.name,
          brand_id: marca,
          subido_por: c?.principal_key ?? null,
          subido_en: o.created_at,
          bytes: o.bytes,
          mime: o.mime,
          url: urlDelObjeto(SB_URL(), BUCKET, o.name),
          dias_esperando: diasEsperando(o.created_at, ahora),
        };
        // Un intento anterior que no se consumó: se ve, para que no parezca que nadie lo tocó.
        if (previo) fila.decidido = { decision: previo.decision, outcome: previo.outcome, decided_at: previo.decided_at };
        return fila;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    // ALCANCE DE REVISIÓN: un revisor sólo ve lo de sus marcas. Admin, el mismo array.
    const items = filterByReviewScope(todos, session.review);
    const by_brand: Record<string, number> = {};
    for (const it of items) by_brand[it.brand_id] = (by_brand[it.brand_id] ?? 0) + 1;

    return res.status(200).json({
      total: items.length,
      // Nada caduca solo en esta zona: lo que lleva más de una semana esperando se cuenta aparte.
      esperando: items.filter((i) => (i.dias_esperando ?? 0) >= 7).length,
      by_brand,
      items,
      decisiones_legibles: decisionesLegibles,
      ...(decisionesLegibles ? {} : {
        aviso: 'El registro de decisiones todavía no existe: la bandeja se puede leer, pero no se '
             + 'puede decidir. Sin registro no hay promoción.',
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[media-tray] lectura falló:', message);
    return res.status(502).json({ error: 'tray_read_failed', message });
  }
}
