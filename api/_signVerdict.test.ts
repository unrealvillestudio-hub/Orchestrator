import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  watcherOf, verdictReason, verdictEffect, toContext, CALIBRATION_STATUSES, FIXABLE_REASON_PREFIX,
  pendingStateOf,
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
/**
 * U-5 REAPUNTÓ ESTA LECTURA, Y NO LA DEBILITÓ. Lo que estas pruebas fijan seguía siendo
 * cierto; lo que cambió es DÓNDE vive. Los botones, sus paneles y sus llamadas se
 * extrajeron de `ApprovalCalibrationModule.tsx` al componente único `pieceActions.tsx`,
 * que montan las dos bandejas. Dejar la lectura en el archivo viejo habría hecho pasar las
 * pruebas contra un archivo que ya no contiene lo que afirman — verde sin verificar nada,
 * que es peor que rojo.
 */
const MOD = readFileSync(new URL('../src/modules/iid/pieceActions.tsx', import.meta.url), 'utf8');
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

  // ── CORTE D, CORREGIDO EL 2026-09-18 — LA MISMA INTENCIÓN, EL REMEDIO CONTRARIO ──────
  //
  // QUÉ AFIRMABA ESTA PRUEBA HASTA HOY: `CALIBRATION_STATUSES` debía ser exactamente
  // `['awaiting_approval']`, y no contener `deferred` ni `challenged`. El daño que protegía es
  // real y está medido: `c5d542b7` y `afded574` fueron rechazadas estando YA apartadas por el
  // sistema, sin que la pantalla lo dijera. Sam decidió sin saber.
  //
  // POR QUÉ EL REMEDIO ERA EL EQUIVOCADO. Excluir esos estados no informa la decisión: la
  // suprime. La pieza desaparece de la única pantalla donde Sam mira lo pendiente, su
  // `deferred_until` pasa solo y nadie la devuelve — medido el 2026-09-18 con la primera pieza
  // `blog` de la historia de la marca (`2c391e74`, `duplication:0.85`, aplazada hasta
  // 2026-10-09), que el motor generó bien y la bandeja no mostró. Y la exclusión se apoyaba en
  // una bandeja de aplazadas que NO EXISTE en este repositorio.
  //
  // LA REGLA DE SAM, literal: «TODO lo que está pendiente debe aparecer en la bandeja».
  //
  // QUÉ SE EXIGE AHORA, que es lo que el corte D quería y no consiguió: la pieza aparece Y la
  // pantalla dice en qué estado está. Una decisión informada necesita las dos mitades — por eso
  // esta prueba falla si se amplía la lista sin el eje que la distingue, o si se pinta el eje
  // sin decir el aplazamiento. Ni la inclusión sola ni el color solo cierran el corte D.
  it('todo lo pendiente se lista, y la tarjeta dice en qué estado está cada cosa', () => {
    // 1 · aparece: los tres estados vivos del CHECK, ninguno escondido.
    expect([...CALIBRATION_STATUSES].sort()).toEqual(['awaiting_approval', 'challenged', 'deferred']);

    // 2 · se distingue: incluir sin distinguir es el defecto de corte D al revés.
    expect(pendingStateOf('deferred', false)).toBe('aplazada');
    expect(pendingStateOf('challenged', false)).toBe('retenida');
    expect(pendingStateOf('awaiting_approval', false)).toBe('esperando');

    // 3 · se dice POR QUÉ y HASTA CUÁNDO. Es exactamente lo que le faltó a `c5d542b7`.
    expect(toContext(piece({ status: 'deferred', deferred_until: '2026-10-09T10:31:35Z', deferred_reason: 'duplication:0.85' })))
      .toMatchObject({ deferred_until: '2026-10-09T10:31:35Z', deferred_reason: 'duplication:0.85' });
    expect(sinComentarios(UI)).toMatch(/deferred_until|DeferralNotice/);
    expect(sinComentarios(UI)).toMatch(/apartó hasta/);

    // 4 · y el aviso lo decide el ESTADO, no la columna. Medido el 2026-09-18: `5aeb27e3` y
    // `7a7a8a58` volvieron a la bandeja vivas y `awaiting_approval` arrastrando un
    // `deferred_until` YA VENCIDO del ciclo anterior. Si el aviso se disparara por «la columna
    // no es nula», esas dos leerían «apartada hasta» una fecha pasada: una afirmación falsa en
    // la pantalla, el mismo daño que el corte D. `toContext` reporta la columna tal cual —es
    // el dato—; quien calla es la tarjeta.
    expect(toContext(piece({ status: 'awaiting_approval', deferred_until: '2026-09-10T13:00:54Z' })).deferred_until)
      .toBe('2026-09-10T13:00:54Z');
    expect(pendingStateOf('awaiting_approval', true)).not.toBe('aplazada');
    expect(sinComentarios(UI)).toMatch(/state !== 'aplazada'\) return null/);
  });

  it('un veredicto humano DEROGA el aplazamiento del sistema, y limpia sus dos columnas', () => {
    // El residuo medido: `5aeb27e3` y `7a7a8a58` volvieron a la bandeja arrastrando un
    // `deferred_until` vencido. Mientras la columna quede puesta, la fila dice algo que ya no es
    // cierto. Los TRES veredictos la limpian — aprobar, rechazar y fixable son decisiones humanas,
    // y una decisión humana manda sobre el apartado automático.
    for (const v of ['approved', 'rejected', 'fixable'] as const) {
      expect(verdictEffect(v, '2026-09-18T22:00:00Z', 'sam', 'motivo:x', 'propuesta'))
        .toMatchObject({ deferred_until: null, deferred_reason: null });
    }
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
describe('fixable · RETA la pieza, no la descarta (cambio de diseño del 2026-09-20)', () => {
  it('NO sella: marcar algo para arreglarlo no puede sacarlo de la cola de lo arreglable', () => {
    // EL DEFECTO QUE CIERRA. `discarded_at` no sólo saca la pieza de esta bandeja: la saca del
    // SISTEMA. Medido en unrlvl-iid-functions (migración 20260920030000): con esa columna puesta,
    // `storage-orphan-sweep` deja de sostener su imagen, `publish-slot-reserver` y el scheduler la
    // excluyen, y la vía de re-adaptación (READAPT-01) la rechaza por diseño.
    const e = verdictEffect('fixable', '2026-08-31T22:00:00Z', 'sam', 'motivo:titulo', 'se rescata el gancho');
    expect(e.status).toBe('challenged');
    expect(e.challenged_at).toBe('2026-08-31T22:00:00Z');
    expect(e.discarded_at).toBeNull();
  });

  it('limpia un descarte previo EXPLÍCITAMENTE, en vez de omitir la columna', () => {
    // Omitirla dejaría a una pieza re-juzgada tras un descarte diciendo a la vez que está retada y
    // que está descartada. Gana la que se escribe, así que las dos se escriben.
    const e = verdictEffect('fixable', '2026-08-31T22:00:00Z', 'sam', 'x', 'la propuesta');
    expect(Object.keys(e)).toContain('discarded_at');
    expect(Object.keys(e)).toContain('discarded_reason');
    expect(e.discarded_reason).toBeNull();
  });

  it('el motivo va a SU columna, `challenged_reason`, con el marcador y la propuesta', () => {
    // `challenged_reason` existe desde la migración del 2026-09-19, que nació porque el reto era el
    // único de los tres estados con fecha y sin motivo — así que el motivo caía en la del descarte.
    const e = verdictEffect('fixable', '2026-08-31T22:00:00Z', 'sam', 'motivo:titulo', 'se rescata el gancho');
    expect(e.challenged_reason).toBe(`${FIXABLE_REASON_PREFIX} se rescata el gancho`);
    expect(e.discarded_reason).toBeNull();
  });

  it('el marcador es LEGIBLE, no criterio: el estado decide, el texto sólo acompaña', () => {
    // Es la corrección de Sam del 2026-09-20: «podría decir otra cosa y entonces fallaría».
    // MEDIDO ese mismo día: de las 41 piezas con veredicto `fixable` en el corpus, 3 NO llevaban
    // el prefijo en su motivo. Un criterio de prefijo habría callado 3 sin que nadie lo notara.
    // Por eso lo que se exige acá es que el ESTADO no dependa del texto en ningún caso.
    for (const propuesta of ['se rescata el gancho', 'otra cosa entera', '   ']) {
      const e = verdictEffect('fixable', '2026-08-31T22:00:00Z', 'sam', 'motivo:x', propuesta);
      expect(e.status).toBe('challenged');
      expect(e.discarded_at).toBeNull();
    }
  });

  it('un rechazo sigue siendo un rechazo, sin marcador y sin tocar el reto', () => {
    const e = verdictEffect('rejected', '2026-08-31T22:00:00Z', 'sam', 'motivo:falta_firma');
    expect(e.status).toBe('rejected');
    expect(e.discarded_at).toBe('2026-08-31T22:00:00Z');
    expect(e.discarded_reason).toBe('motivo:falta_firma');
    expect(String(e.discarded_reason)).not.toContain(FIXABLE_REASON_PREFIX);
    expect(e.challenged_at).toBeUndefined();
  });

  it('los dos dejan de compartir columnas: son estados distintos, no etiquetas del mismo', () => {
    const fix = verdictEffect('fixable', '2026-08-31T22:00:00Z', 'sam', 'x', 'la propuesta');
    const rej = verdictEffect('rejected', '2026-08-31T22:00:00Z', 'sam', 'x');
    expect(fix.status).not.toBe(rej.status);
    expect(Object.keys(fix).sort()).not.toEqual(Object.keys(rej).sort());
  });

  it('la pieza retada sigue en la bandeja, pero NO como una tarjeta sin juzgar', () => {
    // Es lo que el sellado venía a evitar, y sigue evitado: `pendingStateOf` le da eje propio.
    // Un veredicto que no sella y tampoco distingue sería una nota que no se aplica — el defecto
    // de SIGN-01 corte A2, que ya costó seis decisiones sin efecto.
    expect(CALIBRATION_STATUSES).toContain('challenged');
    expect(pendingStateOf('challenged', true)).toBe('por_arreglar');
    expect(pendingStateOf('challenged', true)).not.toBe('esperando');
  });

  it('y no se confunde con una retenida del JUEZ, que se arbitra en vez de arreglarse', () => {
    // Los distingue si hay fila en el corpus: el juez escribe `intel.judge_calibration`, no
    // `intel.approval_calibration`. Una retada CON veredicto humano sólo puede venir de un fixable.
    expect(pendingStateOf('challenged', false)).toBe('retenida');
    expect(pendingStateOf('challenged', true)).not.toBe('retenida');
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
    // U-5 — la MISMA propiedad, en la forma nueva. El `setError(err instanceof …)` repetido
    // en cada handler se encapsuló en `cardError`, que conserva las dos mitades: la frase
    // redactada por el endpoint y el crudo del server. Lo que este test fija no cambió — que
    // el error del server LLEGA a la pantalla en vez de degradarse en silencio.
    expect(limpio).toMatch(/setError\(cardError\(err,/);
    expect(limpio).toMatch(/return \{ message: err\.message, detail \}/);
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
