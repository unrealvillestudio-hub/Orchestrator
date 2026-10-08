import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { statesForQuery, type PendingState } from './calibrationInbox';

/**
 * 2026-10-07 — FILTRO DE GRUPOS EN ARREGLOS (Sam: «reparadas», «auto-fixed» y «por reparar», con el
 * mismo patrón que el filtro de aplazadas de Calibración).
 *
 * Lo que se fija: el grupo ESTRECHA el alcance de la pestaña a uno de sus ejes y nunca lo cambia, y
 * los tres grupos son ejes de `pendingStateOf` — no un segundo clasificador sobre el texto del motivo.
 */
const ARREGLOS: PendingState[] = ['por_arreglar', 'corregida', 'sin_imagen', 'autofix_residuo'];

describe('statesForQuery', () => {
  it('sin alcance (Calibración): el selector elige un eje o ninguno', () => {
    expect(statesForQuery(undefined, '')).toEqual([]);
    expect(statesForQuery(undefined, 'aplazada')).toEqual(['aplazada']);
    expect(statesForQuery([], 'aplazada')).toEqual(['aplazada']);
  });

  it('con alcance y «Todas»: pide todo el alcance', () => {
    expect(statesForQuery(ARREGLOS, '')).toEqual(ARREGLOS);
  });

  it('con alcance y un grupo suyo: lo estrecha a ese eje', () => {
    expect(statesForQuery(ARREGLOS, 'corregida')).toEqual(['corregida']);
    expect(statesForQuery(ARREGLOS, 'autofix_residuo')).toEqual(['autofix_residuo']);
    expect(statesForQuery(ARREGLOS, 'por_arreglar')).toEqual(['por_arreglar']);
  });

  it('con alcance y un eje ajeno: se ignora, la pestaña no se convierte en otra', () => {
    expect(statesForQuery(ARREGLOS, 'aplazada')).toEqual(ARREGLOS);
  });
});

describe('los grupos de Arreglos', () => {
  it('nombran los tres ejes que Sam pidió, en su orden', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    expect(app).toMatch(
      /groups: \[\['corregida', 'Reparadas'\], \['autofix_residuo', 'Auto-fixed'\], \['por_arreglar', 'Por reparar'\]\]/,
    );
  });
});
