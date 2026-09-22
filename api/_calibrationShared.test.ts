import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { actionsFor, ACTION_KEYS, type PieceActions } from './_calibrationShared.js';

/**
 * U-4 — QUÉ SE PUEDE HACER CON UNA PIEZA.
 *
 * `actionsFor` es pura: se prueba entera sin doblar nada y sin red.
 *
 * Lo que estas pruebas fijan no es qué botón se pinta —eso es de la pantalla y llega en
 * U-5—, sino que la respuesta salga del ESTADO DE LA PIEZA. Hasta U-4 salía de la bandeja
 * donde se la abriera, que no era una regla sino el orden en que se construyeron.
 *
 * Los identificadores de las fixtures son ficticios a propósito: si algo dependiera del
 * nombre de una marca o de un canal reales, estas pruebas fallarían.
 */

// ── Fixtures ─────────────────────────────────────────────────────────────────────
const CON_IMAGEN = { image: { url: 'https://ejemplo.invalid/imagen-ficticia.png' } };

const disponibles = (a: PieceActions) =>
  ACTION_KEYS.filter((k) => a[k].available).sort();

// ── Una pieza viva ofrece todo ───────────────────────────────────────────────────
describe('pieza en la bandeja, sin sellar', () => {
  it('con imagen → las seis disponibles, y ninguna lleva motivo', () => {
    const a = actionsFor({ status: 'awaiting_approval', assets: CON_IMAGEN });
    expect(disponibles(a)).toEqual([...ACTION_KEYS].sort());
    for (const k of ACTION_KEYS) expect(a[k].reason).toBeNull();
  });
});

// ── Aprobada: el caso que hace posible U-5 ───────────────────────────────────────
describe('pieza ya aprobada (scheduled)', () => {
  const a = actionsFor({ status: 'scheduled', assets: CON_IMAGEN });

  it('aprobar NO está disponible, y dice por qué', () => {
    expect(a.approve.available).toBe(false);
    expect(a.approve.reason).toBeTruthy();
  });

  it('las otras cinco SÍ: sacarla de circulación vale en cualquier estado vivo', () => {
    // Es la novedad que U-3 dejó lista: al sellarla, su franja se libera sola.
    expect(disponibles(a)).toEqual(
      ['discard', 'edit_text', 'fixable', 'recompose_image', 'reject'],
    );
  });
});

// ── Sellada ──────────────────────────────────────────────────────────────────────
describe('pieza sellada (discarded_at)', () => {
  it('las seis cerradas, todas con el mismo motivo: un veredicto no se pisa', () => {
    const a = actionsFor({
      status: 'rejected', discarded_at: '2026-09-13T10:00:00Z', assets: CON_IMAGEN,
    });
    expect(disponibles(a)).toEqual([]);
    const motivos = new Set(ACTION_KEYS.map((k) => a[k].reason));
    expect(motivos.size).toBe(1);
    expect([...motivos][0]).toContain('discarded_at');
  });
});

// ── El orden de las puertas ──────────────────────────────────────────────────────
describe('publicada Y sellada — un estado incoherente que el carril puede producir', () => {
  it('gana el motivo de PUBLICADA, no el de descartada', () => {
    // Si el orden se invirtiera, esta prueba falla. Lo que hay que leer es que ya salió.
    const a = actionsFor({
      status: 'published', discarded_at: '2026-09-13T10:00:00Z', assets: CON_IMAGEN,
    });
    expect(disponibles(a)).toEqual([]);
    expect(a.approve.reason).toContain('ya salió');
    expect(a.approve.reason).not.toContain('discarded_at');
  });
});

// ── La imagen · SIN-IMAGEN-01 ────────────────────────────────────────────────────
//
// LO QUE ESTE BLOQUE INVIERTE, Y POR QUÉ. Hasta el 2026-09-22 estas mismas comprobaciones exigían
// lo contrario: que `recompose_image` se CERRARA en una pieza sin imagen, «porque no hay nada que
// recomponer». La frase era cierta sobre el nombre de la acción y falsa sobre lo que la acción
// hace, y el precio lo pagaba exactamente quien más la necesitaba — la única pieza que no podía
// conseguir una imagen era la que no tenía ninguna.
//
// LA MEDICIÓN QUE LO DECIDIÓ (2026-09-22):
//   · `api/recompose-image.ts` manda SIEMPRE `regenerate_image: true`, escrito fijo en el cuerpo.
//   · En esa rama el motor no lee la imagen anterior: arma la escena desde el título y la cabeza
//     del copy más la directriz del dominio (`content-run-stage/index.ts:6848`). La lectura de
//     `prevImage.clean_url` está en la rama contraria, que este repositorio nunca usa.
//   · 7 piezas vivas no tenían imagen, las 7 porque ImageLab devolvió 429 («Resource exhausted»).
//     Ninguna era un caso raro: eran piezas normales a las que se les cayó un lab.
//
// La precondición REAL —que la plataforma lleve imagen— vive en el motor y la hace cumplir él,
// fail-loud y antes de gastar una generación. Ver el docstring de `actionsFor`.
describe('pieza sin imagen · puede pedir una', () => {
  it('sin assets, las SEIS acciones siguen disponibles', () => {
    const a = actionsFor({ status: 'awaiting_approval', assets: null });
    expect(disponibles(a)).toEqual(
      ['approve', 'discard', 'edit_text', 'fixable', 'recompose_image', 'reject'],
    );
    expect(a.recompose_image.reason).toBeNull();
  });

  it('una url vacía tampoco la cierra: generar no necesita una imagen previa', () => {
    const a = actionsFor({ status: 'awaiting_approval', assets: { image: { url: '' } } });
    expect(a.recompose_image.available).toBe(true);
  });

  it('las puertas de sellado SIGUEN cerrándola: generar sobre lo ya sellado no tiene destino', () => {
    // Esto es lo que NO cambia, y es la mitad que importa: la acción se abrió por la razón
    // correcta (la operación no necesita imagen previa), no porque se hayan aflojado las puertas.
    expect(actionsFor({ status: 'published', assets: null }).recompose_image.available).toBe(false);
    expect(actionsFor({ status: 'awaiting_approval', discarded_at: '2026-09-13T10:00:00Z', assets: null })
      .recompose_image.available).toBe(false);
  });

  it('el motor sigue siendo quien decide si la plataforma lleva imagen', () => {
    // Una copia de `CANAL_BY_PLATFORM` acá se quedaría vieja, y al quedarse vieja fallaría EN LA
    // MISMA DIRECCIÓN que el defecto que este corte arregla: negándole la imagen a una plataforma
    // nueva que sí la lleva. Este test fija que no hay ninguna lista de plataformas en el módulo.
    const src = readFileSync(new URL('./_calibrationShared.ts', import.meta.url), 'utf8')
      .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const bloque = src.slice(src.indexOf('export function actionsFor'),
                             src.indexOf('export interface PieceContext'));
    for (const plataforma of ['email', 'meta_ig', 'meta_fb', 'tiktok', 'linkedin', 'blog',
                              'CANAL_NONE', 'INSTAGRAM_FEED']) {
      expect(bloque, `actionsFor nombra la plataforma «${plataforma}»`).not.toContain(plataforma);
    }
  });
});

// ── El invariante que impide olvidar un motivo ───────────────────────────────────
describe('invariante estructural — vale para CUALQUIER entrada', () => {
  const ENTRADAS = [
    { status: 'awaiting_approval', assets: CON_IMAGEN },
    { status: 'scheduled', assets: CON_IMAGEN },
    { status: 'published' },
    { status: 'rejected', discarded_at: '2026-09-13T10:00:00Z' },
    { status: null, discarded_at: null, assets: null },
    { status: 'un-estado-que-todavia-no-existe' },
    {},
  ];

  it('las claves son EXACTAMENTE las seis, ni una más ni una menos', () => {
    for (const e of ENTRADAS) {
      expect(Object.keys(actionsFor(e)).sort()).toEqual([...ACTION_KEYS].sort());
    }
  });

  it('toda acción cerrada tiene motivo, y no vacío', () => {
    // Este caso es el que impide que alguien añada una acción y se olvide del motivo:
    // un botón apagado sin explicación obliga a adivinar.
    for (const e of ENTRADAS) {
      const a = actionsFor(e);
      for (const k of ACTION_KEYS) {
        if (a[k].available) expect(a[k].reason).toBeNull();
        else expect((a[k].reason ?? '').trim().length).toBeGreaterThan(0);
      }
    }
  });
});

// ── Lo que no puede estar escrito en esta función ────────────────────────────────
const SRC = readFileSync(new URL('./_calibrationShared.ts', import.meta.url), 'utf8');
const ACTIONS_FOR = SRC.slice(
  SRC.indexOf('// ── ACCIONES POR PIEZA · U-4'),
  SRC.indexOf('/** Contexto plano de una pieza'),
);

describe('ni una marca ni una bandeja en el eje de acciones', () => {
  it('el bloque existe y se pudo aislar', () => {
    expect(ACTIONS_FOR.length).toBeGreaterThan(500);
  });

  it('no aparece ninguna marca del ecosistema', () => {
    for (const nombre of ['NeuroneSCF', 'ForumPHs', 'LucienSael', 'UnrealvilleStudio'])
      expect(ACTIONS_FOR).not.toContain(nombre);
  });

  it('ninguna acción se llama por su bandeja', () => {
    // `publish_approve` o `calibration_reject` serían la versión «caso» de este eje: la
    // acción volvería a depender de la pantalla, que es justo lo que U-4 cierra.
    for (const clave of ACTION_KEYS) {
      expect(clave).not.toMatch(/publish|calibrat|challeng|queue|inbox|bandeja/i);
    }
  });

  it('no se ramifica por marca ni por canal', () => {
    expect(ACTIONS_FOR).not.toMatch(/brand_id|platform_key|\bdomain\b/);
  });
});
