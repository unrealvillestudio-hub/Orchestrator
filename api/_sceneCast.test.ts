import { describe, it, expect } from 'vitest';
import { SCENE_SLOTS, sceneCastOf, slotDirective, imageHistoryOf, MODE_HELP, SLOT_CHANGE_MODE } from './_sceneCast.js';
import { IMAGE_MODES, resolveRecomposeMode } from './recompose-image.js';

/**
 * EN LA ESCENA Y VOLVER A LA IMAGEN ANTERIOR (2026-10-20). Sam, 2026-10-19: «Ref1, Ref2, host y fondo»; «jamás me
 * acordaré de los nombres»; «deshacer el error de una regeneración incorrecta me toca venir aquí contigo».
 * Marca N+1: personas y lugares inventados (una agencia de viajes en Chile).
 */
const PERSONAS = [{ display_name: 'Valentina Ríos' }, { display_name: 'Tomás' }, { display_name: ' ' }, { display_name: 'Tomás' }];
const LUGARES = [{ aliases: ['Valparaíso', 'el puerto'] }, { aliases: ['Atacama'] }, { aliases: [] }];

describe('los lugares de la escena', () => {
  it('son Ref1, Ref2, Host y Fondo, en ese orden', () => {
    expect(SCENE_SLOTS.map((s) => s.key)).toEqual(['Ref1', 'Ref2', 'Host', 'Fondo']);
    expect(SCENE_SLOTS.find((s) => s.key === 'Fondo')!.kind).toBe('place');
  });
  it('las opciones salen del dato de la marca, sin vacíos ni repetidos, y se dice quién sale hoy', () => {
    const c = sceneCastOf(PERSONAS, LUGARES, { identity_refs: [{ name: 'Tomás' }] });
    expect(c.persons.map((p) => p.name)).toEqual(['Tomás', 'Valentina Ríos']);
    expect(c.places.map((p) => p.name)).toEqual(['Atacama', 'Valparaíso']);
    expect(c.in_image).toEqual(['Tomás']);
    expect(sceneCastOf(null, undefined, null)).toEqual({ persons: [], places: [], in_image: [] });
  });
  it('elegir en el menú escribe la directriz con el lugar y el nombre', () => {
    expect(slotDirective('Ref1', 'Valentina Ríos')).toBe('Ref1 por Valentina Ríos');
    expect(slotDirective('Fondo', 'Atacama')).toBe('Fondo por Atacama');
    expect(slotDirective('Ref9', 'X')).toBe('');
    expect(slotDirective('Ref1', ' ')).toBe('');
  });
  it('cambiar un lugar de la escena va al modo misma escena, que el endpoint acepta', () => {
    expect(SLOT_CHANGE_MODE).toBe('same_scene');
    expect(IMAGE_MODES).toContain('same_scene');
    expect(resolveRecomposeMode('same_scene', true)).toBe('same_scene');
    expect(resolveRecomposeMode('same_scene', false)).toBe('regenerate_full');
  });
  it('la ayuda nombra los tres modos', () => {
    expect(Object.keys(MODE_HELP).sort()).toEqual(['edit_from_current', 'regenerate_full', 'same_scene']);
  });
});

describe('las imágenes anteriores', () => {
  it('se listan de la más reciente a la más antigua, con su índice', () => {
    const h = imageHistoryOf({ url: 'u2', history: [{ url: 'u1', clean_url: 'c1', replaced_at: 'a', generation_mode: 'edit_from_current' }, { url: '' }, { url: 'u0' }] });
    expect(h.map((x) => [x.index, x.url])).toEqual([[0, 'u1'], [2, 'u0']]);
    expect(h[0]).toMatchObject({ clean_url: 'c1', replaced_at: 'a', generation_mode: 'edit_from_current' });
  });
  it('sin historial, nada', () => {
    expect(imageHistoryOf({ url: 'u' })).toEqual([]);
    expect(imageHistoryOf(null)).toEqual([]);
  });
});

describe('sin marcas en el código', () => {
  it('ni el archivo nombra marcas, personas o lugares reales', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./_sceneCast.ts', import.meta.url), 'utf8');
    for (const lit of ['ForumPHs', 'NeuroneSCF', 'Irja', 'Patricia', 'Itzel', 'Casco']) expect(src.includes(lit)).toBe(false);
  });
});
