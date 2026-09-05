/**
 * UNRLVL Orchestrator — api/_publishSlots.ts  (PR-C · la fecha visible en la bandeja)
 *
 * CUÁNDO SALE UNA PIEZA, resuelto en el server y por dato.
 *
 * EL DEFECTO QUE CIERRA. PR-B dejó franjas reservadas en `intel.brand_publish_slots` y
 * ningún sitio donde verlas: el contrato de las dos bandejas no tenía un solo campo de
 * fecha, así que la única forma de saber cuándo sale una pieza era una consulta SQL. No es
 * un defecto introducido: es una capacidad que nunca existió porque hasta PR-B no había
 * fechas que mostrar.
 *
 * DOS COSAS DISTINTAS, DOS NOMBRES DISTINTOS — y no se pueden colapsar:
 *
 *   · `PieceSlot`     — COMPROMISO. La franja que esta pieza tiene reservada. Existe la
 *                       fila en `brand_publish_slots` con su `piece_id`. Se muestra en la
 *                       cola de publicación bajo la etiqueta «Publica:».
 *   · `ForecastSlot`  — PREVISIÓN. La próxima franja LIBRE de la marca × canal de la pieza.
 *                       La pieza todavía no está aprobada, así que no tiene franja: esto es
 *                       dónde CAERÍA si se aprobara ahora, y otra pieza aprobada antes se la
 *                       lleva. Se muestra en calibración bajo «Fecha prevista de publicación:».
 *
 * Llamar «fecha de publicación» a las dos sería tener dos cosas distintas con el mismo
 * nombre, que es el defecto que ya costó dos PR correctivos.
 *
 * ── NI UN HUSO, NI UN DESFASE, NI UNA MARCA EN ESTE ARCHIVO ──────────────────────
 * El huso sale de `public.brands.publish_timezone` por `brand_id`, en runtime, igual que
 * `reading_language` sale de la misma tabla (ver `_brandLanguage.ts`). El nombre IANA es la
 * única forma que sobrevive al cambio de horario: un desfase cableado acertaría hasta
 * noviembre y luego mentiría en silencio — y el `CHECK` de producción ya rechaza los
 * desfases en la base por ese mismo motivo. Una marca nueva entra sembrando su fila.
 *
 * ── ESTE MÓDULO NO ESCRIBE ───────────────────────────────────────────────────────
 * Ni en `brand_publish_slots`, ni en `content_pieces`, ni en ninguna otra tabla. Calcular
 * una previsión NO reserva nada: `forecastFor()` es una función pura sobre filas ya leídas.
 */

import { SB_URL, SB_KEY, type ContentPiece } from './_calibrationShared.js';

/** Tope de lectura de franjas. Franjas de un horizonte de semanas: el orden es de cientos. */
export const SLOTS_CAP = 5000;
/** Tope de lectura del catálogo de marcas. Marcas, no piezas: el orden es de decenas. */
export const BRAND_TZ_CAP = 500;

// ── Fila cruda ───────────────────────────────────────────────────────────────────
/**
 * Una franja de `intel.brand_publish_slots`. `status` viaja como texto a propósito: los
 * valores (`free`, `reserved`, `published`, `failed`) son del CHECK de la tabla, y
 * enumerarlos acá crearía una segunda fuente que diverge en el primer valor nuevo.
 */
export interface PublishSlotRow {
  brand_id: string;
  platform_key: string;
  slot_at: string;
  status: string;
  piece_id: string | null;
}

// ── Lo que viaja a la tarjeta ────────────────────────────────────────────────────
/**
 * La franja RESERVADA de una pieza. `null` en el contrato de la bandeja = la pieza no tiene
 * franja, que es un estado real y visible, no un hueco de datos.
 */
export interface PieceSlot {
  /** Instante UTC, ISO-8601. La pantalla nunca lo muestra crudo: lo sitúa en `timezone`. */
  slot_at: string;
  /** Estado de la franja, tal como lo declara la tabla. */
  status: string;
  /**
   * Huso de la marca, nombre IANA, desde `public.brands.publish_timezone`. `null` = la marca
   * no lo tiene sembrado: la pantalla dice eso y NO sitúa la hora, en vez de inventar un huso
   * o de mostrar UTC como si fuera la hora de alguien.
   */
  timezone: string | null;
}

/**
 * PREVISIÓN, no compromiso: próxima franja libre de la marca × canal de esta pieza.
 * `null` = no hay franja libre futura, o el canal no tiene política sembrada.
 */
export interface ForecastSlot {
  slot_at: string;
  timezone: string | null;
}

// ── Acceso a datos ───────────────────────────────────────────────────────────────
function intelHeaders(): Record<string, string> {
  return { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Accept-Profile': 'intel' };
}
function publicHeaders(): Record<string, string> {
  return { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Accept-Profile': 'public' };
}

const clean = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};

function millis(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * Huso de publicación por `brand_id`. `null` = el catálogo no se pudo leer.
 *
 * Se lee aparte del catálogo de idiomas (`_brandLanguage.ts`) aunque las dos columnas vivan
 * en `public.brands`: son dos ejes distintos —con qué voz se LEE una pieza y en qué huso se
 * PUBLICA— y unirlos ataría el lector en voz alta al calendario. Son dos lecturas de una
 * tabla de decenas de filas por request, no de la tabla de piezas.
 */
export type BrandTimezoneCatalog = Record<string, string> | null;

/** Indexa las filas del catálogo. Puro: la prueba lo ejercita sin red. */
export function indexBrandTimezones(
  rows: Array<{ id?: string | null; publish_timezone?: string | null }>,
): BrandTimezoneCatalog {
  const byBrand: Record<string, string> = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = clean(row?.id);
    const tz = clean(row?.publish_timezone);
    if (id && tz) byBrand[id] = tz;
  }
  return byBrand;
}

/**
 * Lee el catálogo una vez por request. Degrada a `null` sin lanzar: que no se sepa el huso
 * no puede tumbar la bandeja entera — se muestra la ausencia y se nombra la columna que
 * falta sembrar.
 */
export async function fetchBrandTimezones(): Promise<BrandTimezoneCatalog> {
  const url = `${SB_URL()}/rest/v1/brands?select=id,publish_timezone&limit=${BRAND_TZ_CAP}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: publicHeaders() });
  } catch {
    console.warn('[publish-slots] brands no disponible (red) — sin huso de publicación');
    return null;
  }
  if (!res.ok) {
    console.warn(`[publish-slots] brands no disponible (${res.status}) — sin huso de publicación`);
    return null;
  }
  const rows = (await res.json().catch(() => [])) as Array<{ id?: string | null; publish_timezone?: string | null }>;
  return indexBrandTimezones(rows);
}

const SLOT_SELECT = 'brand_id,platform_key,slot_at,status,piece_id';

/**
 * Un índice de franjas, o `null` cuando la LECTURA FALLÓ.
 *
 * LA DISTINCIÓN ES EL PUNTO, y por eso no se degrada a un mapa vacío: «esta pieza no tiene
 * franja» y «no se pudo saber si la tiene» son dos afirmaciones distintas, y la primera
 * dispara un aviso —«Aprobada sin franja asignada»— que existe precisamente para hacer
 * visible un fallo del reservador. Un mapa vacío por una lectura caída pintaría ese aviso en
 * todas las tarjetas aprobadas a la vez: una alarma falsa a escala, que es la forma más
 * rápida de enseñar a ignorar la alarma verdadera.
 *
 * Con `null`, el endpoint lo declara (`slots_source: 'unavailable'`) y la pantalla dice que
 * las fechas FALTAN, no que estén vacías. Mismo patrón que `cutoffs_source`.
 */
export type SlotIndex = Map<string, PublishSlotRow> | null;

/**
 * Las franjas de las piezas de la PÁGINA VISIBLE, indexadas por `piece_id`. Sólo la página:
 * el `in.()` de PostgREST crece con la lista, igual que en las trazas y los intentos.
 *
 * Un `piece_id` no puede tener dos franjas — lo garantiza el índice único parcial
 * `brand_publish_slots_pieza_uniq` (medido 2026-09-05: cero piezas en dos franjas). Si aun
 * así llegaran dos, gana la primera y el resto se ignora: la tarjeta muestra UNA fecha o
 * ninguna, nunca dos.
 */
export async function fetchSlotsByPiece(pieceIds: string[]): Promise<SlotIndex> {
  const ids = Array.from(new Set(pieceIds.filter((id) => typeof id === 'string' && id)));
  if (!ids.length) return new Map();

  const list = ids.map((id) => `"${id}"`).join(',');
  const url = `${SB_URL()}/rest/v1/brand_publish_slots`
    + `?select=${SLOT_SELECT}&piece_id=in.(${encodeURIComponent(list)})&limit=${SLOTS_CAP}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: intelHeaders() });
  } catch {
    console.warn('[publish-slots] brand_publish_slots no disponible (red) — franjas SIN LEER');
    return null;
  }
  if (!res.ok) {
    console.warn(`[publish-slots] brand_publish_slots no disponible (${res.status}) — franjas SIN LEER`);
    return null;
  }
  return indexByPiece((await res.json().catch(() => [])) as PublishSlotRow[]);
}

/** Indexa por `piece_id`, quedándose con la primera de cada una. Puro: se prueba sin red. */
export function indexByPiece(rows: PublishSlotRow[]): Map<string, PublishSlotRow> {
  const out = new Map<string, PublishSlotRow>();
  for (const r of Array.isArray(rows) ? rows : []) {
    const id = clean(r?.piece_id);
    if (id && !out.has(id)) out.set(id, r);
  }
  return out;
}

/** Clave de canal. Separador NUL: no puede aparecer dentro de un identificador. */
export function channelSlotKey(brandId: string, platformKey: string): string {
  return `${brandId}\u0000${platformKey}`;
}

/**
 * La PRÓXIMA franja libre de cada (marca, canal). Se leen todas las libres futuras de una
 * vez —son el horizonte sembrado, no una tabla de piezas— y se indexa la de menor `slot_at`.
 *
 * `now` se recibe para que la prueba pueda fijar el instante; en producción es la hora del
 * server, la misma con la que se construye el filtro de la consulta.
 */
export async function fetchNextFreeSlots(now: Date = new Date()): Promise<SlotIndex> {
  const url = `${SB_URL()}/rest/v1/brand_publish_slots`
    + `?select=${SLOT_SELECT}&status=eq.free&slot_at=gt.${encodeURIComponent(now.toISOString())}`
    + `&order=slot_at.asc&limit=${SLOTS_CAP}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: intelHeaders() });
  } catch {
    console.warn('[publish-slots] franjas libres no disponibles (red) — previsión SIN LEER');
    return null;
  }
  if (!res.ok) {
    console.warn(`[publish-slots] franjas libres no disponibles (${res.status}) — previsión SIN LEER`);
    return null;
  }
  return indexNextFree((await res.json().catch(() => [])) as PublishSlotRow[]);
}

/**
 * Indexa la franja libre más temprana por (marca, canal). Puro y exportado: la previsión se
 * prueba sin red, y el orden NO se confía al `order=` de la consulta —se compara acá— para
 * que una respuesta desordenada no produzca una previsión falsa.
 */
export function indexNextFree(rows: PublishSlotRow[]): Map<string, PublishSlotRow> {
  const best = new Map<string, PublishSlotRow>();
  for (const r of Array.isArray(rows) ? rows : []) {
    const brand = clean(r?.brand_id);
    const platform = clean(r?.platform_key);
    const at = millis(r?.slot_at);
    if (!brand || !platform || at === null) continue;
    const key = channelSlotKey(brand, platform);
    const cur = best.get(key);
    if (!cur || at < (millis(cur.slot_at) ?? Infinity)) best.set(key, r);
  }
  return best;
}

// ── Resolución por pieza (pura) ──────────────────────────────────────────────────
/** El huso de una marca. `null` cuando no está sembrado o el catálogo no se pudo leer. */
export function timezoneOf(brandId: string | null | undefined, catalog: BrandTimezoneCatalog): string | null {
  if (!catalog) return null;
  const id = clean(brandId);
  if (!id) return null;
  return catalog[id] ?? null;
}

/**
 * La franja RESERVADA de una pieza, con el huso de su marca. `null` = la pieza no tiene
 * franja. La tarjeta distingue ese `null` de «todavía no aprobada» mirando `approved_at`:
 * en una pieza sin aprobar, no tener franja es lo esperado, no una anomalía.
 */
export function slotOf(
  piece: ContentPiece,
  slots: SlotIndex,
  timezones: BrandTimezoneCatalog,
): PieceSlot | null {
  // Lectura caída: `null` acá significa «no hay franja que mostrar», y quien lo interpreta
  // es la pantalla, que YA sabe por `slots_source` que las franjas no se leyeron. Sin ese
  // aviso, este mismo `null` se leería como «sin franja» y sería mentira.
  if (!slots) return null;
  const row = slots.get(piece.id);
  if (!row) return null;
  const slot_at = clean(row.slot_at);
  if (!slot_at) return null;
  return { slot_at, status: clean(row.status) ?? 'unknown', timezone: timezoneOf(piece.brand_id, timezones) };
}

/**
 * La PREVISIÓN de una pieza: la próxima franja libre de su (marca, canal). `null` = no hay
 * franja libre futura para ese canal, o el canal no tiene política sembrada — que es
 * información, no error, y la pantalla lo dice así.
 *
 * NO RESERVA NADA. Es una lectura sobre filas ya traídas.
 */
export function forecastFor(
  piece: ContentPiece,
  freeSlots: SlotIndex,
  timezones: BrandTimezoneCatalog,
): ForecastSlot | null {
  if (!freeSlots) return null; // lectura caída — lo declara `slots_source`, no este `null`.
  const platform = clean(piece.platform);
  if (!platform) return null;
  const row = freeSlots.get(channelSlotKey(piece.brand_id, platform));
  const slot_at = row ? clean(row.slot_at) : null;
  if (!slot_at) return null;
  return { slot_at, timezone: timezoneOf(piece.brand_id, timezones) };
}
