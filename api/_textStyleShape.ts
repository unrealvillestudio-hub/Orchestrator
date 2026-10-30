/**
 * LA FORMA DE `text_style` (2026-10-23) — sin dependencias, para que la lean `_overlayText.ts` y `_textStyle.ts` sin
 * importarse entre sí. Ver `_textStyle.ts`. PURO.
 */

export const TEXT_STYLE_STRENGTHS = ['soft', 'brand', 'strong', 'heavy'] as const;
export type ShadowStrength = (typeof TEXT_STYLE_STRENGTHS)[number];

export interface TextStyleBlock {
  role?: string; emphasis?: string[]; emphasis_role?: string; text_shadow?: 'on' | 'off';
  shadow_spans?: string[]; shadow_strength?: ShadowStrength;
  /** 2026-10-28 — los tramos en cursiva (ImageLab ≥ 1.18.0): cada uno invierte la cursiva de lo que tiene debajo. */
  italic_spans?: string[];
  /** 2026-10-30 — los tramos de sólo color (ImageLab ≥ 1.21.0): toman el color del resaltado del bloque, sin su tipografía. */
  color_spans?: string[];
}
export interface TextStyle { headline?: TextStyleBlock; sub?: TextStyleBlock }

/** Los pasos del grosor de la sombra, dichos para quien elige. `null` = la de la marca (no viaja nada). */
export const SHADOW_STRENGTH_CHOICES: ReadonlyArray<{ value: ShadowStrength | null; label: string }> = [
  { value: null, label: 'La de la marca' }, { value: 'soft', label: 'Suave' }, { value: 'strong', label: 'Fuerte' }, { value: 'heavy', label: 'Muy fuerte' },
];

const ROLE = /^[a-z0-9_]{1,40}$/;
const textos = (xs: unknown): string[] => (Array.isArray(xs) ? xs.filter((t: unknown): t is string => typeof t === 'string' && !!t) : []);

/** Un bloque leído de lo guardado. Lo que no tiene forma se descarta: aquí sólo se muestra. PURO. */
function blockOf(raw: unknown, sub: boolean): TextStyleBlock | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  const out: TextStyleBlock = {};
  if (typeof b.role === 'string' && ROLE.test(b.role)) out.role = b.role;
  if (typeof b.emphasis_role === 'string' && ROLE.test(b.emphasis_role)) out.emphasis_role = b.emphasis_role;
  if (sub && textos(b.emphasis).length) out.emphasis = textos(b.emphasis);
  if (b.text_shadow === 'on' || b.text_shadow === 'off') out.text_shadow = b.text_shadow;
  if (textos(b.shadow_spans).length) out.shadow_spans = textos(b.shadow_spans);
  if (textos(b.italic_spans).length) out.italic_spans = textos(b.italic_spans);
  if (textos(b.color_spans).length) out.color_spans = textos(b.color_spans);
  if (typeof b.shadow_strength === 'string' && (TEXT_STYLE_STRENGTHS as readonly string[]).includes(b.shadow_strength)) out.shadow_strength = b.shadow_strength as ShadowStrength;
  return Object.keys(out).length ? out : null;
}

/** ¿Pide `text_style` algún tramo en cursiva, en cualquier bloque? (2026-10-28) PURO. */
export function textStyleWantsItalic(ts: unknown): boolean {
  const o = ts && typeof ts === 'object' && !Array.isArray(ts) ? ts as Record<string, any> : {};
  return ['headline', 'sub'].some((k) => Array.isArray(o[k]?.italic_spans) && o[k].italic_spans.length > 0);
}

/** ¿Pide `text_style` algún tramo de sólo color, en cualquier bloque? (2026-10-30) PURO. */
export function textStyleWantsColor(ts: unknown): boolean {
  const o = ts && typeof ts === 'object' && !Array.isArray(ts) ? ts as Record<string, any> : {};
  return ['headline', 'sub'].some((k) => Array.isArray(o[k]?.color_spans) && o[k].color_spans.length > 0);
}

/** Lo elegido por bloque tal como está guardado (`overlay_override.text_style` o el de una lámina). PURO. */
export function textStyleOf(raw: unknown): TextStyle | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const headline = blockOf(o.headline, false);
  const sub = blockOf(o.sub, true);
  const out: TextStyle = { ...(headline ? { headline } : {}), ...(sub ? { sub } : {}) };
  return Object.keys(out).length ? out : null;
}

