import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * NADA QUEDA DEBAJO DE LA BARRA DEL TELEFONO.
 *
 * EL CASO, reportado por Sam el 2026-09-22 con una captura marcada en rojo: los botones «Anterior»
 * y «Siguiente» de la bandeja quedaban tapados por la barra de navegacion del telefono. No estaban
 * mal puestos — estaban debajo, y por DOS cosas que se sumaban:
 *
 *   1 · el pie fijo de la aplicacion flota por encima del contenido y el contenido no reservaba ni
 *       un pixel para el. El ultimo elemento de CUALQUIER pantalla quedaba debajo del pie, en
 *       cualquier dispositivo — el telefono solo lo hacia evidente.
 *   2 · el telefono se queda ademas su propia franja, que el navegador expone como
 *       `env(safe-area-inset-bottom)`.
 *
 * POR QUE ES UN TEST Y NO UN ARREGLO A SECAS. Porque este defecto **no avisa**. Un elemento tapado
 * se ve como una pantalla que sencillamente no tiene paginacion, y en el escritorio donde se
 * desarrolla no ocurre. Sin algo que lo vigile, la proxima barra fija que alguien añada nacera con
 * el mismo problema y tampoco lo dira.
 *
 * LO QUE ESTE TEST NO PUEDE HACER: medir pixeles. Lee las FUENTES y fija las tres propiedades
 * estructurales de las que el resultado depende — el mismo criterio que
 * `vigilante_resumen_de_corridas_test` aplica en el otro repositorio: una medicion solo vale en la
 * via que la ejecuta, asi que aca se protege lo que si se puede comprobar leyendo.
 */

/**
 * El CSS se lee SIN COMENTARIOS, y no es una precaucion teorica: la cabecera de `index.css`
 * EXPLICA el defecto citando `env(safe-area-inset-bottom)` sin respaldo, asi que un barrido que
 * leyera comentarios se dispararia sobre su propia documentacion. Es el mismo tropiezo que
 * `vigilante_resumen_de_corridas_test` dejo escrito en el otro repositorio — y aca ocurrio de
 * verdad, la primera vez que este test corrio.
 */
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

const CSS  = sinComentarios(readFileSync(new URL('./index.css', import.meta.url), 'utf8'));
const APP  = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('el hueco inferior existe y se calcula en un solo sitio', () => {
  it('`--hueco-inferior` suma el pie fijo y la zona segura del dispositivo', () => {
    expect(CSS).toMatch(/--hueco-inferior:\s*calc\(\s*var\(--pie-fijo\)\s*\+\s*env\(safe-area-inset-bottom/);
  });

  it('`env()` lleva respaldo explicito, o la declaracion entera cae en silencio', () => {
    // Sin el segundo argumento, un navegador que no conozca `safe-area-inset-bottom` invalida la
    // expresion COMPLETA y `padding-bottom` no se aplica. Es el peor desenlace posible: la pantalla
    // se veria perfecta justo donde se prueba, y rota donde se usa.
    const usos = CSS.match(/env\(safe-area-inset-bottom[^)]*\)/g) ?? [];
    expect(usos.length, 'no se usa la zona segura en ningun sitio').toBeGreaterThan(0);
    for (const u of usos) {
      expect(u, `«${u}» no declara respaldo`).toMatch(/env\(safe-area-inset-bottom\s*,\s*0px\s*\)/);
    }
  });

  it('el numero del pie se escribe UNA vez: dos copias se separan en el primer cambio', () => {
    // `--pie-fijo` es la unica fuente. Si alguien escribiera `1.75rem` suelto en la regla del
    // contenido, cambiar la altura del pie arreglaria una mitad y dejaria la otra igual de tapada.
    const reglaContenido = CSS.slice(CSS.indexOf('.pb-hueco-inferior'), CSS.indexOf('.pie-sobre-la-barra'));
    expect(reglaContenido).toContain('var(--hueco-inferior)');
    expect(reglaContenido).not.toMatch(/\d+(\.\d+)?rem\s*\+/);
  });
});

describe('sin `viewport-fit=cover` todo el calculo vale cero sin fallar', () => {
  it('el meta viewport lo declara', () => {
    // Esta es la linea que hace REAL a `env(safe-area-inset-*)`. Sin ella devuelve 0, el calculo se
    // evalua a la altura del pie y nada avisa: el arreglo parece aplicado y no lo esta.
    const meta = HTML.match(/<meta\s+name="viewport"[^>]*>/)?.[0] ?? '';
    expect(meta, 'no se encontro el meta viewport').not.toBe('');
    expect(meta).toContain('viewport-fit=cover');
  });
});

describe('las dos mitades estan puestas, y ninguna barra fija se queda sin su parte', () => {
  it('el contenedor de pantalla reserva el hueco', () => {
    // Va sobre el contenedor y NO sobre el paginador a proposito: lo que se tapa es siempre el
    // ultimo elemento de la pantalla, sea cual sea. Arreglarlo en el paginador dejaria el defecto
    // vivo en toda vista que no lo monte.
    const contenedores = APP.match(/className="min-h-screen[^"]*"/g) ?? [];
    expect(contenedores.length, 'no se encontro ningun contenedor de pantalla').toBeGreaterThan(0);
    for (const c of contenedores) {
      expect(c, `un contenedor de pantalla no reserva el hueco: ${c}`).toContain('pb-hueco-inferior');
    }
  });

  it('TODA barra fija al fondo se aparta de la franja del telefono', () => {
    // La propiedad, no un sitio concreto: el dia que entre una cuarta barra fija, este test la
    // nombra antes de que nadie la vea tapada en una captura.
    const FUENTES = ['./App.tsx', './modules/planner/FlowPlannerModule.tsx'];
    for (const ruta of FUENTES) {
      const src = readFileSync(new URL(ruta, import.meta.url), 'utf8');
      const barras = src.match(/className="[^"]*fixed bottom-0[^"]*"/g) ?? [];
      for (const b of barras) {
        expect(b, `una barra fija al fondo no se aparta de la barra del telefono: ${b}`)
          .toContain('pie-sobre-la-barra');
      }
    }
  });

  it('el pie no fija su alto: con `border-box` un alto fijo se comeria el respiro por dentro', () => {
    // `h-7` + `padding-bottom` deja el pie igual de aplastado y el texto pegado al borde, sin que
    // nada falle. `min-h-7` conserva el alto de siempre cuando no hay franja, y crece cuando la hay.
    const pies = APP.match(/className="[^"]*fixed bottom-0[^"]*"/g) ?? [];
    expect(pies.length).toBeGreaterThan(0);
    for (const p of pies) {
      // OJO con `\b`: el guion ya es un limite de palabra, asi que `\bh-7\b` casa dentro de
      // `min-h-7` y este test se dispararia sobre su propio arreglo. Se exige que no haya nada
      // de clase pegado por delante.
      expect(p, `el pie fija su alto con h-7: ${p}`).not.toMatch(/(?<![\w-])h-7(?![\w-])/);
      expect(p).toMatch(/\bmin-h-7\b/);
    }
  });
});
