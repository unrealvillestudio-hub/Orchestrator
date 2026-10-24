/**
 * EL TEXTO DE CADA LÁMINA DEL CARRUSEL, DESDE LA BANDEJA (2026-10-22).
 *
 * Medido ese día: el botón «Texto de la imagen» corregía sólo la imagen de la pieza; la portada del carrusel
 * (`assets.carousel.slides[n=1]`) y las láminas 2..N no cambiaban, y lo que se publica son las láminas
 * (`carouselMediaOf` del drenaje, `manualImagesOf` aquí). Desde este cambio:
 *   · la portada sigue la vía de siempre (`recompose` + `overlay_override`), y el motor recompone también la
 *     lámina 1 con ese texto;
 *   · las láminas 2..N van por `carousel_recompose` con `slides_text` (rama `slide_text` de `recompose-image`).
 * Ninguna de las dos genera escena: recomponen sobre la imagen limpia de cada lámina (0 USD).
 *
 * Este módulo es PURO: qué ve el editor de cada lámina y qué viaja al motor. Las reglas de fondo (límites,
 * pasos, palabra clave) las aplica el motor (bloque CARRUSEL-TEXTO de content-run-stage); aquí sólo se valida
 * lo que conviene saber antes de pagar el viaje.
 *
 * MULTIMARCA: cero marcas. El formato se lee de la pieza (`CAROUSEL_FORMAT`), no de la marca.
 */

import { CAROUSEL_FORMAT } from './_manualShared.js';
import { readTextPlaceRequest, storedTextPlace, type TextPlace } from './_textPlace.js';
import { readTextColumnRequest, storedTextColumn, type TextColumn } from './_textColumn.js';
import { textStyleOf, type TextStyle } from './_textStyleShape.js';

/** El mismo techo que el motor (`CAROUSEL_HEADLINE_MAX`, `CAROUSEL_EYEBROW_MAX`, `CAROUSEL_SUBHEADLINE_MAX`). */
export const SLIDE_HEADLINE_MAX = 140;
export const SLIDE_EYEBROW_MAX = 28;
export const SLIDE_SUBHEADLINE_MAX = 300;
export const SLIDE_STEPS_MAX = 5;

export interface SlideStep { text: string; critical: boolean }

/** Lo que el editor muestra de una lámina. */
export interface CarouselSlideTextView {
  n: number;
  role: 'cover' | 'body' | 'closing';
  headline: string | null;
  subheadline: string | null;
  eyebrow: string | null;
  steps: SlideStep[];
  /** Sin imagen limpia el motor no puede recomponer su texto sin cambiarle la foto: el editor lo dice. */
  editable: boolean;
  url: string | null;
  /** 2026-10-22 — la ubicación del texto guardada en la lámina (`_textPlace.ts`); la portada, la de la imagen. */
  text_place: TextPlace | null;
  /** 2026-10-24 — la columna del texto guardada en la lámina (`_textColumn.ts`); la portada, la de la imagen. */
  text_column: TextColumn | null;
  /** 2026-10-23 — lo elegido por bloque (`_textStyle.ts`). Sólo existe si hay algo elegido; la portada, el de la imagen. */
  text_style?: TextStyle;
}

export interface CarouselTextView { total: number; slides: CarouselSlideTextView[] }

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
/** 2026-10-23 — `text_style` sólo cuando hay algo elegido: sin él, la lámina es la de siempre, clave por clave. */
const withTextStyle = (raw: unknown): { text_style?: TextStyle } => { const ts = textStyleOf(raw); return ts ? { text_style: ts } : {}; };

/**
 * Las láminas de un carrusel con su texto, en el orden en que se publican. PURO. `null` si la pieza no es un
 * carrusel de dos o más láminas: el mismo criterio con el que se publica y se pinta (`manualImagesOf`).
 */
export function carouselTextViewOf(piece: { format?: string | null; assets?: any } | null | undefined): CarouselTextView | null {
  if (!piece || String(piece.format ?? '') !== CAROUSEL_FORMAT) return null;
  const raw = Array.isArray(piece.assets?.carousel?.slides) ? piece.assets.carousel.slides : [];
  const slides = raw.filter((s: any) => Number.isInteger(Number(s?.n)))
    .map((s: any) => ({ ...s, n: Number(s.n) }))
    .sort((a: any, b: any) => a.n - b.n);
  if (slides.length < 2) return null;
  const total = slides.length;
  return {
    total,
    slides: slides.map((s: any, i: number): CarouselSlideTextView => ({
      n: s.n,
      role: i === 0 ? 'cover' : i === total - 1 ? 'closing' : 'body',
      headline: texto(s.headline),
      subheadline: texto(s.subheadline),
      eyebrow: texto(s.eyebrow),
      steps: Array.isArray(s.steps)
        ? s.steps.filter((p: any) => typeof p?.text === 'string' && p.text.trim()).map((p: any) => ({ text: p.text.trim(), critical: p.critical === true }))
        : [],
      // La portada se recompone sobre la limpia de la pieza; las demás, sobre la suya.
      editable: i === 0 || (typeof s.clean_url === 'string' && !!s.clean_url),
      url: typeof s.url === 'string' ? s.url : null,
      // La portada es la imagen de la pieza: su fila es la de `image.text_place`.
      text_place: storedTextPlace(i === 0 ? piece.assets?.image?.text_place : s.text_place),
      text_column: storedTextColumn(i === 0 ? piece.assets?.image?.text_column : s.text_column),
      ...withTextStyle(i === 0 ? piece.assets?.image?.overlay_override?.text_style : s.text_style),
    })),
  };
}

/** Los pasos como líneas editables: uno por línea, `!` al inicio = el crítico. PURO. */
export function stepsToLines(steps: readonly SlideStep[]): string {
  return steps.map((p) => `${p.critical ? '! ' : ''}${p.text}`).join('\n');
}

/** Y de vuelta. Líneas vacías sobran. PURO. */
export function linesToSteps(lines: string): SlideStep[] {
  return String(lines ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => (l.startsWith('!') ? { text: l.slice(1).trim(), critical: true } : { text: l, critical: false }))
    .filter((p) => p.text);
}

export interface SlideTextDraft { headline: string; subheadline: string; eyebrow: string; steps: string }

/** El borrador con el que abre el editor de una lámina. PURO. */
export function slideTextDraftOf(slide: CarouselSlideTextView | null | undefined): SlideTextDraft {
  return {
    headline: slide?.headline ?? '', subheadline: slide?.subheadline ?? '', eyebrow: slide?.eyebrow ?? '',
    steps: stepsToLines(slide?.steps ?? []),
  };
}

export interface SlideTextOut {
  n: number; headline?: string; subheadline?: string | null; eyebrow?: string | null; steps?: SlideStep[] | null;
  /** 2026-10-22 — la ubicación del texto de la lámina (`_textPlace.ts`). Puede viajar sola. */
  text_place?: TextPlace | null;
  /** 2026-10-24 — la columna del texto de la lámina (`_textColumn.ts`). Puede viajar sola. */
  text_column?: TextColumn | null;
  /** 2026-10-23 — lo elegido por bloque (`_textStyle.ts`); `null` lo borra. Puede viajar solo. */
  text_style?: TextStyle | null;
}

/**
 * Lo que viaja al motor: SÓLO los campos que cambiaron respecto de la lámina actual (lo no tocado no se reescribe
 * ni se atribuye a nadie en `piece_edits`). PURO. Valida lo que conviene saber antes del viaje.
 */
export function slideTextPayload(slide: CarouselSlideTextView, draft: SlideTextDraft):
  { ok: true; value: SlideTextOut; changed: number } | { ok: false; error: string } {
  if (slide.role === 'cover') return { ok: false, error: 'La portada se corrige con el texto de la imagen (lámina 1).' };
  if (!slide.editable) return { ok: false, error: `La lámina ${slide.n} no guarda su imagen limpia: su texto no se puede recomponer sin cambiarle la foto.` };
  const headline = draft.headline.replace(/\s+/g, ' ').trim();
  if (!headline) return { ok: false, error: `El titular de la lámina ${slide.n} no puede quedar vacío.` };
  if (headline.length > SLIDE_HEADLINE_MAX) return { ok: false, error: `El titular tiene ${headline.length} caracteres; el máximo es ${SLIDE_HEADLINE_MAX}.` };
  const sub = draft.subheadline.replace(/\s+/g, ' ').trim();
  if (sub.length > SLIDE_SUBHEADLINE_MAX) return { ok: false, error: `La bajada tiene ${sub.length} caracteres; el máximo es ${SLIDE_SUBHEADLINE_MAX}.` };
  const eyebrow = draft.eyebrow.replace(/\s+/g, ' ').trim();
  if (eyebrow.length > SLIDE_EYEBROW_MAX) return { ok: false, error: `La etiqueta tiene ${eyebrow.length} caracteres; el máximo es ${SLIDE_EYEBROW_MAX}.` };
  const steps = linesToSteps(draft.steps);
  if (steps.length > SLIDE_STEPS_MAX) return { ok: false, error: `${steps.length} pasos; el máximo es ${SLIDE_STEPS_MAX}.` };
  if (steps.filter((p) => p.critical).length > 1) return { ok: false, error: 'Sólo un paso puede ser el crítico (el que empieza con «!»).' };

  const value: SlideTextOut = { n: slide.n };
  let changed = 0;
  if (headline !== (slide.headline ?? '')) { value.headline = headline; changed++; }
  if (sub !== (slide.subheadline ?? '')) { value.subheadline = sub || null; changed++; }
  if (eyebrow !== (slide.eyebrow ?? '')) { value.eyebrow = eyebrow || null; changed++; }
  if (JSON.stringify(steps) !== JSON.stringify(slide.steps)) { value.steps = steps.length ? steps : null; changed++; }
  return { ok: true, value, changed };
}

/**
 * Lo que la ruta acepta en `slide_text` antes de llamar al motor. PURO. Una lámina por petición, la 2 en adelante:
 * la portada va por `overlay_override`.
 */
export function readSlideTextRequest(raw: unknown): { ok: true; value: SlideTextOut } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'slide_text debe ser un objeto { n, headline?, subheadline?, eyebrow?, steps?, text_place? }' };
  const o = raw as Record<string, unknown>;
  const n = Number(o.n);
  if (!Number.isInteger(n) || n < 1) return { ok: false, error: 'slide_text.n debe ser el número entero de la lámina' };
  if (n === 1) return { ok: false, error: 'la lámina 1 es la portada: su texto se corrige con overlay_override' };
  const permitidos = ['n', 'headline', 'subheadline', 'eyebrow', 'steps', 'text_place', 'text_column', 'text_style'];
  const ajenos = Object.keys(o).filter((k) => !permitidos.includes(k));
  if (ajenos.length) return { ok: false, error: `slide_text trae campos que esta vía no corrige: ${ajenos.join(', ')}` };
  const value: SlideTextOut = { n };
  if ('headline' in o) value.headline = String(o.headline ?? '');
  if ('subheadline' in o) value.subheadline = o.subheadline == null ? null : String(o.subheadline);
  if ('eyebrow' in o) value.eyebrow = o.eyebrow == null ? null : String(o.eyebrow);
  if ('steps' in o) value.steps = Array.isArray(o.steps) ? (o.steps as SlideStep[]) : null;
  if ('text_place' in o) {
    const tp = readTextPlaceRequest(o.text_place);
    if (!tp.ok) return { ok: false, error: `slide_text.${tp.error}` };
    value.text_place = tp.value;
  }
  if ('text_column' in o) {
    const tc = readTextColumnRequest(o.text_column);
    if (!tc.ok) return { ok: false, error: `slide_text.${tc.error}` };
    value.text_column = tc.value;
  }
  // 2026-10-23 — lo elegido por bloque: aquí sólo que sea un objeto; la forma y los tramos los valida el motor.
  if ('text_style' in o) {
    if (o.text_style != null && (typeof o.text_style !== 'object' || Array.isArray(o.text_style))) return { ok: false, error: 'slide_text.text_style debe ser un objeto { headline?, sub? } o null' };
    value.text_style = (o.text_style ?? null) as TextStyle | null;
  }
  if (Object.keys(value).length < 2) return { ok: false, error: `la lámina ${n} no trae ningún campo que corregir` };
  return { ok: true, value };
}

/** La vista del carrusel después de guardar una lámina: lo guardado, sin esperar otra lectura. PURO. */
export function carouselViewAfterSlideSave(view: CarouselTextView, out: SlideTextOut): CarouselTextView {
  return {
    ...view,
    slides: view.slides.map((s) => (s.n !== out.n ? s : {
      ...s,
      ...('headline' in out ? { headline: out.headline ?? null } : {}),
      ...('subheadline' in out ? { subheadline: out.subheadline ?? null } : {}),
      ...('eyebrow' in out ? { eyebrow: out.eyebrow ?? null } : {}),
      ...('steps' in out ? { steps: out.steps ?? [] } : {}),
      ...('text_place' in out ? { text_place: out.text_place ?? null } : {}),
      ...('text_column' in out ? { text_column: out.text_column ?? null } : {}),
      ...('text_style' in out ? { text_style: out.text_style ?? undefined } : {}),
    })),
  };
}

/** La etiqueta del selector de lámina. PURO. */
export function slideTabLabel(slide: Pick<CarouselSlideTextView, 'n' | 'role'>): string {
  return slide.role === 'cover' ? `${slide.n} · portada` : slide.role === 'closing' ? `${slide.n} · cierre` : String(slide.n);
}

export const CAROUSEL_SLIDE_HELP =
  'La lámina 1 es la portada: lleva el texto de la imagen y se corrige arriba, como siempre. Las demás se corrigen aquí: ' +
  'titular, bajada, etiqueta y pasos (uno por línea; «!» al inicio = el crítico). Se recompone sobre su foto, sin generar (0 USD).';

/** Lo que la tarjeta dice de la portada después de aplicar el texto de la imagen en un carrusel. PURO. */
export function coverNoteOf(carouselRecomposed: boolean | string | null | undefined): { tone: 'ok' | 'alert'; text: string } | null {
  if (carouselRecomposed == null) return null;
  if (carouselRecomposed === true) return { tone: 'ok', text: 'La portada del carrusel (lámina 1) también lleva el texto nuevo.' };
  return { tone: 'alert', text: `La imagen cambió, pero la portada del carrusel no se recompuso: ${String(carouselRecomposed)}` };
}
