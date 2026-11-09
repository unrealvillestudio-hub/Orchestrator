/**
 * RETENIDA SIN JUEZ = TRABAJO DE ARREGLO (Sam, 2026-11-09: «Las impugnadas dónde las reviso, si no lo
 * están colócalas en "arreglos"»).
 *
 * Medido el 2026-11-09: las 15 piezas vivas en el eje `retenida` (12 NSCF, 2 UVS, 1 FPHs) NO tenían
 * ninguna fila en `intel.judge_calibration`. No eran desacuerdos del juez —lo único que `retenida`
 * significa—: 11 decían «Retenida por CC, sesión de fixables» y una era el residuo de un auto-fix. Se
 * veían en Calibración con la etiqueta de otra cosa.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { pendingStateOf, PENDING_STATES, CALIBRATION_TAB_STATES, type PendingState } from './_calibrationShared.js';

describe('pendingStateOf — el séptimo eje', () => {
  it('challenged, con imagen, sin juicio de Sam, sin residuo y SIN fila del juez ⇒ retenida_para_arreglo', () => {
    expect(pendingStateOf('challenged', false, true, true, false, false, true)).toBe<PendingState>('retenida_para_arreglo');
  });
  it('con fila del juez sigue siendo retenida (desacuerdo del juez)', () => {
    expect(pendingStateOf('challenged', false, true, true, false, false, false)).toBe<PendingState>('retenida');
  });
  it('los ejes más específicos mandan antes: fixable de Sam, sin imagen, residuo y cambio tras aprobar', () => {
    expect(pendingStateOf('challenged', true, true, true, false, false, true)).toBe<PendingState>('por_arreglar');
    expect(pendingStateOf('challenged', false, true, false, false, false, true)).toBe<PendingState>('sin_imagen');
    expect(pendingStateOf('challenged', false, true, true, true, false, true)).toBe<PendingState>('autofix_residuo');
    expect(pendingStateOf('challenged', true, true, true, false, true, true)).toBe<PendingState>('cambiada_tras_aprobar');
  });
  it('una pieza viva no se ve afectada', () => {
    expect(pendingStateOf('awaiting_approval', false, false, true, false, false, true)).toBe<PendingState>('esperando');
  });
});

describe('dónde vive', () => {
  it('es un eje declarado, fuera de Calibración y dentro de Arreglos', () => {
    expect(PENDING_STATES).toContain('retenida_para_arreglo');
    expect(CALIBRATION_TAB_STATES).not.toContain('retenida_para_arreglo');
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(app).toMatch(/states: \[[^\]]*'retenida_para_arreglo'\]/);
  });
  it('la bandeja pregunta al juez y una lectura caída no mueve a nadie de pestaña', () => {
    const q = readFileSync(new URL('./calibration-queue.ts', import.meta.url), 'utf8');
    expect(q).toMatch(/fetchJudgedPieceIds\(retadasIds\)/);
    expect(q).toMatch(/juzgadas !== null && !juzgadas\.has\(p\.id\)/);
  });
  it('Retenidas sigue mirando sólo lo que tiene arbitraje: su llamada pasa `false`', () => {
    const c = readFileSync(new URL('./challenged-queue.ts', import.meta.url), 'utf8');
    expect(c).toMatch(/cambioTrasAprobacion\(p\), false\)/);
  });
});
