/**
 * brandsLoader.ts — U-9 · EL CATÁLOGO DE MARCAS SALE DEL CÓDIGO.
 *
 * ── EL DEFECTO QUE ESTE ARCHIVO TENÍA, Y POR QUÉ NADIE LO VIO ────────────────────
 * El camino dinámico existía desde el principio y NUNCA se ejecutó con éxito: la consulta
 * pedía una columna `name` que `public.brands` no tiene —se llama `display_name`—, así que
 * PostgREST devolvía un error de columna inexistente, el `catch` lo tragaba y la función
 * devolvía la lista de respaldo. Siempre.
 *
 * Nadie se enteró porque el respaldo funcionaba. Ése es el defecto de fondo y es el que
 * este corte cierra: **no era malo tener respaldo, era imposible distinguirlo del camino
 * bueno.** Por eso ahora la función declara de dónde salieron las marcas, igual que
 * `slots_source` y `cutoffs_source` declaran la suya en los endpoints.
 *
 * ── LO QUE COSTÓ, MEDIDO EL 2026-09-13 ───────────────────────────────────────────
 * La lista escrita a mano tenía once marcas y la base catorce activas. Faltaban cuatro
 * —entre ellas una con piezas y franjas en producción— y sobraba una que la base marca
 * como fusionada. **La marca N+1 ya había entrado y el código no se enteró**, que es
 * exactamente lo que la regla multimarca predice cuando la instancia vive en el código.
 *
 * ── EL FILTRO DE ESTADO ES UNA FRONTERA, NO UNA COMODIDAD ───────────────────────
 * `status=eq.active` es **el único mecanismo** que impide que una marca de perímetro
 * personal o una fusionada aparezcan en una pantalla del ecosistema. No se relaja «para
 * depurar» y no se mueve al cliente: va en la consulta. Si la lectura falla, el sistema NO
 * cae en una lista completa sin filtrar — cae en el respaldo de abajo, que tampoco las
 * contiene.
 */

import { BrandProfile } from '../core/types';
import { fetchWithTimeout } from './fetchWithTimeout';

/**
 * Se leen EN CADA LLAMADA, no una vez al importar el módulo: capturarlas al importar ata el
 * valor al instante en que el bundle se evalúa.
 *
 * Y se consultan en los dos sitios donde pueden estar. En el navegador viven en
 * `import.meta.env`, que es lo que Vite inyecta en el build; fuera del navegador —Node, una
 * prueba, un render en servidor— `import.meta.env` puede no ser el mismo objeto o no
 * existir, y entonces valen las de `process.env`. El acceso a `process` va guardado porque
 * en el navegador no existe y tocarlo sin guarda rompe la página entera.
 */
function env(clave: string): string {
  const viteEnv = (import.meta as any).env;
  if (viteEnv && viteEnv[clave]) return String(viteEnv[clave]);
  if (typeof process !== 'undefined' && process.env && process.env[clave]) return String(process.env[clave]);
  return '';
}
const SB_URL = () => env('VITE_SUPABASE_URL');
const SB_KEY = () => env('VITE_SUPABASE_ANON_KEY');

/**
 * EL COLOR SE DERIVA DEL ID, NO SE LISTA POR MARCA.
 *
 * Antes había un mapa `marca → color` en este archivo: once entradas, una por marca, que
 * es instancia viviendo en el código — el mismo defecto que el resto del corte retira, en
 * pequeño. Una marca nueva salía gris porque nadie se acordaba de añadirla.
 *
 * La REGLA de derivar un tono estable a partir del identificador sí es eje y sí va acá. El
 * mismo id da siempre el mismo color, y una marca nueva tiene el suyo sin tocar una línea.
 * Si algún día `public.brands` gana una columna de color, esa columna manda y esta función
 * pasa a ser el respaldo — no al revés.
 */
export function brandColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  // Saturación y luminosidad fijas: lo que varía es el tono, para que ninguna marca salga
  // ilegible sobre el fondo oscuro por un sorteo desafortunado.
  return `hsl(${h % 360}, 62%, 58%)`;
}

/**
 * RESPALDO — ES UNA FOTO, NO UN CATÁLOGO. Fechado el 2026-09-13.
 *
 * Se recorta al mínimo imprescindible a propósito: lo justo para que la pantalla no quede
 * en blanco mientras alguien arregla la lectura. **Una lista de respaldo que se presenta
 * como catálogo vuelve a desviarse sola**, que es la historia de las once marcas que este
 * corte retira.
 *
 * Cuando se usa, la pantalla LO DICE. Un respaldo silencioso es el defecto, no el respaldo.
 */
export const BRANDS_FALLBACK: BrandProfile[] = [
  { id: 'UnrealvilleStudio', name: 'Unrealville Studio', color: brandColor('UnrealvilleStudio'), market: '', description: '' },
];

/** De dónde salieron las marcas que se están mostrando. */
export interface BrandsResult {
  brands: BrandProfile[];
  source: 'db' | 'fallback';
  /** Por qué se cayó al respaldo. `null` cuando vinieron de la base. */
  reason: string | null;
}

/**
 * Sólo se cachea la lectura BUENA. Cachear el respaldo convertiría un fallo de red de un
 * segundo en un fallo de toda la sesión, y la próxima pantalla heredaría una lista vieja
 * sin volver a intentarlo.
 */
let _brandsCache: BrandProfile[] | null = null;

export async function loadBrands(): Promise<BrandsResult> {
  if (_brandsCache) return { brands: _brandsCache, source: 'db', reason: null };

  if (!SB_URL() || !SB_KEY()) {
    const reason = 'Faltan las variables de entorno de Supabase en este despliegue.';
    console.warn(`[brandsLoader] ${reason} — se usa el respaldo`);
    return { brands: BRANDS_FALLBACK, source: 'fallback', reason };
  }

  try {
    // `display_name`, no `name`: ése era el error que dejaba muerto este camino. Y
    // `status=eq.active` es la frontera de perímetro descrita arriba — no se quita.
    const res = await fetchWithTimeout('db',
      `${SB_URL()}/rest/v1/brands?select=id,display_name,market,status&status=eq.active&order=display_name`,
      { headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}` } }
    );

    if (!res.ok) throw new Error(`Supabase respondió ${res.status}`);

    const rows: Array<{ id: string; display_name: string | null; market: string | null }> = await res.json();
    if (!Array.isArray(rows)) throw new Error('La respuesta de Supabase no es una lista');

    _brandsCache = rows.map((r) => ({
      id:          r.id,
      // Si una fila no tiene nombre para mostrar, se muestra su id: es feo y es honesto.
      // Inventar un nombre haría invisible que a esa fila le falta un dato.
      name:        r.display_name ?? r.id,
      color:       brandColor(r.id),
      market:      r.market ?? '',
      description: '',  // el Orchestrator no lo usa; vive en el contexto de marca
    }));

    return { brands: _brandsCache, source: 'db', reason: null };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error('[brandsLoader] no se pudieron leer las marcas:', reason);
    return { brands: BRANDS_FALLBACK, source: 'fallback', reason };
  }
}

export function getBrandById(brands: BrandProfile[], id: string): BrandProfile | undefined {
  return brands.find((b) => b.id === id);
}

/** Invalida el cache (usar si Sam añade una marca durante la sesión). */
export function invalidateBrandsCache(): void {
  _brandsCache = null;
}
