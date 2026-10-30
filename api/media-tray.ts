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
 *
 * ── CAMBIOS (2026-10-30) · LA ZONA DE ENTRADA ESTÁ EN UN BUCKET PRIVADO ──────────────────────
 *
 * La bandeja ya no mira `unrlvl-media`: mira **los buckets que declaran las filas de los
 * principales** (`intel.media_principals.allowed_bucket`), que desde `unrlvl-iid-functions#537` es
 * el privado `unrlvl-media-staging`. Dos consecuencias visibles en la respuesta:
 *
 *   · cada item trae su **`bucket`**, porque la ruta sola ya no dice dónde vive el objeto;
 *   · la **`url` es firmada y temporal**, y puede venir `null`. Una URL pública contra un bucket
 *     privado devuelve 400 y el navegador pinta un hueco, así que lo que no se pudo firmar se
 *     CUENTA en `sin_url` en vez de salir como una URL que no abre.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, extractToken, SB_URL, SB_KEY } from './_calibrationShared.js';
import { requireReviewer, filterByReviewScope } from './_reviewScope.js';
import { fetchWithTimeout } from './_fetchWithTimeout.js';
import { bucketsDeAterrizaje, objetosBajo, urlesFirmadas, MAX_FIRMAS } from './_mediaStore.js';
import {
  ZONA_DE_ENTRADA, marcaDeLaRuta, diasEsperando, type EnBandeja,
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
    // LOS BUCKETS SALEN DE LA FILA, NO DEL CÓDIGO. Si esta lectura falla, el `catch` de abajo
    // responde 502: mirar el bucket equivocado devolvería una bandeja vacía, que no es un error a
    // la vista.
    const buckets = await bucketsDeAterrizaje();

    const objetos: Array<{ bucket: string; name: string; created_at: string | null; bytes: number | null; mime: string | null }> = [];
    for (const b of buckets) {
      for (const o of await objetosBajo(b, ZONA_DE_ENTRADA)) objetos.push({ bucket: b, ...o });
      if (objetos.length >= CAP) break;
    }
    objetos.length = Math.min(objetos.length, CAP);

    // Quién pidió el permiso de cada objeto. Es dato del corredor, escrito por el corredor.
    // `intel.media_grants` guarda la ruta y no el bucket, así que el cruce es por ruta: hoy hay un
    // solo bucket de aterrizaje y no hay ambigüedad. Si algún día hay dos, esta lectura necesita
    // que la concesión declare su bucket — queda dicho aquí y no se supone resuelto.
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

    // LAS FIRMAS. Se piden por bucket y con tope: lo que pase del tope llega sin URL y se cuenta.
    const firmas = new Map<string, string>();
    let firmadas = 0;
    for (const b of buckets) {
      const delBucket = objetos.filter((o) => o.bucket === b).map((o) => o.name).slice(0, Math.max(0, MAX_FIRMAS - firmadas));
      if (!delBucket.length) continue;
      for (const [ruta, url] of await urlesFirmadas(b, delBucket)) firmas.set(`${b}/${ruta}`, url);
      firmadas += delBucket.length;
    }

    const todos = objetos
      .map((o) => {
        const marca = marcaDeLaRuta(o.name);
        if (!marca) return null;                       // una ruta que no se entiende no se decide
        const c = porRuta.get(o.name);
        const previo = decididos.get(o.name);
        const fila: Omit<EnBandeja, 'url'> & { brand_id: string; bucket: string; url: string | null; decidido?: unknown } = {
          object_path: o.name,
          brand_id: marca,
          bucket: o.bucket,
          subido_por: c?.principal_key ?? null,
          subido_en: o.created_at,
          bytes: o.bytes,
          mime: o.mime,
          // Firmada y temporal. `null` = no se pudo firmar: se cuenta, no se disfraza.
          url: firmas.get(`${o.bucket}/${o.name}`) ?? null,
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

    const sinUrl = items.filter((i) => !i.url).length;

    return res.status(200).json({
      total: items.length,
      // Nada caduca solo en esta zona: lo que lleva más de una semana esperando se cuenta aparte.
      esperando: items.filter((i) => (i.dias_esperando ?? 0) >= 7).length,
      by_brand,
      items,
      // De dónde se leyó, para que una bandeja vacía se pueda distinguir de una bandeja que miró
      // al bucket equivocado.
      buckets,
      // Cuántas tarjetas llegan sin imagen porque su firma no se pudo emitir. Cero es lo normal.
      sin_url: sinUrl,
      ...(sinUrl ? {
        aviso_firmas: `${sinUrl} de ${items.length} objetos llegan sin URL firmada: la tarjeta no `
                    + 'puede mostrar la imagen. No se decide sobre lo que no se ve.',
      } : {}),
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
