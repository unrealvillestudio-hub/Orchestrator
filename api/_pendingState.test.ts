import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { pendingStateOf, CALIBRATION_STATUSES, type PendingState } from './_calibrationShared.js';

/**
 * TODO LO QUE ESTÁ PENDIENTE APARECE EN LA BANDEJA, Y SE DISTINGUE.
 *
 * REGLA DE SAM (2026-09-18): «Lo importante es que no desaparezcan de la bandeja porque pierdo el
 * rastro y no sé lo que está pendiente y lo que no. TODO lo que está pendiente debe aparecer en la
 * bandeja.»
 *
 * EL DEFECTO QUE CIERRA, MEDIDO. Dos piezas —`5aeb27e3` y `7a7a8a58`— se calibraron como `fixable`
 * el 2026-09-15, se corrigieron y se devolvieron a la bandeja 22 minutos después. Siguen vivas,
 * corregidas y esperando aprobación, y llevaban tres días invisibles: la bandeja excluía toda pieza
 * con fila en `intel.approval_calibration`, sin mirar si seguía pendiente. Y el 2026-09-18 se les
 * sumó la primera pieza de blog de UnrealvilleStudio, que nació `deferred` y nació invisible.
 *
 * POR QUÉ ES UN TEST Y NO UNA NOTA. Porque esconder es la forma más barata de resolver «esto se
 * mezcla», y ya se eligió una vez (SIGN-01 corte D). La próxima vez que alguien quiera estrechar
 * esta lista, este test le pone delante lo que costó.
 *
 * Los identificadores de las fixtures son ficticios: si algo dependiera del nombre de una marca
 * real, este test fallaría.
 */

describe('el eje de pendiente', () => {
  it('una pieza sin juzgar espera su primer veredicto', () => {
    expect(pendingStateOf('awaiting_approval', false)).toBe<PendingState>('esperando');
  });

  it('una pieza YA JUZGADA que sigue viva es para recalibrar, no para esconder', () => {
    // Es el caso de las dos piezas del 2026-09-15: veredicto en el corpus, corregidas y devueltas.
    expect(pendingStateOf('awaiting_approval', true)).toBe<PendingState>('recalibrar');
  });

  it('una aplazada es pendiente: nadie la devuelve sola', () => {
    expect(pendingStateOf('deferred', false)).toBe<PendingState>('aplazada');
    // Que además tenga fila en el corpus no la saca de aplazada: el estado manda sobre la historia.
    expect(pendingStateOf('deferred', true)).toBe<PendingState>('aplazada');
  });

  it('una retenida por desacuerdo es pendiente', () => {
    expect(pendingStateOf('challenged', false)).toBe<PendingState>('retenida');
  });

  it('un estado desconocido cae en esperando, nunca en un silencio', () => {
    // Un estado nuevo en el CHECK no puede hacer desaparecer una pieza. El caso menos sorprendente
    // —y el único que no esconde— es tratarla como pendiente de veredicto.
    expect(pendingStateOf('un_estado_que_no_existe', false)).toBe<PendingState>('esperando');
    expect(pendingStateOf(null, false)).toBe<PendingState>('esperando');
    expect(pendingStateOf(undefined, false)).toBe<PendingState>('esperando');
  });

  it('no distingue por mayúsculas ni por espacios', () => {
    expect(pendingStateOf('  DEFERRED ', false)).toBe<PendingState>('aplazada');
  });
});

describe('los estados que la bandeja lista', () => {
  it('incluye los tres en los que una pieza está viva y pendiente', () => {
    expect([...CALIBRATION_STATUSES].sort())
      .toEqual(['awaiting_approval', 'challenged', 'deferred']);
  });

  it('cada estado listado tiene su lugar en el eje, y ninguno cae en el genérico por accidente', () => {
    // `awaiting_approval` es el único que depende del corpus; los otros dos se nombran solos.
    expect(pendingStateOf('deferred', false)).not.toBe('esperando');
    expect(pendingStateOf('challenged', false)).not.toBe('esperando');
  });
});

describe('la consulta de la bandeja no vuelve a excluir por corpus', () => {
  // Se lee el archivo, sin comentarios: la cabecera EXPLICA el filtro que se retiró y lo cita, así
  // que un barrido que lea comentarios se dispara sobre su propia explicación.
  const sinComentarios = (s: string) =>
    s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const QUEUE = sinComentarios(readFileSync(new URL('./calibration-queue.ts', import.meta.url), 'utf8'));

  it('no filtra las piezas por su presencia en el corpus', () => {
    expect(QUEUE).not.toMatch(/filter\s*\(\s*\(?\s*p\s*\)?\s*=>\s*!\s*evaluated\.ids\.has/);
  });

  it('el corpus se usa para ANOTAR el estado, no para quitar la pieza', () => {
    expect(QUEUE).toMatch(/pendingStateOf\s*\(/);
  });

  it('las marcas salen del conjunto SIN filtrar, para que ninguna desaparezca', () => {
    // `by_brand` se siembra a 0 sobre `perPiece` (sin filtrar) y luego se cuenta sobre `scoped`.
    // Sin la siembra, una marca cuyas piezas caen todas por un filtro se esfuma de la interfaz.
    expect(QUEUE).toMatch(/for\s*\(const p of perPiece\)\s*by_brand\[p\.brand_id\]\s*=\s*0/);
  });
});

// ── EL EJE SE DECLARA EN DOS SITIOS, Y AQUÍ SE COMPRUEBA QUE DIGAN LO MISMO ──────────────────
//
// `PendingState` vive dos veces: en el server (`_calibrationShared.ts`, que lo EMITE) y en el
// cliente (`src/services/calibrationInbox.ts`, que lo transporta para que la tarjeta lo pinte).
// Son dos listas, no una importación: el cliente no puede importar de `api/`.
//
// ESTO NO ES TEÓRICO. Al añadir `por_arreglar` el 2026-09-20, el server lo emitía y el cliente no
// lo conocía — y `tsc -b` pasó en verde, porque `PENDING_STATE_UI` está tipado contra el tipo DEL
// CLIENTE: la tabla estaba completa respecto de una lista que ya no era la buena. El compilador no
// puede ver la divergencia; sólo puede verla algo que lea los dos archivos.
//
// El síntoma habría sido una tarjeta con `PENDING_STATE_UI[state]` en `undefined` y un fallo al
// leerle `.color` — en producción, sobre la pieza recién marcada como fixable.
describe('los dos `PendingState` —server y cliente— declaran exactamente los mismos ejes', () => {
  const literales = (fuente: string, decl: string): string[] => {
    const m = fuente.match(new RegExp(`export type ${decl} =([^;]*);`));
    expect(m, `no se encontró la declaración de ${decl}`).not.toBeNull();
    return [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
  };

  const SERVER = readFileSync(new URL('./_calibrationShared.ts', import.meta.url), 'utf8');
  const CLIENTE = readFileSync(new URL('../src/services/calibrationInbox.ts', import.meta.url), 'utf8');
  const UI = readFileSync(new URL('../src/modules/iid/pieceUi.tsx', import.meta.url), 'utf8');

  const ejesServer = literales(SERVER, 'PendingState');

  it('el cliente conoce todos los ejes que el server emite, y ninguno de más', () => {
    expect(literales(CLIENTE, 'PendingState')).toEqual(ejesServer);
  });

  it('la tabla de color cubre todos los ejes: una tarjeta sin color revienta al pintarse', () => {
    const tabla = UI.slice(UI.indexOf('PENDING_STATE_UI'), UI.indexOf('PendingStateBadge'));
    for (const eje of ejesServer) {
      expect(tabla, `PENDING_STATE_UI no tiene fila para '${eje}'`).toMatch(new RegExp(`\\b${eje}\\s*:`));
    }
  });

  it('los dos `challenged` tienen color distinto: arbitrar no es arreglar', () => {
    const fila = (eje: string) => UI.match(new RegExp(`${eje}\\s*:\\s*\\{[^}]*color:\\s*'(#[0-9A-Fa-f]{3,8})'`))?.[1];
    expect(fila('retenida')).toBeTruthy();
    expect(fila('por_arreglar')).toBeTruthy();
    expect(fila('por_arreglar')).not.toBe(fila('retenida'));
  });
});
