/**
 * FILTRO POR DÍA DE SALIDA (Sam, 2026-10-21) — el día se juzga en el reloj de la marca.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  dayFilterParam, dayFilterLabel, isCalendarDate, localDayOf, nextCalendarDay,
  targetDayOf, slotMatchesDay, dayWindowOf,
} from './_publishSlots.js';

const PTY = 'America/Panama';   // UTC-5 todo el año, sin cambio de hora
const MIA = 'America/New_York'; // con cambio de hora

describe('dayFilterParam', () => {
  it('vacío, ausente o «all» es sin filtro', () => {
    expect(dayFilterParam(undefined)).toEqual({ kind: 'all' });
    expect(dayFilterParam('')).toEqual({ kind: 'all' });
    expect(dayFilterParam(' all ')).toEqual({ kind: 'all' });
  });
  it('entiende today, tomorrow y una fecha real', () => {
    expect(dayFilterParam('today')).toEqual({ kind: 'today' });
    expect(dayFilterParam(['tomorrow'])).toEqual({ kind: 'tomorrow' });
    expect(dayFilterParam('2026-10-22')).toEqual({ kind: 'date', date: '2026-10-22' });
  });
  it('lo que no entiende es null (el endpoint responde 400), nunca «sin filtro»', () => {
    expect(dayFilterParam('mañana')).toBeNull();
    expect(dayFilterParam('2026-02-30')).toBeNull();
    expect(dayFilterParam('22/10/2026')).toBeNull();
  });
  it('la etiqueta devuelve lo que se pidió', () => {
    expect(dayFilterLabel({ kind: 'date', date: '2026-10-22' })).toBe('2026-10-22');
    expect(dayFilterLabel({ kind: 'tomorrow' })).toBe('tomorrow');
  });
});

describe('calendario', () => {
  it('isCalendarDate rechaza días que no existen', () => {
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2027-02-29')).toBe(false);
  });
  it('nextCalendarDay cruza mes y año', () => {
    expect(nextCalendarDay('2026-10-31')).toBe('2026-11-01');
    expect(nextCalendarDay('2026-12-31')).toBe('2027-01-01');
  });
  it('el día de un instante depende del huso', () => {
    // 2026-10-22 02:00 UTC = 21 oct 21:00 en UTC-5.
    expect(localDayOf('2026-10-22T02:00:00Z', PTY)).toBe('2026-10-21');
    expect(localDayOf('2026-10-22T02:00:00Z', 'UTC')).toBe('2026-10-22');
  });
  it('sin huso, o con uno que no existe, se juzga en UTC', () => {
    expect(localDayOf('2026-10-22T02:00:00Z', null)).toBe('2026-10-22');
    expect(localDayOf('2026-10-22T02:00:00Z', 'Marte/Olympus')).toBe('2026-10-22');
  });
});

describe('slotMatchesDay — en el reloj de la marca', () => {
  // «Ahora»: 21 oct 13:43 UTC = 08:43 en UTC-5.
  const now = new Date('2026-10-21T13:43:00Z');

  it('una franja de las 19:00 en UTC-5 (00:00 UTC del 22) es de HOY, no de mañana', () => {
    expect(slotMatchesDay('2026-10-22T00:00:00Z', { kind: 'today' }, now, PTY)).toBe(true);
    expect(slotMatchesDay('2026-10-22T00:00:00Z', { kind: 'tomorrow' }, now, PTY)).toBe(false);
  });
  it('la misma franja, para una marca en UTC, es de mañana', () => {
    expect(slotMatchesDay('2026-10-22T00:00:00Z', { kind: 'tomorrow' }, now, 'UTC')).toBe(true);
  });
  it('«mañana» es el día siguiente del calendario de la marca', () => {
    expect(targetDayOf({ kind: 'tomorrow' }, now, MIA)).toBe('2026-10-22');
    expect(slotMatchesDay('2026-10-22T21:30:00Z', { kind: 'tomorrow' }, now, MIA)).toBe(true);
  });
  it('una fecha concreta', () => {
    expect(slotMatchesDay('2026-10-23T14:00:00Z', { kind: 'date', date: '2026-10-23' }, now, MIA)).toBe(true);
    expect(slotMatchesDay('2026-10-23T14:00:00Z', { kind: 'date', date: '2026-10-22' }, now, MIA)).toBe(false);
  });
  it('sin franja no entra en ningún día; sin filtro entra todo', () => {
    expect(slotMatchesDay(null, { kind: 'today' }, now, PTY)).toBe(false);
    expect(slotMatchesDay(null, { kind: 'all' }, now, PTY)).toBe(true);
  });
});

describe('dayWindowOf — la ventana leída cubre cualquier huso', () => {
  it('dos días a cada lado', () => {
    const w = dayWindowOf({ kind: 'date', date: '2026-10-22' }, new Date())!;
    expect(w.from.toISOString()).toBe('2026-10-20T00:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-10-25T00:00:00.000Z');
    expect(dayWindowOf({ kind: 'all' }, new Date())).toBeNull();
  });
});

describe('los endpoints filtran ANTES de paginar y de contar', () => {
  const quitarComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  it('publish-queue: el día se aplica antes de by_brand y del slice de la página', () => {
    const src = quitarComentarios(readFileSync(new URL('./publish-queue.ts', import.meta.url), 'utf8'));
    const filtro = src.indexOf('slotMatchesDay(');
    expect(filtro).toBeGreaterThan(0);
    expect(filtro).toBeLessThan(src.indexOf('by_brand[p.brand_id]'));
    expect(filtro).toBeLessThan(src.indexOf('ordered.slice(offset'));
    expect(src).toMatch(/status\(400\)[\s\S]*invalid_day/);
    expect(src).toMatch(/status\(503\)[\s\S]*day_filter_unavailable/);
  });
  it('manual-queue: el día se aplica antes de contar', () => {
    const src = quitarComentarios(readFileSync(new URL('./manual-queue.ts', import.meta.url), 'utf8'));
    expect(src.indexOf('slotMatchesDay(')).toBeLessThan(src.indexOf('by_brand[it.brand_id]'));
  });
});
