import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { imageOverlayOf, overlayMarkupOf, parseOverlayMarkup } from './_overlayText.js';

/**
 * EL TEXTO DE LA IMAGEN SE ESCRIBE EN LA BANDEJA (2026-10-19). Sam: ajustar «en sitio» dónde se corta cada
 * línea, qué palabras van resaltadas y el texto mismo, y que «solo cambie en la imagen». Los titulares de
 * estas pruebas son los de sus capturas del 2026-10-19.
 */
describe('del marcado a lo que el motor espera', () => {
  it('Enter es línea y *así* es resaltado', () => {
    expect(parseOverlayMarkup('¿Por qué el color\n*SE VA ANTES*\nde la próxima cita?'))
      .toEqual({ ok: true, headline: '¿Por qué el color\nSE VA ANTES\nde la próxima cita?', emphasis: ['SE VA ANTES'] });
  });
  it('líneas vacías y espacios sobran; un resaltado repetido cuenta una vez', () => {
    expect(parseOverlayMarkup('  Tu *PUNTA* y tu *RAÍZ*  \n\n no tienen la misma edad. '))
      .toEqual({ ok: true, headline: 'Tu PUNTA y tu RAÍZ\nno tienen la misma edad.', emphasis: ['PUNTA', 'RAÍZ'] });
  });
  it('lo que no se puede componer se dice antes de mandar nada', () => {
    expect(parseOverlayMarkup('').ok).toBe(false);
    expect(parseOverlayMarkup('Hola *mundo').ok).toBe(false);
    expect(parseOverlayMarkup('Hola ** mundo').ok).toBe(false);
    expect(parseOverlayMarkup('*a* *b* *c* *d*').ok).toBe(false);
    expect(parseOverlayMarkup('x'.repeat(301)).ok).toBe(false);
  });
});

describe('de lo que la imagen lleva al marcado', () => {
  it('marca el énfasis entre asteriscos, el más largo primero', () => {
    expect(overlayMarkupOf('Nunca te preguntó DÓNDE VIVES.', ['DÓNDE VIVES'])).toBe('Nunca te preguntó *DÓNDE VIVES*.');
    expect(overlayMarkupOf('75 MINUTOS de blowout. MENOS DE 5 en el estacionamiento.', ['75 MINUTOS', 'MENOS DE 5']))
      .toBe('*75 MINUTOS* de blowout. *MENOS DE 5* en el estacionamiento.');
  });
  it('ida y vuelta: el marcado de lo compuesto se vuelve a leer igual', () => {
    const h = '¿Por qué el color SE VA ANTES de la próxima cita?';
    expect(parseOverlayMarkup(overlayMarkupOf(h, ['SE VA ANTES']))).toEqual({ ok: true, headline: h, emphasis: ['SE VA ANTES'] });
  });
});

describe('lo que la tarjeta recibe', () => {
  it('lo escrito a mano manda y se marca como escrito', () => {
    expect(imageOverlayOf({ image: { overlay_override: { headline: 'A\nB', subheadline: null, emphasis: ['B'] }, overlay: { headline: 'otro' } } }))
      .toEqual({ headline: 'A\nB', subheadline: null, emphasis: ['B'], written: true });
  });
  it('sin texto escrito, lo que se compuso', () => {
    expect(imageOverlayOf({ image: { overlay: { headline: 'Compuesto', subheadline: 'Bajada', emphasis: [] } } }))
      .toEqual({ headline: 'Compuesto', subheadline: 'Bajada', emphasis: [], written: false });
  });
  it('sin imagen o sin texto, null', () => {
    expect(imageOverlayOf({})).toBeNull();
    expect(imageOverlayOf({ image: { overlay: null } })).toBeNull();
  });
});

describe('el cableado', () => {
  const sinComentarios = (src: string) => src.split('\n')
    .filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('{/*'); }).join('\n');
  const API = sinComentarios(readFileSync(new URL('./recompose-image.ts', import.meta.url), 'utf8'));
  const MOD = sinComentarios(readFileSync(new URL('../src/modules/iid/pieceActions.tsx', import.meta.url), 'utf8'));
  it('con texto de la imagen no se regenera la escena ni se pide directriz', () => {
    expect(API).toContain('if (tieneImagen && !directive && !conTexto) {');
    const i = API.indexOf('if (conTexto) {');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(API.indexOf("regenerate_image: true"), 'la rama del texto sale antes de la que regenera');
    expect(API.slice(i, i + 900)).toContain('regenerate_image: false');
    expect(API).toContain('if (ef.body.overlay_override_applied !== true) {');
  });
  it('el panel manda el texto parseado, y null para volver al copy', () => {
    expect(MOD).toContain('overlay_override: override');
    expect(MOD).toContain('submitOverlay(true)');
  });
});
