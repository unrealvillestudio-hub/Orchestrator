import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * LA VERSIÓN QUE PINTA LA UI — 2026-09-13.
 *
 * El pie de pantalla decía una versión que llevaba meses sin tocarse, y había TRES números
 * distintos conviviendo: el del pie, el de `package.json` y el del context file. Ninguno
 * coincidía con otro, y ninguno con lo que estaba desplegado.
 *
 * Es el mismo defecto que U-9 retiró del catálogo de marcas, en pequeño: **un valor escrito
 * a mano sólo se actualiza cuando alguien se acuerda.** Subir el número no lo arregla —lo
 * aplaza—, así que lo que se fija acá no es QUÉ versión dice, sino que **no la diga a mano**.
 */

const APP = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const VITE = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

describe('la versión de la UI se deriva, no se escribe', () => {
  it('`App.tsx` no lleva ninguna etiqueta de versión escrita a mano', () => {
    // Si vuelve a aparecer una constante con un número dentro, volvemos al punto de partida.
    expect(APP).not.toMatch(/BUILD_TAG\s*=\s*["'`][^`$]*\d/);
    expect(APP).toContain('__APP_VERSION__');
  });

  it('el build la inyecta desde `package.json`, que es el campo que existe para esto', () => {
    expect(VITE).toContain('__APP_VERSION__');
    expect(VITE).toMatch(/package\.json/);
  });

  it('`package.json` declara una versión con forma de versión', () => {
    expect(PKG.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('el commit acompaña a la versión cuando la plataforma lo da, y se omite cuando no', () => {
    // Contesta la pregunta que más se repitió durante el upgrade —«¿lo que veo ya lleva el
    // cambio?»— mirando la pantalla en vez de mirando Vercel. Y cuando no hay despliegue
    // del que hablar, no se pinta un hueco: un identificador a medias confunde más.
    expect(VITE).toContain('VERCEL_GIT_COMMIT_SHA');
    expect(APP).toMatch(/__APP_COMMIT__\s*\?/);
  });
});
