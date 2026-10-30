/**
 * EL TEXTO DE LA IMAGEN SE ESCRIBE EN LA BANDEJA (2026-10-19).
 *
 * Sam (2026-10-19): poder ajustar «en sitio» el texto que va sobre la imagen —dónde se corta cada línea,
 * qué palabras van resaltadas, e incluso el texto— y que «solo cambie en la imagen». El motor
 * (`content-run-stage`, `assets.image.overlay_override`) recibe { headline, subheadline, emphasis[] }; un salto
 * de línea en `headline` es un corte (ImageLab ≥ 1.7.0).
 *
 * La pantalla lo escribe con un marcado mínimo: Enter = nueva línea, `^así^` = resaltado (desde 2026-10-30; antes
 * `*así*`) y `*así*` = sólo color. Este módulo es PURO:
 * traduce entre el marcado y lo que el motor espera. Sin red, sin DB.
 *
 * MULTIMARCA: cero marcas; los colores y la tipografía del resaltado son dato de cada marca en ImageLab.
 */

import { textStyleOf, type TextStyle } from './_textStyleShape.js';

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
  /** 2026-10-20 — el color de la barra lateral (franja de identidad) elegido por una persona; null = el de la marca. */
  identity_role: string | null;
  /** 2026-10-23 — lo elegido por bloque (`_textStyle.ts`). Sólo existe si hay algo elegido. */
  text_style?: TextStyle;
}

/** 2026-10-23 — `text_style` sólo cuando hay algo elegido: sin él, la vista es la de siempre, clave por clave. */
const withTextStyle = (raw: unknown): { text_style?: TextStyle } => { const ts = textStyleOf(raw); return ts ? { text_style: ts } : {}; };

/** Lo que la persona eligió para la imagen además del texto. Fuera del texto escrito, todo es lo de la marca. */
const SIN_ELECCION = { emphasis_role: null, text_shadow: null, shadow_spans: [] as string[], rule_role: null, identity_role: null };

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
      identity_role: typeof ov.identity_role === 'string' && ov.identity_role ? ov.identity_role : null,
      ...withTextStyle(ov.text_style),
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
 * El titular como marcado editable: cada tramo resaltado entre asteriscos, desde 2026-10-20 cada tramo con la
 * sombra al revés entre virgulillas (`~así~`) y desde 2026-10-28 cada tramo en cursiva entre guiones bajos (`_así_`).
 * Las marcas se ponen por posición sobre el titular, así un tramo puede contener a otro o cruzarlo. PURO.
 *
 * 2026-10-30 — LAS MARCAS NUEVAS (Sam: «aparte del resaltado por asteriscos que convierte el texto resaltado en
 * mayúsculas cerradas, haya otra opción para que resalte solo en color»; aprobado «Sí, así»): el resaltado de la marca
 * (con su tipografía) pasa a `^así^` y `*así*` es SÓLO COLOR (ImageLab ≥ 1.21.0, `text_style.<bloque>.color_spans`). Lo
 * guardado son listas, no marcado: una pieza que ya tenía resaltado vuelve al editor con `^…^` y sale igual que antes.
 */
export const MARK_EMPHASIS = '^';
export const MARK_COLOR = '*';
export const MARK_SHADOW = '~';
export const MARK_ITALIC = '_';
export function overlayMarkupOf(headline: string | null, emphasis: readonly string[], shadowSpans: readonly string[] = [],
  italicSpans: readonly string[] = [], colorSpans: readonly string[] = []): string {
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
  const marcas: Array<{ at: number; mark: string; close: boolean; a: number; b: number; k: number }> = [];
  const poner = (terms: readonly string[], mark: string, k: number) => {
    for (const [a, b] of rangos(terms)) marcas.push({ at: a, mark, close: false, a, b, k }, { at: b, mark, close: true, a, b, k });
  };
  poner(emphasis, MARK_EMPHASIS, 0); poner(shadowSpans, MARK_SHADOW, 1); poner(italicSpans, MARK_ITALIC, 2); poner(colorSpans, MARK_COLOR, 3);
  // En la misma posición, primero se cierra y después se abre. 2026-10-28 — y las marcas se ANIDAN, no se cruzan: se
  // cierra primero la que se abrió último, y se abre primero la que cierra último. Sam lo vio en la pieza 23698205: la
  // bajada `*_El contrato sí_*` volvía al editor como `*_El contrato sí*_`, que se lee como un error de quien escribe.
  marcas.sort((x, y) => x.at - y.at || Number(y.close) - Number(x.close)
    || (x.close ? (y.a - x.a) || (y.k - x.k) : (y.b - x.b) || (x.k - y.k)));
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
  markup: string; sub: string; role: string | null; shadow: 'on' | 'off' | null; ruleRole: string | null; identityRole: string | null;
} {
  return {
    markup: overlayMarkupOf(view?.headline ?? null, view?.emphasis ?? [], view?.shadow_spans ?? [], view?.text_style?.headline?.italic_spans ?? [],
      view?.text_style?.headline?.color_spans ?? []),
    sub: view?.subheadline ?? '',
    role: view?.emphasis_role ?? null,
    shadow: view?.text_shadow ?? null,
    ruleRole: view?.rule_role ?? null,
    identityRole: view?.identity_role ?? null,
  };
}

/** Lo que el editor manda al motor como texto escrito para la imagen. */
export interface OverlayOverrideOut {
  headline: string; subheadline: string | null; emphasis: string[]; emphasis_role?: string;
  text_shadow?: 'on' | 'off'; shadow_spans?: string[]; rule_role?: string; identity_role?: string;
  /** 2026-10-23 — lo elegido por bloque (ImageLab ≥ 1.16.0). Viaja sólo si hay algo elegido. */
  text_style?: TextStyle;
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
    identity_role: override.identity_role ?? null,
    ...withTextStyle(override.text_style),
  };
}

/**
 * Del marcado a lo que el motor espera. Un asterisco, una virgulilla o un guion bajo sin pareja, un tramo vacío, más de 3
 * resaltados, de 3 tramos de sombra o de 3 en cursiva, o un titular demasiado largo son errores que se dicen antes de
 * mandar nada. 2026-10-28 — `_así_` = cursiva (Sam): el texto de la imagen no lleva guiones bajos propios.
 * 2026-10-30 — `^así^` = resaltado y `*así*` = sólo color (ver `overlayMarkupOf`).
 */
export function parseOverlayMarkup(markup: string):
  { ok: true; headline: string; emphasis: string[]; shadow_spans: string[]; italic_spans: string[]; color_spans: string[] } | { ok: false; error: string } {
  const lines = String(markup ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { ok: false, error: 'El texto de la imagen está vacío.' };
  const emphasis: string[] = [];
  const shadowSpans: string[] = [];
  const italicSpans: string[] = [];
  const colorSpans: string[] = [];
  const plain: string[] = [];
  // Un tramo se lee con las OTRAS marcas ya quitadas: así se pueden cruzar o anidar.
  type Mark = '^' | '*' | '~' | '_';
  const RE: Record<Mark, RegExp> = { '^': /\^([^^]*)\^/g, '*': /\*([^*]*)\*/g, '~': /~([^~]*)~/g, '_': /_([^_]*)_/g };
  const tramos = (line: string, mark: Mark, out: string[], vacio: string): string | null => {
    const sin = (['^', '*', '~', '_'] as const).filter((m) => m !== mark).reduce((t, m) => t.split(m).join(''), line);
    const re = new RegExp(RE[mark].source, 'g');
    for (const m of sin.matchAll(re)) {
      const t = m[1].replace(/\s+/g, ' ').trim();
      if (!t) return vacio;
      if (!out.includes(t)) out.push(t);
    }
    return null;
  };
  for (const line of lines) {
    if ((line.match(/\^/g) ?? []).length % 2) return { ok: false, error: `Un acento circunflejo (^) de resaltado sin pareja en «${line}».` };
    if ((line.match(/\*/g) ?? []).length % 2) return { ok: false, error: `Un asterisco (*) de color sin pareja en «${line}».` };
    if ((line.match(/~/g) ?? []).length % 2) return { ok: false, error: `Una virgulilla (~) sin pareja en «${line}».` };
    if ((line.match(/_/g) ?? []).length % 2) return { ok: false, error: `Un guion bajo (_) de cursiva sin pareja en «${line}».` };
    const e1 = tramos(line, '^', emphasis, 'Hay un resaltado vacío (^^).');
    if (e1) return { ok: false, error: e1 };
    const e2 = tramos(line, '~', shadowSpans, 'Hay un tramo de sombra vacío (~~).');
    if (e2) return { ok: false, error: e2 };
    const e3 = tramos(line, '_', italicSpans, 'Hay un tramo en cursiva vacío (__).');
    if (e3) return { ok: false, error: e3 };
    const e4 = tramos(line, '*', colorSpans, 'Hay un tramo de color vacío (**).');
    if (e4) return { ok: false, error: e4 };
    plain.push(line.replace(/[\^*~_]/g, '').replace(/\s+/g, ' ').trim());
  }
  if (emphasis.length > OVERLAY_EMPHASIS_MAX) return { ok: false, error: `Hay ${emphasis.length} resaltados; el máximo es ${OVERLAY_EMPHASIS_MAX}.` };
  if (shadowSpans.length > OVERLAY_EMPHASIS_MAX) return { ok: false, error: `Hay ${shadowSpans.length} tramos de sombra; el máximo es ${OVERLAY_EMPHASIS_MAX}.` };
  if (italicSpans.length > OVERLAY_EMPHASIS_MAX) return { ok: false, error: `Hay ${italicSpans.length} tramos en cursiva; el máximo es ${OVERLAY_EMPHASIS_MAX}.` };
  if (colorSpans.length > OVERLAY_EMPHASIS_MAX) return { ok: false, error: `Hay ${colorSpans.length} tramos de color; el máximo es ${OVERLAY_EMPHASIS_MAX}.` };
  const headline = plain.join('\n');
  if (headline.length > OVERLAY_TEXT_MAX) return { ok: false, error: `El texto tiene ${headline.length} caracteres; el máximo es ${OVERLAY_TEXT_MAX}.` };
  for (const t of [...emphasis, ...shadowSpans, ...italicSpans, ...colorSpans]) {
    if (!headline.includes(t)) return { ok: false, error: `El tramo «${t}» no queda igual en el texto: revise los espacios alrededor de las marcas.` };
  }
  return { ok: true, headline, emphasis, shadow_spans: shadowSpans, italic_spans: italicSpans, color_spans: colorSpans };
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

/**
 * 2026-10-20 — los colores posibles de la barra lateral (la franja de identidad, `tokens.identity`): el suyo de siempre
 * y los accent con los que la marca resalta. Es la lista que acepta el compositor (`identityAllowedRoles`, ImageLab
 * 1.10.0). Sin franja en la capa de la marca, nada que elegir. PURO.
 */
export function identityColorOptions(
  tokenRows: Array<{ brand_id?: unknown; canal?: unknown; tokens?: any }>,
  palette: Array<{ role?: unknown; hex?: unknown }>,
  brandId: string,
): EmphasisColorOption[] {
  const fila = (tokenRows ?? []).find((r) => r?.brand_id === brandId && (r?.canal == null || r?.canal === ''));
  const id = fila?.tokens?.identity;
  const propio = id && String(id.mode ?? 'none') !== 'none' && typeof id.palette === 'string' ? id.palette : null;
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
