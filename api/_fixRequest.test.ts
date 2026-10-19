import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeFixCatalog, effectiveFixImageMode, resolveFixRequest, type FixRequestCode } from './_fixRequest.js';
import { toggleFixCode, fixPillsOf, fixRequestPayload, fixForcedNote, FIX_MODE_RULE, FIX_OVERLAY_NOTE } from '../src/modules/iid/pieceActions';

/**
 * EL FIXABLE DICE QUÉ CORREGIR (2026-10-19).
 *
 * EL DEFECTO, medido el 2026-10-18: la propuesta de un fixable viajaba sólo como texto libre, y el carril
 * tenía que adivinar si se pedía texto, imagen o las dos cosas (cb85d923-…, 8f8db518-…). Sam pidió pills
 * de selección múltiple por panel, un texto de ayuda para elegir el modo de la imagen y la pill «SIN TOCAR
 * EL RESTO». La lista la aprobó el 2026-10-18 y vive como dato en `intel.fix_request_codes`.
 *
 * El catálogo de estas pruebas es FICTICIO a propósito: si la pantalla dependiera de un código concreto,
 * estas pruebas fallarían. Ninguna marca aparece aquí.
 */
const CATALOGO: FixRequestCode[] = normalizeFixCatalog([
  { code: 'T_UNO', channel: 'text', label: 'Uno', help: 'Ayuda uno', sort: 20 },
  { code: 'T_CERO', channel: 'text', label: 'Cero', help: null, sort: 10 },
  { code: 'I_GESTO', channel: 'image', label: 'Gesto', help: null, sort: 30 },
  { code: 'I_QUIETO', channel: 'image', label: 'No tocar lo demás', help: null, sort: 40, forces_image_mode: 'edit_from_current' },
]);

describe('el catálogo es dato y se normaliza', () => {
  it('ordena por `sort` y descarta filas que la pantalla no puede pintar', () => {
    const c = normalizeFixCatalog([
      ...CATALOGO,
      { code: '', channel: 'text', label: 'sin código', sort: 1 },
      { code: 'X', channel: 'audio', label: 'canal desconocido', sort: 1 },
      { code: 'Y', channel: 'image', label: '', sort: 1 },
      { code: 'Z', channel: 'image', label: 'modo raro', sort: 50, forces_image_mode: 'repintar' },
    ]);
    expect(c.map((x) => x.code)).toEqual(['T_CERO', 'T_UNO', 'I_GESTO', 'I_QUIETO', 'Z']);
    expect(c.find((x) => x.code === 'Z')?.forces_image_mode).toBeNull();
  });
  it('sin catálogo, lista vacía (la pantalla sigue con la propuesta escrita)', () => {
    expect(normalizeFixCatalog(null)).toEqual([]);
  });
});

describe('el modo de imagen', () => {
  it('una pill que impone modo gana a la elección', () => {
    expect(effectiveFixImageMode(['I_QUIETO'], CATALOGO, 'regenerate_full')).toEqual({ mode: 'edit_from_current', forcedBy: 'I_QUIETO' });
  });
  it('sin pill que imponga, rige lo elegido', () => {
    expect(effectiveFixImageMode(['I_GESTO'], CATALOGO, 'regenerate_full')).toEqual({ mode: 'regenerate_full', forcedBy: null });
  });
});

describe('lo que el server acepta', () => {
  it('sin pills, todo como antes', () => {
    expect(resolveFixRequest({}, CATALOGO)).toEqual({ ok: true, fix_codes: null, image_mode: null, forced_by: null });
    expect(resolveFixRequest({ fix_codes: [] }, CATALOGO)).toMatchObject({ ok: true, fix_codes: null });
  });
  it('quita repetidos y espacios', () => {
    expect(resolveFixRequest({ fix_codes: ['T_UNO', ' T_UNO ', 'I_GESTO'] }, CATALOGO)).toMatchObject({ ok: true, fix_codes: ['T_UNO', 'I_GESTO'] });
  });
  it('un código fuera del catálogo es 400, con cuál', () => {
    const r = resolveFixRequest({ fix_codes: ['T_UNO', 'NO_EXISTE'] }, CATALOGO);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error).toBe('unknown fix_codes'); expect(r.detail).toContain('NO_EXISTE'); }
  });
  it('un tipo equivocado es 400', () => {
    expect(resolveFixRequest({ fix_codes: 'T_UNO' }, CATALOGO).ok).toBe(false);
    expect(resolveFixRequest({ fix_codes: [1] }, CATALOGO).ok).toBe(false);
  });
  it('un modo fuera del contrato es 400', () => {
    const r = resolveFixRequest({ fix_codes: ['I_GESTO'], image_mode: 'repintar' }, CATALOGO);
    expect(r.ok).toBe(false);
  });
  it('la pill que impone modo gana también en el server', () => {
    expect(resolveFixRequest({ fix_codes: ['I_GESTO', 'I_QUIETO'], image_mode: 'regenerate_full' }, CATALOGO))
      .toEqual({ ok: true, fix_codes: ['I_GESTO', 'I_QUIETO'], image_mode: 'edit_from_current', forced_by: 'I_QUIETO' });
  });
});

describe('el panel Fixable', () => {
  it('marca y desmarca conservando el orden', () => {
    expect(toggleFixCode([], 'A')).toEqual(['A']);
    expect(toggleFixCode(['A', 'B'], 'A')).toEqual(['B']);
    expect(toggleFixCode(['B'], 'A')).toEqual(['B', 'A']);
  });
  it('separa las pills por canal, en el orden del catálogo', () => {
    expect(fixPillsOf(CATALOGO, 'text').map((c) => c.code)).toEqual(['T_CERO', 'T_UNO']);
    expect(fixPillsOf(CATALOGO, 'image').map((c) => c.code)).toEqual(['I_GESTO', 'I_QUIETO']);
    expect(fixPillsOf(null, 'image')).toEqual([]);
  });
  it('el modo sólo viaja si se pidió algo de la imagen', () => {
    expect(fixRequestPayload(['T_UNO'], CATALOGO, 'regenerate_full')).toEqual({ fix_codes: ['T_UNO'], image_mode: null, forced_by: null });
    expect(fixRequestPayload(['T_UNO', 'I_GESTO'], CATALOGO, 'regenerate_full')).toEqual({ fix_codes: ['T_UNO', 'I_GESTO'], image_mode: 'regenerate_full', forced_by: null });
    expect(fixRequestPayload([], CATALOGO, 'regenerate_full')).toEqual({ fix_codes: null, image_mode: null, forced_by: null });
  });
  it('«no tocar lo demás» fija el modo y la pantalla dice cuál pill lo fija, con su etiqueta del catálogo', () => {
    const p = fixRequestPayload(['I_QUIETO'], CATALOGO, 'regenerate_full');
    expect(p).toEqual({ fix_codes: ['I_QUIETO'], image_mode: 'edit_from_current', forced_by: 'I_QUIETO' });
    expect(fixForcedNote(p.forced_by, CATALOGO)).toBe('«No tocar lo demás» fija el modo: corregir sobre la imagen actual.');
  });
  it('un código que el catálogo ya no tiene no viaja', () => {
    expect(fixRequestPayload(['RETIRADO', 'T_UNO'], CATALOGO, 'edit_from_current').fix_codes).toEqual(['T_UNO']);
  });
  it('la ayuda dice cuándo usar cada modo y dónde se corrige el texto de la imagen', () => {
    expect(FIX_MODE_RULE).toMatch(/conservaría la mayor parte/);
    expect(FIX_MODE_RULE).toMatch(/personas, la escena o la composición/);
    expect(FIX_OVERLAY_NOTE).toMatch(/título y del gancho/);
  });
});

describe('el cableado', () => {
  const sinComentarios = (src: string) => src.split('\n')
    .filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('{/*'); }).join('\n');
  const VERDICT = sinComentarios(readFileSync(new URL('./calibration-verdict.ts', import.meta.url), 'utf8'));
  const MOD = sinComentarios(readFileSync(new URL('../src/modules/iid/pieceActions.tsx', import.meta.url), 'utf8'));
  it('el endpoint sirve el catálogo por GET y valida las pills antes de tocar nada', () => {
    expect(VERDICT).toContain("if (req.method === 'GET') return catalogo(req, res);");
    const valida = VERDICT.indexOf('resolveFixRequest(');
    expect(valida).toBeGreaterThan(0);
    expect(valida).toBeLessThan(VERDICT.indexOf('ensureArtifact(pieceId)'));
  });
  it('sin pills, el veredicto no nombra las columnas nuevas: aprobar y rechazar no dependen de su migración', () => {
    expect(VERDICT).toContain('...(fix_codes ? { fix_codes } : {}),');
    expect(VERDICT).toContain('...(image_mode ? { image_mode } : {}),');
    expect(VERDICT).not.toMatch(/fix_proposal,\s+fix_codes,\s+image_mode,/);
  });
  it('el panel manda las pills sólo con fixable', () => {
    expect(MOD).toContain("...(verdict === 'fixable' ? { fix_codes: fixReq.fix_codes, image_mode: fixReq.image_mode } : {}),");
  });
  it('ninguna etiqueta del catálogo está escrita en la pantalla', () => {
    for (const etiqueta of ['SIN TOCAR EL RESTO', 'Nombre de marca o podcast', 'Gesto o mirada', 'Accesorios y ambiente'])
      expect(MOD).not.toContain(etiqueta);
  });
});
