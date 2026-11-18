/**
 * ZONA SEGURA AJUSTABLE POR PIEZA (Sam, 2026-11-18: «poder agrandar o mover un poco las zonas seguras» y «ir al máximo
 * posible a mi discreción»; VideoLab v1.13.0, #49: `text_layers.safe_override`, % del lienzo, 0 ≤ v < 50).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { safeOverrideOf, validateTextLayers, groupPresets, type PresetsByLayer } from './_pieceText';
import { overrideDeRect, ajustarZona } from '../src/modules/iid/TextoVisual';
import { videoTextDraftOf, textLayersFromDraft } from '../src/modules/iid/OnScreenTextEditor';

const W = 1080, H = 1920;

describe('la regla de VideoLab: % del lienzo, 0 ≤ v < 50', () => {
  it('acepta una zona válida y la redondea; null la quita; sin campo, nada', () => {
    const e: string[] = [];
    expect(safeOverrideOf({ top: 2, left: 0, right: 2.345, bottom: 49.99 }, e)).toEqual({ top: 2, left: 0, right: 2.35, bottom: 49.99 });
    expect(safeOverrideOf(null, e)).toBeNull();
    expect(safeOverrideOf(undefined, e)).toBeUndefined();
    expect(e).toEqual([]);
  });
  it('rechaza un lado de 50 o más, negativo, o que falte', () => {
    const e: string[] = [];
    expect(safeOverrideOf({ top: 50, left: 0, right: 0, bottom: 0 }, e)).toBeUndefined();
    expect(safeOverrideOf({ top: -1, left: 0, right: 0, bottom: 0 }, e)).toBeUndefined();
    expect(safeOverrideOf({ top: 1, left: 1, right: 1 }, e)).toBeUndefined();
    expect(e.length).toBe(3);
  });
});

describe('viaja de la ventana a VideoLab y vuelve', () => {
  const presets = groupPresets([{ preset_key: 'h1', layer: 'hook', name: 'H1', brand_id: null, status: 'proposed', spec: {} }], 'MarcaA') as PresetsByLayer;
  const base = { presets, cast: [], accent_options: [], strip_options: [], proposals: { hooks: [], key_phrases: [], share_ctas: [] } } as any;
  it('lo guardado se abre en el borrador, y el borrador lo manda', () => {
    const o = { top: 3, left: 2, right: 2, bottom: 30 };
    const d = videoTextDraftOf({ ...base, current: { text_layers: { hook: { text: 'Hola', preset_key: 'h1', start_ms: 0, end_ms: 2800, emphasis: [] }, roles: [], captions: null, key_titles: [], cta: null, identity: { strip: false, identity_role: null }, safe_override: o }, hook: null } });
    expect(d.safe_override).toEqual(o);
    d.hook.choice = 'own'; d.hook.own = 'Hola';
    const capas = textLayersFromDraft(d, base.proposals, 60000);
    expect(capas.safe_override).toEqual(o);
    const v = validateTextLayers(capas, { presets, accentRoles: [], stripRoles: [], durationMs: 60000, castIds: [] });
    expect(v.ok && v.value.safe_override).toEqual(o);
  });
  it('«Restablecer» (null) no manda zona: VideoLab vuelve a la de la marca', () => {
    const d = videoTextDraftOf({ ...base, current: { text_layers: null, hook: null } });
    d.hook.choice = 'own'; d.hook.own = 'Hola'; d.safe_override = null;
    expect('safe_override' in textLayersFromDraft(d, base.proposals, 60000)).toBe(false);
  });
});

describe('las asas: px del lienzo ↔ % por lado, sin salir del video ni pasar del 50 %', () => {
  const marca = { x: 65, y: 269, w: 777, h: 940 };
  it('el borde superior sube y la zona crece; nunca por encima del video', () => {
    expect(ajustarZona(marca, 'top', 0, -100, W, H)).toEqual({ x: 65, y: 169, w: 777, h: 1040 });
    expect(ajustarZona(marca, 'top', 0, -9999, W, H).y).toBe(0);
  });
  it('un lado no pasa del 50 %: la zona siempre contiene el centro', () => {
    const r = ajustarZona(marca, 'left', 9999, 0, W, H);
    expect(r.x).toBeLessThan(W / 2);
    expect(overrideDeRect(r, W, H).left).toBeLessThan(50);
  });
  it('mover no saca la zona del video', () => {
    const r = ajustarZona(marca, 'mover', -9999, -9999, W, H);
    expect(r.x).toBe(0); expect(r.w).toBe(777); expect(r.h).toBe(940);
    // en vertical la frena el centro: el borde inferior no sube del 50 % del alto
    expect(r.y).toBeGreaterThanOrEqual(0); expect(r.y + r.h).toBeGreaterThan(H / 2);
  });
  it('a % por lado, como lo espera VideoLab', () => {
    expect(overrideDeRect({ x: 0, y: 0, w: W, h: H }, W, H)).toEqual({ top: 0, left: 0, right: 0, bottom: 0 });
    expect(overrideDeRect(marca, W, H)).toEqual({ top: 14.01, left: 6.02, right: 22.04, bottom: 37.03 });
  });
});

describe('el cableado', () => {
  const editor = readFileSync('src/modules/iid/OnScreenTextEditor.tsx', 'utf8');
  it('la zona se ajusta sobre la vista de la tarjeta y «Restablecer» la quita', () => {
    expect(editor).toMatch(/onZona=\{enCurso \? undefined : \(o\) => setDraft\(\{ \.\.\.draft, safe_override: o \}\)\}/);
    expect(editor).toMatch(/onClick=\{\(\) => setDraft\(\{ \.\.\.draft, safe_override: null \}\)\}/);
  });
});
