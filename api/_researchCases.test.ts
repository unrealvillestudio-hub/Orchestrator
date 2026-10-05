import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  verdictEffect, researchHintOf, isOpenResearchCase, actionsFor, toContext,
  RESEARCH_REASON_PREFIX, RESEARCH_CLOSED_REASON_PREFIX, RESEARCH_CASE_STATUSES,
  type ContentPiece,
} from './_calibrationShared.js';

/**
 * INVESTIGAR (2026-10-05) — EL BOTÓN «INVESTIGAR» Y EL CASO DE INVESTIGACIÓN, DEL LADO DE LA INTERFAZ.
 *
 * Medido el 2026-10-05 en `fadfe938-50ac-4ad1-b305-c7548a6c8816`: una propuesta Fixable que pedía
 * ampliar la investigación la «resolvió» el carril de texto inventando una afirmación sin fuente.
 * «Investigar» manda la pregunta al agente de investigación de la marca; el carril
 * (`unrlvl-iid-functions`) crea una pieza NUEVA con las fuentes o devuelve la original a Arreglos.
 *
 * Lo que este archivo fija:
 *   1 · el efecto sobre la pieza: retada, no descartada, con «Investigación pendiente: <pregunta>»;
 *   2 · la ruta: lee antes de escribir, escribe el corpus, abre el caso y sólo entonces mueve la pieza;
 *   3 · el contrato con el carril: los dos prefijos son los mismos literales y ninguno es «Auto-fix:»;
 *   4 · la pista que evita una petición por tarjeta;
 *   5 · multimarca.
 *
 * Las fixtures son FICTICIAS: si la lógica dependiera de una marca real, fallarían.
 */

const sinComentarios = (src: string) => src
  .split('\n')
  .filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*'); })
  .join('\n');
const RUTA = sinComentarios(readFileSync(new URL('./research-cases.ts', import.meta.url), 'utf8'));
const VEREDICTO = sinComentarios(readFileSync(new URL('./calibration-verdict.ts', import.meta.url), 'utf8'));
const NOW = '2026-10-05T12:00:00Z';

describe('1 · el efecto sobre la pieza', () => {
  const e = verdictEffect('research', NOW, 'revisor', null, '¿Qué pasa con el escenario Y?');

  it('la RETA, no la descarta: tiene futuro', () => {
    expect(e).toMatchObject({ status: 'challenged', challenged_at: NOW, discarded_at: null, discarded_reason: null });
  });
  it('el motivo empieza por «Investigación pendiente:» y lleva la pregunta', () => {
    expect(e.challenged_reason).toBe('Investigación pendiente: ¿Qué pasa con el escenario Y?');
    expect(String(e.challenged_reason).startsWith('Auto-fix:')).toBe(false);
  });
  it('deroga el aplazamiento, como todo veredicto humano', () => {
    expect(e).toMatchObject({ deferred_until: null, deferred_reason: null });
  });
  it('«Investigar» vale donde vale Fixable', () => {
    for (const status of ['awaiting_approval', 'challenged', 'deferred', 'scheduled']) {
      const a = actionsFor({ status, assets: {} });
      expect(a.research.available).toBe(a.fixable.available);
    }
    const sellada = actionsFor({ status: 'rejected', discarded_at: NOW, assets: {} });
    expect(sellada.research.available).toBe(false);
  });
});

describe('2 · la ruta lee antes de escribir, y escribe en orden', () => {
  it('la pregunta se valida antes de tocar nada', () => {
    expect(RUTA.indexOf("error: 'question required'")).toBeGreaterThan(0);
    expect(RUTA.indexOf("error: 'question required'")).toBeLessThan(RUTA.indexOf('ensureArtifact('));
  });
  it('lee los casos (tabla y caso abierto) → corpus → caso → pieza → franja', () => {
    const lee = RUTA.indexOf('await fetchResearchCases(pieceId)', RUTA.indexOf('async function investigar'));
    const corpus = RUTA.indexOf('upsertVerdict(');
    const caso = RUTA.indexOf('insertResearchCase(');
    const pieza = RUTA.indexOf('applyVerdictToPiece(');
    const franja = RUTA.indexOf('releaseSlotsForPiece(', pieza);
    expect(lee).toBeGreaterThan(0);
    expect([lee < corpus, corpus < caso, caso < pieza, pieza < franja]).toEqual([true, true, true, true]);
  });
  it('un caso abierto corta con 409 ANTES del corpus', () => {
    const corte = RUTA.indexOf("error: 'research_case_open'");
    expect(corte).toBeGreaterThan(0);
    expect(corte).toBeLessThan(RUTA.indexOf('upsertVerdict('));
  });
  it('el corpus recibe el veredicto `research` y la pregunta como propuesta', () => {
    expect(RUTA).toMatch(/verdict: 'research',/);
    expect(RUTA).toMatch(/fix_proposal: question,/);
    expect(RUTA).toMatch(/applyVerdictToPiece\(pieceId, 'research', evaluated_by, criterion \|\| null, question\)/);
  });
  it('sin la migración se dice qué falta y que no se escribió nada', () => {
    expect(RUTA).toMatch(/error: 'research_cases_missing'/);
    expect(RUTA).toMatch(/error: 'research_verdict_missing'/);
    expect(RUTA).toMatch(/approval_calibration_verdict_check/);
  });
  it('`calibration-verdict` no acepta `research`: dice a qué ruta ir', () => {
    expect(VEREDICTO).toMatch(/if \(verdict === 'research'\) \{\s*return res\.status\(400\)\.json\(\{\s*error: 'use_research_cases'/);
    expect(VEREDICTO.indexOf("error: 'use_research_cases'")).toBeLessThan(VEREDICTO.indexOf('upsertVerdict('));
  });
});

describe('3 · el contrato con el carril', () => {
  it('los dos prefijos son los literales que escribe `content-run-stage`, y ninguno es «Auto-fix:»', () => {
    expect(RESEARCH_REASON_PREFIX).toBe('Investigación pendiente:');
    expect(RESEARCH_CLOSED_REASON_PREFIX).toBe('Investigación cerrada:');
    for (const p of [RESEARCH_REASON_PREFIX, RESEARCH_CLOSED_REASON_PREFIX]) expect(p.startsWith('Auto-fix:')).toBe(false);
  });
  it('los estados del caso son los del CHECK de la migración, y abiertos los del índice parcial', () => {
    expect([...RESEARCH_CASE_STATUSES]).toEqual(['pending', 'researching', 'researched', 'rewriting', 'rewritten', 'no_material', 'failed']);
    expect(RESEARCH_CASE_STATUSES.filter((s) => isOpenResearchCase({ status: s }))).toEqual(['pending', 'researching', 'researched', 'rewriting']);
    expect(isOpenResearchCase(null)).toBe(false);
  });
});

describe('4 · la pista: sólo las tarjetas con caso piden su estado', () => {
  it('sí: espera, cerró, nació de un caso o fue reemplazada', () => {
    expect(researchHintOf({ challenged_reason: 'Investigación pendiente: ¿Y?' })).toBe(true);
    expect(researchHintOf({ challenged_reason: 'Investigación cerrada: no se encontró material para «¿Y?».' })).toBe(true);
    expect(researchHintOf({ assets: { supersedes: { piece_id: 'p-0', case_id: 'c-1' } } })).toBe(true);
    expect(researchHintOf({ assets: { superseded_by: { piece_id: 'p-2', case_id: 'c-1' } } })).toBe(true);
    expect(researchHintOf({ assets: { research_case: { case_id: 'c-1' } } })).toBe(true);
  });
  it('no: una pieza sin caso, un fixable o un reto del carril', () => {
    expect(researchHintOf(null)).toBe(false);
    expect(researchHintOf({ challenged_reason: null, assets: null })).toBe(false);
    expect(researchHintOf({ challenged_reason: 'fixable: acortar el cierre' })).toBe(false);
    expect(researchHintOf({ challenged_reason: 'Auto-fix: no pudo resolver X' })).toBe(false);
  });
  it('viaja en el contexto de la tarjeta', () => {
    const p = { id: 'p-1', brand_id: 'MarcaInventadaA', status: 'challenged', challenged_reason: 'Investigación pendiente: ¿Y?', assets: {} } as unknown as ContentPiece;
    expect(toContext(p).research_hint).toBe(true);
    expect(toContext({ ...p, challenged_reason: null } as ContentPiece).research_hint).toBe(false);
  });
});

describe('5 · multimarca', () => {
  it('la ruta no nombra marcas, rubros ni plataformas', () => {
    const code = RUTA.toLowerCase();
    for (const n of ['forumphs', 'neuronescf', 'luciensael', 'unrealville', 'fphs', 'nscf', 'instagram', 'meta_ig', 'linkedin', 'fiduci'])
      expect(code.includes(n), n).toBe(false);
  });
});
