import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  carouselTextViewOf, carouselViewAfterSlideSave, coverNoteOf, linesToSteps, readSlideTextRequest, slideTabLabel,
  slideTextDraftOf, slideTextPayload, stepsToLines, SLIDE_EYEBROW_MAX, SLIDE_HEADLINE_MAX,
} from './_carouselText.js';

/**
 * EL TEXTO CORREGIDO LLEGA A LAS LÁMINAS (2026-10-22). Medido ese día: «Texto de la imagen» recomponía sólo la imagen
 * de la pieza; la portada del carrusel y las láminas 2..N no cambiaban, y lo que se publica son las láminas. Estas
 * pruebas fijan qué ve el editor de cada lámina, qué viaja al motor, el cableado de la ruta y de la tarjeta, y que
 * ninguna vía nueva regenera la escena. La forma de las láminas es la medida en un carrusel real de 5.
 */
const U = (s: string) => `https://x/storage/${s}.png`;
const carrusel = () => ({
  format: 'carousel',
  assets: { carousel: { slides: [
    { n: 2, url: U('c2'), clean_url: U('l2'), headline: 'Observability changed more in months', subheadline: 'Systems now recommend action.', eyebrow: 'The shift', steps: null },
    { n: 1, url: U('c1'), clean_url: U('limpia'), headline: "You didn't stop deciding.", subheadline: null, eyebrow: null },
    { n: 3, url: U('c3'), clean_url: U('l3'), headline: "The machine isn't choosing", subheadline: 'The failure is the human.', eyebrow: 'The real failure',
      steps: [{ text: 'Uno', critical: true }, { text: 'Dos', critical: false }] },
    { n: 4, url: U('c4'), clean_url: null, headline: 'Sin limpia', subheadline: null, eyebrow: null },
    { n: 5, url: U('c5'), clean_url: U('l5'), headline: 'Keep a record', subheadline: 'And check it.', eyebrow: 'What to track' },
  ] } },
});

describe('lo que ve el editor', () => {
  it('las láminas en orden de publicación, con su rol y su texto', () => {
    const v = carouselTextViewOf(carrusel())!;
    expect(v.total).toBe(5);
    expect(v.slides.map((s) => [s.n, s.role])).toEqual([[1, 'cover'], [2, 'body'], [3, 'body'], [4, 'body'], [5, 'closing']]);
    expect(v.slides[2]).toMatchObject({ headline: "The machine isn't choosing", eyebrow: 'The real failure',
      steps: [{ text: 'Uno', critical: true }, { text: 'Dos', critical: false }], editable: true });
  });
  it('una lámina sin imagen limpia no se puede editar (la portada usa la de la pieza)', () => {
    const v = carouselTextViewOf(carrusel())!;
    expect(v.slides.find((s) => s.n === 4)!.editable).toBe(false);
    const sinLimpia = carrusel(); (sinLimpia.assets.carousel.slides[1] as any).clean_url = null;
    expect(carouselTextViewOf(sinLimpia)!.slides[0].editable).toBe(true);
  });
  it('no es carrusel: otro formato o menos de dos láminas', () => {
    expect(carouselTextViewOf({ ...carrusel(), format: 'post' })).toBeNull();
    expect(carouselTextViewOf({ format: 'carousel', assets: { carousel: { slides: [{ n: 1 }] } } })).toBeNull();
    expect(carouselTextViewOf(null)).toBeNull();
  });
  it('las etiquetas del selector', () => {
    expect(slideTabLabel({ n: 1, role: 'cover' })).toBe('1 · portada');
    expect(slideTabLabel({ n: 3, role: 'body' })).toBe('3');
    expect(slideTabLabel({ n: 5, role: 'closing' })).toBe('5 · cierre');
  });
});

describe('los pasos como líneas', () => {
  it('ida y vuelta; «!» marca el crítico y las líneas vacías sobran', () => {
    const steps = [{ text: 'Uno', critical: true }, { text: 'Dos', critical: false }];
    expect(stepsToLines(steps)).toBe('! Uno\nDos');
    expect(linesToSteps('! Uno\n\n  Dos  \n!')).toEqual(steps);
  });
});

describe('lo que viaja al motor', () => {
  const v = () => carouselTextViewOf(carrusel())!;
  const lamina = (n: number) => v().slides.find((s) => s.n === n)!;
  it('sólo los campos que cambiaron', () => {
    const d = { ...slideTextDraftOf(lamina(3)), headline: 'The human stops asking' };
    expect(slideTextPayload(lamina(3), d)).toEqual({ ok: true, value: { n: 3, headline: 'The human stops asking' }, changed: 1 });
    const d2 = { ...slideTextDraftOf(lamina(3)), subheadline: '  ', steps: '' };
    expect(slideTextPayload(lamina(3), d2)).toEqual({ ok: true, value: { n: 3, subheadline: null, steps: null }, changed: 2 });
  });
  it('sin cambios: cero campos', () => {
    expect(slideTextPayload(lamina(2), slideTextDraftOf(lamina(2)))).toEqual({ ok: true, value: { n: 2 }, changed: 0 });
  });
  it('lo que no se puede componer se dice antes del viaje', () => {
    expect(slideTextPayload(lamina(1), slideTextDraftOf(lamina(1))).ok).toBe(false);
    expect(slideTextPayload(lamina(4), slideTextDraftOf(lamina(4))).ok).toBe(false);
    const d = slideTextDraftOf(lamina(3));
    expect(slideTextPayload(lamina(3), { ...d, headline: ' ' }).ok).toBe(false);
    expect(slideTextPayload(lamina(3), { ...d, headline: 'x'.repeat(SLIDE_HEADLINE_MAX + 1) }).ok).toBe(false);
    expect(slideTextPayload(lamina(3), { ...d, eyebrow: 'x'.repeat(SLIDE_EYEBROW_MAX + 1) }).ok).toBe(false);
    expect(slideTextPayload(lamina(3), { ...d, steps: '! a\n! b' }).ok).toBe(false);
    expect(slideTextPayload(lamina(3), { ...d, steps: 'a\nb\nc\nd\ne\nf' }).ok).toBe(false);
  });
  it('la ruta acepta una lámina 2..N con sus campos y nada más', () => {
    expect(readSlideTextRequest({ n: 3, headline: 'x' })).toEqual({ ok: true, value: { n: 3, headline: 'x' } });
    expect(readSlideTextRequest({ n: 1, headline: 'x' }).ok).toBe(false);
    expect(readSlideTextRequest({ n: 3 }).ok).toBe(false);
    expect(readSlideTextRequest({ n: 3, cta: 'x' }).ok).toBe(false);
    expect(readSlideTextRequest({ n: 'tres', headline: 'x' }).ok).toBe(false);
    expect(readSlideTextRequest([{ n: 3 }]).ok).toBe(false);
  });
  it('la vista queda con lo guardado, sin esperar otra lectura', () => {
    const after = carouselViewAfterSlideSave(v(), { n: 3, headline: 'Nuevo', steps: null });
    expect(after.slides.find((s) => s.n === 3)).toMatchObject({ headline: 'Nuevo', steps: [], eyebrow: 'The real failure' });
    expect(after.slides.find((s) => s.n === 2)).toEqual(v().slides.find((s) => s.n === 2));
  });
  it('lo que la tarjeta dice de la portada', () => {
    expect(coverNoteOf(null)).toBeNull();
    expect(coverNoteOf(true)!.tone).toBe('ok');
    expect(coverNoteOf('CAROUSEL_COMPOSE_FAILED en la lámina 1')).toMatchObject({ tone: 'alert' });
  });
});

describe('el cableado', () => {
  const sinComentarios = (src: string) => src.split('\n')
    .filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('{/*'); }).join('\n');
  const API = sinComentarios(readFileSync(new URL('./recompose-image.ts', import.meta.url), 'utf8'));
  const MOD = sinComentarios(readFileSync(new URL('../src/modules/iid/pieceActions.tsx', import.meta.url), 'utf8'));
  const SERVICE = readFileSync(new URL('../src/services/calibrationInbox.ts', import.meta.url), 'utf8');
  const rama = API.slice(API.indexOf('async function textoDeLaLamina('));

  it('la rama slide_text va antes de exigir directriz y después de la guarda de pieza sellada', () => {
    const sellada = API.indexOf('piece.discarded_at');
    const lamina = API.indexOf('if (body.slide_text !== undefined) return textoDeLaLamina(');
    const directriz = API.indexOf("error: 'visual_directive required'");
    expect(sellada).toBeGreaterThan(-1);
    expect(lamina).toBeGreaterThan(sellada);
    expect(lamina).toBeLessThan(directriz);
  });
  it('llama a carousel_recompose con slides_text y el actor, nunca a recompose: no genera escena', () => {
    expect(rama).toContain("action: 'carousel_recompose', piece_id: pieceId, slides_text: [pedido.value],");
    expect(rama).toContain('edited_by: by,');
    for (const prohibido of ["action: 'recompose'", 'regenerate_image', 'visual_directive: directive', "'carousel_slide'", 'mode,']) {
      expect(rama, `la rama de la lámina no puede llevar \`${prohibido}\``).not.toContain(prohibido);
    }
  });
  it('exige el acuse del motor y rehace el artefacto', () => {
    expect(rama).toContain('if (ef.body.slides_text_applied !== true) {');
    expect(rama).toContain("error: 'slides_text_unsupported'");
    expect(rama.indexOf('ensureArtifact(pieceId)')).toBeGreaterThan(rama.indexOf("callEdgeFunction('content-run-stage'"));
    expect(rama).toContain("error: 'not_carousel'");
  });
  it('la portada sigue la vía de siempre, y la respuesta dice qué pasó con la lámina 1', () => {
    expect(API).toContain("action: 'recompose', piece_id: pieceId, regenerate_image: false,");
    expect(API).toContain('carousel_recomposed: ef.body.carousel_recomposed ?? null,');
  });
  it('el GET entrega las láminas para el selector', () => {
    expect(API).toContain('carousel: carouselTextViewOf(piece),');
    expect(SERVICE).toContain('carousel?: CarouselTextView | null;');
  });
  it('la tarjeta: selector de lámina, la 1 por el texto de la imagen, las demás por slide_text, y refresca la vista', () => {
    expect(MOD).toContain("if (regenTab === 'text') return laminaElegida ? submitSlideText() : submitOverlay(false);");
    expect(MOD).toContain('const laminaElegida = slideN > 1 ? carouselView?.slides.find((s) => s.n === slideN) ?? null : null;');
    expect(MOD).toContain('setCarouselView(r.carousel ?? null);');
    expect(MOD).toContain('aria-label="Lámina del carrusel"');
    const i = MOD.indexOf('const submitSlideText');
    const cuerpo = MOD.slice(i, MOD.indexOf('const pickSlot', i));
    // 2026-10-22 — `value` es `p.value` más la ubicación del texto si se eligió (`_textPlace.ts`).
    expect(cuerpo).toContain('await saveSlideText(token, piece.piece_id, value)');
    expect(cuerpo).toContain('onRegenerated?.({ html: r.html');
    expect(cuerpo, 'la lámina no es un veredicto').not.toContain('saveVerdict');
    expect(cuerpo).not.toContain('recomposeImage(');
    expect(SERVICE).toContain("body: { piece_id: pieceId, slide_text: slide, edit_reason: editReason ?? null },");
  });
});

describe('ninguna marca', () => {
  it('el módulo no nombra marca ni ciudad', () => {
    const src = readFileSync(new URL('./_carouselText.ts', import.meta.url), 'utf8').toLowerCase();
    for (const p of ['neurone', 'nscf', 'forumph', 'fphs', 'lucien', 'unrealville', 'miami', 'panam']) expect(src).not.toContain(p);
  });
});
