import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formasVoseantes } from './idioma/voseo';

/**
 * NI UNA FORMA VOSEANTE EN EL CÓDIGO, LA INTERFAZ NI LOS PROMPTS DE ESTE REPO.
 *
 * EL CASO. Sam, 2026-10-20: «la UI del Orchestrator vas a revisarla toda porque tiene voseos y son
 * prohibidos en nuestro ecosystem». El barrido de ese día encontró voseo en la interfaz (Sembrador,
 * consola de calibración, cola de seeds), en los módulos de oficio que van dentro del prompt del
 * generador (`api/craft-modules/`) y en el propio prompt de `api/calibrate.ts`. El último es el más
 * caro: un prompt que pide español neutro escrito con voseo empuja al modelo hacia el voseo.
 *
 * POR QUÉ UN TEST. Dos tests anteriores vigilaban la UI con listas cerradas y `\b`, y no avisaron:
 * la lista no tenía las formas nuevas y `\b` no casa con una vocal acentuada final. Este recorre TODO
 * el texto de `src/` y `api/` con el detector morfológico de `idioma/voseo.ts`, así que una pantalla o
 * un prompt nuevo queda vigilado sin que nadie se acuerde de añadirlo.
 *
 * FUERA DEL BARRIDO, a propósito:
 *   · `*.fixtures.json` — transcripciones byte a byte de piezas reales, verificadas por md5. Son
 *     citas de lo que se publicó y no se reescriben (§2-BIS: la cita literal no está prohibida).
 *   · `CLAUDE.md`, `README.md`, `docs/` — context files, con bloques literales del protocolo que
 *     citan el voseo como ejemplo. Se revisan a mano.
 */
const RAIZ = fileURLToPath(new URL('..', import.meta.url));
// `supabase/functions` entra el 2026-10-21: el correo de `iid-approval-digest` abría con una forma
// voseante y el barrido de #82 no la vio porque esta lista no incluía la carpeta.
const CARPETAS = ['src', 'api', 'supabase/functions'];
const EXTENSIONES = /\.(tsx?|mjs|md|html|css|json)$/;

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivos(ruta);
    if (!EXTENSIONES.test(nombre) || nombre.endsWith('.fixtures.json')) return [];
    return [ruta];
  });
}

describe('el texto del repo está en ES neutro internacional', () => {
  const todos = CARPETAS.flatMap((c) => archivos(join(RAIZ, c)));

  it('el barrido encuentra los archivos (si da cero, el test no vigila nada)', () => {
    expect(todos.length).toBeGreaterThan(50);
  });

  it('ni una forma voseante ni regional en src/, api/ ni supabase/functions/', () => {
    const hallazgos = todos.flatMap((ruta) =>
      readFileSync(ruta, 'utf8').split('\n').flatMap((linea, i) =>
        formasVoseantes(linea).map((forma) => `${relative(RAIZ, ruta)}:${i + 1} «${forma}»`),
      ),
    );
    expect(hallazgos).toEqual([]);
  });
});

describe('el detector caza la clase y respeta lo legítimo', () => {
  // Las formas se arman por partes para que este archivo no contenga ninguna entera.
  const voseante = (raiz: string, fin: string) => raiz + fin;

  it('imperativo y presente voseantes, también con tilde final', () => {
    expect(formasVoseantes(`${voseante('Revis', 'á')} esto`)).toHaveLength(1);
    expect(formasVoseantes(`¿${voseante('Ten', 'és')} un post?`)).toHaveLength(1);
    expect(formasVoseantes(`${voseante('eleg', 'í')} una marca`)).toHaveLength(1);
    expect(formasVoseantes(voseante('v', 'os'))).toHaveLength(1);
    expect(formasVoseantes(`${voseante('mir', 'á')} la pieza`)).toHaveLength(1);
  });

  it('el imperativo con pronombre pegado, que no lleva tilde', () => {
    expect(formasVoseantes(`${voseante('Aprob', 'ala')} hoy`)).toHaveLength(1);
    expect(formasVoseantes(voseante('fij', 'ate'))).toHaveLength(1);
    expect(formasVoseantes('Apruébala hoy; fíjate en la escala y en el regalo.')).toEqual([]);
  });

  it('el regionalismo con equivalente neutro', () => {
    expect(formasVoseantes(`por ${voseante('ac', 'á')}`)).toHaveLength(1);
  });

  it('no marca futuros, tuteo ni palabras comunes', () => {
    expect(formasVoseantes('Revisa esto; se aplicará después y estás a tiempo, más o menos.')).toEqual([]);
    expect(formasVoseantes('¿Qué marca? Aquí, allí o más allá; podrá y querrá.')).toEqual([]);
  });

  it('una cadena con \\n escrito no pega la n a la palabra siguiente', () => {
    expect(formasVoseantes('línea uno\\naquí')).toEqual([]);
  });
});
