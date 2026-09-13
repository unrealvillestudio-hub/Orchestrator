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
    // El campo sigue en el contrato, marcado `deprecated`, pero sin lector: su borrado es U-6.
    expect(PUBLISH_CODE).not.toMatch(/data\.approval/);
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

  it('fixable acusa que SELLA igual que un rechazo', () => {
    expect(OUTCOME_COPY.fixable.text).toMatch(/sella/i);
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
