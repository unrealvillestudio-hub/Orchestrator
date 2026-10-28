import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN, ZOOM_STORAGE_KEY, ZOOM_VIEWS, clampZoom, loadZoom, saveZoom, zoomIn, zoomLabel, zoomOut,
} from './zoom';

/** Un almacén en memoria, y uno que lanza como el de una ventana privada con el almacenamiento bloqueado. */
const memoria = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m }; };
const bloqueado = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('SecurityError'); } };

describe('el zoom de las bandejas (Sam, 2026-10-28)', () => {
  it('se queda entre 80 % y 150 %, en pasos de 5 %', () => {
    expect(clampZoom(1.12)).toBe(1.1);
    expect(clampZoom(0.2)).toBe(ZOOM_MIN);
    expect(clampZoom(9)).toBe(ZOOM_MAX);
    expect(clampZoom('1.25')).toBe(1.25);
    expect(clampZoom('raro')).toBe(ZOOM_DEFAULT);
    expect(clampZoom(Number.NaN)).toBe(ZOOM_DEFAULT);
  });

  it('un paso más o menos, sin pasarse de los bordes', () => {
    expect(zoomIn(1)).toBe(1.05);
    expect(zoomOut(1)).toBe(0.95);
    expect(zoomIn(ZOOM_MAX)).toBe(ZOOM_MAX);
    expect(zoomOut(ZOOM_MIN)).toBe(ZOOM_MIN);
    expect(zoomLabel(1.1)).toBe('110 %');
  });

  it('se recuerda en este navegador, y sin almacenamiento funciona igual al 100 %', () => {
    const a = memoria();
    expect(loadZoom(a)).toBe(ZOOM_DEFAULT);
    saveZoom(a, 1.2);
    expect(a.m.get(ZOOM_STORAGE_KEY)).toBe('1.2');
    expect(loadZoom(a)).toBe(1.2);
    a.m.set(ZOOM_STORAGE_KEY, '7');
    expect(loadZoom(a)).toBe(ZOOM_MAX);
    expect(loadZoom(bloqueado)).toBe(ZOOM_DEFAULT);
    expect(() => saveZoom(bloqueado, 1.2)).not.toThrow();
    expect(loadZoom(null)).toBe(ZOOM_DEFAULT);
  });

  it('se ofrece en las bandejas donde se corrige, Publicación incluida, y en las dos entradas de la app', () => {
    for (const v of ['calibration', 'fixes', 'challenged', 'publish', 'media']) expect(ZOOM_VIEWS.has(v)).toBe(true);
    expect(ZOOM_VIEWS.has('hub')).toBe(false);
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    expect(app.match(/style=\{conZoom \? \{ zoom \} : undefined\}/g)?.length).toBe(2);
    expect(app.match(/\{conZoom && <ZoomControl zoom=\{zoom\} onChange=\{setZoom\} \/>\}/g)?.length).toBe(2);
  });
});
