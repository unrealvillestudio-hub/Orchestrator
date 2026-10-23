import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { textStyleOf, textColorOptions, textStyleDraftOf, subMarkupOf, parseSubMarkup, textStylePayload, withBlock, SHADOW_STRENGTH_CHOICES } from './_textStyle.js';
import { imageOverlayOf, overlayViewAfterApply } from './_overlayText.js';
import { carouselTextViewOf, readSlideTextRequest, carouselViewAfterSlideSave } from './_carouselText.js';

// 2026-10-23 — Sam, sobre affe6b7c: elegir por bloque (título y bajada) el color del texto, el resaltado y su color,
// la sombra y su grosor; también en el carrusel. Marca INVENTADA: otro rubro, otro idioma.
const PAL = [
  { role: 'lino', hex: '#F4EFE6' }, { role: 'gris', hex: '#B8B0A8' }, { role: 'tinta', hex: '#141210' },
  { role: 'trigo', hex: '#D9A441' }, { role: 'hoja', hex: '#2F7A3D' },
];
const FILAS = (palette: Record<string, unknown> = {}) => [
  { brand_id: null, canal: null, tokens: { layout: { text_effect: { kind: 'shadow' } } } },
  { brand_id: 'Granja', canal: null, tokens: { palette: { headline: 'lino', subheadline: 'gris', headline_emphasis: 'trigo', ...palette },
    layout: { emphasis_contrast: { fallbacks: ['hoja'] } } } },
];

describe('la forma guardada', () => {
  it('se lee lo que tiene forma; lo demás se descarta', () => {
    expect(textStyleOf({ headline: { role: 'tinta', shadow_strength: 'heavy' }, sub: { emphasis: ['a'], text_shadow: 'off', role: 'Mal' } }))
      .toEqual({ headline: { role: 'tinta', shadow_strength: 'heavy' }, sub: { emphasis: ['a'], text_shadow: 'off' } });
    expect(textStyleOf({ headline: { emphasis: ['no va en el titular'] } })).toBeNull();
    expect(textStyleOf(null)).toBeNull(); expect(textStyleOf('x')).toBeNull();
  });
  it('la imagen de la pieza la muestra sólo si la hay: sin ella, la vista de siempre', () => {
    const con = imageOverlayOf({ image: { overlay_override: { headline: 'A b', subheadline: 'c d', emphasis: [], text_style: { sub: { role: 'lino' } } } } });
    expect(con?.text_style).toEqual({ sub: { role: 'lino' } });
    const sin = imageOverlayOf({ image: { overlay_override: { headline: 'A b', emphasis: [] } } });
    expect(sin && 'text_style' in sin).toBe(false);
    expect(overlayViewAfterApply({ headline: 'A', subheadline: 'b', emphasis: [], text_style: { headline: { role: 'tinta' } } })?.text_style)
      .toEqual({ headline: { role: 'tinta' } });
  });
});

describe('los colores del texto', () => {
  it('los suyos, el más claro y el más oscuro de la paleta y los accent; con el de siempre de cada bloque', () => {
    const o = textColorOptions(FILAS(), PAL, 'Granja');
    expect(o.options.map((x) => x.role)).toEqual(['lino', 'gris', 'tinta', 'trigo', 'hoja']);
    expect(o.headline_default).toBe('lino'); expect(o.sub_default).toBe('gris');
  });
  it('con `palette.text_options`, esos en lugar de los extremos', () => {
    expect(textColorOptions(FILAS({ text_options: ['hoja'] }), PAL, 'Granja').options.map((x) => x.role)).toEqual(['lino', 'gris', 'hoja', 'trigo']);
  });
  it('un rol que la paleta no tiene no se ofrece', () => {
    expect(textColorOptions(FILAS({ text_options: ['nada'] }), PAL, 'Granja').options.map((x) => x.role)).not.toContain('nada');
  });
});

describe('el borrador y lo que viaja', () => {
  it('la bajada se edita con marcas y vuelve a su texto plano y sus tramos', () => {
    const ts = { sub: { emphasis: ['el vecino'], shadow_spans: ['No fue'] } };
    const m = subMarkupOf('No fue el clima. Fue el vecino.', ts);
    expect(m).toBe('~No fue~ el clima. Fue *el vecino*.');
    expect(parseSubMarkup(m)).toEqual({ ok: true, sub: 'No fue el clima. Fue el vecino.', emphasis: ['el vecino'], shadow_spans: ['No fue'] });
    expect(parseSubMarkup('')).toEqual({ ok: true, sub: null, emphasis: [], shadow_spans: [] });
    const mal = parseSubMarkup('a *b');
    expect(mal.ok).toBe(false);
    if (!mal.ok) expect(mal.error).toMatch(/^En la bajada: /);
  });
  it('sólo viaja lo elegido; nada elegido es null', () => {
    const d0 = textStyleDraftOf(null);
    expect(textStylePayload(d0, { emphasis: [], shadow_spans: [] })).toBeNull();
    const d = withBlock(withBlock(d0, 'headline', { role: 'tinta', strength: 'strong' }), 'sub', { role: 'lino', shadow: 'on', strength: 'heavy', emphasisRole: 'hoja' });
    expect(textStylePayload(d, { emphasis: ['el vecino'], shadow_spans: [] })).toEqual({
      headline: { role: 'tinta', shadow_strength: 'strong' },
      sub: { role: 'lino', text_shadow: 'on', shadow_strength: 'heavy', emphasis: ['el vecino'], emphasis_role: 'hoja' },
    });
    expect(textStylePayload(d, { emphasis: [], shadow_spans: [] })?.sub, 'sin resaltado no viaja su color').toEqual({ role: 'lino', text_shadow: 'on', shadow_strength: 'heavy' });
  });
  it('en la lámina, el color de la palabra clave va en el bloque del titular', () => {
    const d = withBlock(textStyleDraftOf(null), 'headline', { emphasisRole: 'hoja' });
    expect(textStylePayload(d, { emphasis: [], shadow_spans: [] })).toBeNull();
    expect(textStylePayload(d, { emphasis: [], shadow_spans: [] }, { emphasis_role_in_block: true })).toEqual({ headline: { emphasis_role: 'hoja' } });
  });
  it('el borrador abre con lo guardado; «la de la marca» no se guarda como paso', () => {
    expect(textStyleDraftOf({ sub: { role: 'lino', shadow_strength: 'brand', text_shadow: 'off' } }).sub)
      .toEqual({ role: 'lino', emphasisRole: null, shadow: 'off', strength: null });
    expect(SHADOW_STRENGTH_CHOICES.map((c) => c.value)).toEqual([null, 'soft', 'strong', 'heavy']);
  });
});

describe('las láminas', () => {
  const pieza = {
    format: 'carousel',
    assets: { image: { overlay_override: { headline: 'A', text_style: { headline: { role: 'tinta' } } } }, carousel: { slides: [
      { n: 1, headline: 'A', clean_url: 'u1' }, { n: 2, headline: 'B', subheadline: 'c d', clean_url: 'u2', text_style: { sub: { role: 'lino' } } },
      { n: 3, headline: 'C', clean_url: 'u3' },
    ] } },
  };
  it('la vista lleva el de cada lámina; la portada, el de la imagen; sin elección, la lámina de siempre', () => {
    const v = carouselTextViewOf(pieza)!;
    expect(v.slides[0].text_style).toEqual({ headline: { role: 'tinta' } });
    expect(v.slides[1].text_style).toEqual({ sub: { role: 'lino' } });
    expect('text_style' in v.slides[2]).toBe(false);
  });
  it('la ruta acepta text_style (objeto o null) y la vista lo guarda', () => {
    const r = readSlideTextRequest({ n: 2, text_style: { sub: { role: 'tinta' } } });
    expect(r.ok && r.value.text_style).toEqual({ sub: { role: 'tinta' } });
    expect(readSlideTextRequest({ n: 2, text_style: 'x' }).ok).toBe(false);
    const v = carouselViewAfterSlideSave(carouselTextViewOf(pieza)!, { n: 2, text_style: { sub: { role: 'tinta' } } });
    expect(v.slides[1].text_style).toEqual({ sub: { role: 'tinta' } });
  });
});

describe('el cableado', () => {
  const sin = (s: string) => s.split('\n').filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('{/*'); }).join('\n');
  const API = sin(readFileSync(new URL('./recompose-image.ts', import.meta.url), 'utf8'));
  const MOD = sin(readFileSync(new URL('../src/modules/iid/pieceActions.tsx', import.meta.url), 'utf8'));
  it('el GET sirve los colores del texto', () => {
    expect(API).toContain('text_colors: textColorOptions(tokens, palette, brandId),');
  });
  it('sin acuse del motor, 409: la pantalla no dice que se aplicó lo que no', () => {
    expect(API).toContain("if (conEstilo && ef.body.text_style_applied !== true) {");
    expect(API).toContain("if (pedido.value.text_style && ef.body.text_style_applied !== true) {");
    expect((API.match(/error: 'text_style_unsupported'/g) ?? []).length).toBe(2);
  });
  it('el editor manda la bajada plana con sus tramos en text_style, en la imagen y en la lámina', () => {
    expect(MOD).toContain('const subP = parseSubMarkup(overlaySub);');
    expect(MOD).toContain('override = { headline: parsed.headline, subheadline: subP.sub, emphasis: parsed.emphasis,');
    expect(MOD).toContain('...(estilo ? { text_style: estilo } : {}),');
    expect(MOD).toContain("const p = slideTextPayload(laminaElegida, { ...slideDraft, subheadline: subP.sub ?? '' });");
    expect(MOD).toContain('...(estiloCambia ? { text_style: estilo } : {})');
  });
  it('sin marcas en el código', () => {
    for (const f of ['./_textStyle.ts', './_textStyleShape.ts', '../src/modules/iid/TextStyleControls.tsx']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      for (const lit of ['ForumPHs', 'NeuroneSCF', 'UnrealvilleStudio', 'LucienSael', 'terra', 'cream', 'dust']) expect(src.includes(lit), `${f} nombra ${lit}`).toBe(false);
    }
  });
});
