/**
 * DESHACER, APLICAR JUNTOS Y ESCUCHA APROXIMADA (Sam, 2026-11-17: «deshacer (a), sí a aplicar juntos, las dos escuchas»).
 *
 * Cubre: deshacer es UN PASO ATRÁS por intercambio (dos veces = como estaba), con texto y sonido de esa versión, sin
 * render y nunca con un cambio en curso; aplicar juntos (texto y sonido en un pedido, en las dos ventanas); el borrador
 * guarda la propuesta por su texto; y la escucha aproximada (momentos y volúmenes).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { assetsAfterUndoVideo, undoInfoOf, VIDEO_HISTORY_MAX } from './_pieceText';
import { cueTimesOf, approxGains } from './_pieceSound';
import { draftParaGuardar } from '../src/modules/iid/OnScreenTextEditor';

const T = '2026-11-17T23:00:00.000Z';
const v = (n: number, extra: Record<string, unknown> = {}) => ({
  url: `https://ejemplo.invalid/v${n}.mp4`, version: `v${n}`, text_layers: { hook: { text: `gancho ${n}` }, sound: n === 9 ? { bed: { preset_key: 'f' } } : undefined },
  clean_video: { url: `https://ejemplo.invalid/limpio-${n}.mp4` }, timeline: { faces: [{ n }] }, ...extra,
});
const assets = () => ({ video: v(9), video_history: [{ ...v(8), replaced_at: 'x' }, { ...v(7), replaced_at: 'y' }], otra: 1 });

describe('deshacer lo aplicado: un paso atrás', () => {
  it('vuelve la versión anterior con su texto y su sonido; la de ahora pasa primera al historial', () => {
    const r = assetsAfterUndoVideo(assets(), 'sam', T);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.assets.video).toMatchObject({ url: 'https://ejemplo.invalid/v8.mp4', version: 'v8', text_layers: { hook: { text: 'gancho 8' } }, restored: { by: 'sam', at: T, from_version: 'v9' } });
    expect(r.assets.video.replaced_at).toBeUndefined();
    expect(r.assets.video_history.map((h: any) => h.version)).toEqual(['v9', 'v7']);
    expect(r.assets.video_history[0].text_layers.sound).toEqual({ bed: { preset_key: 'f' } });
    expect(r.assets.otra).toBe(1);
    expect([r.from_version, r.to_version]).toEqual(['v9', 'v8']);
  });
  it('el video limpio y la línea de tiempo son los de ahora (la base de la próxima edición)', () => {
    const r = assetsAfterUndoVideo(assets(), 'sam', T);
    expect(r.ok && r.assets.video.clean_video).toEqual({ url: 'https://ejemplo.invalid/limpio-9.mp4' });
    expect(r.ok && r.assets.video.timeline).toEqual({ faces: [{ n: 9 }] });
  });
  it('deshacer otra vez devuelve el que estaba', () => {
    const uno = assetsAfterUndoVideo(assets(), 'sam', T);
    const dos = uno.ok ? assetsAfterUndoVideo(uno.assets, 'sam', T) : uno;
    expect(dos.ok && dos.assets.video.version).toBe('v9');
    expect(dos.ok && dos.assets.video_history.map((h: any) => h.version)).toEqual(['v8', 'v7']);
  });
  it('sin versión anterior o con un cambio en curso, no se deshace nada', () => {
    expect(assetsAfterUndoVideo({ video: v(1), video_history: [] }, 'sam', T)).toEqual({ ok: false, reason: 'no hay versión anterior de este video' });
    const enCurso = { ...assets(), video: { ...v(9), pending_text_job: { job_id: 'j' } } };
    expect(assetsAfterUndoVideo(enCurso, 'sam', T).ok).toBe(false);
    expect(undoInfoOf(enCurso)).toMatchObject({ available: false });
    expect(undoInfoOf(assets())).toEqual({ available: true, to_version: 'v8', reason: null });
  });
  it('el historial no pasa del tope', () => {
    const largo = { video: v(20), video_history: Array.from({ length: VIDEO_HISTORY_MAX }, (_, i) => ({ ...v(19 - i), replaced_at: 'x' })) };
    const r = assetsAfterUndoVideo(largo, 'sam', T);
    expect(r.ok && r.assets.video_history.length).toBe(VIDEO_HISTORY_MAX);
  });
});

describe('el servidor', () => {
  const ruta = readFileSync('api/piece-text.ts', 'utf8');
  it('deshacer: sin render, ancla en el video leído y en «sin pendiente»', () => {
    expect(ruta).toMatch(/const guardado = await guardarAssets\(piece\.id, r\.assets, assets\.video\.url, \{ sinPendiente: true \}\);/);
    expect(ruta).not.toMatch(/deshacerVideo[\s\S]{0,600}buildVideoLabBody/);
  });
  it('aplicar juntos: «apply» lleva el sonido si viene, «apply_sound» lleva el texto si viene', () => {
    expect(ruta).toMatch(/Object\.prototype\.hasOwnProperty\.call\(body, 'sound'\) \? \{ sound: body\.sound \?\? null \} : undefined/);
    expect(ruta).toMatch(/const vigente = body\.text_layers \?\? \(piece\.assets as any\)\?\.video\?\.text_layers \?\? SIN_TEXTO;/);
  });
});

describe('el borrador de la tarjeta', () => {
  it('una propuesta elegida se guarda por su texto, no por su posición', () => {
    const d: any = { hook: { choice: 1, own: '', preset_key: 'h' }, cta: { choice: null, own: '' }, roles: [], key_titles: [], captions: {}, strip: {} };
    const props: any = { hooks: [{ text: 'uno' }, { text: 'dos' }], key_phrases: [], share_ctas: [] };
    expect(draftParaGuardar(d, props).hook).toEqual({ choice: 'own', own: 'dos', preset_key: 'h' });
    expect(draftParaGuardar(d, props).cta).toEqual({ choice: null, own: '' });
  });
});

describe('la escucha aproximada', () => {
  it('cuándo suena cada momento: entradas, golpes, cifras, CTA, roles y cortes de toma', () => {
    const capas = {
      hook: { start_ms: 0 }, cta: { at_ms: 9000 }, roles: [{ show: true, at_ms: 400 }, { show: false, at_ms: 500 }],
      key_titles: [{ at_ms: 3000, text: 'El 1 %', preset_key: 'k' }, { at_ms: 6000, text: 'Sello', preset_key: 'golpe' }],
    };
    const timeline = { faces: [{ start_ms: 0, shot_id: 1 }, { start_ms: 5000, shot_id: 2 }] };
    expect(cueTimesOf(capas, timeline, ['golpe'])).toEqual([
      { fn: 'block_entry', at_ms: 0 }, { fn: 'word_pop', at_ms: 400 }, { fn: 'block_entry', at_ms: 3000 },
      { fn: 'digit_land', at_ms: 3800 }, { fn: 'shot_cut', at_ms: 5000 }, { fn: 'impact', at_ms: 6000 }, { fn: 'cta', at_ms: 9000 },
    ]);
  });
  it('volúmenes entre 0 y 1; más volumen de fondo = más alto; la cama más fuerte se baja', () => {
    const a = approxGains({ underVoiceLu: 14, levelLu: 0, bedLufs: -20, gainDb: 0 });
    const b = approxGains({ underVoiceLu: 14, levelLu: 6, bedLufs: -20, gainDb: 0 });
    const c = approxGains({ underVoiceLu: 14, levelLu: 0, bedLufs: -14, gainDb: 0 });
    expect(b.bed).toBeGreaterThan(a.bed);
    expect(c.bed).toBeLessThan(a.bed);
    for (const g of [a, b, c, approxGains({ underVoiceLu: 0, levelLu: 6, bedLufs: -40, gainDb: 6 })]) {
      expect(g.bed).toBeGreaterThanOrEqual(0); expect(g.bed).toBeLessThanOrEqual(1);
      expect(g.fx).toBeGreaterThanOrEqual(0); expect(g.fx).toBeLessThanOrEqual(1);
    }
  });
});

describe('multimarca', () => {
  it('ningún archivo nuevo nombra una marca', () => {
    const MARCAS = /NeuroneSCF|ForumPHs|LucienSael|SamPublisher|D7Herbal|VivoseMask|VizosCosmetics|DiamondDetails|PatriciaOsorio/i;
    expect(readFileSync('src/modules/iid/BarraDeshacer.tsx', 'utf8')).not.toMatch(MARCAS);
  });
});
