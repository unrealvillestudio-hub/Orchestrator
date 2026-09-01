/**
 * UNRLVL Orchestrator — api/_brandLanguage.ts
 *
 * EN QUÉ IDIOMA SE LEE UNA PIEZA EN VOZ ALTA, resuelto por dato y no por código.
 *
 * EL DEFECTO QUE CIERRA. El lector en voz alta no recibía ningún idioma sugerido, así que caía
 * en la voz `default` del sistema del operador: una pieza en español se leía con voz inglesa.
 * El idioma no estaba en ninguna parte del contrato de la pieza — no porque no exista, sino
 * porque nadie lo bajaba: `public.brands` lo declara por marca desde antes de este cambio.
 *
 * LA REGLA DE RESOLUCIÓN, y por qué en ese orden:
 *   1. `voicelab_language` — la forma completa (`es-ES`, `en-US`) cuando está poblada. Es más
 *      específica, y una voz regional acierta más que un prefijo suelto.
 *   2. `language_primary`  — el prefijo (`es`, `en`). Siempre poblado.
 *   3. `null`              — la marca no está en el catálogo. El lector cae entonces en la voz
 *      del sistema, que es exactamente lo que hacía antes: degradar, nunca inventar.
 *
 * SOBRE EL PASO 3 Y LA FILA `DEFAULT`. El catálogo tiene una fila con ese id. NO se usa como
 * respaldo a propósito: escribir ese identificador en el código sería enumerar una instancia
 * —un id concreto de una tabla— dentro de una capa que sirve a N marcas. Una marca sin idioma
 * declarado se arregla sembrando su fila, no editando este archivo.
 *
 * NINGÚN IDIOMA APARECE EN ESTE ARCHIVO. Ni `es`, ni `en`, ni una tabla de equivalencias: los
 * valores son dato, salen de `public.brands` en runtime y se resuelven por `brand_id`. Una
 * marca de otro rubro y otro país entra sembrando una fila.
 */

import { SB_URL, SB_KEY } from './_calibrationShared.js';

/** Tope de lectura del catálogo. Marcas, no piezas: el orden de magnitud es decenas. */
export const BRANDS_CAP = 500;

/** Fila cruda de `public.brands` (sólo las dos columnas que declaran idioma). */
interface BrandLanguageRow {
  id?: string | null;
  language_primary?: string | null;
  voicelab_language?: string | null;
}

/**
 * Idioma de lectura por `brand_id`. `null` = el catálogo no se pudo leer; en ese caso NADA se
 * sugiere y el lector usa la voz del sistema. `null` y «catálogo vacío» son lo mismo para el
 * consumidor, pero no para el diagnóstico: el fallo se registra en el log.
 */
export type BrandLanguageCatalog = Record<string, string> | null;

function publicHeaders(): Record<string, string> {
  return { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Accept-Profile': 'public' };
}

const clean = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};

/** Indexa las filas del catálogo. Puro: la prueba lo ejercita sin red. */
export function indexBrandLanguages(rows: BrandLanguageRow[]): BrandLanguageCatalog {
  const byBrand: Record<string, string> = {};
  for (const row of rows) {
    const id = clean(row?.id);
    if (!id) continue;
    // La forma completa gana a la del prefijo: más específica, mejor voz.
    const lang = clean(row?.voicelab_language) ?? clean(row?.language_primary);
    if (lang) byBrand[id] = lang;
  }
  return byBrand;
}

/**
 * Lee el catálogo una vez por request, igual que los topes de canal y las firmas
 * (`_pieceMetrics`). Degrada a `null` sin lanzar: que el lector no sepa el idioma no puede
 * tumbar la bandeja entera.
 */
export async function fetchBrandLanguages(): Promise<BrandLanguageCatalog> {
  const url = `${SB_URL()}/rest/v1/brands?select=id,language_primary,voicelab_language&limit=${BRANDS_CAP}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: publicHeaders() });
  } catch {
    console.warn('[brand-language] brands no disponible (red) — sin idioma sugerido');
    return null;
  }
  if (!res.ok) {
    console.warn(`[brand-language] brands no disponible (${res.status}) — sin idioma sugerido`);
    return null;
  }
  const rows = (await res.json().catch(() => [])) as BrandLanguageRow[];
  return indexBrandLanguages(Array.isArray(rows) ? rows : []);
}

/** El idioma de lectura de una pieza, por su marca. `null` cuando no hay nada que sugerir. */
export function readingLanguageOf(
  brandId: string | null | undefined,
  catalog: BrandLanguageCatalog,
): string | null {
  if (!catalog) return null;
  const id = clean(brandId);
  if (!id) return null;
  return catalog[id] ?? null;
}
