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
    expect(pendingStateOf('awaiting_approval', false, false)).toBe<PendingState>('esperando');
  });

  it('una pieza YA JUZGADA que sigue viva es para recalibrar, no para esconder', () => {
    // Es el caso de las dos piezas del 2026-09-15: veredicto en el corpus, corregidas y devueltas.
    // OJO: `retada:false`. Una pieza juzgada que vuelve SIN haber pasado por un reto sigue siendo
    // `recalibrar`; el eje no se comió al anterior, lo estrechó.
    expect(pendingStateOf('awaiting_approval', true, false)).toBe<PendingState>('recalibrar');
  });

  it('una aplazada es pendiente: nadie la devuelve sola', () => {
    expect(pendingStateOf('deferred', false, false)).toBe<PendingState>('aplazada');
    // Que además tenga fila en el corpus no la saca de aplazada: el estado manda sobre la historia.
    expect(pendingStateOf('deferred', true, false)).toBe<PendingState>('aplazada');
    // Ni siquiera un reto en su historia: el aplazamiento es lo que la tiene apartada AHORA.
    expect(pendingStateOf('deferred', true, true)).toBe<PendingState>('aplazada');
  });

  it('una retenida por desacuerdo es pendiente', () => {
    expect(pendingStateOf('challenged', false, false)).toBe<PendingState>('retenida');
  });

  it('un estado desconocido cae en esperando, nunca en un silencio', () => {
    // Un estado nuevo en el CHECK no puede hacer desaparecer una pieza. El caso menos sorprendente
    // —y el único que no esconde— es tratarla como pendiente de veredicto.
    expect(pendingStateOf('un_estado_que_no_existe', false, false)).toBe<PendingState>('esperando');
    expect(pendingStateOf(null, false, false)).toBe<PendingState>('esperando');
    expect(pendingStateOf(undefined, false, false)).toBe<PendingState>('esperando');
  });

  it('no distingue por mayúsculas ni por espacios', () => {
    expect(pendingStateOf('  DEFERRED ', false, false)).toBe<PendingState>('aplazada');
  });
});

// ── EL CIRCUITO DE ARREGLOS · LO-CORREGIDO-01 ───────────────────────────────────────────────
//
// LO QUE ESTE BLOQUE PROTEGE, y está medido. El 2026-09-22 la bandeja tenía 14 piezas marcadas
// como `recalibrar` y **13 de ellas eran piezas retadas que habían vuelto del arreglo**. El eje
// decía «ya se juzgó una vez» y, en la práctica, estaba nombrando el final del circuito de
// arreglos — con la diferencia de que en ese final lo que Sam tiene que hacer es comparar la pieza
// contra SU PROPIA PROPUESTA, que ningún otro caso requiere.
//
// El orden de las dos preguntas es lo que hay que vigilar: si se preguntara primero por el corpus,
// TODA pieza retada caería en `recalibrar`, porque un fixable ES un veredicto y siempre deja fila.
// El eje nacería muerto y nadie lo notaría — la bandeja seguiría pintando algo.
describe('una pieza que volvió del arreglo no se lee como una recalibración cualquiera', () => {
  it('viva, con un reto en su historia = corregida', () => {
    expect(pendingStateOf('awaiting_approval', true, true)).toBe<PendingState>('corregida');
  });

  it('el reto gana al corpus, y ése es el orden que importa', () => {
    // Un fixable SIEMPRE deja fila en `approval_calibration`, así que estas dos banderas llegan
    // juntas en todas las piezas del circuito. Si `recalibrar` se resolviera primero, `corregida`
    // no se emitiría jamás y este test es lo único capaz de decirlo.
    expect(pendingStateOf('awaiting_approval', true, true)).not.toBe<PendingState>('recalibrar');
  });

  it('todavía retenida en la base = sigue por arreglar, aunque lleve la marca del reto', () => {
    // `challenged` se resuelve antes: la pieza no ha vuelto, está EN el arreglo.
    expect(pendingStateOf('challenged', true, true)).toBe<PendingState>('por_arreglar');
  });

  it('sin fila en el corpus pero con marca de reto: se corrigió igual y volvió', () => {
    // No debería ocurrir —el fixable escribe el corpus— pero si ocurre, la pieza volvió y lo que
    // toca con ella es mirarla contra la propuesta. Caer en `esperando` la mandaría a la cola de
    // las que nunca se han visto.
    expect(pendingStateOf('awaiting_approval', false, true)).toBe<PendingState>('corregida');
  });
});

describe('los estados que la bandeja lista', () => {
  it('incluye los tres en los que una pieza está viva y pendiente', () => {
    expect([...CALIBRATION_STATUSES].sort())
      .toEqual(['awaiting_approval', 'challenged', 'deferred']);
  });

  it('cada estado listado tiene su lugar en el eje, y ninguno cae en el genérico por accidente', () => {
    // `awaiting_approval` es el único que depende del corpus; los otros dos se nombran solos.
    expect(pendingStateOf('deferred', false, false)).not.toBe('esperando');
    expect(pendingStateOf('challenged', false, false)).not.toBe('esperando');
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

  // ── LO-CORREGIDO-01 · LA PESTAÑA NO PUEDE MENTIR SOBRE EL RESTO DE LA BANDEJA ──────────────
  //
  // Son dos propiedades y las dos ya se rompieron una vez en este archivo, con `by_brand`: contar
  // sobre el conjunto YA filtrado hace que entrar en una vista ponga a cero todo lo demás, y
  // entonces el contador afirma que la bandeja se vació. Es la misma trampa, en otra dimensión.

  it('`by_state` se cuenta sobre TODO lo pendiente, no sobre lo filtrado', () => {
    // Si se contara sobre `scoped`, abrir la pestaña de arreglos diría «0 esperando» — y esa es
    // una afirmación sobre las otras noventa piezas que nadie midió.
    expect(QUEUE).toMatch(/for\s*\(const p of perPiece\)\s*by_state\[/);
    expect(QUEUE).not.toMatch(/for\s*\(const p of scoped\)\s*by_state\[/);
  });

  it('los SEIS ejes se siembran a cero: un eje sin piezas dice cero, no desaparece', () => {
    expect(QUEUE).toMatch(/PENDING_STATES\.map\(\(\w+\)\s*=>\s*\[\w+,\s*0\]\)/);
  });

  it('el eje se resuelve ANTES de filtrar, o el filtro trabajaría sobre lo que no existe', () => {
    // `stateById` se llena sobre `perPiece`; el filtro lo consulta después. Si el eje volviera a
    // calcularse dentro del `.map()` final —como hasta el 2026-09-22, cuando sólo pintaba un
    // color— filtrar por él sería imposible y contar, un recuento de veinte tarjetas.
    const iEje = QUEUE.indexOf('stateById.set');
    const iFiltro = QUEUE.indexOf('states.includes');
    expect(iEje, 'no se encontró el mapa de ejes').toBeGreaterThan(-1);
    expect(iFiltro, 'no se encontró el filtro por eje').toBeGreaterThan(-1);
    expect(iEje).toBeLessThan(iFiltro);
  });

  it('el filtro por eje va ANTES de `by_brand`, como los otros transversales', () => {
    // Las pastillas de marca tienen que contar lo que ESTA pestaña daría. Filtrar después las
    // dejaría contando la bandeja entera bajo el título de una pestaña.
    expect(QUEUE.indexOf('states.includes')).toBeLessThan(QUEUE.indexOf('by_brand[p.brand_id] = 0'));
  });

  it('un eje desconocido no vacía la bandeja: se ignora y se declara lo aplicado', () => {
    // `parseStates` filtra contra `PENDING_STATES` y devuelve `[]` si no queda ninguno — que es
    // `all`. Devolver una lista vacía de piezas haría que un parámetro mal escrito se leyera como
    // «no hay nada», la mentira más cara de esta bandeja.
    expect(QUEUE).toMatch(/PENDING_STATES as readonly string\[\]\)\.includes/);
    expect(QUEUE).toMatch(/if\s*\(states\.length\)\s*scoped\s*=/);
  });

  it('el rastro de ediciones se lee SÓLO de la página visible', () => {
    // El `in.()` de PostgREST crece con la lista, y el historial de ciento y pico piezas no cabe
    // en una tarjeta. Mismo criterio que las trazas y los intentos, que ya se leen así.
    expect(QUEUE).toMatch(/fetchPieceEdits\(page\.map/);
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

  it('LOS SEIS COLORES SON DISTINTOS: dos ejes del mismo color vuelven a ser un solo eje', () => {
    // El caso anterior vigilaba una pareja concreta. Esto vigila la PROPIEDAD, que es la que de
    // verdad importa: distinguir cinco situaciones con cuatro colores es haber escondido una.
    const fila = (eje: string) => UI.match(new RegExp(`${eje}\\s*:\\s*\\{[^}]*color:\\s*'(#[0-9A-Fa-f]{3,8})'`))?.[1];
    const colores = ejesServer.map((e) => {
      const c = fila(e);
      expect(c, `'${e}' no tiene color en PENDING_STATE_UI`).toBeTruthy();
      return c!.toLowerCase();
    });
    expect(new Set(colores).size, `hay ejes que comparten color: ${colores.join(', ')}`)
      .toBe(ejesServer.length);
  });
});
