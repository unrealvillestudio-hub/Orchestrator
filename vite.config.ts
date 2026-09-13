import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

/**
 * LA VERSIÓN QUE PINTA LA UI SALE DE AQUÍ, NO DE UNA CONSTANTE ESCRITA A MANO.
 *
 * Antes el pie de pantalla llevaba una etiqueta fija en `App.tsx`, y quedó vieja por el
 * mismo motivo por el que quedó vieja la lista de marcas: **un valor escrito a mano sólo
 * se actualiza cuando alguien se acuerda.** Había tres números distintos conviviendo —el
 * del pie, el de `package.json` y el del context file— y ninguno coincidía con otro.
 *
 * Ahora hay uno: el de `package.json`, que es el campo que existe para esto. Subir la
 * versión es cambiar ese campo, y la pantalla se entera sola en el siguiente build.
 *
 * Y va acompañado del COMMIT, cuando la plataforma lo da. Es la respuesta a la pregunta
 * que más se repitió durante el upgrade —«¿esto que estoy viendo ya lleva el cambio?»—:
 * con el hash corto delante, se contesta mirando la pantalla en vez de mirando Vercel.
 */
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const commit = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Vacío en local, donde no hay despliegue del que hablar. La UI lo omite entonces en
    // vez de pintar un hueco: un identificador a medias confunde más que no ponerlo.
    __APP_COMMIT__: JSON.stringify(commit),
  },
});
