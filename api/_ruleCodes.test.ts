import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  tokenizeRuleText, codesIn, codesInValue, ruleTextsForBrand, ruleTextsFor, firstSentence,
  RULE_CODE_PATTERN, type RuleTextRow,
} from './_ruleCodes';

/**
 * 2026-10-05 — CHIP DE REGLA. Sam: pasar el ratón sobre un código de regla muestra qué dice. Lo
 * que se prueba aquí es lo que decide QUÉ se muestra: qué es un código, y de qué marca puede venir.
 */
describe('tokenizeRuleText — qué es un código de regla', () => {
  it('parte el texto en literales y códigos, y unirlos devuelve el original byte a byte', () => {
    const s = 'Auto-fix (1 intento): corrigió HR-AAA-05, HR-AAA-16 e IMG-BBB-02.';
    const t = tokenizeRuleText(s);
    expect(t.filter((k) => k.t === 'code').map((k) => k.v)).toEqual(['HR-AAA-05', 'HR-AAA-16', 'IMG-BBB-02']);
    expect(t.map((k) => k.v).join('')).toBe(s);
  });

  it('FIXABLE-PROPUESTA es un pseudo-código y queda como texto', () => {
    expect(codesIn('resolvió FIXABLE-PROPUESTA y HR-AAA-01')).toEqual(['HR-AAA-01']);
    expect(tokenizeRuleText('FIXABLE-PROPUESTA')).toEqual([{ t: 'text', v: 'FIXABLE-PROPUESTA' }]);
  });

  it('sólo la forma exacta: ni pegado a otra palabra, ni con tres dígitos, ni en minúsculas', () => {
    for (const no of ['XHR-AAA-01', 'HR-AAA-012', 'HR-AAA-01X', 'hr-aaa-01', 'HR-AAA-1', 'HR--01', 'HR-AAA-01-B'])
      expect(codesIn(no)).toEqual([]);
    expect(codesIn('(HR-AAA-01)')).toEqual(['HR-AAA-01']);
  });

  it('códigos repetidos se cuentan una vez; texto vacío o nulo no rompe', () => {
    expect(codesIn('HR-A-01 y HR-A-01')).toEqual(['HR-A-01']);
    expect(tokenizeRuleText(null)).toEqual([]);
    expect(codesInValue({ a: ['HR-A-01'], b: { c: 'ver IMG-B-02' } })).toEqual(['HR-A-01', 'IMG-B-02']);
  });

  it('la regex casa con la forma de TODOS los códigos de la tabla: ^(HR|IMG)-[A-Z]+-[0-9]{2}$', () => {
    const re = new RegExp(`^${RULE_CODE_PATTERN}$`);
    for (const c of ['HR-GEN-01', 'HR-LEGAL-02', 'IMG-RETAIL-01', 'HR-ZZZ-99']) expect(re.test(c)).toBe(true);
  });
});

describe('ruleTextsForBrand — una regla de otra marca nunca llega a la pieza', () => {
  const rows: RuleTextRow[] = [
    { code: 'HR-GEN-01', statement: 'General.', severity: 'warn', brand_id: null },
    { code: 'HR-AAA-01', statement: 'De la marca A.', severity: 'blocking', brand_id: 'MarcaA' },
    { code: 'HR-BBB-01', statement: 'De la marca B.', severity: 'blocking', brand_id: 'MarcaB' },
  ];

  it('la marca ve las suyas y las generales; no las de otra', () => {
    expect(Object.keys(ruleTextsForBrand(rows, 'MarcaA')).sort()).toEqual(['HR-AAA-01', 'HR-GEN-01']);
    expect(ruleTextsForBrand(rows, 'MarcaA')['HR-BBB-01']).toBeUndefined();
  });

  it('MARCA N+1: una marca inventada, sin una línea de código nueva, ve sólo sus reglas y las generales', () => {
    const conN1 = [...rows, { code: 'HR-NUEVA-01', statement: 'De la marca N+1.', severity: 'warn', brand_id: 'MarcaInventadaN1' }];
    expect(ruleTextsForBrand(conN1, 'MarcaInventadaN1')).toEqual({
      'HR-GEN-01': { statement: 'General.', severity: 'warn' },
      'HR-NUEVA-01': { statement: 'De la marca N+1.', severity: 'warn' },
    });
    expect(ruleTextsForBrand(conN1, 'MarcaA')['HR-NUEVA-01']).toBeUndefined();
  });

  it('sin marca resuelta, sólo las generales', () => {
    expect(Object.keys(ruleTextsForBrand(rows, null))).toEqual(['HR-GEN-01']);
    expect(Object.keys(ruleTextsForBrand(rows, ''))).toEqual(['HR-GEN-01']);
  });

  it('si una regla de marca y una general comparten código, gana la de la marca, en cualquier orden', () => {
    const dup: RuleTextRow[] = [
      { code: 'HR-X-01', statement: 'Propia.', severity: 'blocking', brand_id: 'MarcaA' },
      { code: 'HR-X-01', statement: 'General.', severity: 'warn', brand_id: null },
    ];
    expect(ruleTextsForBrand(dup, 'MarcaA')['HR-X-01'].statement).toBe('Propia.');
    expect(ruleTextsForBrand([...dup].reverse(), 'MarcaA')['HR-X-01'].statement).toBe('Propia.');
  });

  it('ruleTextsFor recorta a los códigos de la pieza y descarta filas sin enunciado', () => {
    const conVacia = [...rows, { code: 'HR-AAA-02', statement: '  ', severity: 'warn', brand_id: 'MarcaA' }];
    expect(ruleTextsFor(conVacia, 'MarcaA', ['HR-AAA-01', 'HR-AAA-02', 'HR-BBB-01'])).toEqual({
      'HR-AAA-01': { statement: 'De la marca A.', severity: 'blocking' },
    });
  });

  it('el módulo no nombra ninguna marca (sin comentarios: CC_PROTOCOL §14.1)', () => {
    const src = readFileSync(new URL('./_ruleCodes.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const nombre of ['NeuroneSCF', 'ForumPHs', 'LucienSael', 'UnrealvilleStudio', 'FPHS', 'NSCF', 'UNRLVL'])
      expect(src).not.toContain(nombre);
  });
});

describe('la lectura de reglas', () => {
  it('pide enunciado, severidad y marca; nunca `instruction` (Sam: sólo el enunciado)', () => {
    const src = readFileSync(new URL('./_challengedShared.ts', import.meta.url), 'utf8');
    const f = src.slice(src.indexOf('export async function fetchRuleTexts'), src.indexOf('/** Las columnas de pieza'));
    expect(f).toContain('select=code,statement,severity,brand_id');
    expect(f).not.toContain('instruction');
  });
});

describe('firstSentence — lo que se ve al pasar el ratón', () => {
  it('corta en la primera frase', () => {
    expect(firstSentence('La primera. La segunda.')).toBe('La primera.');
    expect(firstSentence('¿Pregunta? Respuesta.')).toBe('¿Pregunta?');
  });
  it('sin punto, el texto entero; muy larga, cortada con …', () => {
    expect(firstSentence('Sin punto final')).toBe('Sin punto final');
    const larga = 'a'.repeat(400) + '.';
    expect(firstSentence(larga).length).toBe(180);
    expect(firstSentence(larga).endsWith('…')).toBe(true);
  });
});
