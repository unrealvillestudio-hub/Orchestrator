/**
 * LO PUBLICADO EN EL HISTORIAL (Sam, 2026-10-22: «cómo no voy a poder ver algo ya publicado, para eso es
 * historial»). Fixtures ficticias: ni marcas, ni canales, ni URLs reales.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { publishedParam, conPublicacion, soloPublicadas, type PublicacionDePieza } from './_publicadas.js';

const piezas = new Map<string, PublicacionDePieza>([
  ['a', { status: 'published', published_at: '2026-10-21T23:00:00Z', post_url: 'https://ejemplo.invalid/p/a' }],
  ['b', { status: 'published', published_at: '2026-10-22T06:18:00Z', post_url: null }],
  ['c', { status: 'rejected', published_at: null, post_url: null }],
  ['d', { status: 'scheduled', published_at: '2026-10-23T00:00:00Z', post_url: 'https://ejemplo.invalid/x' }],
]);
const filas = ['a', 'b', 'c', 'd', 'e'].map((piece_id) => ({ piece_id }));

describe('publishedParam', () => {
  it('sólo un sí explícito enciende el filtro', () => {
    for (const v of ['1', 'true', 'Sí', ['1']]) expect(publishedParam(v)).toBe(true);
    for (const v of [undefined, '', '0', 'false', 'no', 2]) expect(publishedParam(v)).toBe(false);
  });
});

describe('conPublicacion', () => {
  const r = conPublicacion(filas, piezas);
  it('cada fila lleva el estado vivo de su pieza y cuándo salió', () => {
    expect(r[0]).toEqual({ piece_id: 'a', piece_status: 'published', published_at: '2026-10-21T23:00:00Z', post_url: 'https://ejemplo.invalid/p/a' });
  });
  it('una pieza no publicada no muestra fecha ni enlace aunque el dato los traiga', () => {
    expect(r[3]).toMatchObject({ piece_status: 'scheduled', published_at: null, post_url: null });
  });
  it('sin dato de la pieza, null: no se inventa que salió', () => {
    expect(r[4]).toMatchObject({ piece_status: null, published_at: null, post_url: null });
  });
});

describe('soloPublicadas', () => {
  it('deja sólo las publicadas y ordena por fecha de publicación, la más reciente primero', () => {
    expect(soloPublicadas(conPublicacion(filas, piezas)).map((x) => x.piece_id)).toEqual(['b', 'a']);
  });
});

describe('el cableado', () => {
  const api = readFileSync(new URL('./evaluated-history.ts', import.meta.url), 'utf8');
  it('el historial lee el filtro, enriquece las filas y, con el filtro, ordena por publicación', () => {
    expect(api).toMatch(/publishedParam\(req\.query\.published\)/);
    expect(api).toMatch(/conPublicacion\(/);
    expect(api).toMatch(/soloPublicadas\(/);
  });
  it('la pantalla tiene el interruptor y pinta cuándo salió', () => {
    const ui = readFileSync(new URL('../src/modules/iid/EvaluatedHistoryModule.tsx', import.meta.url), 'utf8');
    expect(ui).toMatch(/Sólo publicadas/);
    expect(ui).toMatch(/row\.published_at/);
  });
});
