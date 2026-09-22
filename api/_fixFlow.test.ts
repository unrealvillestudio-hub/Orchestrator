import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fixFlowOf, BEFORE_EXCERPT_MAX, type PieceEditRow } from './_fixFlow.js';

/**
 * LO QUE UNA PIEZA CORREGIDA TIENE QUE PODER DECIR DE SÍ MISMA.
 *
 * EL ENCARGO, literal (Sam, 2026-09-21): «calibro > decido que va a fixable con mi comentario > lo
 * corregimos en chat > lo devuelves corregido a la bandeja (asegurando el aprendizaje del flujo) >
 * luego apruebo si está bien».
 *
 * «Si está bien» es una COMPARACIÓN, y una comparación necesita dos cosas delante. La propuesta
 * estaba guardada en `content_pieces.challenged_reason` desde el 2026-09-20 y no se enseñaba en
 * ninguna pantalla — el mismo defecto que la bandeja de retenidas documentó en su día: la
 * evidencia escrita que nadie ve.
 *
 * ── EL RIESGO QUE ESTE TEST CIERRA, Y ESTÁ MEDIDO ────────────────────────────────
 * Medido el 2026-09-22 en producción: **32 piezas tienen `edited_at` y CERO filas en
 * `intel.piece_edits`**. Hay caminos de corrección que no registran el diff. La tentación es
 * contar las filas que hay y llamarlas versiones; el resultado sería que una pieza corregida sin
 * rastro se presentaría como **v1**, es decir «como nació» — una afirmación falsa, escrita con la
 * misma tipografía que las verdaderas.
 *
 * Un dato ausente que se presenta como un cero medido es la peor clase de mentira de este sistema,
 * y es la que estas comprobaciones persiguen. `version:null` con su frase explícita es lo correcto.
 *
 * Las piezas y los textos de las fixturas son ficticios: si algo dependiera de una marca real,
 * este test fallaría.
 */

const RETO = '2026-09-20T10:00:00.000Z';

function edit(over: Partial<PieceEditRow> = {}): PieceEditRow {
  return {
    piece_id: 'p1',
    field: 'body',
    before_text: 'lo que decia antes',
    after_text: 'lo que dice ahora',
    edit_reason: null,
    edited_by: 'sam',
    created_at: '2026-09-20T11:00:00.000Z',
    ...over,
  };
}

describe('por qué versión va una pieza', () => {
  it('sin tocar y sin rastro es v1: nació así y no se perdió nada', () => {
    const f = fixFlowOf({ id: 'p1', challenged_at: RETO, challenged_reason: 'falta el cierre' }, []);
    expect(f.version).toBe(1);
    expect(f.traced).toBe(true);
  });

  it('un cambio registrado la lleva a v2, y la anterior se conserva', () => {
    const f = fixFlowOf(
      { id: 'p1', challenged_at: RETO, edited_at: '2026-09-20T11:00:00.000Z' },
      [edit()],
    );
    expect(f.version).toBe(2);
    expect(f.traced).toBe(true);
    // «Se conserva la anterior» no es una promesa: es el texto, y viaja.
    expect(f.changes[0].before_excerpt).toBe('lo que decia antes');
  });

  it('dos cambios la llevan a v3', () => {
    const f = fixFlowOf(
      { id: 'p1', challenged_at: RETO, edited_at: '2026-09-20T12:00:00.000Z' },
      [edit(), edit({ field: 'title', created_at: '2026-09-20T12:00:00.000Z' })],
    );
    expect(f.version).toBe(3);
  });

  it('EDITADA Y SIN RASTRO NO ES v1: no se sabe, y eso se dice', () => {
    // El caso de las 32 piezas medidas el 2026-09-22. Un `1` acá afirmaría «está como nació».
    const f = fixFlowOf(
      { id: 'p1', challenged_at: RETO, edited_at: '2026-09-20T11:00:00.000Z' },
      [],
    );
    expect(f.version).toBeNull();
    expect(f.traced).toBe(false);
  });

  it('con rastro pero sin `edited_at`, el rastro manda: hubo cambios y se sabe cuáles', () => {
    // Medido el 2026-09-22: 7 piezas están así. La ausencia de `edited_at` no borra las filas.
    const f = fixFlowOf({ id: 'p1', challenged_at: RETO, edited_at: null }, [edit()]);
    expect(f.version).toBe(2);
    expect(f.traced).toBe(true);
  });
});

describe('qué cambios cuenta como parte de ESTE arreglo', () => {
  it('sólo los posteriores al reto: lo de antes es historia de la pieza, no mérito del arreglo', () => {
    const f = fixFlowOf(
      { id: 'p1', challenged_at: RETO, edited_at: '2026-09-20T11:00:00.000Z' },
      [
        edit({ created_at: '2026-09-19T08:00:00.000Z', field: 'title' }), // ANTES del reto
        edit({ created_at: '2026-09-20T11:00:00.000Z', field: 'body' }),  // después
      ],
    );
    expect(f.changes.map((c) => c.field)).toEqual(['body']);
    // Pero la VERSIÓN cuenta las dos: la pieza lleva dos cambios encima, vengan de donde vengan.
    // Contar sólo los del arreglo haría que una pieza editada dos veces dijera v2 dos veces.
    expect(f.version).toBe(3);
  });

  it('un cambio exactamente en el instante del reto cuenta como posterior', () => {
    const f = fixFlowOf({ id: 'p1', challenged_at: RETO }, [edit({ created_at: RETO })]);
    expect(f.changes).toHaveLength(1);
  });

  it('sin fecha de reto NINGÚN cambio se atribuye al arreglo', () => {
    // Ante la duda, no se atribuye. Al revés, la tarjeta le colgaría al arreglo cambios que
    // nadie hizo por él — y Sam aprobaría creyendo que su propuesta se atendió.
    const f = fixFlowOf({ id: 'p1', challenged_at: null }, [edit()]);
    expect(f.changes).toHaveLength(0);
    expect(f.version).toBe(2);
  });

  it('los cambios llegan del más reciente al más antiguo, venga como venga la lectura', () => {
    const f = fixFlowOf(
      { id: 'p1', challenged_at: RETO },
      [
        edit({ created_at: '2026-09-20T11:00:00.000Z', field: 'body' }),
        edit({ created_at: '2026-09-21T09:00:00.000Z', field: 'title' }),
      ],
    );
    expect(f.changes.map((c) => c.field)).toEqual(['title', 'body']);
  });
});

describe('la propuesta viaja entera y el texto anterior recortado', () => {
  it('la propuesta de Sam no se recorta: es el criterio contra el que se aprueba', () => {
    const larga = 'x'.repeat(BEFORE_EXCERPT_MAX * 2);
    const f = fixFlowOf({ id: 'p1', challenged_at: RETO, challenged_reason: larga }, []);
    expect(f.challenge_reason).toBe(larga);
  });

  it('el texto anterior sí se recorta: la tarjeta reconoce, no relee', () => {
    const f = fixFlowOf(
      { id: 'p1', challenged_at: RETO },
      [edit({ before_text: 'y'.repeat(BEFORE_EXCERPT_MAX + 50) })],
    );
    const ex = f.changes[0].before_excerpt!;
    expect(ex.length).toBe(BEFORE_EXCERPT_MAX + 1); // + el carácter de elisión
    expect(ex.endsWith('…')).toBe(true);
  });

  it('un campo que nació vacío da `null`, no una cadena vacía que parezca un texto', () => {
    const f = fixFlowOf({ id: 'p1', challenged_at: RETO }, [edit({ before_text: '   ' })]);
    expect(f.changes[0].before_excerpt).toBeNull();
  });
});

describe('nada de esto sabe de marcas', () => {
  it('el módulo no nombra ninguna marca ni ningún campo editable concreto', () => {
    const src = readFileSync(new URL('./_fixFlow.ts', import.meta.url), 'utf8')
      .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
      .toLowerCase();
    for (const marca of ['unrealvillestudio', 'neuronescf', 'forumphs', 'luciensael',
                         'nscf_', 'fphs_', 'uvs-']) {
      expect(src, `el módulo nombra «${marca}» fuera de un comentario`).not.toContain(marca);
    }
    // Y tampoco una lista cerrada de campos: `field` llega como DATO. Medido el 2026-09-22, la
    // tabla ya trae diez valores distintos, entre ellos rutas dentro de `assets`; una lista escrita
    // acá los escondería en silencio.
    expect(src).not.toMatch(/\[\s*'title'\s*,\s*'body'\s*\]/);
  });

  it('un campo que nadie previó viaja igual', () => {
    const f = fixFlowOf({ id: 'p1', challenged_at: RETO },
      [edit({ field: 'assets.un.campo.que.nadie.previo' })]);
    expect(f.changes[0].field).toBe('assets.un.campo.que.nadie.previo');
  });
});
