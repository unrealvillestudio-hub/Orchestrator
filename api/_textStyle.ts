/**
 * LO ELEGIDO POR BLOQUE EN EL TEXTO DE LA IMAGEN (2026-10-23).
 *
 * Sam, sobre la pieza affe6b7c: «debo poder decidir según el title combinación de resaltado, colores de franja o
 * resaltado, pero ahora veo que también color del texto cuando sea necesario… y lo mismo y aparte para la última
 * oración del embedded text… quisiera poder definir el grueso de la sombra»; y «sí a todo, carrusel también».
 *
 * El motor (`content-run-stage` → ImageLab ≥ 1.16.0) recibe `text_style` = { headline?, sub? }: por bloque, el color
 * del texto (`role`), el resaltado de la bajada (`emphasis`) y su color (`emphasis_role`), la sombra 'on' | 'off' sólo
 * para ese bloque, sus tramos al revés (`shadow_spans`) y su grosor (`shadow_strength`). Lo usan las dos vías: la imagen
 * de la pieza (`overlay_override.text_style`) y cada lámina 2..N (`slide_text.text_style`).
 *
 * Este módulo es PURO: la forma, las opciones de color que la marca ofrece y el paso entre lo que el editor muestra y
 * lo que viaja. Sin red, sin DB.
 *
 * MULTIMARCA: cero marcas. Los colores posibles son dato de cada marca en ImageLab (sus tokens y su paleta).
 */

import { emphasisColorOptions, parseOverlayMarkup, overlayMarkupOf, type EmphasisColorOption } from './_overlayText.js';

export { TEXT_STYLE_STRENGTHS, SHADOW_STRENGTH_CHOICES, textStyleOf } from './_textStyleShape.js';
export type { ShadowStrength, TextStyleBlock, TextStyle } from './_textStyleShape.js';
import type { ShadowStrength, TextStyleBlock, TextStyle } from './_textStyleShape.js';

// ── LOS COLORES DEL TEXTO ──────────────────────────────────────────────────────────────────────────────────────
// La MISMA lista que acepta el compositor (`textAllowedRoles`, ImageLab 1.16.0): los colores de siempre del titular y
// de la bajada; `palette.text_options` si la marca los declara —si no, el más claro y el más oscuro de su paleta—; y
// los accent con los que la marca resalta. Una marca nueva ofrece lo que declare, sin tocar código.

export interface TextColorOptions { options: EmphasisColorOption[]; headline_default: string | null; sub_default: string | null }

/** Luminancia relativa WCAG de un hex (#RGB o #RRGGBB); NaN si no es un hex. PURO. */
function luminance(hex: string): number {
  const h = String(hex ?? '').trim().replace(/^#/, '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return NaN;
  const n = parseInt(full, 16);
  const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** Los colores que una persona puede dar al texto de un bloque, con el de siempre de cada uno. PURO. */
export function textColorOptions(
  tokenRows: Array<{ brand_id?: unknown; canal?: unknown; tokens?: any }>,
  palette: Array<{ role?: unknown; hex?: unknown }>,
  brandId: string,
): TextColorOptions {
  const general = (b: string | null) => (tokenRows ?? []).find((r) => (b == null ? r?.brand_id == null : r?.brand_id === b) && (r?.canal == null || r?.canal === ''));
  const pal = { ...(general(null)?.tokens?.palette ?? {}), ...(general(brandId)?.tokens?.palette ?? {}) };
  const hexDe = new Map((palette ?? []).filter((p) => typeof p?.role === 'string' && typeof p?.hex === 'string')
    .map((p) => [String(p.role), String(p.hex)]));
  const roles: string[] = [];
  const add = (r: unknown) => { if (typeof r === 'string' && r && !roles.includes(r)) roles.push(r); };
  add(pal.headline); add(pal.subheadline);
  if (Array.isArray(pal.text_options)) pal.text_options.forEach(add);
  else {
    const lum = [...hexDe.entries()].map(([role, hex]) => ({ role, l: luminance(hex) })).filter((x) => Number.isFinite(x.l))
      .sort((a, b) => (a.l - b.l) || a.role.localeCompare(b.role));
    if (lum.length) { add(lum[lum.length - 1].role); add(lum[0].role); }
  }
  for (const o of emphasisColorOptions(tokenRows, palette, brandId)) add(o.role);
  const headlineDefault = typeof pal.headline === 'string' ? pal.headline : null;
  const subDefault = typeof pal.subheadline === 'string' ? pal.subheadline : headlineDefault;
  const options = roles.filter((r) => hexDe.has(r)).map((role) => ({ role, hex: hexDe.get(role)!, is_default: false }));
  return { options, headline_default: headlineDefault, sub_default: subDefault };
}

// ── EL BORRADOR DEL EDITOR ───────────────────────────────────────────────────────────────────────────────────

/** Lo que el editor muestra de un bloque. `null` en un campo = lo de la marca (no viaja). */
export interface TextBlockDraft {
  role: string | null; emphasisRole: string | null; shadow: 'on' | 'off' | null; strength: ShadowStrength | null;
}
export interface TextStyleDraft { headline: TextBlockDraft; sub: TextBlockDraft }

const BLOCK_VACIO: TextBlockDraft = { role: null, emphasisRole: null, shadow: null, strength: null };

/**
 * El borrador con el que abre el editor. `legacyShadow` es la sombra de TODO el texto que guardaban las correcciones
 * anteriores (`overlay_override.text_shadow`): sin elección propia, cada bloque abre con ella. PURO.
 */
export function textStyleDraftOf(ts: TextStyle | null | undefined, legacyShadow: 'on' | 'off' | null = null): TextStyleDraft {
  const b = (x: TextStyleBlock | undefined): TextBlockDraft => ({
    role: x?.role ?? null, emphasisRole: x?.emphasis_role ?? null,
    shadow: x?.text_shadow ?? legacyShadow, strength: x?.shadow_strength && x.shadow_strength !== 'brand' ? x.shadow_strength : null,
  });
  return { headline: b(ts?.headline), sub: b(ts?.sub) };
}

/** La bajada como marcado editable: `*resaltado*`, `~sombra al revés~` y `_cursiva_`, como el titular. PURO. */
export function subMarkupOf(sub: string | null | undefined, ts: TextStyle | null | undefined): string {
  return overlayMarkupOf(sub ?? '', ts?.sub?.emphasis ?? [], ts?.sub?.shadow_spans ?? [], ts?.sub?.italic_spans ?? []);
}

/** Del marcado de la bajada a su texto y sus tramos. Una sola línea: los saltos se leen como espacios. PURO. */
export function parseSubMarkup(markup: string): { ok: true; sub: string | null; emphasis: string[]; shadow_spans: string[]; italic_spans: string[] } | { ok: false; error: string } {
  const plano = String(markup ?? '').replace(/\s+/g, ' ').trim();
  if (!plano) return { ok: true, sub: null, emphasis: [], shadow_spans: [], italic_spans: [] };
  const p = parseOverlayMarkup(plano);
  if (!p.ok) return { ok: false, error: `En la bajada: ${p.error}` };
  return { ok: true, sub: p.headline, emphasis: p.emphasis, shadow_spans: p.shadow_spans, italic_spans: p.italic_spans };
}

/**
 * Lo que viaja como `text_style`: sólo lo elegido. `headlineSpans` y `headlineEmphasisRole` van aquí en las láminas
 * (en la imagen de la pieza viajan sueltos, como siempre). Sin nada elegido ⇒ null. PURO.
 */
export function textStylePayload(draft: TextStyleDraft, sub: { emphasis: string[]; shadow_spans: string[]; italic_spans?: string[] },
  headline: { shadow_spans?: string[]; emphasis_role_in_block?: boolean; italic_spans?: string[] } = {}): TextStyle | null {
  const blk = (d: TextBlockDraft, extra: Partial<TextStyleBlock>): TextStyleBlock | null => {
    const out: TextStyleBlock = {
      ...(d.role ? { role: d.role } : {}),
      ...(d.shadow ? { text_shadow: d.shadow } : {}),
      ...(d.strength ? { shadow_strength: d.strength } : {}),
      ...extra,
    };
    return Object.keys(out).length ? out : null;
  };
  const h = blk(draft.headline, {
    ...(headline.emphasis_role_in_block && draft.headline.emphasisRole ? { emphasis_role: draft.headline.emphasisRole } : {}),
    ...(headline.shadow_spans?.length ? { shadow_spans: headline.shadow_spans } : {}),
    // 2026-10-28 — la cursiva por tramo viaja siempre en el bloque (ImageLab ≥ 1.18.0).
    ...(headline.italic_spans?.length ? { italic_spans: headline.italic_spans } : {}),
  });
  const s = blk(draft.sub, {
    ...(sub.emphasis.length ? { emphasis: sub.emphasis } : {}),
    ...(sub.emphasis.length && draft.sub.emphasisRole ? { emphasis_role: draft.sub.emphasisRole } : {}),
    ...(sub.shadow_spans.length ? { shadow_spans: sub.shadow_spans } : {}),
    ...(sub.italic_spans?.length ? { italic_spans: sub.italic_spans } : {}),
  });
  const out: TextStyle = { ...(h ? { headline: h } : {}), ...(s ? { sub: s } : {}) };
  return Object.keys(out).length ? out : null;
}

/** El borrador de un bloque con un campo cambiado. PURO. */
export function withBlock(draft: TextStyleDraft, which: 'headline' | 'sub', patch: Partial<TextBlockDraft>): TextStyleDraft {
  return { ...draft, [which]: { ...(draft[which] ?? BLOCK_VACIO), ...patch } };
}

/** La ayuda del editor de la bajada. */
export const SUB_EDITOR_HELP = 'Bajada: *así* resalta, ~así~ invierte la sombra y _así_ pone (o quita) la cursiva en ese tramo, como en el titular.';
