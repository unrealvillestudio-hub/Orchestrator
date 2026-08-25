import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CHALLENGE_VERDICTS, retentionReason, pieceBody, pieceTitle, toChallengedRow,
  type JudgeCalibrationRow, type RawPiece,
} from './_challengedShared.js';

/**
 * Pruebas de la bandeja de RETENIDAS — CALIB-01-E.
 *
 * POR QUÉ EXISTEN. Cuando se escribieron, `intel.judge_calibration` todavía no estaba
 * migrada (CALIB-01 cortes A–D se despliegan por separado), así que NO hay una retenida en
 * vivo contra la que probar. Eso no es motivo para no probar: lo que se fija acá es la
 * transformación PURA de la fila —qué ve Sam y de dónde sale cada campo—, que es
 * exactamente lo que rompería en silencio si el contrato cambiara.
 *
 * Los identificadores de las fixtures son FICTICIOS a propósito: si la lógica dependiera
 * del nombre de una marca o del código de una regla reales, estas pruebas fallarían.
 */

// ── Fixtures ─────────────────────────────────────────────────────────────────────
const BRAND = 'BrandAlpha';
const RULE = 'XX-ALPHA-01';

function cal(over: Partial<JudgeCalibrationRow> = {}): JudgeCalibrationRow {
  return {
    id: 'c-1', piece_id: 'p-1', queue_id: 'q-1', brand_id: BRAND,
    rule_code: RULE, verify_pattern: 'patron', judge_marked: true, pattern_found: false,
    verdict: null, decided_by: null, decided_at: null, note: null,
    created_at: '2026-08-25T02:00:00Z',
    ...over,
  };
}

function piece(over: Partial<RawPiece> = {}): RawPiece {
  return {
    id: 'p-1', brand_id: BRAND, domain: 'dom', platform: 'surface_one',
    status: 'challenged', created_at: '2026-08-25T01:59:00Z',
    assets: { copy: { title: 'Un título', raw: 'cuerpo crudo', aife_filtered: 'cuerpo filtrado' } },
    pass_type: 'assisted', challenged_at: '2026-08-25T02:00:00Z',
    edited_at: null, edited_by: null,
    ...over,
  };
}

// ── El conjunto de veredictos ────────────────────────────────────────────────────
describe('CHALLENGE_VERDICTS', () => {
  it('son exactamente dos, y son los del CHECK de la tabla', () => {
    expect([...CHALLENGE_VERDICTS]).toEqual(['judge_was_right', 'rule_failed']);
  });

  it('no incluye un veredicto de "editar": editar NO es un arbitraje', () => {
    // Si "editar" fuera un veredicto, la decisión binaria dejaría de ser binaria y el
    // arbitraje dejaría de tomar segundos — que es lo único que hace que esto escale.
    expect(CHALLENGE_VERDICTS).not.toContain('edited' as never);
  });
});

// ── La razón de la retención ─────────────────────────────────────────────────────
describe('retentionReason', () => {
  it('nombra la regla y explica el desacuerdo en una línea', () => {
    const r = retentionReason(RULE);
    expect(r).toContain(RULE);
    expect(r).toMatch(/patrón verificable no aparece/);
  });

  it('el código llega como DATO: la función no conoce ninguna regla', () => {
    expect(retentionReason('ZZ-OTRA-99')).toContain('ZZ-OTRA-99');
  });
});

// ── El cuerpo efectivo de la pieza ───────────────────────────────────────────────
describe('pieceBody', () => {
  it('prefiere la cara que se publica (aife_filtered)', () => {
    // Es el MISMO criterio que aplica el endpoint de edición del otro lado. Si acá se
    // mostrara `raw` y allá se escribiera la otra cara, Sam editaría un texto distinto del
    // que ve — y no se enteraría hasta ver lo publicado.
    expect(pieceBody(piece())).toBe('cuerpo filtrado');
  });

  it('cae a raw cuando no hay cara filtrada', () => {
    expect(pieceBody(piece({ assets: { copy: { raw: 'sólo crudo' } } }))).toBe('sólo crudo');
  });

  it('una cara filtrada VACÍA sigue siendo la cara que se publica', () => {
    // '' es un texto, no una ausencia: caer a `raw` acá mostraría un cuerpo que ya no existe.
    expect(pieceBody(piece({ assets: { copy: { raw: 'viejo', aife_filtered: '' } } }))).toBe('');
  });

  it('sin assets, sin copy o sin pieza devuelve null, nunca revienta', () => {
    expect(pieceBody(piece({ assets: null }))).toBeNull();
    expect(pieceBody(piece({ assets: {} as any }))).toBeNull();
    expect(pieceBody(null)).toBeNull();
    expect(pieceBody(undefined)).toBeNull();
  });
});

describe('pieceTitle', () => {
  it('devuelve el título de assets.copy', () => {
    expect(pieceTitle(piece())).toBe('Un título');
  });

  it('un título en blanco es AUSENCIA de título, no un título vacío', () => {
    expect(pieceTitle(piece({ assets: { copy: { title: '   ' } } }))).toBeNull();
    expect(pieceTitle(piece({ assets: { copy: { title: null } } }))).toBeNull();
  });
});

// ── La fila que ve Sam ───────────────────────────────────────────────────────────
describe('toChallengedRow', () => {
  const pieces = new Map([['p-1', piece()]]);
  const statements = new Map([[RULE, 'El enunciado completo de la regla.']]);

  it('trae la regla en disputa CON su enunciado', () => {
    const r = toChallengedRow(cal(), pieces, statements);
    expect(r.rule_code).toBe(RULE);
    expect(r.rule_statement).toBe('El enunciado completo de la regla.');
    // Sin el enunciado, "¿el juez tenía razón sobre XX-ALPHA-01?" no es una pregunta
    // contestable: es un código y una moneda al aire.
  });

  it('el enunciado ausente NO tumba la fila: el arbitraje sigue siendo posible', () => {
    const r = toChallengedRow(cal(), pieces, new Map());
    expect(r.rule_statement).toBeNull();
    expect(r.rule_code).toBe(RULE);
  });

  it('lleva el patrón y el hecho de que NO aparece: eso ES el desacuerdo', () => {
    const r = toChallengedRow(cal(), pieces, statements);
    expect(r.verify_pattern).toBe('patron');
    expect(r.pattern_found).toBe(false);
  });

  it('una fila sin pieza se puede arbitrar igual, sobre la regla', () => {
    const r = toChallengedRow(cal({ piece_id: null }), pieces, statements);
    expect(r.piece).toBeNull();
    expect(r.id).toBe('c-1');
  });

  it('un piece_id que no resolvió tampoco rompe la fila', () => {
    const r = toChallengedRow(cal({ piece_id: 'ausente' }), pieces, statements);
    expect(r.piece).toBeNull();
  });

  it('la pieza viaja con el texto que se publica y su estado de calibración', () => {
    const r = toChallengedRow(cal(), pieces, statements);
    expect(r.piece?.title).toBe('Un título');
    expect(r.piece?.body).toBe('cuerpo filtrado');
    expect(r.piece?.pass_type).toBe('assisted');
    expect(r.piece?.status).toBe('challenged');
  });

  it('el id de la fila es el del ARBITRAJE, no el de la pieza', () => {
    // El grano es (pieza, regla): dos desacuerdos sobre la misma pieza son dos filas y dos
    // decisiones. Si la bandeja se identificara por piece_id, decidir una arrastraría la
    // otra — decidir en bloque sobre reglas distintas es exactamente lo que no debe pasar.
    const dos = [cal({ id: 'c-1', rule_code: 'XX-ALPHA-01' }), cal({ id: 'c-2', rule_code: 'XX-ALPHA-02' })]
      .map((c) => toChallengedRow(c, pieces, statements));
    expect(dos.map((r) => r.id)).toEqual(['c-1', 'c-2']);
    expect(new Set(dos.map((r) => r.piece_id)).size).toBe(1);
  });
});

// ── Multimarca (test de la marca N+1) ────────────────────────────────────────────
describe('multimarca', () => {
  it('ninguna marca, plataforma ni código de regla vive en el módulo', () => {
    // Se mide sobre el CÓDIGO del módulo, no sobre estas fixtures. Una marca real cableada
    // acá haría que NSCF, UnrealvilleStudio o LucienSael necesitaran tocar este archivo.
    const src = readSource();
    for (const marca of ['ForumPHs', 'LucienSael', 'UnrealvilleStudio', 'NeuroneSCF'])
      expect(src).not.toContain(marca);
    for (const plat of ['meta_ig', 'meta_fb', 'linkedin', 'tiktok'])
      expect(src).not.toContain(plat);
    expect(src).not.toMatch(/HR-[A-Z0-9]+-\d+/);
  });
});

/**
 * El módulo SIN comentarios: el archivo EXPLICA el defecto del 25-ago, y nombrar un código
 * de regla dentro de una explicación no lo cablea. Lo que se mide es lo que se ejecuta.
 */
function readSource(): string {
  return readFileSync(new URL('./_challengedShared.ts', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*'); })
    .join('\n');
}
