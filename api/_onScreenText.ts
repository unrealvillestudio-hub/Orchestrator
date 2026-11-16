/**
 * UNRLVL Orchestrator — api/_onScreenText.ts (2026-11-16 · contrato «Bloques de texto colocados a mano» v1)
 *
 * UNA SOLA VENTANA «TEXTO EN PANTALLA» PARA IMAGEN Y VIDEO: LA COLOCACIÓN DE CADA BLOQUE. Funciones PURAS: sin red,
 * sin base, sin React. La ventana (`src/modules/iid/OnScreenTextEditor.tsx`) pinta lo que dicen estas funciones; las
 * rutas (`api/recompose-image.ts`, `api/piece-text.ts`) validan con ellas lo que llega antes de llamar a un lab.
 *
 * Objetivo validado por Sam (2026-11-16): «En el Orchestrator, una sola ventana de texto para imagen y video. Cada
 * bloque (título, subtítulo, títulos clave, CTA, rol) tiene X, Y y zoom de 0,7× a 1,3×, dentro de la zona segura. Lo
 * que no aplica a un formato queda desactivado. El render de VideoLab y el compositor de ImageLab respetan esos
 * valores, y avisan si el bloque tapa una cara.» Además: el rol en imágenes existe, desactivado por defecto.
 *
 * ── LA FORMA (contrato §1) ──────────────────────────────────────────────────────────────────────
 *   place: { x_pct, y_pct, zoom }  — x/y ∈ [0, 100] son el CENTRO del bloque dentro de la ZONA SEGURA (no % del
 *   lienzo); zoom ∈ [0,7, 1,3]. Sin `place` el bloque es automático, como siempre. En los subtítulos del video sólo
 *   viaja `{ zoom }`: su banda es fija al fondo de la zona segura.
 *
 * ── REGLA LABS ───────────────────────────────────────────────────────────────────────────────────
 * Aquí no se dibuja nada ni se decide dónde cae un píxel: se valida la forma y se arma el pedido. Dónde termina cada
 * bloque, si se acota y si tapa una cara lo dicen ImageLab (`/api/compose`, `blocks`) y VideoLab (`text_layers`).
 *
 * ── REGLA MULTIMARCA ─────────────────────────────────────────────────────────────────────────────
 * Cero marcas. La posición y el zoom son del sistema; los estilos, colores y la zona segura de la imagen son dato de la
 * marca (`imagelab_overlay_tokens.tokens.layout.safe_zone_pct`). El texto del rol sale de la ficha de la persona.
 */

import { TEXT_SCALE_MAX, TEXT_SCALE_MIN, TEXT_SCALE_STEP } from './_textScale.js';

// ── La colocación ──────────────────────────────────────────────────────────────────────────────

export interface Place { x_pct: number; y_pct: number; zoom: number }
export interface ZoomOnly { zoom: number }

/** El rango del zoom es el del `text_scale` vigente de ImageLab (contrato §1): una sola fuente para los dos. */
export const ZOOM_MIN = TEXT_SCALE_MIN;
export const ZOOM_MAX = TEXT_SCALE_MAX;
export const ZOOM_STEP = TEXT_SCALE_STEP;
export const PCT_STEP = 1;

/** Donde nace un bloque al pasarlo a mano: el centro de la zona segura, a su tamaño. */
export const PLACE_DEFAULT: Place = { x_pct: 50, y_pct: 50, zoom: 1 };

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const obj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** El zoom al paso del deslizador y dentro del rango. PURO. */
export function clampZoom(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  const enPaso = Math.round(n / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(enPaso.toFixed(2))));
}

/** Un porcentaje entero de 0 a 100. PURO. */
export function clampPct(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** Lo que sale de los deslizadores, ya acotado. PURO. */
export function clampPlace(p: Partial<Place> | null | undefined): Place {
  return { x_pct: clampPct(p?.x_pct ?? PLACE_DEFAULT.x_pct), y_pct: clampPct(p?.y_pct ?? PLACE_DEFAULT.y_pct), zoom: clampZoom(p?.zoom ?? 1) };
}

/**
 * Valida un `place` que llega a una ruta. Ausente (`undefined`/`null`) = automático. Fuera de rango o mal formado =
 * error con el campo nombrado: NO se acota en silencio, porque un valor acotado aquí no es el que eligió quien edita.
 * `zoomOnly` = los subtítulos del video: sólo `{ zoom }`. PURO.
 */
export function readPlace(raw: unknown, campo: string, opts: { zoomOnly?: boolean } = {}):
  { ok: true; value: Place | ZoomOnly | null } | { ok: false; error: string } {
  if (raw == null) return { ok: true, value: null };
  if (!obj(raw)) return { ok: false, error: `${campo}.place debe ser un objeto o null` };
  const zoom = num(raw.zoom);
  const errores: string[] = [];
  if (!(zoom >= ZOOM_MIN && zoom <= ZOOM_MAX)) errores.push(`${campo}.place.zoom debe ser un número entre ${ZOOM_MIN} y ${ZOOM_MAX}`);
  if (opts.zoomOnly) {
    if ('x_pct' in raw || 'y_pct' in raw) errores.push(`${campo}.place sólo admite zoom: su banda es fija al fondo de la zona segura`);
    return errores.length ? { ok: false, error: errores.join(' · ') } : { ok: true, value: { zoom: Math.round(zoom * 100) / 100 } };
  }
  const x = num(raw.x_pct), y = num(raw.y_pct);
  if (!(x >= 0 && x <= 100)) errores.push(`${campo}.place.x_pct debe ser un número entre 0 y 100`);
  if (!(y >= 0 && y <= 100)) errores.push(`${campo}.place.y_pct debe ser un número entre 0 y 100`);
  return errores.length ? { ok: false, error: errores.join(' · ') }
    : { ok: true, value: { x_pct: x, y_pct: y, zoom: Math.round(zoom * 100) / 100 } };
}

// ── Los bloques y lo que aplica a cada formato ─────────────────────────────────────────────────

export type Medium = 'image' | 'video';
export const SCREEN_BLOCKS = ['headline', 'subheadline', 'key_titles', 'cta', 'role', 'captions'] as const;
export type ScreenBlock = (typeof SCREEN_BLOCKS)[number];
export const BLOCK_CONTROLS = ['text', 'x', 'y', 'zoom', 'auto', 'preset', 'entry'] as const;
export type BlockControl = (typeof BLOCK_CONTROLS)[number];

/** Las tarjetas de la ventana, en el orden en que se pintan. Igual en los dos formatos: lo que no aplica, desactivado. */
export const BLOCK_LABELS: Record<ScreenBlock, string> = {
  headline: 'Título / Gancho',
  subheadline: 'Subtítulo',
  key_titles: 'Títulos clave',
  cta: 'CTA',
  role: 'Rol',
  captions: 'Subtítulos (karaoke)',
};

export interface Support { enabled: boolean; reason: string | null }
const SI: Support = { enabled: true, reason: null };
const NO = (reason: string): Support => ({ enabled: false, reason });

export const ONLY_VIDEO = 'Sólo en video: una imagen no tiene línea de tiempo.';
export const NO_SUB_IN_VIDEO = 'En video no hay subtítulo de imagen: el gancho va solo y el habla va en los subtítulos.';
export const CAPTIONS_BAND = 'Los subtítulos van en una banda fija al fondo de la zona segura: sólo cambia su tamaño.';
export const LAMINA_SIN_COLOCACION =
  'En una lámina 2..N del carrusel el texto se coloca con los atajos de abajo: X, Y y Zoom rigen la imagen de la pieza y la portada.';
export const NO_ENTRY_IN_IMAGE = 'En una imagen no hay animación ni segundo de entrada: el texto está siempre.';

/** ¿La tarjeta existe en este formato? Si no, se pinta desactivada con este motivo. PURO. */
export function blockSupport(medium: Medium, block: ScreenBlock): Support {
  if (medium === 'video') return block === 'subheadline' ? NO(NO_SUB_IN_VIDEO) : SI;
  if (block === 'key_titles' || block === 'cta' || block === 'captions') return NO(ONLY_VIDEO);
  return SI;
}

/**
 * ¿Este control de esta tarjeta aplica en este formato? Lo que no aplica se pinta desactivado con su motivo (contrato
 * §4: no se oculta). PURO.
 */
export function controlSupport(medium: Medium, block: ScreenBlock, control: BlockControl): Support {
  const b = blockSupport(medium, block);
  if (!b.enabled) return b;
  if (block === 'captions' && (control === 'x' || control === 'y' || control === 'auto' || control === 'text')) return NO(CAPTIONS_BAND);
  if (medium === 'image' && (control === 'preset' || control === 'entry')) return NO(NO_ENTRY_IN_IMAGE);
  return SI;
}

// ── El rol ─────────────────────────────────────────────────────────────────────────────────────

/** «Nombre — Cargo — Marca», con lo que haya: un campo vacío no deja un guion colgado. PURO. */
export function roleTextOf(p: { name?: unknown; title?: unknown } | null | undefined, brandName?: unknown): string {
  return [str(p?.name), str(p?.title), str(brandName)].filter(Boolean).join(' — ');
}

export const ROLE_NO_PERSONA = 'La imagen no tiene una persona guardada (no hay identidad en la pieza): no hay a quién rotular.';
export const ROLE_TEXT_MAX = 160;

/**
 * La persona de una pieza de imagen que se puede rotular: la primera de `assets.image.identity_refs` (quien salió en
 * la escena). El cargo viene de su ficha si se pudo leer. `null` = no hay persona: el interruptor se desactiva. PURO.
 */
export function imagePersonaOf(assets: unknown, fichas: Array<Record<string, unknown>> = []):
  { person_id: string | null; name: string; title: string } | null {
  const refs = (assets as any)?.image?.identity_refs;
  const ref = Array.isArray(refs) ? refs.find((r: any) => str(r?.name)) : null;
  if (!ref) return null;
  const person_id = str(ref.person_id) || null;
  // `person_id` es `person_blueprints.id` (UUID, contrato de identidad por id, 2026-11-16).
  const ficha = fichas.find((f) => (person_id && (str(f?.id) === person_id || str(f?.blueprint_id) === person_id))
    || str(f?.display_name) === str(ref.name)) ?? null;
  return { person_id, name: str(ref.name), title: titleOfFicha(ficha) };
}

/** El cargo en la ficha de una persona: `person_blueprints.role_title` (migración 20261116213000). Sin cargo, ''. PURO. */
export function titleOfFicha(f: Record<string, unknown> | null | undefined): string {
  return f ? str(f.role_title) : '';
}

/** El nombre visible de una marca, de su fila en `public.brands`. PURO. */
export function brandNameOf(row: Record<string, unknown> | null | undefined, brandId: string): string {
  return str(row?.display_name) || str(row?.name) || str(row?.brand_name) || brandId;
}

// ── Imagen: `blocks` (contrato §3) ─────────────────────────────────────────────────────────────

export interface ImageBlocks {
  headline?: { place?: Place };
  subheadline?: { place?: Place };
  role?: { enabled: boolean; text: string; place?: Place };
}

/** Lo que la ventana edita en una imagen: el `place` de cada bloque (null = automático) y el rol. */
export interface ImagePlacementDraft {
  headline: Place | null;
  subheadline: Place | null;
  role: { enabled: boolean; text: string; place: Place | null };
}

/** Lo guardado en la pieza (`assets.image.blocks`, lo escribe el motor al recomponer). Tolerante. PURO. */
export function storedImageBlocks(assets: unknown): ImageBlocks | null {
  const raw = (assets as any)?.image?.blocks;
  const r = readImageBlocksRequest(raw);
  return r.ok ? r.value : null;
}

/** El borrador con el que abre la ventana: lo guardado, o todo automático y el rol apagado. PURO. */
export function imagePlacementDraftOf(stored: ImageBlocks | null, roleSeed: string): ImagePlacementDraft {
  return {
    headline: stored?.headline?.place ? clampPlace(stored.headline.place) : null,
    subheadline: stored?.subheadline?.place ? clampPlace(stored.subheadline.place) : null,
    role: {
      enabled: stored?.role?.enabled === true,
      text: str(stored?.role?.text) || roleSeed,
      place: stored?.role?.place ? clampPlace(stored.role.place) : null,
    },
  };
}

/**
 * El `blocks` que viaja a ImageLab (vía el motor). Viaja ENTERO cuando cambió algo respecto de lo guardado: un bloque
 * sin `place` vuelve a automático, y el rol apagado viaja como `{ enabled: false }` para que el motor lo quite.
 * `undefined` = no se tocó nada, no viaja (lo no tocado no se reescribe ni se atribuye en `piece_edits`). PURO.
 */
export function imageBlocksToSend(draft: ImagePlacementDraft, stored: ImageBlocks | null): ImageBlocks | undefined {
  const out: ImageBlocks = {
    headline: draft.headline ? { place: clampPlace(draft.headline) } : {},
    subheadline: draft.subheadline ? { place: clampPlace(draft.subheadline) } : {},
    role: draft.role.enabled
      ? { enabled: true, text: draft.role.text.trim(), ...(draft.role.place ? { place: clampPlace(draft.role.place) } : {}) }
      : { enabled: false, text: '' },
  };
  const base: ImageBlocks = {
    headline: stored?.headline?.place ? { place: clampPlace(stored.headline.place) } : {},
    subheadline: stored?.subheadline?.place ? { place: clampPlace(stored.subheadline.place) } : {},
    role: stored?.role?.enabled
      ? { enabled: true, text: str(stored.role.text), ...(stored.role.place ? { place: clampPlace(stored.role.place) } : {}) }
      : { enabled: false, text: '' },
  };
  return JSON.stringify(out) === JSON.stringify(base) ? undefined : out;
}

/**
 * Lo que la ruta acepta en `blocks` antes de llamar al motor (contrato §3). `null`/ausente = no viaja. Rol encendido
 * sin texto = error: el compositor no inventa a quién rotular. PURO.
 */
export function readImageBlocksRequest(raw: unknown): { ok: true; value: ImageBlocks | null } | { ok: false; error: string } {
  if (raw == null) return { ok: true, value: null };
  if (!obj(raw)) return { ok: false, error: 'blocks debe ser un objeto o null' };
  const errores: string[] = [];
  const out: ImageBlocks = {};
  for (const k of Object.keys(raw)) {
    if (k !== 'headline' && k !== 'subheadline' && k !== 'role') errores.push(`blocks.${k} no existe en una imagen (sólo headline, subheadline y role)`);
  }
  for (const k of ['headline', 'subheadline'] as const) {
    if (raw[k] == null) continue;
    if (!obj(raw[k])) { errores.push(`blocks.${k} debe ser un objeto`); continue; }
    const p = readPlace(raw[k].place, `blocks.${k}`);
    if (!p.ok) errores.push(p.error);
    else out[k] = p.value ? { place: p.value as Place } : {};
  }
  if (raw.role != null) {
    const r = raw.role;
    if (!obj(r)) errores.push('blocks.role debe ser un objeto');
    else {
      const enabled = r.enabled === true;
      const text = str(r.text);
      if (enabled && !text) errores.push('blocks.role: encendido sin texto');
      if (text.length > ROLE_TEXT_MAX) errores.push(`blocks.role: ${text.length} caracteres, el máximo es ${ROLE_TEXT_MAX}`);
      const p = readPlace(r.place, 'blocks.role');
      if (!p.ok) errores.push(p.error);
      else out.role = { enabled, text: enabled ? text : '', ...(enabled && p.value ? { place: p.value as Place } : {}) };
    }
  }
  return errores.length ? { ok: false, error: errores.join(' · ') } : { ok: true, value: out };
}

// ── La vista previa esquemática ─────────────────────────────────────────────────────────────────

export interface SafeZone { top: number; bottom: number; left: number; right: number }

/**
 * La zona segura de un reel, APROXIMADA, sólo para dibujar la vista previa: la de verdad es dato del canal en VideoLab
 * y la dibuja el render. Arriba la cabecera de la app, abajo la descripción y a la derecha los botones.
 */
export const VIDEO_SAFE_ZONE_APPROX: SafeZone = { top: 12, bottom: 20, left: 6, right: 14 };
export const NO_SAFE_ZONE: SafeZone = { top: 0, bottom: 0, left: 0, right: 0 };

/**
 * La zona segura de la imagen que declara la marca (`layout.safe_zone_pct`): la capa de la marca, si no la global.
 * Mal declarada o ausente = sin zona (todo el lienzo), como hace el compositor. PURO.
 */
export function imageSafeZoneOf(tokenRows: Array<{ brand_id?: unknown; canal?: unknown; tokens?: any }>, brandId: string): SafeZone {
  const general = (b: string | null) => (tokenRows ?? []).find((r) => (b == null ? r?.brand_id == null : r?.brand_id === b) && (r?.canal == null || r?.canal === ''));
  const z = general(brandId)?.tokens?.layout?.safe_zone_pct ?? general(null)?.tokens?.layout?.safe_zone_pct ?? null;
  if (!obj(z)) return NO_SAFE_ZONE;
  const vals = (['top', 'bottom', 'left', 'right'] as const).map((k) => Number(z[k] ?? 0));
  if (vals.some((v) => !Number.isFinite(v) || v < 0 || v >= 50)) return NO_SAFE_ZONE;
  return { top: vals[0], bottom: vals[1], left: vals[2], right: vals[3] };
}

/** La proporción ancho/alto de la pieza, de lo que guarda; sin medidas, la del formato (reel 9:16, imagen 4:5). PURO. */
export function aspectOf(assets: unknown, medium: Medium): number {
  const m = (assets as any)?.[medium];
  const w = Number(m?.width), h = Number(m?.height);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return Math.round((w / h) * 1000) / 1000;
  return medium === 'video' ? 9 / 16 : 4 / 5;
}

/** El tamaño de partida de cada bloque en la vista previa, en % de la zona segura (aproximado, a zoom 1). */
export const PREVIEW_BASE: Record<ScreenBlock, { w: number; h: number }> = {
  headline: { w: 80, h: 16 },
  subheadline: { w: 70, h: 9 },
  key_titles: { w: 70, h: 9 },
  cta: { w: 55, h: 8 },
  role: { w: 50, h: 7 },
  captions: { w: 86, h: 9 },
};

/** Dónde dibuja la vista previa un bloque automático (el ancla habitual), en % de la zona segura. */
export const PREVIEW_AUTO: Record<ScreenBlock, { x_pct: number; y_pct: number }> = {
  headline: { x_pct: 50, y_pct: 14 },
  subheadline: { x_pct: 50, y_pct: 28 },
  key_titles: { x_pct: 50, y_pct: 45 },
  cta: { x_pct: 50, y_pct: 80 },
  role: { x_pct: 30, y_pct: 70 },
  captions: { x_pct: 50, y_pct: 95 },
};

export interface PreviewRect { left: number; top: number; width: number; height: number }

/**
 * El rectángulo de un bloque en % del LIENZO: centro en `place` dentro de la zona segura, tamaño de partida por zoom,
 * acotado para quedar entero dentro de la zona segura (como hará el lab). Sin `place`, el ancla automática. PURO.
 */
export function previewRect(block: ScreenBlock, place: Partial<Place> | null, safe: SafeZone): PreviewRect {
  const zw = 100 - safe.left - safe.right;
  const zh = 100 - safe.top - safe.bottom;
  const zoom = clampZoom(place?.zoom ?? 1);
  const base = PREVIEW_BASE[block];
  const w = Math.min(zw, (base.w * zoom * zw) / 100);
  const h = Math.min(zh, (base.h * zoom * zh) / 100);
  const anchor = place && place.x_pct != null && place.y_pct != null ? { x_pct: place.x_pct, y_pct: place.y_pct } : PREVIEW_AUTO[block];
  const cx = safe.left + (clampPct(anchor.x_pct) * zw) / 100;
  const cy = safe.top + (clampPct(anchor.y_pct) * zh) / 100;
  const left = Math.min(Math.max(cx - w / 2, safe.left), safe.left + zw - w);
  const top = Math.min(Math.max(cy - h / 2, safe.top), safe.top + zh - h);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { left: r2(left), top: r2(top), width: r2(w), height: r2(h) };
}

export const PREVIEW_NOTE = 'Vista aproximada: el resultado real lo da el lab, que acota el bloque a la zona segura y avisa si tapa una cara.';
