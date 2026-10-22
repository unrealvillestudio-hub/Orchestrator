import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  readTextPlaceRequest, storedTextPlace, textPlaceLabel, textPlaceNoteOf, textPlaceOfImage, textPlaceToSend,
  TEXT_PLACE_CHOICES, TEXT_PLACES,
} from './_textPlace.js';
import { carouselTextViewOf, carouselViewAfterSlideSave, readSlideTextRequest } from './_carouselText.js';

/**
 * LA UBICACIÓN DEL TEXTO DE LA IMAGEN, DESDE LA BANDEJA (2026-10-22). Sam, mirando piezas en Arreglos: «quiero poder
 * solicitar en los 3 tabs (calibración, arreglos y publish) que se cambie la ubicación del texto arriba, abajo o
 * recomponer para que no tape el objetivo o el producto». Estas pruebas fijan las tres opciones, qué viaja al motor,
 * el cableado de la ruta y de la tarjeta (sola, con «Recomponer», o junto con el texto), y que el selector está en el
 * único componente de acciones que montan las tres bandejas.
 */
const U = (s: string) => `https://x/storage/${s}.png`;
const carrusel = (imagen: Record<string, unknown> = {}) => ({
  format: 'carousel',
  assets: {
    image: { url: U('compuesta'), clean_url: U('limpia'), ...imagen },
    carousel: { slides: [
      { n: 1, url: U('c1'), clean_url: U('limpia'), headline: 'La cosecha no espera', text_place: 'bottom' },
      { n: 2, url: U('c2'), clean_url: U('l2'), headline: 'El clima cambió', text_place: 'top' },
      { n: 3, url: U('c3'), clean_url: U('l3'), headline: 'Siembra con datos', text_place: 'en medio' },
    ] },
  },
});

describe('las tres opciones', () => {
  it('arriba, abajo y que no tape cara ni producto, en ese orden', () => {
    expect([...TEXT_PLACES]).toEqual(['top', 'bottom', 'auto']);
    expect(TEXT_PLACE_CHOICES.map((c) => [c.value, c.label])).toEqual([
      ['top', 'Arriba'], ['bottom', 'Abajo'], ['auto', 'Que no tape cara ni producto'],
    ]);
  });
  it('lo que la ruta acepta: la lista, o null para volver a la marca; otro valor es un error antes del viaje', () => {
    expect(readTextPlaceRequest('top')).toEqual({ ok: true, value: 'top' });
    expect(readTextPlaceRequest(null)).toEqual({ ok: true, value: null });
    expect(readTextPlaceRequest('')).toEqual({ ok: true, value: null });
    expect(readTextPlaceRequest('arriba')).toMatchObject({ ok: false });
    expect(storedTextPlace('auto')).toBe('auto');
    expect(storedTextPlace('en medio')).toBeNull();
  });
  it('junto con el texto, viaja sólo si se eligió y cambió', () => {
    expect(textPlaceToSend(null, 'top')).toBeNull();
    expect(textPlaceToSend('top', 'top')).toBeNull();
    expect(textPlaceToSend('bottom', 'top')).toBe('bottom');
    expect(textPlaceToSend('auto', null)).toBe('auto');
  });
  it('lo que dice la tarjeta', () => {
    expect(textPlaceLabel(null)).toBe('como la marca');
    expect(textPlaceLabel('auto')).toBe('Que no tape cara ni producto');
    expect(textPlaceNoteOf('top', null)).toBe('La imagen se recompuso con el texto arriba, sobre su misma foto (0 USD).');
    expect(textPlaceNoteOf('bottom', 3)).toMatch(/^La lámina 3 se recompuso con el texto abajo/);
    expect(textPlaceNoteOf('auto', 1)).toMatch(/^La imagen se recompuso con el texto donde no tapa cara ni producto/);
  });
});

describe('el carrusel', () => {
  it('la portada muestra la fila de la imagen de la pieza; cada lámina, la suya; un valor raro no cuenta', () => {
    const v = carouselTextViewOf(carrusel({ text_place: 'top' }))!;
    expect(v.slides.map((s) => s.text_place)).toEqual(['top', 'top', null]);
    expect(carouselTextViewOf(carrusel())!.slides[0].text_place).toBeNull();
    expect(textPlaceOfImage(carrusel({ text_place: 'auto' }).assets)).toBe('auto');
  });
  it('slide_text acepta la ubicación sola, y la valida', () => {
    expect(readSlideTextRequest({ n: 2, text_place: 'bottom' })).toEqual({ ok: true, value: { n: 2, text_place: 'bottom' } });
    expect(readSlideTextRequest({ n: 2, text_place: null })).toEqual({ ok: true, value: { n: 2, text_place: null } });
    expect(readSlideTextRequest({ n: 2, text_place: 'arriba' })).toMatchObject({ ok: false });
    expect(readSlideTextRequest({ n: 1, text_place: 'top' })).toMatchObject({ ok: false });
  });
  it('después de guardar, la vista lleva la ubicación nueva sin otra lectura', () => {
    const v = carouselTextViewOf(carrusel())!;
    const after = carouselViewAfterSlideSave(v, { n: 2, text_place: 'auto' });
    expect(after.slides.find((s) => s.n === 2)!.text_place).toBe('auto');
    expect(after.slides.find((s) => s.n === 2)!.headline).toBe('El clima cambió');
  });
});

describe('el cableado', () => {
  const sinComentarios = (src: string) => src.split('\n')
    .filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('{/*'); }).join('\n');
  const API = sinComentarios(readFileSync(new URL('./recompose-image.ts', import.meta.url), 'utf8'));
  const MOD = sinComentarios(readFileSync(new URL('../src/modules/iid/pieceActions.tsx', import.meta.url), 'utf8'));
  const SERVICE = readFileSync(new URL('../src/services/calibrationInbox.ts', import.meta.url), 'utf8');

  it('la ruta: se valida antes del viaje y va por la rama sin generar, sola o con el texto', () => {
    expect(API).toContain("const conUbicacion = Object.prototype.hasOwnProperty.call(body, 'text_place');");
    expect(API).toContain("if (ubicacion && !ubicacion.ok) return res.status(400).json({ error: 'invalid text_place', detail: ubicacion.error });");
    const i = API.indexOf('if (conTexto || conUbicacion) {');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(API.indexOf('regenerate_image: true'));
    const rama = API.slice(i, API.indexOf("const modeRaw"));
    expect(rama).toContain('regenerate_image: false');
    expect(rama).toContain('...(ubicacion && ubicacion.ok ? { text_place: ubicacion.value } : {}),');
    expect(rama).toContain('...(conTexto ? { overlay_override: body.overlay_override ?? null } : {}),');
    expect(rama, 'no lleva directriz: no genera escena').not.toContain('visual_directive: directive');
  });
  it('la ruta exige el acuse del motor y el GET entrega la ubicación guardada', () => {
    expect(API).toContain('if (conUbicacion && ef.body.text_place_applied !== true) {');
    expect(API).toContain("error: 'text_place_unsupported'");
    expect(API).toContain('text_place: textPlaceOfImage(piece.assets),');
    expect(SERVICE).toContain("...('text_place' in input ? { text_place: input.text_place ?? null } : {}),");
  });
  it('la tarjeta: selector de tres opciones y «Recomponer» que manda sólo la ubicación', () => {
    expect(MOD).toContain('aria-label="Ubicación del texto"');
    expect(MOD).toContain('{TEXT_PLACE_CHOICES.map((c) => (');
    expect(MOD).toContain('onClick={submitPlace}');
    expect(MOD).toContain('Recomponer');
    const i = MOD.indexOf('const submitPlace');
    const cuerpo = MOD.slice(i, MOD.indexOf('const submitRegen', i));
    expect(cuerpo).toContain("await recomposeImage(token, { piece_id: piece.piece_id, visual_directive: '', text_place: placeSel })");
    expect(cuerpo).toContain('await saveSlideText(token, piece.piece_id, out)');
    expect(cuerpo, 'la lámina 2..N por su vía; la portada, por la imagen').toContain('if (laminaElegida && carouselView) {');
    expect(cuerpo).toContain('onRegenerated?.({ html: r.html');
    for (const prohibido of ['saveVerdict', 'mode:', 'overlay_override', 'headline']) expect(cuerpo).not.toContain(prohibido);
  });
  it('la tarjeta: con «Aplicar texto», la ubicación elegida viaja si cambió', () => {
    expect(MOD).toContain('const lugar = clear ? null : textPlaceToSend(placeSel, placeVigente);');
    expect(MOD).toContain('const lugar = textPlaceToSend(placeSel, laminaElegida.text_place);');
    expect(MOD).toContain('setPlaceVigente(r.text_place ?? null);');
  });
  it('el selector vive en el único componente de acciones, y las tres bandejas lo montan', () => {
    for (const f of ['ApprovalCalibrationModule', 'ChallengedInboxModule', 'PublishQueueModule']) {
      const src = readFileSync(new URL(`../src/modules/iid/${f}.tsx`, import.meta.url), 'utf8');
      expect(src, f).toContain("from './pieceActions'");
      expect(src, f).toContain('<PieceActionsBar');
    }
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(app).toContain("label: 'Calibración'");
    expect(app).toContain("label: 'Arreglos'");
    expect(app).toContain("label: 'Publicación'");
  });
});

describe('ninguna marca', () => {
  it('el módulo no nombra marca ni ciudad', () => {
    const src = readFileSync(new URL('./_textPlace.ts', import.meta.url), 'utf8').toLowerCase();
    for (const p of ['neurone', 'nscf', 'forumph', 'fphs', 'lucien', 'unrealville', 'miami', 'panam']) expect(src).not.toContain(p);
  });
});
