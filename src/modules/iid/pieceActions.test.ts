import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  actionButtons, slotWarning, slotReleaseNotice, ACTION_SPECS, PANEL_COPY, OUTCOME_COPY,
} from './pieceActions';
import type { PieceActions, PieceActionKey } from '../../services/calibrationInbox';

/**
 * U-5 — LAS ACCIONES DE UNA PIEZA.
 *
 * Lo que estas pruebas fijan no es el aspecto de un botón: es que la decisión de si una
 * acción se puede venga del CONTRATO y no de la pantalla. Un condicional sobre `status` en
 * el front acertaría hoy y mentiría en cuanto el server cambiara de criterio, sin que nada
 * fallara — que es el modo de fallo que U-4 y U-5 existen para cerrar.
 *
 * Los identificadores de las fixtures son ficticios: si algo dependiera de una marca, de un
 * canal o de un huso reales, estas pruebas fallarían.
 */

// ── Fixtures ─────────────────────────────────────────────────────────────────────
const KEYS: PieceActionKey[] =
  ['approve', 'reject', 'fixable', 'discard', 'edit_text', 'recompose_image'];

const SI = { available: true, reason: null };
const NO = (reason: string) => ({ available: false, reason });

function actions(over: Partial<PieceActions> = {}): PieceActions {
  return Object.fromEntries(KEYS.map((k) => [k, SI])) as PieceActions;
}
const conTodo = actions();

const activos = (bs: ReturnType<typeof actionButtons>) =>
  bs.filter((b) => b.available).map((b) => b.key).sort();

// Huso ficticio pero válido como forma IANA: lo que se prueba es que la fecha viaje, no
// que el motor lo sepa resolver.
const FRANJA = { slot_at: '2026-09-20T15:30:00+00:00', status: 'reserved', timezone: 'UTC' };

// ── 1 · Todo disponible ──────────────────────────────────────────────────────────
describe('pieza con las seis disponibles', () => {
  it('seis botones activos, ninguno con motivo', () => {
    const bs = actionButtons(conTodo);
    expect(bs).toHaveLength(6);
    expect(activos(bs)).toEqual([...KEYS].sort());
    for (const b of bs) expect(b.reason).toBeNull();
  });
});

// ── 2 · La tarjeta que hoy no existe en ninguna pantalla ─────────────────────────
describe('pieza ya aprobada (scheduled)', () => {
  const MOTIVO = 'Ya está aprobada y con franja. Para cambiar de opinión, rechazar o descartar.';
  const bs = actionButtons({ ...conTodo, approve: NO(MOTIVO) });

  it('Aprobar sale APAGADO y mostrando su motivo — no se oculta', () => {
    const approve = bs.find((b) => b.key === 'approve')!;
    expect(approve.available).toBe(false);
    expect(approve.reason).toBe(MOTIVO);
    // Sigue estando en la lista: apagar no es ocultar. Un botón que desaparece obliga a
    // preguntarse si existe.
    expect(bs).toHaveLength(6);
  });

  it('los otros cinco siguen activos', () => {
    expect(activos(bs)).toEqual(['discard', 'edit_text', 'fixable', 'recompose_image', 'reject']);
  });
});

// ── 3 · Sin imagen ───────────────────────────────────────────────────────────────
describe('pieza sin imagen', () => {
  it('sólo Regenerar imagen se apaga, con su motivo propio', () => {
    const bs = actionButtons({
      ...conTodo,
      recompose_image: NO('Esta pieza no tiene imagen: no hay nada que recomponer.'),
    });
    expect(activos(bs)).toEqual(['approve', 'discard', 'edit_text', 'fixable', 'reject']);
    expect(bs.find((b) => b.key === 'recompose_image')!.reason).toContain('no tiene imagen');
  });
});

// ── 3 bis · Pieza sellada — U-6 §5.3 ─────────────────────────────────────────────
describe('pieza ya sellada', () => {
  it('las seis apagadas CON su motivo, ninguna oculta', () => {
    // Es el caso que más se ve en Retenidas: una pieza descartada o ya juzgada sigue
    // listada por su arbitraje pendiente. Seis botones apagados y explicados dicen qué
    // pasa; seis botones ausentes obligan a preguntarse si la pantalla se rompió.
    const SELLADA = 'Esta pieza ya está sellada: no admite más acciones.';
    const bs = actionButtons(Object.fromEntries(KEYS.map((k) => [k, NO(SELLADA)])) as PieceActions);
    expect(bs).toHaveLength(6);
    expect(activos(bs)).toEqual([]);
    for (const b of bs) expect(b.reason).toBe(SELLADA);
  });
});

// ── Fail-loud sobre un contrato incompleto ───────────────────────────────────────
describe('contrato que no declara una acción', () => {
  it('se apaga y lo dice — nunca se asume disponible', () => {
    const parcial = { ...conTodo } as Record<string, unknown>;
    delete parcial.fixable;
    const bs = actionButtons(parcial as PieceActions);
    const fixable = bs.find((b) => b.key === 'fixable')!;
    expect(fixable.available).toBe(false);
    expect(fixable.reason).toContain('no declaró');
  });

  it('sin contrato ninguno, las seis apagadas y todas con motivo', () => {
    const bs = actionButtons(null);
    expect(bs).toHaveLength(6);
    expect(activos(bs)).toEqual([]);
    for (const b of bs) expect((b.reason ?? '').length).toBeGreaterThan(0);
  });
});

// ── 4 y 5 · El compromiso, antes de romperlo ─────────────────────────────────────
describe('el aviso de franja va ANTES de la acción', () => {
  it('acción que sella + franja → el texto lleva la fecha y avisa de la liberación', () => {
    const w = slotWarning(true, FRANJA);
    expect(w).not.toBeNull();
    expect(w!.text).toContain(w!.when);
    expect(w!.text).toMatch(/vuelve al pozo|liberar/i);
  });

  it('acción que sella + SIN franja → no se promete liberar nada', () => {
    expect(slotWarning(true, null)).toBeNull();
    expect(slotWarning(true, undefined)).toBeNull();
  });

  it('acción que NO sella → no se habla de la franja aunque la haya', () => {
    // Aprobar, editar y regenerar no sacan la pieza de circulación: su franja no se toca.
    expect(slotWarning(false, FRANJA)).toBeNull();
  });

  it('huso sin sembrar → se calla, no inventa una hora', () => {
    expect(slotWarning(true, { ...FRANJA, timezone: null })).toBeNull();
  });
});

// ── 6 · Un fixable sin propuesta no se puede confirmar ───────────────────────────
describe('los textos obligatorios', () => {
  it('fixable, edición y regeneración exigen texto; rechazo y descarte no', () => {
    expect(PANEL_COPY.fix.required).toBe(true);
    expect(PANEL_COPY.edit.required).toBe(true);
    expect(PANEL_COPY.regen.required).toBe(true);
    // El criterio es OPCIONAL a propósito: obligarlo empuja a escribir relleno para avanzar,
    // y eso envenena el corpus con ruido que parece señal.
    expect(PANEL_COPY.reject.required).toBe(false);
    expect(PANEL_COPY.discard.required).toBe(false);
  });
});

// ── 7 · El fallo de liberación tiene que poder llegar a Sam ──────────────────────
describe('qué se dice después, sobre la franja', () => {
  it('ok:false → aviso de que la pieza quedó sellada y la franja NO se liberó', () => {
    const n = slotReleaseNotice({ ok: false, released: 0, slot_ids: [], error: '403 denegado' });
    expect(n!.tone).toBe('alert');
    expect(n!.text).toContain('NO SE LIBERÓ');
    expect(n!.text).toContain('403 denegado');
    // Sin esta vía, el fallo que el endpoint atrapa a propósito sería invisible.
    expect(n!.text).toMatch(/vigilancia/i);
  });

  it('una franja liberada → se dice, sin alarmar', () => {
    const n = slotReleaseNotice({ ok: true, released: 1, slot_ids: ['slot-ficticia-1'] });
    expect(n!.tone).toBe('ok');
    expect(n!.text).toMatch(/volvió al pozo/i);
  });

  it('cero franjas NO es un error: se informa y ya', () => {
    const n = slotReleaseNotice({ ok: true, released: 0, slot_ids: [] });
    expect(n!.tone).toBe('ok');
    expect(n!.text).toMatch(/no tenía franja/i);
  });

  it('sin informe del server → no se dice nada, en vez de suponer', () => {
    expect(slotReleaseNotice(null)).toBeNull();
    expect(slotReleaseNotice(undefined)).toBeNull();
  });
});

// ── 8 · El barrido que protege la regla dura ─────────────────────────────────────
const leer = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');

/**
 * EL BARRIDO VA SOBRE EL CÓDIGO, NO SOBRE LOS COMENTARIOS, y la distinción es necesaria:
 * los comentarios de este corte CITAN los textos que retira para dejar escrito por qué se
 * fueron. Barrer el archivo entero haría fallar la prueba por la explicación de su propio
 * arreglo, y el reflejo sería borrar la explicación — justo lo que no se quiere.
 *
 * Es el mismo criterio que ya usa `_publishSlots.test.ts` para los desfases horarios.
 */
const soloCodigo = (src: string) => src
  .split('\n')
  .filter((l) => {
    const t = l.trim();
    return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('{/*');
  })
  .join('\n');

const ACTIONS_SRC = leer('./pieceActions.tsx');
const PUBLISH_SRC = leer('./PublishQueueModule.tsx');
const CALIB_SRC = leer('./ApprovalCalibrationModule.tsx');
const ACTIONS_CODE = soloCodigo(ACTIONS_SRC);
const PUBLISH_CODE = soloCodigo(PUBLISH_SRC);
const CALIB_CODE = soloCodigo(CALIB_SRC);

describe('la disponibilidad vive en el contrato, nunca en el front', () => {
  const ESTADOS = /status\s*===\s*'(scheduled|published|awaiting_approval|rejected|draft|deferred|challenged)'/;

  it('ninguna pantalla de acciones se ramifica por el estado de la pieza', () => {
    // Un condicional así acertaría hoy y mentiría en cuanto el server cambiara de criterio,
    // sin que nada fallara. Lo dice `actions[k].available`.
    expect(ACTIONS_CODE).not.toMatch(ESTADOS);
    expect(PUBLISH_CODE).not.toMatch(ESTADOS);
  });

  it('el componente no mira discarded_at ni la imagen para decidir', () => {
    expect(ACTIONS_CODE).not.toMatch(/discarded_at/);
    expect(ACTIONS_CODE).not.toMatch(/assets\??\.image/);
  });

  it('el componente no sabe desde qué bandeja lo montan', () => {
    // Una prop `inbox` o `variant` devolvería la decisión al front por la puerta de atrás.
    expect(ACTIONS_CODE).not.toMatch(/\b(inbox|variant|fromPublish|isCalibration)\s*[:?]/);
  });

  it('ninguna acción se llama por su bandeja', () => {
    for (const s of ACTION_SPECS) {
      expect(s.key).not.toMatch(/publish|calibrat|challeng|queue|inbox|bandeja/i);
    }
  });

  it('ni una marca ni un canal del ecosistema en el componente', () => {
    for (const nombre of ['NeuroneSCF', 'ForumPHs', 'LucienSael', 'UnrealvilleStudio', 'meta_ig', 'meta_fb', 'tiktok'])
      expect(ACTIONS_SRC).not.toContain(nombre);
  });

  it('la fecha de franja se formatea UNA sola vez, con la función compartida', () => {
    // Dos formateos de la misma fecha son dos fechas en cuanto alguien toque uno.
    expect(ACTIONS_CODE).toContain('fmtInZone');
    expect(ACTIONS_CODE).not.toMatch(/new Intl\.DateTimeFormat/);
    expect(ACTIONS_CODE).not.toMatch(/toLocaleString|toLocaleDateString/);
  });
});

describe('los dos textos caducos se retiraron', () => {
  it('la bandeja de publicación ya no dice que no aprueba', () => {
    expect(PUBLISH_CODE).not.toContain('Esta bandeja todavía no aprueba');
    expect(PUBLISH_CODE).not.toContain('La aprobación se hace en la bandeja de calibración');
  });

  it('y ninguna pantalla afirma dónde vive una acción', () => {
    // La regla que deja escrita este corte: si un texto afirma algo sobre disponibilidad,
    // sale del contrato o no se escribe.
    expect(PUBLISH_CODE).not.toMatch(/aprobar es del carril|aprueba por diseño/i);
  });

  it('la bandeja de publicación ya no lee `approval`', () => {
    // U-5 le quitó el lector; U-6 borró el campo. Esta prueba cuida el lado del front: si
    // alguien vuelve a leerlo, leería `undefined` y pintaría un aviso permanente.
    expect(PUBLISH_CODE).not.toMatch(/data\.approval/);
  });

  it('el campo `approval` se retiró del contrato — U-6', () => {
    // Se comprueba en los DOS lados, porque un campo retirado a medias es peor que uno
    // vigente: el tipo promete algo que la respuesta ya no trae.
    const ENDPOINT = soloCodigo(readFileSync(new URL('../../../api/publish-queue.ts', import.meta.url), 'utf8'));
    const CLIENTE = soloCodigo(readFileSync(new URL('../../services/publishInbox.ts', import.meta.url), 'utf8'));
    expect(ENDPOINT).not.toMatch(/^\s*approval:/m);
    expect(CLIENTE).not.toMatch(/^\s*approval:/m);
    // Y la bandeja sigue entregando lo que sí se usa: el retiro no se llevó nada por delante.
    expect(ENDPOINT).toContain('cutoffs_source:');
    expect(ENDPOINT).toContain('slots_source:');
    expect(CLIENTE).toContain('pieces: PublishablePiece[];');
  });
});

describe('una sola implementación de las acciones', () => {
  it('calibración monta el componente compartido, no su propia copia', () => {
    expect(CALIB_CODE).toContain('PieceActionsBar');
    // Si estos volvieran a aparecer, habría dos implementaciones que divergirían.
    expect(CALIB_CODE).not.toContain('saveVerdict');
    expect(CALIB_CODE).not.toContain('discardPiece');
    expect(CALIB_CODE).not.toContain('recomposeImage');
  });

  it('publicación monta el mismo componente', () => {
    expect(PUBLISH_CODE).toContain('PieceActionsBar');
  });

  it('el módulo de calibración ADELGAZÓ: la lógica se extrajo, no se duplicó', () => {
    // Antes de U-5 tenía 641 líneas con los botones dentro. Si vuelve a crecer hasta ahí,
    // es que alguien añadió una segunda implementación en vez de usar la compartida.
    expect(CALIB_SRC.split('\n').length).toBeLessThan(500);
  });
});

// ── 9 · El acuse — corrección del 2026-09-13 ─────────────────────────────────────
/**
 * EL DEFECTO QUE ESTE BLOQUE CIERRA, medido en producción el 2026-09-13: aprobar desde
 * Publicación no decía nada. `approve` llamaba a `onResolved` directo, así que calibración
 * mostraba su tarjeta de confirmación y publicación quitaba la pieza EN SECO.
 *
 * Un acuse ausente no se distingue de una acción que no ocurrió — que es exactamente lo que
 * Sam reportó: «al hacer clic aprueba, no dice nada más». Y era la misma divergencia entre
 * pantallas que este corte vino a cerrar, dejada abierta dentro del propio corte.
 */
describe('toda acción que resuelve la pieza lo dice, y lo dice igual en las dos bandejas', () => {
  it('los cuatro desenlaces tienen acuse, y ninguno vacío', () => {
    for (const k of ['approved', 'rejected', 'fixable', 'discarded'] as const) {
      expect(OUTCOME_COPY[k].text.trim().length).toBeGreaterThan(20);
    }
  });

  it('aprobar acusa que HABILITA, y que no publica', () => {
    // La confusión que este corte no puede reintroducir: habilitar no es publicar. La franja
    // la calcula content-scheduler, no el clic.
    expect(OUTCOME_COPY.approved.text).toMatch(/habilitada/i);
    expect(OUTCOME_COPY.approved.text).toMatch(/content-scheduler/);
  });

  it('descartar acusa que NO entra al corpus — un descarte no es un rechazo', () => {
    expect(OUTCOME_COPY.discarded.text).toMatch(/no entra al corpus/i);
    expect(OUTCOME_COPY.rejected.text).toMatch(/corpus/i);
  });

  it('fixable acusa que RETA, no que descarta — y no deja pensar que la pieza se perdió', () => {
    // Hasta el 2026-09-20 este acuse decía que fixable sellaba igual que un rechazo, y era
    // verdad. Dejó de serlo: descartar una pieza no la saca sólo de la bandeja, la saca del
    // sistema. El acuse tiene que decir lo que pasa AHORA, porque es lo único que Sam ve del
    // efecto — un acuse desactualizado es peor que ninguno: afirma con confianza algo falso.
    expect(OUTCOME_COPY.fixable.text).toMatch(/retada/i);
    expect(OUTCOME_COPY.fixable.text).not.toMatch(/sella/i);
    expect(OUTCOME_COPY.fixable.text).not.toMatch(/descartada\b(?!:)/i);
  });

  it('y el botón de fixable ya no se declara sellador', () => {
    // `seals` gobierna la confirmación y lo que la interfaz promete. Un botón que dice sellar y
    // no sella es la misma divergencia entre lo que se ve y lo que pasa que este archivo combate.
    const spec = (k: PieceActionKey) => ACTION_SPECS.find((b) => b.key === k)!;
    expect(spec('fixable').seals).toBe(false);
    expect(spec('reject').seals).toBe(true);
    expect(spec('discard').seals).toBe(true);
  });

  it('`approve` pasa por el mismo acuse que los demás: ningún camino corto', () => {
    // El defecto era exactamente este atajo. Si `approve` vuelve a llamar a `onResolved`
    // directo, la prueba falla.
    expect(ACTIONS_CODE).not.toMatch(/verdict === 'approved'.{0,80}onResolved\(/s);
    expect(ACTIONS_CODE).toContain("finish(verdict === 'approved'");
  });

  it('ninguna bandeja pinta su propio acuse: uno solo, en el sitio de la acción', () => {
    // Si una bandeja vuelve a tener el suyo, las dos pueden decir cosas distintas de la
    // misma acción — que es el defecto de origen, un piso más arriba.
    expect(CALIB_CODE).not.toMatch(/guardada en el corpus/);
    expect(PUBLISH_CODE).not.toMatch(/guardada en el corpus/);
  });
});

// ── 10 · Un botón apagado tiene que VERSE apagado — corrección del 2026-09-13 ─────
/**
 * EL DEFECTO, visto en una captura de producción: `approve` era el único con relleno sólido
 * y los otros cinco eran sólo borde, así que atenuarlo con `opacity` lo dejaba siendo el
 * elemento MÁS llamativo de la fila. El tooltip decía «ya está aprobada» y el botón seguía
 * leyéndose como la acción principal disponible: el estado y su apariencia decían cosas
 * opuestas, y la apariencia gana.
 */
describe('el apagado se distingue por su forma, no por su transparencia', () => {
  it('un botón no disponible NO lleva su estilo de acción, lleva el neutro', () => {
    expect(ACTIONS_CODE).toContain('b.available ? BUTTON_STYLE[b.key] : DISABLED_STYLE');
    // El barrido se acota a DONDE SE PINTA UN BOTÓN DE ACCIÓN, que es donde vivía el
    // defecto: seis botones compitiendo entre sí. El botón de confirmar de un panel sí
    // puede atenuarse — está solo y no compite con nada, así que ahí `disabled:opacity` es
    // correcto y se deja.
    //
    // El ancla se movió en U-6: `buttons.map` desapareció al partirse la fila en dos
    // niveles, y un `indexOf` que devuelve -1 hace pasar la prueba sin medir nada. Ahora
    // apunta al pintor único, y se comprueba que existe antes de barrer.
    const i = ACTIONS_CODE.indexOf('const pintar =');
    const j = ACTIONS_CODE.indexOf('if (doneNote)', i);
    expect(i, 'no se encontró el pintor de botones: el barrido no mediría nada').toBeGreaterThan(-1);
    expect(j, 'no se encontró el final del pintor: el barrido leería el panel').toBeGreaterThan(i);
    expect(ACTIONS_CODE.slice(i, j)).not.toMatch(/disabled:opacity-\d+/);
  });

  it('el estilo neutro no tiene relleno ni sombra: nada que compita con los activos', () => {
    const i = ACTIONS_CODE.indexOf('const DISABLED_STYLE');
    const decl = ACTIONS_CODE.slice(i, ACTIONS_CODE.indexOf(';', i));
    expect(decl).toContain('bg-transparent');
    expect(decl).toContain('shadow-none');
    expect(decl).not.toMatch(/\bbg-(accent|rose|sky|emerald|violet|zinc-[1-8])/);
  });

  it('ninguna acción reclama el ancho sobrante: la principal depende de la pieza', () => {
    // `flex-1` en `approve` empujaba el sexto botón a una segunda fila y lo declaraba
    // principal siempre — y cuál es la principal lo dice el estado de la pieza, no la tabla.
    const i = ACTIONS_CODE.indexOf('const BUTTON_STYLE');
    const tabla = ACTIONS_CODE.slice(i, ACTIONS_CODE.indexOf('};', i));
    expect(tabla).not.toContain('flex-1');
  });
});

// ── 11 · Los niveles por aprendizaje — U-6 §2 bis ────────────────────────────────
/**
 * LA JERARQUÍA SE PRUEBA SOBRE EL ORDEN QUE DEVUELVE LA LÓGICA PURA, NO SOBRE CSS.
 *
 * Una prueba de estilos se rompe al cambiar un color —y entonces se «arregla» cambiando la
 * prueba—. Una de orden se rompe sólo cuando cambia la doctrina, que es exactamente cuando
 * tiene que romperse y mirarse.
 *
 * La doctrina, de Sam el 2026-09-13: el carril es CALIBRACIÓN y existe para que haya
 * aprendizaje. Pesa más lo que escribe el corpus. Un arreglo no compite con un juicio.
 */
describe('el nivel de una acción lo decide qué deja aprendizaje', () => {
  const NIVEL = (k: PieceActionKey) => ACTION_SPECS.find((s) => s.key === k)!.weight;

  it('las tres que escriben el corpus son primarias; el descarte, secundario', () => {
    expect([NIVEL('approve'), NIVEL('reject'), NIVEL('fixable')])
      .toEqual(['primary', 'primary', 'primary']);
    // Descartar SELLA, pero no entra al corpus: sella y no enseña. Por eso no es primaria.
    expect(NIVEL('discard')).toBe('secondary');
  });

  it('editar y regenerar son TERCIARIAS: corrigen el artefacto y no dejan aprendizaje', () => {
    expect(NIVEL('edit_text')).toBe('tertiary');
    expect(NIVEL('recompose_image')).toBe('tertiary');
  });

  it('las tres primarias se pintan PRIMERO Y JUNTAS, sin nada intercalado', () => {
    const orden = actionButtons(conTodo).map((b) => b.key);
    expect(orden.slice(0, 3)).toEqual(['approve', 'reject', 'fixable']);
  });

  it('ningún arreglo va antes de un juicio, en ninguna bandeja', () => {
    // Es la prueba que protege §2 bis de un reordenamiento bienintencionado: no mira dónde
    // está cada botón, mira que ningún terciario adelante a un primario.
    const bs = actionButtons(conTodo);
    const ultimoJuicio = bs.map((b) => b.weight).lastIndexOf('primary');
    const primerArreglo = bs.map((b) => b.weight).indexOf('tertiary');
    expect(primerArreglo).toBeGreaterThan(ultimoJuicio);
  });

  it('el nivel NO toca la disponibilidad: se degrada el peso, nunca el permiso', () => {
    // La forma exacta de hacerlo mal: subordinar un arreglo apagándolo. Las seis siguen
    // disponibles cuando el contrato las declara disponibles, sea cual sea su nivel.
    const bs = actionButtons(conTodo);
    for (const b of bs) expect(b.available, `${b.key} perdió disponibilidad por su nivel`).toBe(true);
  });

  it('cada acción declara su nivel: ninguna se queda sin doctrina', () => {
    // Si entra una acción nueva sin `weight`, TypeScript la caza; si entra con un nivel
    // inventado, la caza esto.
    for (const s of ACTION_SPECS)
      expect(['primary', 'secondary', 'tertiary'], `${s.key} sin nivel válido`).toContain(s.weight);
  });
});
