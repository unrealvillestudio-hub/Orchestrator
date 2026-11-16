import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  BLOCK_CONTROLS, CAPTIONS_BAND, LAMINA_SIN_COLOCACION, NO_ENTRY_IN_IMAGE, NO_SAFE_ZONE, NO_SUB_IN_VIDEO, ONLY_VIDEO,
  PLACE_DEFAULT, SCREEN_BLOCKS, ZOOM_MAX, ZOOM_MIN, aspectOf, blockSupport, brandNameOf, clampPct, clampPlace, clampZoom,
  controlSupport, imageBlocksToSend, imagePersonaOf, imagePlacementDraftOf, imageSafeZoneOf, previewRect, readImageBlocksRequest,
  readPlace, roleTextOf, storedImageBlocks, titleOfFicha,
} from './_onScreenText.js';
import { TEXT_SCALE_MAX, TEXT_SCALE_MIN } from './_textScale.js';
import { groupPresets, validateTextLayers } from './_pieceText.js';
import { imagePreviewItems, textLayersFromDraft, videoPreviewItems, videoTextDraftOf, OWN } from '../src/modules/iid/OnScreenTextEditor';

/**
 * UNA SOLA VENTANA «TEXTO EN PANTALLA» (contrato «Bloques de texto colocados a mano» v1, 2026-11-16). Las marcas y
 * personas de estas pruebas son de MENTIRA a propósito: el código no sabe de ninguna.
 */

// ── 1 · la forma de `place` (contrato §1) ──────────────────────────────────────────────────────
describe('place: x/y de 0 a 100 de la zona segura y zoom de 0,7 a 1,3', () => {
  it('el rango del zoom es el mismo del text_scale vigente de ImageLab', () => {
    expect([ZOOM_MIN, ZOOM_MAX]).toEqual([TEXT_SCALE_MIN, TEXT_SCALE_MAX]);
  });

  it('ausente = automático; bien formado pasa tal cual', () => {
    expect(readPlace(undefined, 'hook')).toEqual({ ok: true, value: null });
    expect(readPlace(null, 'hook')).toEqual({ ok: true, value: null });
    expect(readPlace({ x_pct: 0, y_pct: 100, zoom: 1.3 }, 'hook')).toEqual({ ok: true, value: { x_pct: 0, y_pct: 100, zoom: 1.3 } });
  });

  it('fuera de rango o mal formado = error con el campo nombrado, no se acota en silencio', () => {
    const r = readPlace({ x_pct: 101, y_pct: -1, zoom: 2 }, 'cta');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('cta.place.x_pct');
      expect(r.error).toContain('cta.place.y_pct');
      expect(r.error).toContain('cta.place.zoom');
    }
    expect(readPlace('arriba', 'hook').ok).toBe(false);
    expect(readPlace({ x_pct: 50, y_pct: 50 }, 'hook').ok).toBe(false);
  });

  it('subtítulos: sólo zoom; x/y se rechazan con el motivo de la banda fija', () => {
    expect(readPlace({ zoom: 0.85 }, 'captions', { zoomOnly: true })).toEqual({ ok: true, value: { zoom: 0.85 } });
    const r = readPlace({ x_pct: 10, y_pct: 10, zoom: 1 }, 'captions', { zoomOnly: true });
    expect(r.ok).toBe(false);
  });

  it('los deslizadores acotan al paso y al rango', () => {
    expect(clampZoom(1.33)).toBe(1.3);
    expect(clampZoom(0.5)).toBe(0.7);
    expect(clampZoom(1.02)).toBe(1);
    expect(clampZoom('x')).toBe(1);
    expect(clampPct(-5)).toBe(0);
    expect(clampPct(140)).toBe(100);
    expect(clampPlace(null)).toEqual(PLACE_DEFAULT);
  });
});

// ── 2 · qué aplica a cada formato (contrato §4: desactivado con su motivo, no oculto) ──────────
describe('lo que no aplica al formato queda desactivado con su motivo', () => {
  it('imagen: Títulos clave, CTA y Subtítulos (karaoke) desactivados; Título, Subtítulo y Rol activos', () => {
    expect(blockSupport('image', 'key_titles')).toEqual({ enabled: false, reason: ONLY_VIDEO });
    expect(blockSupport('image', 'cta')).toEqual({ enabled: false, reason: ONLY_VIDEO });
    expect(blockSupport('image', 'captions')).toEqual({ enabled: false, reason: ONLY_VIDEO });
    for (const b of ['headline', 'subheadline', 'role'] as const) expect(blockSupport('image', b).enabled).toBe(true);
  });

  it('video: Subtítulo desactivado; el resto activo', () => {
    expect(blockSupport('video', 'subheadline')).toEqual({ enabled: false, reason: NO_SUB_IN_VIDEO });
    for (const b of ['headline', 'key_titles', 'cta', 'role', 'captions'] as const) expect(blockSupport('video', b).enabled).toBe(true);
  });

  it('imagen: animación/preset y segundo de entrada desactivados en todos sus bloques', () => {
    for (const b of ['headline', 'subheadline', 'role'] as const) {
      expect(controlSupport('image', b, 'preset')).toEqual({ enabled: false, reason: NO_ENTRY_IN_IMAGE });
      expect(controlSupport('image', b, 'entry')).toEqual({ enabled: false, reason: NO_ENTRY_IN_IMAGE });
      for (const c of ['text', 'x', 'y', 'zoom', 'auto'] as const) expect(controlSupport('image', b, c).enabled).toBe(true);
    }
  });

  it('subtítulos del video: sólo Zoom (y su estilo)', () => {
    for (const c of ['x', 'y', 'auto', 'text'] as const) expect(controlSupport('video', 'captions', c)).toEqual({ enabled: false, reason: CAPTIONS_BAND });
    expect(controlSupport('video', 'captions', 'zoom').enabled).toBe(true);
    expect(controlSupport('video', 'captions', 'preset').enabled).toBe(true);
  });

  it('cada control desactivado lleva motivo; ninguno activo lo lleva', () => {
    for (const m of ['image', 'video'] as const) for (const b of SCREEN_BLOCKS) for (const c of BLOCK_CONTROLS) {
      const s = controlSupport(m, b, c);
      expect(s.enabled ? s.reason === null : !!s.reason).toBe(true);
    }
  });
});

// ── 3 · el rol ─────────────────────────────────────────────────────────────────────────────────
describe('el rol: «Nombre — Cargo — Marca» de la ficha de la persona', () => {
  it('arma el texto con lo que haya, sin guiones colgados', () => {
    expect(roleTextOf({ name: 'Persona Uno', title: 'Conductora' }, 'Marca Prueba')).toBe('Persona Uno — Conductora — Marca Prueba');
    expect(roleTextOf({ name: 'Persona Uno', title: '' }, 'Marca Prueba')).toBe('Persona Uno — Marca Prueba');
    expect(roleTextOf(null, '')).toBe('');
  });

  it('la persona de la imagen es la de su identidad guardada; el cargo, de su ficha', () => {
    const assets = { image: { identity_refs: [{ name: 'Persona Uno', person_id: 'p-1', image_urls: ['u'] }] } };
    expect(imagePersonaOf(assets, [{ blueprint_id: 'p-1', role_title: 'Asesora' }])).toEqual({ person_id: 'p-1', name: 'Persona Uno', title: 'Asesora' });
    expect(imagePersonaOf(assets)).toEqual({ person_id: 'p-1', name: 'Persona Uno', title: '' });
    const uuid = '00000000-0000-4000-8000-000000000001';
    const porId = { image: { identity_refs: [{ name: 'Persona Uno', person_id: uuid, image_urls: ['u'] }] } };
    expect(imagePersonaOf(porId, [{ id: uuid, blueprint_id: 'bp_uno', role_title: 'Asesora' }])).toEqual({ person_id: uuid, name: 'Persona Uno', title: 'Asesora' });
    expect(imagePersonaOf({ image: {} })).toBeNull();
    expect(imagePersonaOf({ image: { identity_refs: [{ name: '' }] } })).toBeNull();
  });

  it('cargo de la ficha (role_title) y nombre de marca', () => {
    expect(titleOfFicha({ role_title: 'Gerente' })).toBe('Gerente');
    expect(titleOfFicha({ title: 'Otro', job_title: 'Otro' })).toBe('');
    expect(titleOfFicha(null)).toBe('');
    expect(brandNameOf({ display_name: 'Marca Visible' }, 'MarcaPrueba')).toBe('Marca Visible');
    expect(brandNameOf(null, 'MarcaPrueba')).toBe('MarcaPrueba');
  });
});

// ── 4 · imagen: `blocks` (contrato §3) ─────────────────────────────────────────────────────────
describe('imagen: el borrador y el `blocks` que viaja', () => {
  it('abre todo automático y el rol APAGADO por defecto, con su texto sembrado', () => {
    const d = imagePlacementDraftOf(null, 'Persona Uno — Marca Prueba');
    expect(d).toEqual({ headline: null, subheadline: null, role: { enabled: false, text: 'Persona Uno — Marca Prueba', place: null } });
  });

  it('sin cambios no viaja nada', () => {
    expect(imageBlocksToSend(imagePlacementDraftOf(null, 'x'), null)).toBeUndefined();
    const stored = { headline: { place: { x_pct: 20, y_pct: 30, zoom: 1.1 } } };
    expect(imageBlocksToSend(imagePlacementDraftOf(stored, ''), stored)).toBeUndefined();
  });

  it('con un cambio viaja entero: el bloque automático va vacío y el rol apagado como enabled:false', () => {
    const d = imagePlacementDraftOf(null, 'R');
    d.headline = { x_pct: 50, y_pct: 80, zoom: 0.9 };
    expect(imageBlocksToSend(d, null)).toEqual({
      headline: { place: { x_pct: 50, y_pct: 80, zoom: 0.9 } }, subheadline: {}, role: { enabled: false, text: '' },
    });
  });

  it('«Automático» quita el place guardado: viaja el bloque sin place', () => {
    const stored = { headline: { place: { x_pct: 20, y_pct: 30, zoom: 1 } } };
    const d = imagePlacementDraftOf(stored, '');
    d.headline = null;
    expect(imageBlocksToSend(d, stored)?.headline).toEqual({});
  });

  it('rol encendido viaja con su texto y, si se colocó, su place', () => {
    const d = imagePlacementDraftOf(null, 'Persona Uno — Conductora — Marca Prueba');
    d.role = { ...d.role, enabled: true, place: { x_pct: 10, y_pct: 90, zoom: 1 } };
    expect(imageBlocksToSend(d, null)?.role).toEqual({ enabled: true, text: 'Persona Uno — Conductora — Marca Prueba', place: { x_pct: 10, y_pct: 90, zoom: 1 } });
  });

  it('la ruta valida la forma antes del viaje', () => {
    expect(readImageBlocksRequest(null)).toEqual({ ok: true, value: null });
    expect(readImageBlocksRequest({ headline: { place: { x_pct: 1, y_pct: 2, zoom: 1 } }, subheadline: {}, role: { enabled: false } }))
      .toEqual({ ok: true, value: { headline: { place: { x_pct: 1, y_pct: 2, zoom: 1 } }, subheadline: {}, role: { enabled: false, text: '' } } });
    expect(readImageBlocksRequest({ cta: {} }).ok).toBe(false);
    expect(readImageBlocksRequest({ role: { enabled: true, text: '' } }).ok).toBe(false);
    expect(readImageBlocksRequest({ headline: { place: { x_pct: 1, y_pct: 2, zoom: 9 } } }).ok).toBe(false);
    expect(readImageBlocksRequest('x').ok).toBe(false);
  });

  it('lo guardado en la pieza se lee tolerante: mal formado no cuenta', () => {
    expect(storedImageBlocks({ image: { blocks: { headline: { place: { x_pct: 5, y_pct: 5, zoom: 1 } } } } })).toEqual({ headline: { place: { x_pct: 5, y_pct: 5, zoom: 1 } } });
    expect(storedImageBlocks({ image: { blocks: { headline: { place: { x_pct: 500 } } } } })).toBeNull();
  });
});

// ── 5 · video: `place` por capa en text_layers (contrato §2) ────────────────────────────────────
const P = (layer: string, key: string) => ({ preset_key: key, layer, name: key, description: '', brand_id: null, active: true, sort: 1, status: 'proposed' });
const PRESETS = groupPresets([P('hook', 'h1'), P('role', 'r1'), P('caption', 'c1'), P('key_title', 'k1'), P('cta', 'a1')], 'MarcaPrueba');
const CTX = { presets: PRESETS, accentRoles: ['accent_a'], stripRoles: [], durationMs: 30000, castIds: ['p-1'] };
const PL = { x_pct: 40, y_pct: 60, zoom: 1.15 };

describe('video: place por capa', () => {
  it('validateTextLayers acepta y pasa place en hook, roles, key_titles y cta; zoom solo en captions', () => {
    const v = validateTextLayers({
      hook: { text: 'Gancho', preset_key: 'h1', start_ms: 0, end_ms: 2000, place: PL },
      roles: [{ person_id: 'p-1', text: 'Persona Uno — Conductora', at_ms: 0, dur_ms: 3000, preset_key: 'r1', place: PL }],
      captions: { enabled: true, preset_key: 'c1', accent_role: 'accent_a', place: { zoom: 0.8 } },
      key_titles: [{ text: 'Clave', at_ms: 1000, dur_ms: 2000, preset_key: 'k1', place: PL }],
      cta: { text: 'Compártelo', at_ms: 20000, preset_key: 'a1', place: PL },
    }, CTX);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.value.hook?.place).toEqual(PL);
      expect(v.value.roles[0].place).toEqual(PL);
      expect(v.value.key_titles[0].place).toEqual(PL);
      expect(v.value.cta?.place).toEqual(PL);
      expect(v.value.captions?.place).toEqual({ zoom: 0.8 });
    }
  });

  it('sin place, la capa sale idéntica a la de antes (automática, sin la clave)', () => {
    const v = validateTextLayers({ hook: { text: 'Gancho', preset_key: 'h1', start_ms: 0, end_ms: 2000 } }, CTX);
    expect(v.ok && 'place' in (v.value.hook ?? {})).toBe(false);
  });

  it('place mal formado = 400 con el campo nombrado; x/y en subtítulos también', () => {
    const v = validateTextLayers({
      hook: { text: 'Gancho', preset_key: 'h1', start_ms: 0, end_ms: 2000, place: { x_pct: 150, y_pct: 1, zoom: 1 } },
      captions: { enabled: true, preset_key: 'c1', accent_role: 'accent_a', place: { x_pct: 1, y_pct: 1, zoom: 1 } },
    }, CTX);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.errors.join(' ')).toContain('hook.place.x_pct');
      expect(v.errors.join(' ')).toContain('captions.place sólo admite zoom');
    }
  });

  const prop = {
    presets: PRESETS, accent_options: [{ role: 'accent_a', hex: '', is_default: true }], strip_options: [],
    cast: [{ person_id: 'p-1', name: 'Persona Uno', role: 'host' as const, title: 'Conductora' }],
    proposals: { hooks: [{ text: 'Gancho A' }], key_phrases: [{ text: 'Clave A' }], share_ctas: [{ text: 'Compártelo' }] },
    current: { text_layers: null, hook: null },
  };

  it('el borrador abre todo automático y textLayersFromDraft manda place sólo en lo colocado a mano', () => {
    const d = videoTextDraftOf(prop as any);
    expect(d.hook.place).toBeNull();
    expect(d.captions.zoom).toBeNull();
    d.hook.choice = 0; d.hook.place = PL;
    d.cta.choice = OWN; d.cta.own = 'Pásalo';
    d.captions.enabled = true; d.captions.zoom = 1.2;
    d.key_titles[0].on = true;
    const t = textLayersFromDraft(d, prop.proposals as any, 30000);
    expect(t.hook?.place).toEqual(PL);
    expect(t.cta && 'place' in t.cta).toBe(false);
    expect(t.key_titles[0] && 'place' in t.key_titles[0]).toBe(false);
    expect(t.captions?.place).toEqual({ zoom: 1.2 });
  });

  it('lo vigente del video siembra su place al reabrir', () => {
    const d = videoTextDraftOf({ ...prop, current: { hook: null, text_layers: {
      hook: { text: 'Gancho A', preset_key: 'h1', start_ms: 0, end_ms: 2000, emphasis: [], place: PL },
      roles: [], captions: { enabled: true, preset_key: 'c1', accent_role: 'accent_a', place: { zoom: 0.9 } },
      key_titles: [], cta: null, identity: { strip: false, strip_role: null },
    } } } as any);
    expect(d.hook.place).toEqual(PL);
    expect(d.captions.zoom).toBe(0.9);
  });

  it('la vista previa dibuja un rectángulo por capa elegida', () => {
    const d = videoTextDraftOf(prop as any);
    d.hook.choice = 0; d.captions.enabled = true; d.roles[0].show = true;
    expect(videoPreviewItems(d, prop.proposals as any).map((i) => i.block)).toEqual(['headline', 'role', 'captions']);
    const img = imagePlacementDraftOf(null, 'R');
    expect(imagePreviewItems(img, false).map((i) => i.block)).toEqual(['headline']);
    img.role.enabled = true;
    expect(imagePreviewItems(img, true).map((i) => i.block)).toEqual(['headline', 'subheadline', 'role']);
  });
});

// ── 6 · la vista previa esquemática ────────────────────────────────────────────────────────────
describe('vista previa: rectángulo dentro de la zona segura', () => {
  const SAFE = { top: 10, bottom: 20, left: 5, right: 5 };
  it('centro en place, tamaño por zoom, entero dentro de la zona segura', () => {
    const r = previewRect('cta', { x_pct: 50, y_pct: 50, zoom: 1 }, SAFE);
    expect(r.left + r.width / 2).toBeCloseTo(50, 1);
    expect(r.top + r.height / 2).toBeCloseTo(10 + 35, 1);
    const g = previewRect('cta', { x_pct: 50, y_pct: 50, zoom: 1.3 }, SAFE);
    expect(g.width).toBeGreaterThan(r.width);
  });
  it('en el borde se acota para quedar entero dentro', () => {
    const r = previewRect('headline', { x_pct: 100, y_pct: 100, zoom: 1.3 }, SAFE);
    expect(r.left + r.width).toBeLessThanOrEqual(95.01);
    expect(r.top + r.height).toBeLessThanOrEqual(80.01);
    expect(r.left).toBeGreaterThanOrEqual(5);
  });
  it('la zona segura de la imagen es dato de la marca (si no, la global; mal declarada, ninguna)', () => {
    const rows = [
      { brand_id: null, canal: null, tokens: { layout: { safe_zone_pct: { top: 4, bottom: 4, left: 4, right: 4 } } } },
      { brand_id: 'MarcaPrueba', canal: null, tokens: { layout: { safe_zone_pct: { top: 8, bottom: 12, left: 6, right: 6 } } } },
    ];
    expect(imageSafeZoneOf(rows, 'MarcaPrueba')).toEqual({ top: 8, bottom: 12, left: 6, right: 6 });
    expect(imageSafeZoneOf(rows, 'OtraMarca')).toEqual({ top: 4, bottom: 4, left: 4, right: 4 });
    expect(imageSafeZoneOf([{ brand_id: null, canal: null, tokens: { layout: { safe_zone_pct: { top: 70 } } } }], 'X')).toEqual(NO_SAFE_ZONE);
  });
  it('la proporción sale de las medidas guardadas o del formato', () => {
    expect(aspectOf({ image: { width: 1080, height: 1350 } }, 'image')).toBe(0.8);
    expect(aspectOf({}, 'video')).toBeCloseTo(9 / 16);
  });
});

// ── 7 · el cableado ────────────────────────────────────────────────────────────────────────────
const sin = (s: string) => s.split('\n').filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('{/*'); }).join('\n');
const API = sin(readFileSync(new URL('./recompose-image.ts', import.meta.url), 'utf8'));
const MOD = sin(readFileSync(new URL('../src/modules/iid/pieceActions.tsx', import.meta.url), 'utf8'));
const UI = readFileSync(new URL('../src/modules/iid/OnScreenTextEditor.tsx', import.meta.url), 'utf8');
const LIB = readFileSync(new URL('./_onScreenText.ts', import.meta.url), 'utf8');

describe('el cableado', () => {
  it('la ruta de imagen valida `blocks`, lo manda por la rama sin generar y exige el acuse', () => {
    expect(API).toContain('const bloques = conBloques ? readImageBlocksRequest(body.blocks) : null;');
    expect(API).toContain("return res.status(400).json({ error: 'invalid blocks', detail: bloques.error });");
    const i = API.indexOf('if (conTexto || conUbicacion || conColumna || conTamano || conBloques) {');
    expect(i).toBeGreaterThan(0);
    expect(API.slice(i, i + 1200)).toContain('...(bloques && bloques.ok && bloques.value ? { blocks: bloques.value } : {}),');
    expect(API).toContain('if (conBloques && ef.body.blocks_applied !== true) {');
  });

  it('el panel de imagen manda `blocks` sólo si cambió y conserva los atajos', () => {
    expect(MOD).toContain('imageBlocksToSend(');
    expect(MOD).toContain('...(bloques ? { blocks: bloques } : {})');
    expect(MOD).toContain('shortcutsSlot=');
    expect(MOD).toContain('placementDisabledReason={laminaElegida ? LAMINA_SIN_COLOCACION : null}');
    expect(LAMINA_SIN_COLOCACION).toContain('atajos');
  });

  it('todas las secciones plegadas al abrir', () => {
    expect(UI).toContain('<details');
    expect(UI).not.toMatch(/<details[^>]*\sopen[\s>=]/);
  });

  it('ni una marca ni un color escrito', () => {
    for (const src of [UI, LIB]) {
      for (const marca of ['NeuroneSCF', 'ForumPHs', 'LucienSael', 'UnrealvilleStudio', 'D7Herbal']) expect(src).not.toContain(marca);
      expect(src.replace(/\/\/.*$/gm, '')).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    }
  });
});
