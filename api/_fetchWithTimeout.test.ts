import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  fetchWithTimeout, FetchTimeout, TIMEOUT_MS, MODEL_ROUTES, FETCH_TIMEOUT_CODE,
} from './_fetchWithTimeout.js';

/**
 * U-8 — LAS LLAMADAS QUE PUEDEN COLGAR UNA FUNCIÓN.
 *
 * Lo que estas pruebas fijan no es que el `fetch` funcione —eso lo prueba la red—, sino
 * las tres cosas que hacen que un timeout sirva de algo:
 *
 *   1. Que VENZA distinto de como FALLA. Confundir «la red falló» con «tardó demasiado»
 *      manda a quien depura al sitio equivocado, y el diagnóstico errado lleva a subir un
 *      plazo que no era el problema.
 *   2. Que el temporizador SIEMPRE se limpie. Uno vivo mantiene despierta a la función que
 *      este módulo existe para no colgar: la misma falla, más sutil y más difícil de ver.
 *   3. Que el plazo del modelo quede POR DEBAJO del `maxDuration` de su ruta. Si no, la
 *      plataforma mata la función antes de que el aborto alcance a devolver un error, y
 *      volvemos al 504 mudo que este corte vino a cerrar.
 *
 * Las URLs de las fixtures son inválidas a propósito: si algo dependiera de un proyecto,
 * una marca o un dominio reales, estas pruebas fallarían.
 */

const URL_FALSA = 'https://destino.invalido/rest/v1/tabla?apikey=NO-ES-UNA-CLAVE&id=eq.1';

/** Una respuesta que no llega nunca, y que sólo termina si alguien aborta su `signal`. */
const colgado = (_url: string, init?: RequestInit) => new Promise<Response>((_res, rej) => {
  init?.signal?.addEventListener('abort', () => {
    rej(new DOMException('The operation was aborted.', 'AbortError'));
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ── 1 · Dentro del plazo ─────────────────────────────────────────────────────────
describe('respuesta dentro del plazo', () => {
  it('devuelve la respuesta y NO deja el temporizador vivo', async () => {
    vi.useFakeTimers();
    const respuesta = new Response('{}', { status: 200 });
    vi.stubGlobal('fetch', vi.fn(async () => respuesta));

    const r = await fetchWithTimeout('db', URL_FALSA);

    expect(r).toBe(respuesta);
    // Si quedara un temporizador pendiente, la función seguiría despierta esperándolo.
    expect(vi.getTimerCount(), 'quedó un temporizador vivo tras una respuesta correcta').toBe(0);
  });

  it('el plazo NO alcanza al cuerpo: una descarga larga no se corta por llegar tarde', async () => {
    // `fetch` resuelve con las CABECERAS. Si el plazo siguiera vivo mientras se consume el
    // cuerpo, una descarga legítima —un vídeo de Storage— moriría a mitad. Se comprueba
    // leyendo el cuerpo MUY después de que el plazo del destino habría vencido.
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('contenido-largo', { status: 200 })));

    const r = await fetchWithTimeout('db', URL_FALSA);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS.db * 3);

    await expect(r.text()).resolves.toBe('contenido-largo');
  });

  it('pasa el `init` del llamante tal cual, más el `signal`', async () => {
    vi.useFakeTimers();
    const espia = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', espia);

    await fetchWithTimeout('db', URL_FALSA, { method: 'PATCH', headers: { 'X-Prueba': '1' } });

    const [, init] = espia.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('PATCH');
    expect((init.headers as Record<string, string>)['X-Prueba']).toBe('1');
    expect(init.signal).toBeDefined();
  });
});

// ── 2 · Vencido ──────────────────────────────────────────────────────────────────
describe('respuesta que excede el plazo', () => {
  it('aborta y lanza el error con código estable, destino y milisegundos', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(colgado));

    const p = fetchWithTimeout('db', URL_FALSA);
    const capturado = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS.db);
    const err = await capturado;

    expect(err).toBeInstanceOf(FetchTimeout);
    expect(err.code).toBe(FETCH_TIMEOUT_CODE);
    expect(err.target).toBe('db');
    expect(err.timeoutMs).toBe(TIMEOUT_MS.db);
    // El mensaje tiene que servir para BUSCAR en un log: código, destino y plazo.
    expect(err.message).toContain(FETCH_TIMEOUT_CODE);
    expect(err.message).toContain(String(TIMEOUT_MS.db));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('el mensaje NO arrastra la query: por ahí viajan claves y filtros', async () => {
    // Un error termina en un log, y un log no es un sitio seguro. La URL viaja recortada
    // a origen + camino, que es lo único que hace falta para saber a quién se llamaba.
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(colgado));

    const p = fetchWithTimeout('db', URL_FALSA);
    const capturado = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS.db);
    const err = await capturado;

    expect(err.message).toContain('https://destino.invalido/rest/v1/tabla');
    expect(err.message).not.toContain('NO-ES-UNA-CLAVE');
    expect(err.message).not.toContain('apikey');
  });

  it('un plazo pasado por argumento gana al del destino, sin abrirle una rama', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(colgado));

    const p = fetchWithTimeout('db', URL_FALSA, {}, 1_234);
    const capturado = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(1_234);
    const err = await capturado;

    expect(err.timeoutMs).toBe(1_234);
  });
});

// ── 3 · Fallo de red, que NO es lo mismo ─────────────────────────────────────────
describe('error de red antes del plazo', () => {
  it('se propaga tal cual, sin disfrazarse de timeout', async () => {
    vi.useFakeTimers();
    const caida = new TypeError('fetch failed');
    vi.stubGlobal('fetch', vi.fn(async () => { throw caida; }));

    await expect(fetchWithTimeout('db', URL_FALSA)).rejects.toBe(caida);
    // Y tampoco deja el temporizador vivo: el `finally` corre también por esta rama.
    expect(vi.getTimerCount(), 'quedó un temporizador vivo tras un error de red').toBe(0);
  });

  it('un error de red NUNCA se convierte en FetchTimeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

    const err = await fetchWithTimeout('edge', URL_FALSA).catch((e) => e);
    expect(err).not.toBeInstanceOf(FetchTimeout);
    expect(err.message).not.toContain(FETCH_TIMEOUT_CODE);
  });
});

// ── 4 · Los plazos, y la invariante contra `maxDuration` ─────────────────────────
const VERCEL = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  functions: Record<string, { maxDuration?: number }>;
};

describe('los plazos: uno por destino, y el del modelo por debajo de su maxDuration', () => {
  it('los tres destinos tienen plazos distintos y ordenados', () => {
    // Si dos coincidieran, uno de los dos estaría copiando al otro en vez de estar medido.
    expect(TIMEOUT_MS.db).toBeLessThan(TIMEOUT_MS.edge);
    expect(TIMEOUT_MS.edge).toBeLessThan(TIMEOUT_MS.model);
  });

  it('cada ruta que llama al modelo declara maxDuration EXPLÍCITO', () => {
    // Un maxDuration heredado del plan no sirve para comparar: cambia el día que cambia
    // el plan, y nadie se entera.
    for (const ruta of MODEL_ROUTES) {
      expect(VERCEL.functions[ruta], `${ruta} no está en vercel.json`).toBeDefined();
      expect(VERCEL.functions[ruta].maxDuration, `${ruta} sin maxDuration declarado`).toBeGreaterThan(0);
    }
  });

  it('ESTA es la prueba del corte: el plazo del modelo cabe dentro del maxDuration', () => {
    // Si alguien sube el plazo o baja el maxDuration, falla acá y no en producción.
    for (const ruta of MODEL_ROUTES) {
      const maxMs = (VERCEL.functions[ruta].maxDuration ?? 0) * 1000;
      expect(TIMEOUT_MS.model, `${ruta}: el plazo no deja margen para responder`).toBeLessThan(maxMs);
    }
  });

  it('el plazo de las Edge Functions cabe en el maxDuration de quien más las llama', () => {
    const maxMs = (VERCEL.functions['api/approve-job.ts'].maxDuration ?? 0) * 1000;
    expect(TIMEOUT_MS.edge).toBeLessThan(maxMs);
  });
});

// ── 5 · El barrido: ninguna llamada se queda fuera ───────────────────────────────
import { readdirSync } from 'node:fs';

const API_DIR = new URL('./', import.meta.url);
const FUENTES = readdirSync(API_DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== '_fetchWithTimeout.ts')
  .map((f) => [f, readFileSync(new URL(f, API_DIR), 'utf8')] as const);

describe('ninguna llamada de api/ se queda sin plazo', () => {
  it('cero `fetch(` crudos fuera del envoltorio', () => {
    // Es la prueba que impide que la próxima llamada nueva nazca sin red. Sin ella, el
    // corte se deshace solo: basta un `fetch(` más en el archivo equivocado.
    const crudo = /(?<![A-Za-z0-9_.])fetch\(/;
    for (const [nombre, src] of FUENTES) {
      const sinComentarios = src.split('\n')
        .filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*'); })
        .join('\n')
        .replace(/fetchWithTimeout\(/g, '');
      expect(sinComentarios, `${nombre} tiene un fetch sin plazo`).not.toMatch(crudo);
    }
  });

  it('no quedan dos envoltorios de timeout conviviendo', () => {
    // Dos implementaciones del mismo propósito divergen en el primer ajuste que toque una.
    for (const [nombre, src] of FUENTES) {
      expect(src, `${nombre} declara su propio AbortController`)
        .not.toMatch(/new AbortController\(/);
    }
  });
});

// ── 6 · El cap del corpus ────────────────────────────────────────────────────────
const SHARED = readFileSync(new URL('./_calibrationShared.ts', import.meta.url), 'utf8');
const QUEUE = readFileSync(new URL('./calibration-queue.ts', import.meta.url), 'utf8');

describe('el último lote sin cap ya lo tiene', () => {
  it('el corpus se lee con cap declarado, no con un número suelto', () => {
    expect(SHARED).not.toContain('limit=100000');
    expect(SHARED).toMatch(/export const EVALUATED_CAP = \d+;/);
    expect(SHARED).toContain('limit=${EVALUATED_CAP}');
  });

  it('cuando se llena, avisa — como sus cuatro hermanos', () => {
    expect(SHARED).toMatch(/truncated = lista\.length >= EVALUATED_CAP/);
    expect(SHARED).toMatch(/console\.warn\([^)]*EVALUATED_CAP/);
  });

  it('y el aviso LLEGA AL CONTRATO: la bandeja lo declara', () => {
    // Un dato que sólo el server conoce y no pasa al contrato es un dato que nadie mira.
    expect(QUEUE).toContain('evaluated.truncated');
  });

  it('pero NO contamina `search.truncated`, que significa lo contrario', () => {
    // El corte del corpus hace que SOBRE una pieza; el de piezas, que FALTE. Meterlos en
    // el mismo campo haría que la búsqueda afirmara algo falso sobre sí misma.
    expect(QUEUE).toMatch(/search\.mode === 'prefix' && piezasTruncadas/);
  });
});

// ── 7 · Multimarca ───────────────────────────────────────────────────────────────
describe('multimarca — un plazo no sabe de marcas', () => {
  const ENVOLTORIO = readFileSync(new URL('./_fetchWithTimeout.ts', import.meta.url), 'utf8');

  it('ni una marca ni un canal del ecosistema en el envoltorio', () => {
    for (const nombre of ['NeuroneSCF', 'ForumPHs', 'LucienSael', 'UnrealvilleStudio', 'D7Herbal', 'meta_ig', 'tiktok'])
      expect(ENVOLTORIO).not.toContain(nombre);
  });

  it('los destinos se nombran por lo que SON, no por el endpoint que los estrenó', () => {
    // `approve` o `calibrate` como nombre de destino cerraría el eje al caso que lo pidió
    // primero, y la siguiente ruta tendría que elegir el plazo de otra.
    expect(Object.keys(TIMEOUT_MS).sort()).toEqual(['db', 'edge', 'model']);
    for (const k of Object.keys(TIMEOUT_MS))
      expect(k).not.toMatch(/approve|calibrat|publish|challeng|intent|trigger/i);
  });
});
