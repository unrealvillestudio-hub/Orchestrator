/**
 * EL TEXTO DE LA IMAGEN SE ESCRIBE EN LA BANDEJA (2026-10-19).
 *
 * Sam (2026-10-19): poder ajustar «en sitio» el texto que va sobre la imagen —dónde se corta cada línea,
 * qué palabras van resaltadas, e incluso el texto— y que «solo cambie en la imagen». El motor
 * (`content-run-stage`, `assets.image.overlay_override`) recibe { headline, subheadline, emphasis[] }; un salto
 * de línea en `headline` es un corte (ImageLab ≥ 1.7.0).
 *
 * La pantalla lo escribe con un marcado mínimo: Enter = nueva línea, `*así*` = resaltado. Este módulo es PURO:
 * traduce entre el marcado y lo que el motor espera. Sin red, sin DB.
 *
 * MULTIMARCA: cero marcas; los colores y la tipografía del resaltado son dato de cada marca en ImageLab.
 */

export const OVERLAY_TEXT_MAX = 300;
export const OVERLAY_EMPHASIS_MAX = 3;

export interface ImageOverlayView {
  headline: string | null;
  subheadline: string | null;
  emphasis: string[];
  /** true si el texto de la imagen lo escribió una persona (no sale del título ni del gancho). */
  written: boolean;
  /** 2026-10-19 — el color del resaltado elegido por una persona (rol de la paleta de la marca), si lo hay. */
  emphasis_role: string | null;
}

/** Lo que la tarjeta necesita del texto de la imagen, leído de `assets.image`. PURO. */
export function imageOverlayOf(assets: any): ImageOverlayView | null {
  const img = assets?.image ?? null;
  if (!img) return null;
  const ov = img.overlay_override;
  if (ov && typeof ov.headline === 'string' && ov.headline.trim()) {
    return {
      headline: ov.headline,
      subheadline: typeof ov.subheadline === 'string' && ov.subheadline.trim() ? ov.subheadline : null,
      emphasis: Array.isArray(ov.emphasis) ? ov.emphasis.filter((t: unknown) => typeof t === 'string' && t) : [],
      written: true,
      emphasis_role: typeof ov.emphasis_role === 'string' && ov.emphasis_role ? ov.emphasis_role : null,
    };
  }
  const o = img.overlay;
  if (!o || typeof o.headline !== 'string' || !o.headline.trim()) return null;
  return {
    headline: o.headline,
    subheadline: typeof o.subheadline === 'string' && o.subheadline.trim() ? o.subheadline : null,
    emphasis: Array.isArray(o.emphasis) ? o.emphasis.filter((t: unknown) => typeof t === 'string' && t) : [],
    written: false,
    emphasis_role: null,
  };
}

/** El titular y su énfasis como marcado editable: cada tramo resaltado entre asteriscos. PURO. */
export function overlayMarkupOf(headline: string | null, emphasis: readonly string[]): string {
  let out = String(headline ?? '');
  // De más largo a más corto: un tramo contenido en otro no se marca dos veces.
  for (const t of [...emphasis].sort((a, b) => b.length - a.length)) {
    const i = out.indexOf(t);
    if (i >= 0 && !out.slice(Math.max(0, i - 1), i).includes('*')) out = `${out.slice(0, i)}*${t}*${out.slice(i + t.length)}`;
  }
  return out;
}

// ── EL EDITOR ABRE CON EL TEXTO QUE LA IMAGEN LLEVA AHORA (2026-10-20) ──────────────────────────────
// Sam, 2026-10-20: «por momentos vuelve a la forma anterior y me tocó refrescar». Medido en `intel.piece_edits`
// (pieza 5b842958, 10:12–10:17): dos correcciones seguidas volvieron a escribir el texto de la PRIMERA. El editor se
// sembraba con el texto que la tarjeta trajo al cargar la bandeja, que no cambia al corregir; al volver a abrirlo,
// mandaba ese texto viejo con el cambio nuevo encima. Ahora se siembra con lo último aplicado y, en cuanto llega,
// con lo que la pieza tiene en la base (GET de `recompose-image`).

/** Los tres campos del editor a partir del texto vigente de la imagen. PURO. */
export function overlayEditorSeed(view: ImageOverlayView | null | undefined): { markup: string; sub: string; role: string | null } {
  return {
    markup: overlayMarkupOf(view?.headline ?? null, view?.emphasis ?? []),
    sub: view?.subheadline ?? '',
    role: view?.emphasis_role ?? null,
  };
}

/**
 * El texto vigente después de aplicar una corrección. Con `override` es exactamente lo que se mandó (escrito a mano);
 * sin él —«Volver al texto del copy»— el texto vuelve a salir del copy y no se conoce hasta releer la pieza: null. PURO.
 */
export function overlayViewAfterApply(
  override: { headline: string; subheadline: string | null; emphasis: string[]; emphasis_role?: string } | null,
): ImageOverlayView | null {
  if (!override) return null;
  return {
    headline: override.headline, subheadline: override.subheadline, emphasis: [...override.emphasis],
    written: true, emphasis_role: override.emphasis_role ?? null,
  };
}

/**
 * Del marcado a lo que el motor espera. Un asterisco sin pareja, un resaltado vacío o que cruza una línea,
 * más de 3 resaltados o un titular demasiado largo son errores que se dicen antes de mandar nada.
 */
export function parseOverlayMarkup(markup: string):
  { ok: true; headline: string; emphasis: string[] } | { ok: false; error: string } {
  const lines = String(markup ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { ok: false, error: 'El texto de la imagen está vacío.' };
  const emphasis: string[] = [];
  const plain: string[] = [];
  for (const line of lines) {
    if ((line.match(/\*/g) ?? []).length % 2) return { ok: false, error: `Un asterisco sin pareja en «${line}».` };
    for (const m of line.matchAll(/\*([^*]*)\*/g)) {
      const t = m[1].trim();
      if (!t) return { ok: false, error: 'Hay un resaltado vacío (**).' };
      if (!emphasis.includes(t)) emphasis.push(t);
    }
    plain.push(line.replace(/\*([^*]*)\*/g, (_, t: string) => t.trim()).replace(/\s+/g, ' ').trim());
  }
  if (emphasis.length > OVERLAY_EMPHASIS_MAX) return { ok: false, error: `Hay ${emphasis.length} resaltados; el máximo es ${OVERLAY_EMPHASIS_MAX}.` };
  const headline = plain.join('\n');
  if (headline.length > OVERLAY_TEXT_MAX) return { ok: false, error: `El texto tiene ${headline.length} caracteres; el máximo es ${OVERLAY_TEXT_MAX}.` };
  return { ok: true, headline, emphasis };
}

// ── EL COLOR DEL RESALTADO (2026-10-19) ─────────────────────────────────────────────────────────
// Sam, 2026-10-19: «no he visto … cambiar de color de accent». Las opciones NO son colores libres: son los
// roles que la propia marca declara para el resaltado del titular en ImageLab —el de siempre
// (`palette.headline_emphasis`) y las alternativas (`layout.emphasis_contrast.fallbacks`)— con su hex de
// `brand_palette`. Una marca nueva ofrece lo que declare, sin tocar código.

export interface EmphasisColorOption { role: string; hex: string; is_default: boolean }

/**
 * Las opciones de color del resaltado de una marca. `tokenRows` son filas de `imagelab_overlay_tokens`; sólo
 * cuenta la de la marca sin canal (la general). Un rol que la paleta no tiene no se ofrece. PURO.
 */
export function emphasisColorOptions(
  tokenRows: Array<{ brand_id?: unknown; canal?: unknown; tokens?: any }>,
  palette: Array<{ role?: unknown; hex?: unknown }>,
  brandId: string,
): EmphasisColorOption[] {
  const fila = (tokenRows ?? []).find((r) => r?.brand_id === brandId && (r?.canal == null || r?.canal === ''));
  const t = fila?.tokens ?? {};
  const porDefecto = typeof t?.palette?.headline_emphasis === 'string' ? t.palette.headline_emphasis : null;
  const alternativas = Array.isArray(t?.layout?.emphasis_contrast?.fallbacks) ? t.layout.emphasis_contrast.fallbacks : [];
  const hexDe = new Map((palette ?? []).filter((p) => typeof p?.role === 'string' && typeof p?.hex === 'string')
    .map((p) => [String(p.role), String(p.hex)]));
  const out: EmphasisColorOption[] = [];
  for (const role of [porDefecto, ...alternativas]) {
    if (typeof role !== 'string' || !role || out.some((o) => o.role === role)) continue;
    const hex = hexDe.get(role);
    if (hex) out.push({ role, hex, is_default: role === porDefecto });
  }
  return out;
}
