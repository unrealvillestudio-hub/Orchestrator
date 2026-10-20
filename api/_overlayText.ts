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
  /** 2026-10-20 — la sombra de todo el texto elegida por una persona; null = la de la marca. */
  text_shadow: 'on' | 'off' | null;
  /** 2026-10-20 — los tramos del titular con la sombra al revés del resto. */
  shadow_spans: string[];
  /** 2026-10-20 — el color del filete (la franja bajo el titular) elegido por una persona; null = el de la marca. */
  rule_role: string | null;
}

/** Lo que la persona eligió para la imagen además del texto. Fuera del texto escrito, todo es lo de la marca. */
const SIN_ELECCION = { emphasis_role: null, text_shadow: null, shadow_spans: [] as string[], rule_role: null };

const textos = (xs: unknown): string[] => (Array.isArray(xs) ? xs.filter((t: unknown): t is string => typeof t === 'string' && !!t) : []);

/** Lo que la tarjeta necesita del texto de la imagen, leído de `assets.image`. PURO. */
export function imageOverlayOf(assets: any): ImageOverlayView | null {
  const img = assets?.image ?? null;
  if (!img) return null;
  const ov = img.overlay_override;
  if (ov && typeof ov.headline === 'string' && ov.headline.trim()) {
    return {
      headline: ov.headline,
      subheadline: typeof ov.subheadline === 'string' && ov.subheadline.trim() ? ov.subheadline : null,
      emphasis: textos(ov.emphasis),
      written: true,
      emphasis_role: typeof ov.emphasis_role === 'string' && ov.emphasis_role ? ov.emphasis_role : null,
      text_shadow: ov.text_shadow === 'on' || ov.text_shadow === 'off' ? ov.text_shadow : null,
      shadow_spans: textos(ov.shadow_spans),
      rule_role: typeof ov.rule_role === 'string' && ov.rule_role ? ov.rule_role : null,
    };
  }
  const o = img.overlay;
  if (!o || typeof o.headline !== 'string' || !o.headline.trim()) return null;
  return {
    headline: o.headline,
    subheadline: typeof o.subheadline === 'string' && o.subheadline.trim() ? o.subheadline : null,
    emphasis: textos(o.emphasis),
    written: false,
    ...SIN_ELECCION,
  };
}

/**
 * El titular como marcado editable: cada tramo resaltado entre asteriscos y, desde 2026-10-20, cada tramo con la
 * sombra al revés entre virgulillas (`~así~`). Las marcas se ponen por posición sobre el titular, así un tramo de
 * sombra puede contener un resaltado o cruzarlo. PURO.
 */
export function overlayMarkupOf(headline: string | null, emphasis: readonly string[], shadowSpans: readonly string[] = []): string {
  const h = String(headline ?? '');
  // Primera aparición que no se pise con otra del mismo tipo; de más largo a más corto (un tramo contenido en otro
  // no se marca dos veces).
  const rangos = (terms: readonly string[]) => {
    const out: Array<[number, number]> = [];
    for (const t of [...terms].sort((a, b) => b.length - a.length)) {
      let from = 0;
      for (;;) {
        const i = t ? h.indexOf(t, from) : -1;
        if (i < 0) break;
        if (!out.some(([a, b]) => i < b && i + t.length > a)) { out.push([i, i + t.length]); break; }
        from = i + 1;
      }
    }
    return out;
  };
  const marcas: Array<{ at: number; mark: string; close: boolean }> = [];
  for (const [a, b] of rangos(emphasis)) marcas.push({ at: a, mark: '*', close: false }, { at: b, mark: '*', close: true });
  for (const [a, b] of rangos(shadowSpans)) marcas.push({ at: a, mark: '~', close: false }, { at: b, mark: '~', close: true });
  // En la misma posición, primero se cierra y después se abre.
  marcas.sort((x, y) => x.at - y.at || Number(y.close) - Number(x.close));
  let out = '';
  let pos = 0;
  for (const m of marcas) { out += h.slice(pos, m.at) + m.mark; pos = m.at; }
  return out + h.slice(pos);
}

// ── EL EDITOR ABRE CON EL TEXTO QUE LA IMAGEN LLEVA AHORA (2026-10-20) ──────────────────────────────
// Sam, 2026-10-20: «por momentos vuelve a la forma anterior y me tocó refrescar». Medido en `intel.piece_edits`
// (pieza 5b842958, 10:12–10:17): dos correcciones seguidas volvieron a escribir el texto de la PRIMERA. El editor se
// sembraba con el texto que la tarjeta trajo al cargar la bandeja, que no cambia al corregir; al volver a abrirlo,
// mandaba ese texto viejo con el cambio nuevo encima. Ahora se siembra con lo último aplicado y, en cuanto llega,
// con lo que la pieza tiene en la base (GET de `recompose-image`).

/** Los campos del editor a partir del texto vigente de la imagen. PURO. */
export function overlayEditorSeed(view: ImageOverlayView | null | undefined): {
  markup: string; sub: string; role: string | null; shadow: 'on' | 'off' | null; ruleRole: string | null;
} {
  return {
    markup: overlayMarkupOf(view?.headline ?? null, view?.emphasis ?? [], view?.shadow_spans ?? []),
    sub: view?.subheadline ?? '',
    role: view?.emphasis_role ?? null,
    shadow: view?.text_shadow ?? null,
    ruleRole: view?.rule_role ?? null,
  };
}

/** Lo que el editor manda al motor como texto escrito para la imagen. */
export interface OverlayOverrideOut {
  headline: string; subheadline: string | null; emphasis: string[]; emphasis_role?: string;
  text_shadow?: 'on' | 'off'; shadow_spans?: string[]; rule_role?: string;
}

/**
 * El texto vigente después de aplicar una corrección. Con `override` es exactamente lo que se mandó (escrito a mano);
 * sin él —«Volver al texto del copy»— el texto vuelve a salir del copy y no se conoce hasta releer la pieza: null. PURO.
 */
export function overlayViewAfterApply(override: OverlayOverrideOut | null): ImageOverlayView | null {
  if (!override) return null;
  return {
    headline: override.headline, subheadline: override.subheadline, emphasis: [...override.emphasis],
    written: true, emphasis_role: override.emphasis_role ?? null,
    text_shadow: override.text_shadow ?? null, shadow_spans: [...(override.shadow_spans ?? [])], rule_role: override.rule_role ?? null,
  };
}

/**
 * Del marcado a lo que el motor espera. Un asterisco o una virgulilla sin pareja, un tramo vacío, más de 3 resaltados
 * o de 3 tramos de sombra, o un titular demasiado largo son errores que se dicen antes de mandar nada.
 */
export function parseOverlayMarkup(markup: string):
  { ok: true; headline: string; emphasis: string[]; shadow_spans: string[] } | { ok: false; error: string } {
  const lines = String(markup ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { ok: false, error: 'El texto de la imagen está vacío.' };
  const emphasis: string[] = [];
  const shadowSpans: string[] = [];
  const plain: string[] = [];
  // Un tramo se lee con la OTRA marca ya quitada: así se pueden cruzar o anidar.
  const tramos = (line: string, mark: '*' | '~', otra: '*' | '~', out: string[], vacio: string): string | null => {
    const sin = line.split(otra).join('');
    const re = mark === '*' ? /\*([^*]*)\*/g : /~([^~]*)~/g;
    for (const m of sin.matchAll(re)) {
      const t = m[1].replace(/\s+/g, ' ').trim();
      if (!t) return vacio;
      if (!out.includes(t)) out.push(t);
    }
    return null;
  };
  for (const line of lines) {
    if ((line.match(/\*/g) ?? []).length % 2) return { ok: false, error: `Un asterisco sin pareja en «${line}».` };
    if ((line.match(/~/g) ?? []).length % 2) return { ok: false, error: `Una virgulilla (~) sin pareja en «${line}».` };
    const e1 = tramos(line, '*', '~', emphasis, 'Hay un resaltado vacío (**).');
    if (e1) return { ok: false, error: e1 };
    const e2 = tramos(line, '~', '*', shadowSpans, 'Hay un tramo de sombra vacío (~~).');
    if (e2) return { ok: false, error: e2 };
    plain.push(line.replace(/[*~]/g, '').replace(/\s+/g, ' ').trim());
  }
  if (emphasis.length > OVERLAY_EMPHASIS_MAX) return { ok: false, error: `Hay ${emphasis.length} resaltados; el máximo es ${OVERLAY_EMPHASIS_MAX}.` };
  if (shadowSpans.length > OVERLAY_EMPHASIS_MAX) return { ok: false, error: `Hay ${shadowSpans.length} tramos de sombra; el máximo es ${OVERLAY_EMPHASIS_MAX}.` };
  const headline = plain.join('\n');
  if (headline.length > OVERLAY_TEXT_MAX) return { ok: false, error: `El texto tiene ${headline.length} caracteres; el máximo es ${OVERLAY_TEXT_MAX}.` };
  for (const t of [...emphasis, ...shadowSpans]) {
    if (!headline.includes(t)) return { ok: false, error: `El tramo «${t}» no queda igual en el texto: revise los espacios alrededor de las marcas.` };
  }
  return { ok: true, headline, emphasis, shadow_spans: shadowSpans };
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

// ── LA SOMBRA Y LA FRANJA (2026-10-20) ──────────────────────────────────────────────────────────────
// Sam, 2026-10-20: la sombra, «las dos cosas» (todo el texto y por tramos), y la franja bajo el texto «con lista de
// los accent colors de la marca correspondiente». Igual que el resaltado: las opciones son dato de la marca en
// ImageLab (compositor ≥ 1.9.0), nunca colores libres.

/**
 * Los colores posibles del filete (la franja bajo el titular): el suyo de siempre (`layout.rule.palette`) y los accent
 * con los que la marca resalta. Es la misma lista que acepta el compositor (`ruleAllowedRoles`). Sin filete
 * declarado y encendido en la capa de la marca, no hay nada que elegir: lista vacía. PURO.
 */
export function ruleColorOptions(
  tokenRows: Array<{ brand_id?: unknown; canal?: unknown; tokens?: any }>,
  palette: Array<{ role?: unknown; hex?: unknown }>,
  brandId: string,
): EmphasisColorOption[] {
  const fila = (tokenRows ?? []).find((r) => r?.brand_id === brandId && (r?.canal == null || r?.canal === ''));
  const rule = fila?.tokens?.layout?.rule;
  const propio = rule?.enabled === true && typeof rule?.palette === 'string' ? rule.palette : null;
  if (!propio) return [];
  const hexDe = new Map((palette ?? []).filter((p) => typeof p?.role === 'string' && typeof p?.hex === 'string')
    .map((p) => [String(p.role), String(p.hex)]));
  const out: EmphasisColorOption[] = [];
  const add = (role: string, is_default: boolean) => {
    const hex = hexDe.get(role);
    if (hex && !out.some((o) => o.role === role)) out.push({ role, hex, is_default });
  };
  add(propio, true);
  for (const o of emphasisColorOptions(tokenRows, palette, brandId)) add(o.role, false);
  return out;
}

/** Cómo lleva la sombra la marca: `when` de `layout.text_effect` ('always' | 'low_contrast' | 'on_request'). */
export interface ShadowOption { declared: boolean; when: string | null }

/**
 * La sombra que la marca declara, de su capa o, si no la tiene, de la capa global (la regla del sistema). Sin
 * ninguna, no se ofrece poner sombra: el compositor no inventa una. PURO.
 */
export function shadowOptionOf(tokenRows: Array<{ brand_id?: unknown; canal?: unknown; tokens?: any }>, brandId: string): ShadowOption {
  const general = (b: string | null) => (tokenRows ?? []).find((r) => (b == null ? r?.brand_id == null : r?.brand_id === b) && (r?.canal == null || r?.canal === ''));
  const te = general(brandId)?.tokens?.layout?.text_effect ?? general(null)?.tokens?.layout?.text_effect ?? null;
  if (!te || typeof te !== 'object') return { declared: false, when: null };
  return { declared: true, when: typeof te.when === 'string' ? te.when : 'always' };
}

/** Lo que la marca hace con la sombra, dicho para quien elige. */
export function shadowDefaultLabel(o: ShadowOption): string {
  if (!o.declared) return 'sin sombra';
  if (o.when === 'low_contrast') return 'sólo cuando el fondo no deja leer';
  if (o.when === 'on_request') return 'sin sombra';
  return 'siempre con sombra';
}
