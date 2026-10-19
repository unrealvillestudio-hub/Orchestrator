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
 * imágenes de la pieza en `assets.image.history` (content-run-stage `withImageHistory`); acá se leen para mostrarlas.
 */

/** Los lugares de la escena, en el orden en que se muestran. `kind` dice qué se puede poner en cada uno. */
export const SCENE_SLOTS = [
  { key: 'Ref1', label: 'Ref1 · principal', kind: 'person' },
  { key: 'Ref2', label: 'Ref2 · secundaria', kind: 'person' },
  { key: 'Host', label: 'Host', kind: 'person' },
  { key: 'Fondo', label: 'Fondo', kind: 'place' },
] as const;
export type SceneSlotKey = (typeof SCENE_SLOTS)[number]['key'];

export interface CastOption { name: string }
export interface SceneCast { persons: CastOption[]; places: CastOption[]; in_image: string[] }

/** Las personas y los lugares de la marca que se pueden poner en la escena, y quiénes salen hoy en la imagen. */
export function sceneCastOf(personRows: unknown, placeRows: unknown, image: unknown): SceneCast {
  const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
  const persons = uniq((Array.isArray(personRows) ? personRows : []).map((r: any) => String(r?.display_name ?? '')))
    .sort((a, b) => a.localeCompare(b, 'es')).map((name) => ({ name }));
  // Un lugar se nombra por su primer alias: es el nombre con el que el motor lo reconoce en una directriz.
  const places = uniq((Array.isArray(placeRows) ? placeRows : []).map((r: any) => String(Array.isArray(r?.aliases) ? r.aliases[0] ?? '' : '')))
    .sort((a, b) => a.localeCompare(b, 'es')).map((name) => ({ name }));
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
