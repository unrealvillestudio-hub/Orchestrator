import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { TEXT_COLUMN_CHOICES, storedTextColumn, textColumnOfImage, readTextColumnRequest, textColumnLabel, textColumnToSend, textLayoutNoteOf } from './_textColumn.js';
import { carouselTextViewOf, readSlideTextRequest, carouselViewAfterSlideSave } from './_carouselText.js';

// 2026-10-24 — Sam: «incluir la opción de alinear a la izquierda o derecha también», «incluye centro».
describe('la columna del texto', () => {
  it('tres opciones, en orden; lo guardado sólo cuenta si es de la lista', () => {
    expect(TEXT_COLUMN_CHOICES.map((c) => c.value)).toEqual(['left', 'center', 'right']);
    expect(storedTextColumn('right')).toBe('right'); expect(storedTextColumn('derecha')).toBeNull();
    expect(textColumnOfImage({ image: { text_column: 'center' } })).toBe('center');
    expect(textColumnOfImage({ image: {} })).toBeNull();
  });
  it('la ruta: null o vacío vuelve a la marca; otro valor, error antes del viaje', () => {
    expect(readTextColumnRequest(null)).toEqual({ ok: true, value: null });
    expect(readTextColumnRequest('left')).toEqual({ ok: true, value: 'left' });
    expect(readTextColumnRequest('izquierda').ok).toBe(false);
  });
  it('viaja sólo si se eligió y cambió; la etiqueta y la nota lo dicen', () => {
    expect(textColumnToSend(null, 'left')).toBeNull();
    expect(textColumnToSend('left', 'left')).toBeNull();
    expect(textColumnToSend('right', 'left')).toBe('right');
    expect(textColumnLabel(null)).toBe('como la marca'); expect(textColumnLabel('right')).toBe('derecha');
    expect(textLayoutNoteOf('top', 'right', null)).toBe('La imagen se recompuso con el texto arriba y a la derecha, sobre su misma foto (0 USD).');
    expect(textLayoutNoteOf(null, 'center', 3)).toBe('La lámina 3 se recompuso con el texto al centro, sobre su misma foto (0 USD).');
  });
  it('las láminas: la vista la lleva (la portada, la de la imagen), la ruta la acepta y la vista la guarda', () => {
    const pieza = { format: 'carousel', assets: { image: { text_column: 'right' }, carousel: { slides: [
      { n: 1, headline: 'A', clean_url: 'u1' }, { n: 2, headline: 'B', clean_url: 'u2', text_column: 'left' }, { n: 3, headline: 'C', clean_url: 'u3' },
    ] } } };
    const v = carouselTextViewOf(pieza)!;
    expect(v.slides.map((s) => s.text_column)).toEqual(['right', 'left', null]);
    const r = readSlideTextRequest({ n: 3, text_column: 'center' });
    expect(r.ok && r.value).toEqual({ n: 3, text_column: 'center' });
    expect(readSlideTextRequest({ n: 3, text_column: 'x' }).ok).toBe(false);
    expect(carouselViewAfterSlideSave(v, { n: 3, text_column: 'center' }).slides[2].text_column).toBe('center');
  });
});

describe('el cableado', () => {
  const sin = (s: string) => s.split('\n').filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('{/*'); }).join('\n');
  const API = sin(readFileSync(new URL('./recompose-image.ts', import.meta.url), 'utf8'));
  const SERVICE = sin(readFileSync(new URL('../src/services/calibrationInbox.ts', import.meta.url), 'utf8'));
  const MOD = sin(readFileSync(new URL('../src/modules/iid/pieceActions.tsx', import.meta.url), 'utf8'));
  it('la ruta la valida, la manda sin generar y exige el acuse (en la imagen y en la lámina)', () => {
    expect(API).toContain("if (columna && !columna.ok) return res.status(400).json({ error: 'invalid text_column', detail: columna.error });");
    expect(API).toContain('...(columna && columna.ok ? { text_column: columna.value } : {}),');
    expect((API.match(/error: 'text_column_unsupported'/g) ?? []).length).toBe(2);
    expect(API).toContain('text_column: textColumnOfImage(piece.assets),');
    expect(SERVICE).toContain("...('text_column' in input ? { text_column: input.text_column ?? null } : {}),");
  });
  it('la tarjeta: el selector, «Aplicar texto» y «Recomponer» la llevan sólo si se eligió', () => {
    expect(MOD).toContain('aria-label="Columna del texto"');
    expect(MOD).toContain('{TEXT_COLUMN_CHOICES.map((c) => (');
    expect(MOD).toContain('const columna = clear ? null : textColumnToSend(colSel, colVigente);');
    expect(MOD).toContain('const columna = textColumnToSend(colSel, laminaElegida.text_column);');
    expect(MOD).toContain('setColVigente(r.text_column ?? null);');
  });
  it('sin marcas', () => {
    const src = readFileSync(new URL('./_textColumn.ts', import.meta.url), 'utf8');
    for (const lit of ['ForumPHs', 'NeuroneSCF', 'UnrealvilleStudio', 'LucienSael']) expect(src.includes(lit)).toBe(false);
  });
});
