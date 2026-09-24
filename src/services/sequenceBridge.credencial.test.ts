import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * LA CREDENCIAL DE BASE NO VIAJA AL NAVEGADOR PARA ESCRIBIR — 2026-09-25.
 *
 * ── QUÉ FIJA ─────────────────────────────────────────────────────────────────────
 * MEDIDO el 2026-09-24 sobre los 23 repositorios del ecosistema:
 * `public.rotate_sequence_current` es una función `SECURITY DEFINER` —escribe en
 * `content_sequences`— y su ÚNICO llamante desde un navegador era
 * `src/services/sequenceBridge.ts`, con `VITE_SUPABASE_ANON_KEY`.
 *
 * Una variable `VITE_*` se INCRUSTA en el bundle: no es un secreto, es texto dentro de un
 * archivo JavaScript. Cualquiera con el bundle podía rotar secuencias de cualquier marca
 * llamando a `/rest/v1/rpc/rotate_sequence_current` sin pasar por esta aplicación.
 *
 * ── POR QUÉ ES UNA PRUEBA Y NO UN COMENTARIO ─────────────────────────────────────
 * Porque la regresión no se nota. Quien añada mañana una pantalla que necesite otra RPC
 * escribirá el `fetch` contra PostgREST igual que estaba escrito éste —es el patrón que
 * el resto del archivo usa para LEER tablas, y leer con `anon` es legítimo—. La línea
 * está entre leer una tabla, que RLS y los GRANT acotan, e invocar una función
 * `SECURITY DEFINER`, que corre con los privilegios del propietario.
 *
 * Esta prueba defiende esa línea exacta: NINGUNA RPC desde el navegador. Las lecturas de
 * tabla siguen como están y no se tocan aquí.
 */

const SRC = join(__dirname, '..');
const API = join(__dirname, '..', '..', 'api');

function archivos(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...archivos(p));
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

/** Un ejemplo en un comentario no es una llamada. Es la misma lección que aprendieron los
 *  detectores de `CREATE TABLE` y de rutas de este mismo trabajo: un filtro sobre el texto
 *  crudo acaba acusando a la documentación. */
const soloCodigo = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

describe('ninguna RPC de Supabase se invoca desde el navegador', () => {
  it('src/ no llama a /rest/v1/rpc/', () => {
    for (const f of archivos(SRC)) {
      expect(soloCodigo(readFileSync(f, 'utf8')), `${f} invoca una RPC desde el navegador`)
        .not.toMatch(/rest\/v1\/rpc\//);
    }
  });

  it('sequenceBridge llama a la ruta propia, no a PostgREST', () => {
    const src = soloCodigo(readFileSync(join(SRC, 'services', 'sequenceBridge.ts'), 'utf8'));
    expect(src).toMatch(/'\/api\/rotate-sequence'/);
    expect(src).not.toMatch(/rotate_sequence_current/);
  });

  it('la ruta propia usa la clave de servicio, no la publicable', () => {
    const ruta = readFileSync(join(API, 'rotate-sequence.ts'), 'utf8');
    expect(ruta).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    // `VITE_*` no existe del lado del servidor; que aparezca sería un copiar-pegar del front.
    expect(soloCodigo(ruta)).not.toMatch(/VITE_/);
  });

  it('la ruta propia exige los tres argumentos antes de tocar la base', () => {
    // Un argumento vacío llegaría a Postgres y rotaría algo que nadie quiso rotar.
    const ruta = soloCodigo(readFileSync(join(API, 'rotate-sequence.ts'), 'utf8'));
    for (const arg of ['brand_id', 'sequence_type', 'language']) {
      expect(ruta, `la ruta no comprueba ${arg}`).toMatch(new RegExp(`!${arg} && '${arg}'`));
    }
  });
});
