/**
 * UNRLVL Orchestrator — api/_sceneCast.ts (2026-10-20)
 *
 * QUIÉN Y QUÉ HAY EN LA ESCENA, Y LAS IMÁGENES ANTERIORES. Funciones PURAS: sin red, sin base.
 *
 * Sam, 2026-10-19: «si quisiera cambiar algo o al host lo llamaría host porque nos referimos a lo que está en la escena
 * (jamás me acordaré de los nombres)… Ref1, Ref2, host y fondo». Los lugares de la escena son del SISTEMA (el motor
 * los entiende igual para cualquier marca: ImageLab `SAME_SCENE_BUILDER_NOTE`); las personas y los lugares que se
 * pueden poner en ellos son DATO de la marca (`brand_persons`, `brand_locations`). Cero marcas en este archivo.
 *
 * Y: «deshacer el error de una regeneración incorrecta me toca venir aquí contigo». El motor guarda las últimas
 * imágenes de la pieza en `assets.image.history` (content-run-stage `withImageHistory`); aquí se leen para mostrarlas.
 */

/** Los lugares de la escena, en el orden en que se muestran. `kind` dice qué se puede poner en cada uno. */
export const SCENE_SLOTS = [
  { key: 'Ref1', label: 'Ref1 · principal', kind: 'person' },
  { key: 'Ref2', label: 'Ref2 · secundaria', kind: 'person' },
  { key: 'Host', label: 'Host', kind: 'person' },
  { key: 'Fondo', label: 'Fondo', kind: 'place' },
] as const;
export type SceneSlotKey = (typeof SCENE_SLOTS)[number]['key'];

/**
 * Una opción del menú. `name` es lo que se ve; `value`, lo que se escribe en la directriz (el nombre de la persona, o el
 * primer alias del lugar: es como el motor lo reconoce). 2026-11-21 (Sam: «no sé quién es quién en el dropdown… ponme un
 * thumbnail de su cara + nombre + si es host o administradora…»): cada persona lleva su cara
 * (`thumb`), su voz y su cargo (`subtitle`) y si se puede pintar (`paintable`: sin descripción para el motor, el carril no
 * la pinta — medido el 2026-11-21: «Ref1 por Beatriz» no hizo nada). Cada lugar lleva su nombre y su grupo (`group`).
 */
export interface CastOption { name: string; value: string; thumb: string | null; subtitle: string | null; paintable: boolean; group: string | null }
export interface SceneCast { persons: CastOption[]; places: CastOption[]; in_image: string[] }

/** Cómo se llama en el menú la voz de una persona en la marca (`brand_persons.role`, vocabulario del sistema). */
export const VOICE_LABELS: Record<string, string> = {
  host: 'Host', brand_voice: 'Voz de marca', expert: 'Especialista', author_voice: 'Autoría', scene_protagonist: 'Protagonista',
};

/**
 * Los grupos del menú de Fondo, por el tipo de lugar (`location_blueprints.location_type`, vocabulario del sistema) y en este
 * orden. 2026-11-21 (Sam): «en el selector de fondo quiero los Estudios de vPodcast de cada marca… y el estudio de
 * Conversations con ese mismo nombre, cada uno es un escenario distinto». Un tipo sin grupo va en «Lugares».
 */
export const PLACE_GROUPS: Array<{ label: string; types: string[] }> = [
  { label: 'Estudios de vPodcast', types: ['podcast_studio'] },
  { label: 'Conversations', types: ['conversation_set'] },
];
export const PLACE_GROUP_DEFAULT = 'Lugares';

const texto = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
const url = (x: unknown) => { const u = typeof x === 'string' ? x : texto((x as any)?.url); return /^https?:\/\//.test(u) ? u : ''; };

/** La cara de la persona para el menú: su tarjeta de cerca, la de medio cuerpo o su primera foto de referencia. */
export function personThumbOf(row: any): string | null {
  const cards = row?.identity_cards ?? row?.raw_config?.identity_cards;
  const photos = Array.isArray(row?.reference_photos) ? row.reference_photos : [];
  return url(cards?.close) || url(cards?.medium) || photos.map(url).find(Boolean) || null;
}

/** Las personas y los lugares de la marca que se pueden poner en la escena, y quiénes salen hoy en la imagen. */
export function sceneCastOf(personRows: unknown, placeRows: unknown, image: unknown): SceneCast {
  const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
  const vistos = new Set<string>();
  const persons: CastOption[] = [];
  for (const r of (Array.isArray(personRows) ? personRows : []) as any[]) {
    const name = texto(r?.display_name);
    if (!name || vistos.has(name)) continue;
    vistos.add(name);
    const voz = VOICE_LABELS[texto(r?.role)] ?? '';
    const cargo = texto(r?.role_title);
    const subtitle = [voz, cargo].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' · ') || null;
    // Sin la columna en la lectura no se sabe: se ofrece como antes. Con la columna vacía, el carril no la pinta.
    const paintable = !('imagelab_description' in (r ?? {})) || !!texto(r?.imagelab_description);
    persons.push({ name, value: name, thumb: personThumbOf(r), subtitle, paintable, group: null });
  }
  persons.sort((a, b) => Number(b.paintable) - Number(a.paintable) || a.name.localeCompare(b.name, 'es'));
  // Un lugar se escribe por su primer alias (así lo reconoce el motor) y se muestra por su nombre si la lectura lo trae.
  const grupoDe = (tipo: string) => PLACE_GROUPS.find((g) => g.types.includes(tipo))?.label ?? PLACE_GROUP_DEFAULT;
  const orden = (g: string | null) => { const i = PLACE_GROUPS.findIndex((x) => x.label === g); return i < 0 ? PLACE_GROUPS.length : i; };
  const lugares = new Set<string>();
  const places: CastOption[] = [];
  for (const r of (Array.isArray(placeRows) ? placeRows : []) as any[]) {
    const value = texto(Array.isArray(r?.aliases) ? r.aliases[0] : '');
    if (!value || lugares.has(value)) continue;
    lugares.add(value);
    const tipo = texto(r?.location_type);
    places.push({ name: texto(r?.display_name) || value, value, thumb: url(Array.isArray(r?.reference_photos) ? r.reference_photos[0] : null) || null,
      subtitle: null, paintable: true, group: tipo ? grupoDe(tipo) : null });
  }
  places.sort((a, b) => orden(a.group) - orden(b.group) || a.name.localeCompare(b.name, 'es'));
  const refs = (image as any)?.identity_refs;
  const in_image = uniq((Array.isArray(refs) ? refs : []).map((r: any) => String(r?.name ?? '')));
  return { persons, places, in_image };
}

/** La directriz que pide poner a alguien (o un lugar) en un lugar de la escena. Vacía si falta algo. */
export function slotDirective(slot: string, name: string): string {
  const s = SCENE_SLOTS.find((x) => x.key === slot);
  const n = String(name ?? '').trim();
  if (!s || !n) return '';
  return `${s.key} por ${n}`;
}

/** El modo que corresponde a cambiar un lugar de la escena: siempre la misma escena con el cambio. */
export const SLOT_CHANGE_MODE = 'same_scene' as const;

export interface ImageHistoryEntry { index: number; url: string; clean_url: string | null; replaced_at: string | null; generation_mode: string | null }

/** Las imágenes anteriores de la pieza, de la más reciente a la más antigua, listas para mostrar. */
export function imageHistoryOf(image: unknown): ImageHistoryEntry[] {
  const list = (image as any)?.history;
  if (!Array.isArray(list)) return [];
  return list
    .map((h: any, index: number) => ({
      index,
      url: typeof h?.url === 'string' ? h.url : '',
      clean_url: typeof h?.clean_url === 'string' ? h.clean_url : null,
      replaced_at: typeof h?.replaced_at === 'string' ? h.replaced_at : null,
      generation_mode: typeof h?.generation_mode === 'string' ? h.generation_mode : null,
    }))
    .filter((h) => h.url);
}

/**
 * Cuándo usar cada modo. Es el texto de ayuda del panel: corto, en el orden en que aparecen los botones.
 * Medido el 2026-10-19 (92a24249): editar no cambia a una persona; desde cero sí, pero inventa otra escena.
 */
export const MODE_HELP: Record<'edit_from_current' | 'same_scene' | 'regenerate_full', string> = {
  edit_from_current: 'Corregir sobre la imagen actual: luz, color, un gesto o un objeto. No cambia a una persona por otra.',
  same_scene: 'Otra persona, misma escena: cambiar a alguien (o el fondo) y dejar la toma, la luz y lo demás como están.',
  regenerate_full: 'Repintar desde cero: cuando la escena entera no sirve. Inventa otra escena.',
};
