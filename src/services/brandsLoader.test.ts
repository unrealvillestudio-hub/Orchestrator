import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadBrands, getBrandById, brandColor, BRANDS_FALLBACK, invalidateBrandsCache } from './brandsLoader';

/**
 * U-9 — EL CATÁLOGO DE MARCAS SALE DEL CÓDIGO.
 *
 * Lo que estas pruebas fijan no es que la lectura funcione —eso se ve en la pantalla— sino
 * las tres cosas por las que el defecto original duró meses sin que nadie lo viera:
 *
 *   1. Que el respaldo SE PUEDA DISTINGUIR del camino bueno. El defecto no fue tener
 *      respaldo: fue que los dos se veían igual, así que una lectura rota parecía normal.
 *   2. Que la consulta pida las columnas QUE EXISTEN. La original pedía `name`, que no
 *      existe, y por eso el camino dinámico nunca se ejecutó con éxito.
 *   3. Que el filtro de estado siga ahí. Es la única frontera entre una marca de perímetro
 *      personal y una pantalla del ecosistema.
 *
 * Los identificadores de las fixtures son ficticios: si algo dependiera de una marca real,
 * estas pruebas fallarían — que es justo lo que este corte vino a conseguir.
 */

const FILA = (id: string, display_name: string | null = null, market: string | null = null) =>
  ({ id, display_name, market, status: 'active' });

/**
 * EL ENTORNO SE PONE POR `process.env`, Y EL MOTIVO IMPORTA.
 *
 * `import.meta.env` NO es un objeto compartido en vitest: **cada módulo recibe el suyo**
 * [`medido` con una sonda el 2026-09-13, dos módulos comparándolos dieron `false`]. Así que
 * escribirlo desde acá no lo cambia allá, y `vi.stubEnv` tampoco lo alcanza.
 *
 * Por eso el loader consulta los dos sitios donde las variables pueden estar, que además de
 * hacer esto probable es más robusto: el mismo módulo funciona en el navegador y fuera de él.
 */
beforeEach(() => {
  invalidateBrandsCache();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://proyecto.invalido');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'clave-ficticia');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  invalidateBrandsCache();
});

// ── 1 · Lectura buena ────────────────────────────────────────────────────────────
describe('cuando la base contesta', () => {
  it('devuelve las marcas del dato y declara que vinieron de ahí', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      FILA('MarcaUno', 'Marca Uno', 'Mercado A'),
      FILA('MarcaDos', 'Marca Dos', 'Mercado B'),
    ]), { status: 200 })));

    const r = await loadBrands();

    expect(r.source).toBe('db');
    expect(r.reason).toBeNull();
    expect(r.brands.map((b) => b.id)).toEqual(['MarcaUno', 'MarcaDos']);
    expect(r.brands[0].name).toBe('Marca Uno');
    expect(r.brands[0].market).toBe('Mercado A');
  });

  it('una fila sin nombre para mostrar cae en su id, no en un nombre inventado', async () => {
    // Inventar un nombre haría invisible que a esa fila le falta un dato.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([FILA('MarcaSinNombre')]), { status: 200 })));
    const r = await loadBrands();
    expect(r.brands[0].name).toBe('MarcaSinNombre');
  });

  it('NO se guarda ninguna lista escrita: la marca N+1 entra sin tocar código', async () => {
    // Es la pregunta de control del corte, hecha prueba: una marca que no existe en ningún
    // archivo de este repo tiene que aparecer sólo porque la base la devolvió.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      FILA('MarcaQueNadieEscribio', 'Marca que nadie escribió'),
    ]), { status: 200 })));

    const r = await loadBrands();
    expect(r.brands).toHaveLength(1);
    expect(r.brands[0].id).toBe('MarcaQueNadieEscribio');
    expect(r.brands[0].color).toBeTruthy();   // y trae color sin estar en ningún mapa
  });
});

// ── 2 · Lectura rota ─────────────────────────────────────────────────────────────
describe('cuando la base no contesta', () => {
  it('devuelve el respaldo Y DICE que es el respaldo — el punto entero del corte', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"code":"42703"}', { status: 400 })));

    const r = await loadBrands();

    expect(r.source).toBe('fallback');
    expect(r.brands).toEqual(BRANDS_FALLBACK);
    // Sin motivo, «falló» no se distingue de «falló por esto», y la reparación empieza a ciegas.
    expect(r.reason).toContain('400');
  });

  it('sin variables de entorno, también lo declara', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    const r = await loadBrands();
    expect(r.source).toBe('fallback');
    expect(r.reason).toMatch(/variables de entorno/i);
  });

  it('el respaldo NO se cachea: un fallo de un segundo no envenena la sesión', async () => {
    const espia = vi.fn(async () => new Response('', { status: 500 }));
    vi.stubGlobal('fetch', espia);
    await loadBrands();

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([FILA('MarcaUno', 'Marca Uno')]), { status: 200 })));
    const segunda = await loadBrands();

    expect(segunda.source, 'el respaldo quedó cacheado y no se reintentó').toBe('db');
  });

  it('el respaldo es una FOTO, no un catálogo: mínimo y fechado', async () => {
    // Una lista de respaldo que se presenta como catálogo vuelve a desviarse sola, que es
    // exactamente lo que le pasó a la de once marcas que este corte retira.
    expect(BRANDS_FALLBACK.length).toBeLessThanOrEqual(2);
    expect(SRC_LOADER).toMatch(/FOTO, NO UN CATÁLOGO|foto, no un catálogo/i);
    expect(SRC_LOADER).toMatch(/2026-09-13/);
  });
});

// ── 3 · La consulta ──────────────────────────────────────────────────────────────
const SRC_LOADER = readFileSync(new URL('./brandsLoader.ts', import.meta.url), 'utf8');

describe('la consulta pide lo que existe y filtra lo que debe', () => {
  it('pide `display_name`, NUNCA `name` — el error que mató este camino', async () => {
    const espia = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', espia);
    await loadBrands();

    const url = String((espia.mock.calls[0] as unknown as unknown[])[0]);
    expect(url).toContain('display_name');
    expect(url, 'volvió la columna que no existe').not.toMatch(/select=[^&]*\bname\b(?!_)/);
    expect(url).not.toMatch(/order=name\b/);
  });

  it('lleva `status=eq.active` — es una frontera de perímetro, no una comodidad', async () => {
    // Es el ÚNICO mecanismo que impide que una marca de perímetro personal o una fusionada
    // aparezcan en una pantalla del ecosistema. Si desaparece, aparecen.
    const espia = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', espia);
    await loadBrands();

    expect(String((espia.mock.calls[0] as unknown as unknown[])[0])).toContain('status=eq.active');
  });

  it('el filtro NO se aplica en el cliente: va en la consulta', () => {
    // Filtrar del lado del cliente traería las filas de perímetro personal al navegador
    // aunque no se pintaran, y el siguiente que toque el mapeo las pintaría sin saberlo.
    expect(SRC_LOADER).not.toMatch(/\.filter\([^)]*status/);
  });
});

// ── 4 · El color, que también era instancia en el código ─────────────────────────
describe('el color se deriva del id', () => {
  it('el mismo id da siempre el mismo color', () => {
    expect(brandColor('MarcaUno')).toBe(brandColor('MarcaUno'));
  });

  it('ids distintos no comparten tono por casualidad', () => {
    expect(brandColor('MarcaUno')).not.toBe(brandColor('MarcaDos'));
  });

  it('ya no hay un mapa de colores por marca', () => {
    // Once entradas, una por marca: instancia en el código, en pequeño. Una marca nueva
    // salía gris porque nadie se acordaba de añadirla.
    expect(SRC_LOADER).not.toMatch(/BRAND_COLORS/);
  });
});

// ── 5 · getBrandById ─────────────────────────────────────────────────────────────
describe('resolver una marca por id', () => {
  it('encuentra la suya y devuelve undefined si no está', () => {
    const marcas = [{ id: 'MarcaUno', name: 'Marca Uno', color: '#000', market: '', description: '' }];
    expect(getBrandById(marcas, 'MarcaUno')?.name).toBe('Marca Uno');
    expect(getBrandById(marcas, 'MarcaAusente')).toBeUndefined();
  });
});

// ── 6 · El barrido que resume el corte ───────────────────────────────────────────
const leer = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const soloCodigo = (src: string) => src
  .split('\n')
  .filter((l) => {
    const t = l.trim();
    return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('{/*');
  })
  .join('\n');

/** Los archivos que este corte toca del lado del front. */
const TOCADOS = [
  ['config/brands', leer('../config/brands.ts')],
  ['brandsLoader', SRC_LOADER],
  ['useBrands', leer('./useBrands.ts')],
  ['Hub', leer('../modules/hub/HubModule.tsx')],
  ['Planner', leer('../modules/planner/FlowPlannerModule.tsx')],
  ['Executor', leer('../modules/executor/FlowExecutorModule.tsx')],
  ['Monitor', leer('../modules/monitor/JobMonitorModule.tsx')],
] as const;

describe('multimarca — ninguna marca vive ya en estos archivos', () => {
  const MARCAS = /NeuroneSCF|UnrealvilleStudio|UnrealvilleStores|ForumPHs|LucienSael|PatriciaOsorio|D7Herbal|VivoseMask|VizosCosmetics|DiamondDetails/i;

  it('cero marcas en el código, fuera del respaldo fechado', () => {
    for (const [nombre, src] of TOCADOS) {
      const codigo = soloCodigo(src)
        // El respaldo es la única excepción declarada, y está fechado y acotado a una fila.
        .replace(/export const BRANDS_FALLBACK[\s\S]*?\];/, '');
      expect(codigo, `${nombre} todavía nombra una marca`).not.toMatch(MARCAS);
    }
  });

  it('la marca por defecto del Hub sale del dato, no de un nombre escrito', () => {
    // Antes: `BRANDS.find(b => b.id === 'UnrealvilleStudio')`. Una marca concreta
    // gobernando una rama de la aplicación.
    const hub = soloCodigo(leer('../modules/hub/HubModule.tsx'));
    expect(hub).not.toMatch(/b\.id === '[A-Z]/);
    expect(hub).toContain('brands[0].id');
  });

  it('con la lista vacía la pantalla LO DICE, en vez de elegir algo', () => {
    // Un selector que se queda mudo manda a buscar el fallo en el sitio equivocado.
    const hub = leer('../modules/hub/HubModule.tsx');
    expect(hub).toContain('Sin marcas disponibles');
    expect(hub).toContain('Cargando marcas');
  });

  it('nadie importa ya la lista vieja', () => {
    for (const [nombre, src] of TOCADOS) {
      if (nombre === 'config/brands') continue;
      expect(src, `${nombre} sigue importando config/brands`).not.toMatch(/from '.*config\/brands'/);
    }
  });

  it('`config/brands.ts` quedó sin datos y con nota, no borrado', () => {
    // Se borra en un tercer PR, cuando no quede ningún import. Es el procedimiento que la
    // regla multimarca fija para retirar un alias legacy.
    const legacy = leer('../config/brands.ts');
    expect(legacy).not.toMatch(/export const BRANDS/);
    expect(legacy).toMatch(/brandsLoader/);
    expect(legacy).toMatch(/tercer PR/);
  });
});
