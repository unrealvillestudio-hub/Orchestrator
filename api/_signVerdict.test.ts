import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  watcherOf, verdictReason, verdictEffect, toContext, CALIBRATION_STATUSES,
  type ContentPiece,
} from './_calibrationShared.js';
import { buildCriterion, REJECT_REASONS, REASON_PREFIX } from '../src/services/calibrationInbox';

/**
 * SIGN-01 cortes A2, D y E — LA BANDEJA EJECUTA, Y LO QUE MUESTRA NO HACE RECHAZAR MATERIAL BUENO.
 *
 * LOS TRES DEFECTOS, medidos el 2026-08-25:
 *   A2 · Ninguna de las 6 decisiones de Sam tocó la pieza: sólo se escribió `approval_calibration`.
 *        No había flujo, había opiniones registradas.
 *   D  · La lista de códigos de la tarjeta ERA el conjunto EVALUADO y se leía como de violaciones —
 *        en `c92b2b9f` aparecían 19 códigos y el Watcher había dado OK. Y la bandeja mezclaba
 *        estados: `c5d542b7` y `afded574` fueron rechazadas estando ya apartadas por el sistema.
 *   E  · Los motivos de rechazo se escribían a mano y no eran agregables.
 *
 * Los identificadores de las fixtures son FICTICIOS: si la lógica dependiera de una marca real,
 * estas pruebas fallarían.
 */

/** Sin comentarios: estos archivos EXPLICAN el defecto que cierran, y nombrarlo no lo reintroduce. */
const sinComentarios = (src: string) => src
  .split('\n')
  .filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('{/*'); })
  .join('\n');

const UI = readFileSync(new URL('../src/modules/iid/pieceUi.tsx', import.meta.url), 'utf8');
const MOD = readFileSync(new URL('../src/modules/iid/ApprovalCalibrationModule.tsx', import.meta.url), 'utf8');
const VERDICT = readFileSync(new URL('./calibration-verdict.ts', import.meta.url), 'utf8');

function piece(over: Partial<ContentPiece> = {}): ContentPiece {
  return { id: 'p-1', brand_id: 'BrandAlpha', ...over };
}
const conWatcher = (w: Record<string, unknown>, extra: Partial<ContentPiece> = {}) =>
  piece({ assets: { watcher: w } as any, ...extra });

// ── A2 · la decisión se ejecuta ──────────────────────────────────────────────────
describe('A2 · aprobar y rechazar TOCAN la pieza', () => {
  it('aprobar HABILITA: sella approved_at, que es lo que la colocación exige', () => {
    const e = verdictEffect('approved', '2026-08-25T22:00:00Z', 'sam', null);
    expect(e.status).toBe('scheduled');
    expect(e.approved_at).toBe('2026-08-25T22:00:00Z');
    expect(e.approved_by).toBe('sam');
  });

  it('aprobar NO publica: no toca scheduled_posts', () => {
    expect(sinComentarios(VERDICT)).not.toMatch(/scheduled_posts/);
    expect(VERDICT).toMatch(/published: false/);
  });

  it('rechazar DESCARTA: sin discarded_at la pieza seguiría en la bandeja', () => {
    const e = verdictEffect('rejected', '2026-08-25T22:00:00Z', 'sam', 'motivo:falta_firma');
    expect(e.status).toBe('rejected');
    expect(e.discarded_at).toBe('2026-08-25T22:00:00Z');
    expect(e.discarded_reason).toBe('motivo:falta_firma');
  });

  it('el efecto va DESPUÉS del corpus: si el corpus falla, la pieza no se mueve', () => {
    expect(VERDICT.indexOf('upsertVerdict(')).toBeLessThan(VERDICT.indexOf('applyVerdictToPiece('));
  });

  it('quien firma sale de la SESIÓN, no del body', () => {
    // `evaluated_by` cae a session.sub; un sello firmable con el nombre de otro no es auditable.
    expect(VERDICT).toMatch(/session\.sub \|\| 'sam'/);
    expect(VERDICT).toMatch(/applyVerdictToPiece\(pieceId, verdict, evaluated_by/);
  });

  it('una pieza que otra mano movió primero se reporta, no se finge', () => {
    expect(VERDICT).toMatch(/piece_applied: false/);
  });
});

// ── D · el veredicto, sin ambigüedad ─────────────────────────────────────────────
describe('D · los cuatro estados se nombran', () => {
  it('RESCHEDULE deja de colapsarse a "sin evaluar"', () => {
    // Antes `watcherOf` sólo admitía PASS|REJECT: una pieza aplazada se veía igual que una que el
    // Watcher nunca juzgó. Son dos cosas distintas.
    expect(watcherOf(conWatcher({ result: 'RESCHEDULE', failed_gate: 'duplication' })).result).toBe('RESCHEDULE');
    expect(toContext(conWatcher({ result: 'RESCHEDULE' })).watcher_verdict).toBe('RESCHEDULE');
  });

  it('sin veredicto se dice "not_evaluated": ninguna tarjeta queda muda', () => {
    expect(toContext(piece()).watcher_verdict).toBe('not_evaluated');
    expect(toContext(conWatcher({ result: 'lo-que-sea' })).watcher_verdict).toBe('not_evaluated');
  });

  it('el gate acompaña a todo veredicto que no sea PASS', () => {
    expect(watcherOf(conWatcher({ result: 'RESCHEDULE', failed_gate: 'duplication' })).gate).toBe('duplication');
    expect(watcherOf(conWatcher({ result: 'PASS', failed_gate: 'x' })).gate).toBeNull();
  });

  it('un PASS dice "evaluó y pasó", no "aprobó"', () => {
    const r = verdictReason(watcherOf(conWatcher({ result: 'PASS', rules_evaluated: 19 })));
    expect(r).toMatch(/pasó los gates/);
    expect(r).toMatch(/19 regla/);
    expect(r).toMatch(/ninguna se incumplió/);
    expect(UI).toMatch(/Watcher: evaluó y PASÓ/);
    expect(sinComentarios(UI)).not.toMatch(/Watcher: OK/);
  });

  it('LA RAZÓN viaja, no sólo el código', () => {
    const r = verdictReason(watcherOf(conWatcher({ result: 'REJECT', failed_gate: 'hard_rules', failed_rules: ['XX-A-01', 'XX-B-02'] })));
    expect(r).toMatch(/incumplió 2 regla/);
    expect(r).toMatch(/XX-A-01, XX-B-02/);
    expect(r).toMatch(/hard_rules/);
  });

  it('un RESCHEDULE dice que NO es un defecto de la pieza', () => {
    expect(verdictReason(watcherOf(conWatcher({ result: 'RESCHEDULE', failed_gate: 'duplication' }))))
      .toMatch(/no es un defecto de la pieza/);
  });

  it('EVALUADAS se cuentan; INCUMPLIDAS se enumeran', () => {
    // Es el defecto que hace rechazar material perfecto: 19 códigos a la vista sobre un OK.
    // Las evaluadas se pintan como CONTEO ("· N evaluadas"), nunca como lista.
    expect(sinComentarios(UI)).toMatch(/evaluada/);
    expect(UI).toMatch(/NO son incumplimientos/);
    const enumera = UI.slice(UI.indexOf("verdict === 'REJECT' && codes.length"), UI.indexOf('rulesEvaluated ==='));
    expect(enumera).toMatch(/codes\.join/);
  });

  it('pass_type visible: clean frente a assisted', () => {
    expect(toContext(piece({ pass_type: 'assisted' })).pass_type).toBe('assisted');
    expect(UI).toMatch(/asistida/);
    expect(UI).toMatch(/ratio aprovechable/);
  });

  it('la bandeja de calibración SÓLO lista lo que espera aprobación', () => {
    // `c5d542b7` y `afded574` fueron rechazadas estando ya apartadas por el sistema.
    expect(CALIBRATION_STATUSES).toEqual(['awaiting_approval']);
    expect(CALIBRATION_STATUSES).not.toContain('deferred');
    expect(CALIBRATION_STATUSES).not.toContain('challenged');
  });

  it('el corpus conserva su contrato: un RESCHEDULE no es una opinión sobre la pieza', () => {
    expect(toContext(conWatcher({ result: 'RESCHEDULE' })).watcher_result).toBeNull();
    expect(toContext(conWatcher({ result: 'REJECT' })).watcher_result).toBe('REJECT');
  });
});

// ── E · el motivo, agregable ─────────────────────────────────────────────────────
describe('E · motivo de rechazo estructurado', () => {
  it('el motivo viaja con prefijo estable, agrupable por consulta', () => {
    expect(buildCriterion('falta_firma', null)).toBe(`${REASON_PREFIX}falta_firma`);
    expect(buildCriterion('falta_firma', 'y además el título')).toBe(`${REASON_PREFIX}falta_firma · y además el título`);
  });

  it('sigue siendo OPCIONAL: sin motivo, el criterio es el de siempre', () => {
    expect(buildCriterion(null, 'sólo prosa')).toBe('sólo prosa');
    expect(buildCriterion('', '')).toBeNull();
    expect(buildCriterion(null, null)).toBeNull();
  });

  it('las clases son de defecto EDITORIAL, nunca marcas', () => {
    const claves = REJECT_REASONS.map((r) => r.value);
    expect(claves).toContain('falta_firma');
    expect(claves).toContain('texto_truncado');
    for (const m of ['ForumPHs', 'LucienSael', 'UnrealvilleStudio', 'NeuroneSCF'])
      expect(claves.join(' ')).not.toContain(m);
  });

  it('la UI ofrece la lista cerrada y la manda por buildCriterion', () => {
    expect(MOD).toMatch(/REJECT_REASONS\.map/);
    expect(MOD).toMatch(/criterion: buildCriterion\(reason, note\)/);
  });
});

// ── multimarca ───────────────────────────────────────────────────────────────────
describe('multimarca', () => {
  it('ninguna marca en el badge ni en el efecto del veredicto', () => {
    const limpio = (src: string) => src.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
    for (const [n, src] of [['pieceUi', limpio(UI)], ['calibration-verdict', limpio(VERDICT)]]) {
      for (const m of ['ForumPHs', 'LucienSael', 'UnrealvilleStudio', 'NeuroneSCF'])
        expect(`${n}:${src}`).not.toContain(m);
    }
  });
});
