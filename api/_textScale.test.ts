import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  TEXT_SCALE_MAX, TEXT_SCALE_MIN, clampTextScale, readTextScaleRequest, storedTextScale, textScaleLabel, textScaleOfImage, textScaleToSend,
} from './_textScale';

describe('el tamaño del texto de la imagen (Sam, 2026-10-28: «el zoom es para el embedded text»)', () => {
  it('de 70 % a 130 % en pasos de 5 %; 1 es el de la marca', () => {
    expect([TEXT_SCALE_MIN, TEXT_SCALE_MAX]).toEqual([0.7, 1.3]);
    expect(clampTextScale(0.5)).toBe(0.7);
    expect(clampTextScale(2)).toBe(1.3);
    expect(clampTextScale('1.07')).toBe(1.05);
    expect(clampTextScale('x')).toBe(1);
    expect(textScaleLabel(null)).toBe('100 %');
    expect(textScaleLabel(0.85)).toBe('85 %');
  });

  it('lo guardado sólo cuenta dentro del rango y distinto de 1', () => {
    expect(storedTextScale(1.1)).toBe(1.1);
    for (const v of [1, 0.6, 1.4, '1.1', null, undefined]) expect(storedTextScale(v)).toBeNull();
    expect(textScaleOfImage({ image: { text_scale: 0.9 } })).toBe(0.9);
    expect(textScaleOfImage({})).toBeNull();
  });

  it('la ruta: null, vacío o 1 vuelven a la marca; otro valor, error antes del viaje', () => {
    expect(readTextScaleRequest(null)).toEqual({ ok: true, value: null });
    expect(readTextScaleRequest(1)).toEqual({ ok: true, value: null });
    expect(readTextScaleRequest(0.8)).toEqual({ ok: true, value: 0.8 });
    for (const v of [0.5, 1.5, '0.8', true]) expect(readTextScaleRequest(v).ok).toBe(false);
  });

  it('viaja sólo si el deslizador se movió a otro valor que el guardado', () => {
    expect(textScaleToSend(null, 0.9)).toBeUndefined();
    expect(textScaleToSend(0.9, 0.9)).toBeUndefined();
    expect(textScaleToSend(1, null)).toBeUndefined();
    expect(textScaleToSend(0.85, null)).toBe(0.85);
    expect(textScaleToSend(1, 0.85)).toBeNull();
  });
});

describe('el cableado', () => {
  const sin = (s: string) => s.split('\n').filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('{/*'); }).join('\n');
  const API = sin(readFileSync(new URL('./recompose-image.ts', import.meta.url), 'utf8'));
  const SERVICE = sin(readFileSync(new URL('../src/services/calibrationInbox.ts', import.meta.url), 'utf8'));
  const MOD = sin(readFileSync(new URL('../src/modules/iid/pieceActions.tsx', import.meta.url), 'utf8'));
  const APP = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

  it('la ruta lo valida, lo manda sin generar, exige el acuse y lo devuelve', () => {
    expect(API).toContain("const tamano = conTamano ? readTextScaleRequest(body.text_scale) : null;");
    expect(API).toContain("if (conTexto || conUbicacion || conColumna || conTamano) {");
    expect(API).toContain("...(tamano && tamano.ok ? { text_scale: tamano.value } : {}),");
    expect(API).toContain("if (conTamano && ef.body.text_scale_applied !== true) {");
    expect(API).toContain("text_scale: textScaleOfImage(piece.assets),");
    expect(SERVICE).toContain("...('text_scale' in input ? { text_scale: input.text_scale ?? null } : {}),");
  });

  it('la tarjeta: el deslizador, «Aplicar texto» y «Recomponer» lo llevan sólo si se movió', () => {
    expect(MOD).toContain('aria-label="Tamaño del texto de la imagen"');
    expect(MOD).toContain('const tamano = clear ? undefined : textScaleToSend(scaleSel, scaleVigente);');
    expect(MOD).toContain('const tamano = laminaElegida ? undefined : textScaleToSend(scaleSel, scaleVigente);');
    expect(MOD).toContain('setScaleVigente(r.text_scale ?? null);');
  });

  it('el zoom de la pantalla se retiró: el zoom es del texto de la imagen', () => {
    expect(APP).not.toMatch(/ZoomControl|useZoom|ZOOM_VIEWS|style=\{conZoom/);
  });

  it('sin marcas', () => {
    const src = readFileSync(new URL('./_textScale.ts', import.meta.url), 'utf8');
    for (const lit of ['ForumPHs', 'NeuroneSCF', 'UnrealvilleStudio', 'LucienSael']) expect(src).not.toContain(lit);
  });
});
