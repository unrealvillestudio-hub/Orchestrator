/**
 * ESCUCHA EXACTA Y MEDIDOR DE CARACTERES (VideoLab v1.12.0; Sam, 2026-11-17: «las dos escuchas» y «decirme hasta dónde
 * alcanza el texto»).
 *
 * Cubre: el medidor de cada bloque sale de `scene.layout[].fit` o del error `VIDEOLAB_TEXT_DOES_NOT_FIT`, y se asigna al
 * bloque correcto (gancho, CTA, cada título clave por su hora o por su índice); la escucha exacta pide a VideoLab con el
 * video limpio y el texto editado, con un plazo menor que el de la ruta.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fitsOfScene, fitOfError } from './_pieceText';
import { fitFor } from '../src/modules/iid/OnScreenTextEditor';
import { TIMEOUT_MS } from './_fetchWithTimeout';

const F = (layer: string, chars: number, chars_fit: number, extra: Record<string, unknown> = {}) =>
  ({ layer, max_lines: 2, max_width_px: 777, min_px: 60, chars, chars_fit, fits: chars_fit === chars, ...extra });

describe('el medidor de la escena', () => {
  const scene = { layout: [
    { layer: 'cta', start_ms: 9000, fit: F('cta', 20, 20) },
    { layer: 'hook', start_ms: 0, fit: F('hook', 40, 40) },
    { layer: 'key_title', start_ms: 6000, fit: F('key_title', 12, 12) },
    { layer: 'key_title', start_ms: 3000, fit: F('key_title', 30, 30) },
    { layer: 'caption_band', start_ms: 0 },
  ] };
  it('uno por bloque con medidor, en orden de entrada', () => {
    expect(fitsOfScene(scene).map((x) => `${x.layer}@${x.start_ms}`)).toEqual(['hook@0', 'key_title@3000', 'key_title@6000', 'cta@9000']);
    expect(fitsOfScene({})).toEqual([]);
  });
  it('cada bloque recibe el suyo: gancho, CTA y cada título clave por su hora de entrada', () => {
    const r = { ok: true, fits: fitsOfScene(scene) };
    expect(fitFor(r, 'hook')?.chars).toBe(40);
    expect(fitFor(r, 'cta')?.chars).toBe(20);
    expect(fitFor(r, 'key_title', { at_ms: 6000 })?.chars).toBe(12);
    expect(fitFor(r, 'key_title', { at_ms: 3000 })?.chars).toBe(30);
    expect(fitFor(r, 'key_title', { at_ms: 1 })).toBeNull();
  });
  it('si no cabe, el medidor del error va sólo al bloque que no entra', () => {
    const err = { ok: false, error: 'VIDEOLAB_TEXT_DOES_NOT_FIT', fit: fitOfError({ fit: F('key_title', 60, 25, { label: 'key_titles[1]' }) }) };
    expect(fitFor(err, 'key_title', { index: 1 })).toMatchObject({ chars: 60, chars_fit: 25, fits: false });
    expect(fitFor(err, 'key_title', { index: 0 })).toBeNull();
    expect(fitFor(err, 'hook')).toBeNull();
    const delGancho = { ok: false, fit: fitOfError({ fit: F('hook', 70, 25, { label: 'hook' }) }) };
    expect(fitFor(delGancho, 'hook')?.chars_fit).toBe(25);
  });
  it('un error sin medidor, o con uno mal formado, no inventa números', () => {
    expect(fitOfError({ error_label: 'VIDEOLAB_PROVIDER_FAILED' })).toBeNull();
    expect(fitOfError({ fit: { layer: 'hook' } })).toBeNull();
  });
});

describe('el servidor', () => {
  const ruta = readFileSync('api/piece-text.ts', 'utf8');
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
  it('la escena reenvía el medidor (bien o mal)', () => {
    expect(ruta).toMatch(/fit: fitOfError\(d\) \};/);
    expect(ruta).toMatch(/fits: fitsOfScene\(d\.scene\),/);
  });
  it('la escucha exacta pide a VideoLab por lab_configs, con el video limpio, sin job', () => {
    expect(ruta).toMatch(/fetchWithTimeout\('lab_sync', `\$\{base\}\/api\/sound-preview`/);
    expect(ruta).toMatch(/base_video: \{ url: assets\.video\.clean_video\.url \}/);
    expect(ruta).not.toMatch(/escuchaExacta[\s\S]{0,2500}guardarAssets/);
  });
  it('el plazo de la escucha deja margen para responder dentro de la ruta', () => {
    expect(TIMEOUT_MS.lab_sync).toBeLessThan(vercel.functions['api/piece-text.ts'].maxDuration * 1000);
  });
});

describe('la vista grande: al lado, de tamaño ajustable y se puede soltar (Sam, 2026-11-17)', () => {
  it('el ancho queda en su rango; un valor raro vuelve al inicial', async () => {
    const { clampAncho, VISTA_ANCHO_MIN, VISTA_ANCHO_MAX, VISTA_ANCHO_INICIAL } = await import('../src/modules/iid/OnScreenTextEditor');
    expect(clampAncho(10)).toBe(VISTA_ANCHO_MIN);
    expect(clampAncho(9999)).toBe(VISTA_ANCHO_MAX);
    expect(clampAncho(Number('nada'))).toBe(VISTA_ANCHO_INICIAL);
    expect(clampAncho(200.4)).toBe(200);
  });
  it('fijar arriba es una opción, no algo obligatorio; la barra y las notas van al lado del video', () => {
    const editor = readFileSync('src/modules/iid/OnScreenTextEditor.tsx', 'utf8');
    const visual = readFileSync('src/modules/iid/TextoVisual.tsx', 'utf8');
    expect(editor).toMatch(/vistaFija && 'md:sticky md:top-0'/);
    expect(editor).toMatch(/role="separator"/);
    expect(visual).toMatch(/<div className="min-w-0 shrink-0 space-y-1\.5" style=\{\{ width: ladoAncho \?\? 180 \}\}>\{lado\}\{notas\}<\/div>/);
  });
  it('la barra del play no se estira: la columna tiene ancho fijo, y las secciones usan el espacio de al lado (Sam, 2026-11-18)', async () => {
    const { anchoLado, VISTA_ANCHO_MIN, VISTA_ANCHO_MAX } = await import('../src/modules/iid/OnScreenTextEditor');
    expect(anchoLado(VISTA_ANCHO_MIN)).toBe(150);
    expect(anchoLado(VISTA_ANCHO_MAX)).toBe(Math.round(VISTA_ANCHO_MAX * 0.62));
    expect(anchoLado(9999)).toBe(anchoLado(VISTA_ANCHO_MAX));
    const editor = readFileSync('src/modules/iid/OnScreenTextEditor.tsx', 'utf8');
    expect(editor).toMatch(/<div className="flex flex-wrap items-start gap-2">/);
    expect(editor).toMatch(/<div className="flex-1 min-w-\[240px\] space-y-2">/);
    expect(editor).toMatch(/ladoAncho=\{anchoLado\(anchoVista\)\}/);
  });
});
