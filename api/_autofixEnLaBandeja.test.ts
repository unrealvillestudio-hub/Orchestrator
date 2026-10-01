import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  pendingStateOf, autofixOf, autofixResiduo, toContext, CALIBRATION_TAB_STATES, PENDING_STATES,
  type ContentPiece, type PendingState,
} from './_calibrationShared.js';

/**
 * CARRIL AUTO-FIX (2026-10-01) — lo que el carril hizo con una pieza llega a la bandeja.
 *
 * El carril (`content-run-stage`, bloque AUTOFIX) corrige los `warn` antes de que la pieza nazca y deja
 * `assets.autofix`. Lo que este test fija del lado de la bandeja:
 *   1. el residuo del carril es un eje propio, `autofix_residuo`, y vive en Arreglos, no en Calibración;
 *   2. sin imagen manda la imagen, y con juicio de Sam manda su `fixable`;
 *   3. la tarjeta sólo cuenta el carril cuando CORRIÓ: apagado, la clave sólo anota lo que habría
 *      entrado y no es una corrección.
 * Los códigos son inventados a propósito: el test no conoce los de ninguna marca.
 */

const piece = (assets: Record<string, unknown> | null): ContentPiece =>
  ({ id: 'p1', brand_id: 'MarcaA', status: 'awaiting_approval', assets } as unknown as ContentPiece);
const RESIDUO = { enabled: true, ran: true, outcome: 'residual', attempts: 2, resolved: ['XX-A-01'], residual: ['XX-B-02'], applied: true, cost_usd: 0.19 };
const LIMPIA = { enabled: true, ran: true, outcome: 'clean', attempts: 1, resolved: ['XX-A-01'], residual: [], applied: true, cost_usd: 0.1 };

describe('el eje del residuo', () => {
  it('challenged, con imagen, sin juicio de Sam y con residuo del carril ⇒ autofix_residuo', () => {
    expect(pendingStateOf('challenged', false, true, true, true)).toBe<PendingState>('autofix_residuo');
  });
  it('sin la señal sigue siendo retenida, como antes', () => {
    expect(pendingStateOf('challenged', false, true, true, false)).toBe<PendingState>('retenida');
  });
  it('sin imagen manda la imagen; con juicio de Sam manda su fixable', () => {
    expect(pendingStateOf('challenged', false, true, false, true)).toBe<PendingState>('sin_imagen');
    expect(pendingStateOf('challenged', true, true, true, true)).toBe<PendingState>('por_arreglar');
  });
  it('fuera de challenged la señal no cambia nada', () => {
    expect(pendingStateOf('awaiting_approval', false, false, true, true)).toBe<PendingState>('esperando');
    expect(pendingStateOf('deferred', false, false, true, true)).toBe<PendingState>('aplazada');
  });
  it('es un eje declarado, de Arreglos y no de Calibración', () => {
    expect(PENDING_STATES).toContain('autofix_residuo');
    expect(CALIBRATION_TAB_STATES).not.toContain('autofix_residuo');
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(app).toMatch(/states: \['por_arreglar', 'corregida', 'sin_imagen', 'autofix_residuo'\]/);
  });
});

describe('lo que la tarjeta cuenta del carril', () => {
  it('con el carril apagado no hay aviso: la clave sólo anota lo que habría entrado', () => {
    expect(autofixOf(piece({ autofix: { enabled: false, ran: false, outcome: 'none', entered: ['XX-A-01'] } }))).toBeNull();
    expect(autofixOf(piece({ autofix: { enabled: true, ran: false, outcome: 'none', reason: 'time_budget' } }))).toBeNull();
    expect(autofixOf(piece(null))).toBeNull();
  });
  it('corrida limpia y corrida con residuo', () => {
    expect(autofixOf(piece({ autofix: LIMPIA }))).toEqual({ outcome: 'clean', attempts: 1, resolved: ['XX-A-01'], residual: [], cost_usd: 0.1 });
    expect(autofixResiduo(piece({ autofix: LIMPIA }))).toBe(false);
    expect(autofixResiduo(piece({ autofix: RESIDUO }))).toBe(true);
  });
  it('viaja en el contexto de la tarjeta', () => {
    expect(toContext(piece({ autofix: RESIDUO })).autofix?.residual).toEqual(['XX-B-02']);
    expect(toContext(piece({})).autofix).toBeNull();
  });
  it('los dos lectores del eje pasan la señal', () => {
    for (const f of ['calibration-queue.ts', 'challenged-queue.ts']) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
      expect(src, f).toMatch(/autofixResiduo\(p\)/);
    }
  });
});
