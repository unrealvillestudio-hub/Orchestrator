import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { HISTORY_SOURCES, HISTORY_CAP } from './evaluated-history.js';

/**
 * HISTORIAL DE EVALUADAS — las cuatro propiedades que no pueden romperse.
 *
 *   1. SÓLO LECTURA. Un tab que mira no muta: si algún día aparece aquí un POST, el
 *      historial deja de ser historial.
 *   2. NINGUNA ENUMERACIÓN DE MARCA, CANAL NI VEREDICTO. `verdict` se amplió una vez
 *      (`fixable`) y volverá a ampliarse; una fila con un valor que el código no conozca
 *      tiene que MOSTRARSE, no desaparecer del historial sin avisar.
 *   3. El token viaja por cabecera, nunca por query string.
 *   4. Las dos generaciones se pueden separar: sin el eje `source` este tab reintroduce la
 *      confusión que el archivado vino a resolver.
 *
 * Se fijan sobre la fuente que se compila, mismo patrón que `pieceUi.test.ts`.
 */

const API = readFileSync(new URL('./evaluated-history.ts', import.meta.url), 'utf8');
const MOD = readFileSync(new URL('../src/modules/iid/EvaluatedHistoryModule.tsx', import.meta.url), 'utf8');
const SERVICE = readFileSync(new URL('../src/services/evaluatedHistory.ts', import.meta.url), 'utf8');

/** Sin comentarios: se mide el código, no la documentación que lo explica. */
const sinComentarios = (src: string) => src
  .split('\n')
  .filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('{/*'); })
  .join('\n');

// ── 1 · sólo lectura ─────────────────────────────────────────────────────────────
describe('el historial mira, no toca', () => {
  it('el endpoint sólo acepta GET', () => {
    expect(API).toMatch(/method !== 'GET'/);
    expect(sinComentarios(API)).not.toMatch(/method: 'POST'|method: 'PATCH'|method: 'DELETE'/);
  });

  it('no escribe en ninguna tabla', () => {
    const code = sinComentarios(API);
    for (const verbo of ['upsert', 'Prefer:', 'resolution=merge-duplicates'])
      expect(code).not.toContain(verbo);
  });

  it('el módulo no ofrece ninguna acción sobre la pieza', () => {
    const code = sinComentarios(MOD);
    for (const accion of ['saveVerdict', 'discardPiece', 'savePieceEdit', 'Aprobar', 'Rechazar', 'Descartar'])
      expect(code).not.toContain(accion);
  });
});

// ── 2 · nada enumerado que sea dato ──────────────────────────────────────────────
describe('marcas, canales y veredictos se descubren del dato', () => {
  it('el endpoint no nombra ninguna marca ni canal del ecosistema', () => {
    const code = sinComentarios(API);
    for (const nombre of ['NeuroneSCF', 'ForumPHs', 'LucienSael', 'UnrealvilleStudio', 'meta_ig', 'meta_fb', 'tiktok'])
      expect(code).not.toContain(nombre);
  });

  it('el módulo tampoco', () => {
    const code = sinComentarios(MOD);
    for (const nombre of ['NeuroneSCF', 'ForumPHs', 'LucienSael', 'UnrealvilleStudio', 'meta_ig', 'meta_fb', 'tiktok'])
      expect(code).not.toContain(nombre);
  });

  it('el veredicto NO es una unión cerrada en el contrato', () => {
    // Un tipo cerrado obligaría a editar el archivo en cada ampliación del eje, y una fila
    // con un valor desconocido dejaría de mostrarse.
    expect(SERVICE).toMatch(/verdict: string;/);
    expect(SERVICE).not.toMatch(/verdict: 'approved' \| 'rejected'/);
  });

  it('el filtro de veredicto compara exacto y no valida contra una lista', () => {
    expect(API).toMatch(/verdict !== 'all'/);
    expect(sinComentarios(API)).not.toMatch(/VERDICTS\s*=|VERDICT_FILTERS\s*=/);
  });

  it('las tres facetas se cuentan del dato', () => {
    for (const faceta of ['by_brand', 'by_channel', 'by_verdict']) expect(API).toContain(faceta);
    expect(API).toMatch(/function tally/);
  });
});

// ── 3 · el token no viaja por la URL ─────────────────────────────────────────────
describe('auth', () => {
  it('el token va por cabecera, nunca por query string', () => {
    expect(API).toMatch(/requireAdmin\(req, res, extractToken\(req\)\)/);
    expect(sinComentarios(API)).not.toMatch(/query\.(session_)?token/);
    expect(SERVICE).toMatch(/Authorization: `Bearer \$\{token\}`/);
  });
});

// ── 4 · las dos generaciones se separan ──────────────────────────────────────────
describe('el origen es el eje de generación de este tab', () => {
  it('los tres valores del eje son estructurales, no dato', () => {
    expect([...HISTORY_SOURCES]).toEqual(['all', 'live', 'archived']);
  });

  it('cada fila declara de qué tabla salió', () => {
    expect(API).toMatch(/source: HistorySource/);
    expect(API).toMatch(/'approval_calibration_archive'/);
  });

  it('el módulo distingue lo archivado a la vista y muestra su motivo', () => {
    expect(MOD).toMatch(/archived_reason/);
    expect(MOD).toContain('archivada');
  });

  it('el tope de lectura se declara y el truncado se dice', () => {
    expect(HISTORY_CAP).toBeGreaterThan(0);
    expect(API).toMatch(/truncated/);
    expect(MOD).toMatch(/truncated/);
  });
});

// ── 5 · el piece_id es la razón de que este tab exista ───────────────────────────
describe('encontrar una pieza y poder nombrarla', () => {
  it('el id es copiable en la fila cerrada, no escondido en el detalle', () => {
    expect(MOD).toMatch(/<CopyableId id=\{row\.piece_id\}/);
  });
});
