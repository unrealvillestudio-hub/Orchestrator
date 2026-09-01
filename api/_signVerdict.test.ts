import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  watcherOf, verdictReason, verdictEffect, toContext, CALIBRATION_STATUSES, FIXABLE_REASON_PREFIX,
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
const SHARED = readFileSync(new URL('./_calibrationShared.ts', import.meta.url), 'utf8');

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
    // El literal se partió en dos ramas al entrar el tercer veredicto: en `fixable` el textarea es
    // la PROPUESTA, no el criterio, y por eso ahí `buildCriterion` sólo lleva el chip. La propiedad
    // que este test fija no cambió — la clase de defecto sigue viajando por `buildCriterion`.
    expect(MOD).toMatch(/buildCriterion\(reason, note\)/);
    expect(MOD).toMatch(/buildCriterion\(reason, null\)/);
  });
});

// ── el tercer veredicto: fixable ─────────────────────────────────────────────────
describe('fixable · sella igual que un rechazo, y la diferencia vive en el corpus', () => {
  it('sella la pieza: sin discarded_at reaparecería en la bandeja mañana', () => {
    // Es la restricción que decide el diseño entero. La bandeja lista CALIBRATION_STATUSES
    // filtrando por discarded_at IS NULL: un veredicto que no sella no es un veredicto.
    const e = verdictEffect('fixable', '2026-08-31T22:00:00Z', 'sam', 'motivo:titulo', 'se rescata el gancho');
    expect(e.status).toBe('rejected');
    expect(e.discarded_at).toBe('2026-08-31T22:00:00Z');
    expect(CALIBRATION_STATUSES).toContain('awaiting_approval');
  });

  it('MISMAS COLUMNAS que un rechazo: lo único que cambia es qué dice el motivo', () => {
    // La versión anterior de esta prueba exigía `toEqual` con el rechazo, que era la lectura
    // literal del brief. Sam la corrigió el 2026-08-31: el corpus SE ARCHIVA, y una fila
    // `fixable` archivada dejaría la pieza indistinguible de un rechazo en `content_pieces`
    // para siempre. Lo que se sigue exigiendo —y es lo que protegía la prueba— es que el
    // SELLADO sea idéntico: mismas columnas, mismo status, misma fecha.
    const fix = verdictEffect('fixable', '2026-08-31T22:00:00Z', 'sam', 'x', 'la propuesta');
    const rej = verdictEffect('rejected', '2026-08-31T22:00:00Z', 'sam', 'x');
    expect(Object.keys(fix).sort()).toEqual(Object.keys(rej).sort());
    expect(fix.status).toBe(rej.status);
    expect(fix.discarded_at).toBe(rej.discarded_at);
    expect(fix.discarded_reason).not.toBe(rej.discarded_reason);
  });

  it('el motivo de la pieza lleva el marcador y la propuesta, no el criterio', () => {
    const e = verdictEffect('fixable', '2026-08-31T22:00:00Z', 'sam', 'motivo:titulo', 'se rescata el gancho');
    expect(e.discarded_reason).toBe(`${FIXABLE_REASON_PREFIX} se rescata el gancho`);
    // Greppable: una consulta sobre content_pieces puede separar los dos sin mirar el corpus.
    expect(String(e.discarded_reason).startsWith(FIXABLE_REASON_PREFIX)).toBe(true);
  });

  it('un rechazo NO gana marcador: sigue llevando su criterio tal cual', () => {
    const e = verdictEffect('rejected', '2026-08-31T22:00:00Z', 'sam', 'motivo:falta_firma');
    expect(e.discarded_reason).toBe('motivo:falta_firma');
    expect(String(e.discarded_reason)).not.toContain(FIXABLE_REASON_PREFIX);
  });

  it('la propuesta baja a la pieza, no sólo al corpus', () => {
    expect(VERDICT).toMatch(/applyVerdictToPiece\(pieceId, verdict, evaluated_by, criterion \|\| null, fix_proposal\)/);
  });

  it('la ventana se EXPLICA en vez de disfrazarse de fallo', () => {
    // Un 500 genérico durante la ventana es indistinguible de un fallo real y el operador no
    // puede saber que no hay nada roto. Mismo criterio que `challenged-queue` con su tabla
    // ausente. El texto crudo del server viaja igual, por si la detección se equivoca.
    expect(VERDICT).toMatch(/CorpusColumnMissing/);
    expect(VERDICT).toMatch(/corpus_column_missing/);
    expect(VERDICT).toMatch(/server_detail/);
    expect(SHARED).toMatch(/class CorpusColumnMissing/);
  });

  it('la interfaz muestra la explicación, no el código de la máquina', () => {
    const SERVICE = readFileSync(new URL('../src/services/calibrationInbox.ts', import.meta.url), 'utf8');
    expect(SERVICE).toMatch(/data\.detail \|\| data\.message \|\| data\.error/);
  });

  it('aprobar sigue siendo la única rama que habilita', () => {
    expect(verdictEffect('approved', '2026-08-31T22:00:00Z', 'sam', null).status).toBe('scheduled');
  });

  it('la propuesta es OBLIGATORIA: sin ella el endpoint corta con 400 antes de tocar nada', () => {
    expect(VERDICT).toMatch(/fix_proposal required/);
    expect(VERDICT.indexOf('fix_proposal required')).toBeLessThan(VERDICT.indexOf('upsertVerdict('));
  });

  it('la propuesta viaja SÓLO con fixable: con los otros dos va null', () => {
    expect(VERDICT).toMatch(/const fix_proposal = verdict === 'fixable' \? proposal : null/);
  });

  it('el reintento sin la columna se RETIRÓ: el upsert nunca degrada el payload', () => {
    // Existió para la ventana entre el PR de código y el de DDL. Con la migración aplicada esa
    // rama no puede ejecutarse nunca, y un camino inalcanzable es deuda, no seguridad — además
    // degradaba en silencio lo que se escribe al corpus. Lo que se conserva es DECIR qué falta:
    // eso no cambia lo que se escribe, sólo lo que se cuenta.
    expect(SHARED).not.toMatch(/row\.fix_proposal === null/);
    expect(SHARED).not.toMatch(/\.\.\.legacy/);
    expect(SHARED).toMatch(/detail\.includes\('fix_proposal'\)/);
    expect(SHARED).toMatch(/class CorpusColumnMissing/);
  });

  it('el mensaje dice qué falta y qué hacer, y NO promete el estado de lo demás', () => {
    // «No hay nada roto» y «aprobar y rechazar siguen funcionando» eran afirmaciones sobre el
    // resto del sistema que este endpoint no comprueba antes de emitirlas. Y como la detección
    // se apoya en el texto del error de PostgREST —heurística, no medición—, si acertara sobre
    // el error equivocado tranquilizarían en el caso exacto en que no deben.
    // Se mide el CÓDIGO, no el comentario: el comentario cita las dos frases retiradas para
    // explicar por qué se fueron, y nombrarlas ahí no las reintroduce en la respuesta.
    const emitido = sinComentarios(VERDICT);
    expect(emitido).not.toMatch(/no hay nada roto/i);
    expect(emitido).not.toMatch(/siguen funcionando/i);
    expect(emitido).toMatch(/aplicando la migración/);
  });

  it('el texto crudo del server es ALCANZABLE en la tarjeta, no sólo enviado', () => {
    // Viajaba al navegador y la tarjeta guardaba únicamente `err.message`, tirando el objeto:
    // la mitigación existía sobre el papel y no en la pantalla. Plegado está bien; ausente no.
    expect(MOD).toMatch(/server_detail/);
    expect(MOD).toMatch(/<details/);
  });

  it('la UI no degrada un fixable a rejected en silencio: muestra el error del server', () => {
    // Un fallback silencioso guardaría un rechazo donde Sam pidió un fixable, y el corpus
    // quedaría mintiendo sin que nadie se entere.
    const limpio = sinComentarios(MOD);
    expect(limpio).not.toMatch(/catch[\s\S]{0,200}submitVerdict\('rejected'\)/);
    expect(limpio).toMatch(/setError\(err instanceof CalibrationError \? err\.message/);
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
