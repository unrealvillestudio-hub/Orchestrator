import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import {
  fetchWithTimeout, RequestTimeout, TIMEOUT_MS, REQUEST_TIMEOUT_CODE, mensajeDeFallo,
} from './fetchWithTimeout';

/**
 * U-8 bis — EL MISMO PLAZO, DEL LADO DEL NAVEGADOR.
 *
 * Lo que estas pruebas fijan, por orden de importancia:
 *
 *   1. **La invariante cruzada.** El plazo del navegador contra las rutas de este repo va
 *      POR ENCIMA del `maxDuration` que esas rutas declaran. Es la regla inversa a la de
 *      U-8 y es la que impide el fallo peor: abortar en el cliente una petición que el
 *      servidor estaba a punto de responder, y decirle al operador que se agotó el tiempo
 *      de un trabajo que sí se hizo.
 *   2. **Que vencer no se disfrace de fallar**, ni de red. Los ocho servicios colapsaban
 *      cualquier error de `fetch` en «no se pudo contactar el servidor (red)».
 *   3. **Que el aviso diga qué es seguro repetir.** Reintentar una lectura es gratis;
 *      reintentar una escritura puede aplicarla dos veces.
 *
 * Las URLs de las fixtures son inválidas a propósito.
 */

const URL_FALSA = 'https://destino.invalido/api/algo';

const colgado = (_url: string, init?: RequestInit) => new Promise<Response>((_res, rej) => {
  init?.signal?.addEventListener('abort', () => {
    rej(new DOMException('The operation was aborted.', 'AbortError'));
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ── 1 · La invariante cruzada, que es el corazón del corte ───────────────────────
const VERCEL = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as {
  functions: Record<string, { maxDuration?: number }>;
};

describe('el que espera, espera más que el que trabaja', () => {
  it('el plazo del navegador SUPERA al maxDuration más largo del repo', () => {
    // Si esto se invirtiera, el navegador mataría respuestas en camino y la pantalla diría
    // «se agotó el tiempo» sobre trabajo ya hecho. Falla en CI y no en producción.
    const maxMs = Math.max(
      ...Object.values(VERCEL.functions).map((f) => (f.maxDuration ?? 0) * 1000),
    );
    expect(maxMs, 'vercel.json no declara ningún maxDuration').toBeGreaterThan(0);
    expect(TIMEOUT_MS['own-api'], 'el cliente abortaría antes de que el servidor conteste')
      .toBeGreaterThan(maxMs);
  });

  it('y deja margen de sobra, no un segundo', () => {
    // Un margen de milisegundos se lo come la latencia de una red mala, que es justo la red
    // de quien abre esto desde el móvil.
    const maxMs = Math.max(...Object.values(VERCEL.functions).map((f) => (f.maxDuration ?? 0) * 1000));
    expect(TIMEOUT_MS['own-api'] - maxMs).toBeGreaterThanOrEqual(10_000);
  });

  it('los cuatro destinos están ordenados de menos a más paciente', () => {
    expect(TIMEOUT_MS.db).toBeLessThan(TIMEOUT_MS.edge);
    expect(TIMEOUT_MS.edge).toBeLessThan(TIMEOUT_MS['own-api']);
    expect(TIMEOUT_MS['own-api']).toBeLessThan(TIMEOUT_MS.lab);
  });
});

// ── 2 · Vencer, fallar y responder ───────────────────────────────────────────────
describe('el plazo', () => {
  it('dentro de plazo devuelve la respuesta y no deja temporizador vivo', async () => {
    vi.useFakeTimers();
    const respuesta = new Response('{}', { status: 200 });
    vi.stubGlobal('fetch', vi.fn(async () => respuesta));

    expect(await fetchWithTimeout('db', URL_FALSA)).toBe(respuesta);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('vencido lanza RequestTimeout con su código, destino y plazo', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(colgado));

    const capturado = fetchWithTimeout('db', URL_FALSA).catch((e) => e);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS.db);
    const err = await capturado;

    expect(err).toBeInstanceOf(RequestTimeout);
    expect(err.code).toBe(REQUEST_TIMEOUT_CODE);
    expect(err.target).toBe('db');
    expect(err.timeoutMs).toBe(TIMEOUT_MS.db);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('un error de red antes del plazo se propaga tal cual', async () => {
    vi.useFakeTimers();
    const caida = new TypeError('Failed to fetch');
    vi.stubGlobal('fetch', vi.fn(async () => { throw caida; }));

    await expect(fetchWithTimeout('own-api', URL_FALSA)).rejects.toBe(caida);
    expect(vi.getTimerCount(), 'quedó un temporizador vivo tras un error de red').toBe(0);
  });

  it('el mensaje del error se lee sin saber de programación', async () => {
    // Lo va a ver Sam en una tarjeta, no en una consola.
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(colgado));
    const capturado = fetchWithTimeout('lab', URL_FALSA).catch((e) => e);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS.lab);
    const err = await capturado;

    expect(err.message).toMatch(/superó los \d+ s de espera/);
    expect(err.message).not.toMatch(/abort|signal|controller/i);
  });
});

// ── 3 · El aviso dice qué es seguro repetir ──────────────────────────────────────
describe('qué se le dice al operador', () => {
  const vencido = new RequestTimeout('own-api', 75_000);

  it('una LECTURA vencida se puede repetir sin miedo, y lo dice', () => {
    const m = mensajeDeFallo(vencido, false);
    expect(m).toMatch(/seguro/i);
    expect(m).toMatch(/no se escribió nada/i);
  });

  it('una ESCRITURA vencida avisa de que pudo aplicarse igual', () => {
    // Es la diferencia que cambia qué hace quien lee: un plazo vencido en el navegador NO
    // cancela el trabajo del servidor. Decir «reintenta» a secas duplica veredictos.
    const m = mensajeDeFallo(vencido, true);
    expect(m).toMatch(/PUEDE HABERSE APLICADO/);
    expect(m).toMatch(/refrescar/i);
    expect(m).not.toMatch(/seguro/i);
  });

  it('un fallo que NO es de plazo sigue diciendo red, sin inventar un timeout', () => {
    expect(mensajeDeFallo(new TypeError('Failed to fetch'), true)).toBe('No se pudo contactar el servidor (red).');
    expect(mensajeDeFallo(new TypeError('Failed to fetch'), false)).not.toMatch(/espera/i);
  });
});

// ── 4 · El barrido: ninguna llamada del front se queda sin plazo ─────────────────
const RAIZ = new URL('../', import.meta.url);

function fuentes(dir: URL, acc: Array<readonly [string, string]> = []): Array<readonly [string, string]> {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const hijo = new URL(entrada.name + (entrada.isDirectory() ? '/' : ''), dir);
    if (entrada.isDirectory()) { fuentes(hijo, acc); continue; }
    if (!/\.(ts|tsx)$/.test(entrada.name) || entrada.name.includes('.test.')) continue;
    if (entrada.name === 'fetchWithTimeout.ts') continue;
    acc.push([entrada.name, readFileSync(hijo, 'utf8')] as const);
  }
  return acc;
}

const soloCodigo = (src: string) => src
  .split('\n')
  .filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('{/*'); })
  .join('\n');

describe('ninguna llamada del front se queda sin plazo', () => {
  const FUENTES = fuentes(RAIZ);

  it('hay archivos que barrer — si esto falla, el barrido no medía nada', () => {
    expect(FUENTES.length).toBeGreaterThan(20);
  });

  it('cero `fetch(` crudos fuera del envoltorio', () => {
    // Es la prueba que impide que la próxima llamada nueva nazca sin plazo. Sin ella, el
    // corte se deshace solo: basta un `fetch(` más en el archivo equivocado.
    const crudo = /(?<![A-Za-z0-9_.])fetch\(/;
    for (const [nombre, src] of FUENTES) {
      const codigo = soloCodigo(src).replace(/fetchWithTimeout\(/g, '');
      expect(codigo, `${nombre} tiene un fetch sin plazo`).not.toMatch(crudo);
    }
  });

  it('no hay un segundo envoltorio compitiendo con éste', () => {
    for (const [nombre, src] of FUENTES) {
      expect(soloCodigo(src), `${nombre} declara su propio AbortController`)
        .not.toMatch(/new AbortController\(/);
    }
  });

  it('ningún servicio colapsa ya un plazo vencido en «red»', () => {
    // El defecto que este corte evita reintroducir: los ocho `catch` convertían cualquier
    // fallo de `fetch` en una caída de red, timeout incluido.
    for (const [nombre, src] of FUENTES) {
      const codigo = soloCodigo(src);
      if (!/No se pudo contactar el servidor/.test(codigo)) continue;
      expect(codigo, `${nombre} sigue colapsando el error sin pasar por mensajeDeFallo`)
        .toMatch(/mensajeDeFallo\(/);
    }
  });
});

// ── 5 · Multimarca ───────────────────────────────────────────────────────────────
describe('multimarca — un plazo no sabe de marcas ni de pantallas', () => {
  const ENVOLTORIO = readFileSync(new URL('./fetchWithTimeout.ts', import.meta.url), 'utf8');

  it('ni una marca en el envoltorio', () => {
    for (const nombre of ['NeuroneSCF', 'ForumPHs', 'LucienSael', 'UnrealvilleStudio', 'PatriciaOsorio', 'D7Herbal'])
      expect(ENVOLTORIO).not.toContain(nombre);
  });

  it('los destinos se nombran por lo que SON, no por la pantalla que los estrenó', () => {
    expect(Object.keys(TIMEOUT_MS).sort()).toEqual(['db', 'edge', 'lab', 'own-api']);
    for (const k of Object.keys(TIMEOUT_MS))
      expect(k).not.toMatch(/hub|planner|monitor|executor|calibrat|publish|challeng|intel/i);
  });
});
