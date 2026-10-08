import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { CAROUSEL_FORMAT } from './_manualShared.js';
import {
  pieceTypeOf, typeParam, topicKey, fetchRecurringFormats, DEFAULT_PIECE_TYPE, type ContentPiece,
} from './_calibrationShared.js';
import calibrationHandler from './calibration-queue.js';
import { pieceTypeLabel, pieceTypeOptions } from '../src/modules/iid/pieceUi';

/**
 * FILTRO «TIPO» EN LAS BANDEJAS DE PIEZAS (Sam, 2026-10-08).
 *
 * Sam quiere filtrar Calibración y Arreglos por tipo de pieza: carruseles, podcasts, vídeo cuando
 * exista. Lo que estas pruebas fijan:
 *   1. la precedencia del tipo: serie del tema → carrusel (criterio compartido) → formato → defecto;
 *   2. `carousel=1` sigue funcionando como alias legado de `type=carousel`;
 *   3. `types` se cuenta ANTES del filtro de tipo y el filtro se combina con plataforma y grupo;
 *   4. si `brand_topics` no se puede leer, la bandeja no se rompe, lo registra con un código estable
 *      y lo declara en `types_source`;
 *   5. las etiquetas de la interfaz salen del dato.
 *
 * Marcas, temas, plataformas y series son INVENTADOS: si algo dependiera de uno real, fallaría.
 */

const MARCA_N1 = 'MarcaN1Inventada';
const OTRA_MARCA = 'OtraMarcaDeOtroRubro';
const PLATAFORMA_N1 = 'plataforma_n1';
const OTRA_PLATAFORMA = 'otra_plataforma';
const TEMA_SERIE = 'tema_con_serie_inventado';
const TEMA_NORMAL = 'tema_normal_inventado';
const SERIE = 'serie_inventada';

const U = (n: number) => `https://cdn.test/t${n}.png`;
const DOS_LAMINAS = { image: { url: U(1) }, carousel: { slides: [{ n: 1, url: U(1) }, { n: 2, url: U(2) }] } };
const UNA_LAMINA = { image: { url: U(1) }, carousel: { slides: [{ n: 1, url: U(1) }, { n: 2, url: '' }] } };

const pieza = (over: Partial<ContentPiece>): ContentPiece => ({
  id: 'p', brand_id: MARCA_N1, platform: PLATAFORMA_N1, format: 'post', domain: TEMA_NORMAL,
  assets: { image: { url: U(1) } }, ...over,
} as ContentPiece);

const SERIES = new Map([[topicKey(MARCA_N1, TEMA_SERIE), SERIE]]);

describe('el tipo de una pieza — precedencia', () => {
  it('(a) la serie del tema manda, aunque la pieza sea un carrusel', () => {
    expect(pieceTypeOf(pieza({ domain: TEMA_SERIE }), SERIES)).toBe(SERIE);
    expect(pieceTypeOf(pieza({ domain: TEMA_SERIE, format: CAROUSEL_FORMAT, assets: DOS_LAMINAS }), SERIES)).toBe(SERIE);
  });

  it('(a) la serie es del tema de SU marca: otra marca con el mismo dominio no la hereda', () => {
    expect(pieceTypeOf(pieza({ brand_id: OTRA_MARCA, domain: TEMA_SERIE }), SERIES)).toBe('post');
  });

  it('(b) carrusel con el criterio de la tarjeta (dos o más láminas con imagen)', () => {
    expect(pieceTypeOf(pieza({ format: CAROUSEL_FORMAT, assets: DOS_LAMINAS }), SERIES)).toBe(CAROUSEL_FORMAT);
  });

  it('(b) un «carrusel» de una sola lámina con imagen se ve como una foto: no es carrusel', () => {
    expect(pieceTypeOf(pieza({ format: CAROUSEL_FORMAT, assets: UNA_LAMINA }), SERIES)).toBe(DEFAULT_PIECE_TYPE);
  });

  it('(c) el formato guardado, en minúsculas y sin espacios; vacío → el tipo por defecto', () => {
    expect(pieceTypeOf(pieza({ format: ' Formato_Nuevo ' }), SERIES)).toBe('formato_nuevo');
    expect(pieceTypeOf(pieza({ format: null }), SERIES)).toBe(DEFAULT_PIECE_TYPE);
    expect(pieceTypeOf(pieza({ format: '   ' }), SERIES)).toBe(DEFAULT_PIECE_TYPE);
    expect(pieceTypeOf(pieza({ domain: null }), new Map())).toBe('post');
  });
});

describe('el parámetro `type` y su alias legado `carousel=1`', () => {
  it('`type` manda, normalizado', () => {
    expect(typeParam(' Serie_Inventada ', undefined)).toBe(SERIE);
    expect(typeParam([SERIE], '1')).toBe(SERIE);
  });
  it('`carousel=1` sin `type` es `type=carousel`', () => {
    expect(typeParam(undefined, '1')).toBe(CAROUSEL_FORMAT);
    expect(typeParam('', 'true')).toBe(CAROUSEL_FORMAT);
  });
  it('sin ninguno, o con `carousel` apagado, no hay filtro', () => {
    for (const c of [undefined, '', '0', 'false']) expect(typeParam(undefined, c)).toBeUndefined();
  });
});

// ── de punta a punta con el handler ──────────────────────────────────────────────
const SECRET = 'secreto-de-prueba';
const b64u = (b: Buffer) => b.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function adminToken(): string {
  const h = b64u(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const p = b64u(Buffer.from(JSON.stringify({ sub: 'admin@test', role: 'admin', exp: Math.floor(Date.now() / 1000) + 600 })));
  return `${h}.${p}.${b64u(createHmac('sha256', SECRET).update(`${h}.${p}`).digest())}`;
}
function fakeRes() {
  const out: { status?: number; body?: any } = {};
  const res = {
    status(c: number) { out.status = c; return res; },
    json(b: unknown) { out.body = b; return res; },
    setHeader() { return res; },
    end() { return res; },
  } as unknown as VercelResponse;
  return { res, out };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const call = async (query: Record<string, string>) => {
  const { res, out } = fakeRes();
  await calibrationHandler({ method: 'GET', query, headers: { authorization: `Bearer ${adminToken()}` } } as unknown as VercelRequest, res);
  return out;
};
const ids = (body: any): string[] => body.pieces.map((p: { piece_id: string }) => p.piece_id).sort();

const uid = (n: number) => `a${String(n).padStart(7, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
/**
 * 12 piezas: 1-3 de la serie (una de ellas carrusel), 4-6 carruseles, 7-9 posts, 10-12 de un formato
 * nuevo. Las pares de la otra plataforma; 1, 4, 7 y 10, devueltas del arreglo (`corregida`).
 */
const PIEZAS: ContentPiece[] = Array.from({ length: 12 }, (_, i) => {
  const n = i + 1;
  const grupo = Math.ceil(n / 3);
  return {
    id: uid(n), brand_id: MARCA_N1, queue_id: null,
    platform: n % 2 ? PLATAFORMA_N1 : OTRA_PLATAFORMA,
    domain: grupo === 1 ? TEMA_SERIE : TEMA_NORMAL,
    format: n === 3 || grupo === 2 ? CAROUSEL_FORMAT : grupo === 4 ? 'formato_nuevo' : 'post',
    status: 'awaiting_approval',
    challenged_at: (n - 1) % 3 === 0 ? '2026-10-01T00:00:00Z' : null,
    created_at: new Date(Date.UTC(2026, 9, 1) + n * 3_600_000).toISOString(),
    discarded_at: null,
    assets: n === 3 || grupo === 2 ? DOS_LAMINAS : { image: { url: U(1) } },
  } as unknown as ContentPiece;
});

describe('Calibración filtra por tipo — marca N+1', () => {
  let temas: () => Response;
  beforeEach(() => {
    temas = () => json([{ brand_id: MARCA_N1, domain: TEMA_SERIE, recurring_format: ` ${SERIE.toUpperCase()} ` }]);
    vi.stubEnv('SUPABASE_URL', 'https://proyecto.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role');
    vi.stubEnv('ORCHESTRATOR_NSCF_IID_INTEL_JWT_SECRET', SECRET);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/brand_topics?')) return temas();
      if (u.includes('/content_pieces?')) return json(PIEZAS);
      return json([]);
    }));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('lee las series con UNA consulta a intel, sólo de los temas que la declaran', async () => {
    await call({ state: 'all', limit: '200' });
    const llamadas = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => String(c[0]).includes('/brand_topics?'));
    expect(llamadas).toHaveLength(1);
    expect(String(llamadas[0][0])).toContain('recurring_format=not.is.null');
    expect(String(llamadas[0][0])).toContain('select=brand_id,domain,recurring_format');
    expect((llamadas[0][1] as RequestInit).headers).toMatchObject({ 'Accept-Profile': 'intel' });
  });

  it('cuenta los tipos ANTES de filtrar por tipo, y cada pieza trae el suyo', async () => {
    const todo = await call({ state: 'all', limit: '200' });
    expect(todo.status).toBe(200);
    expect(todo.body.types).toEqual({ [SERIE]: 3, [CAROUSEL_FORMAT]: 3, post: 3, formato_nuevo: 3 });
    expect(todo.body.types_source).toBe('ok');
    expect(todo.body.type).toBe('');
    const serie = await call({ type: SERIE, state: 'all', limit: '200' });
    expect(ids(serie.body)).toEqual([uid(1), uid(2), uid(3)].sort());
    expect(serie.body.types).toEqual(todo.body.types);
    expect(serie.body.pieces.every((p: { piece_type: string }) => p.piece_type === SERIE)).toBe(true);
    expect(serie.body.total_pending).toBe(3);
  });

  it('`carousel=1` es alias de `type=carousel` y devuelve lo mismo', async () => {
    const alias = await call({ carousel: '1', state: 'all', limit: '200' });
    const tipo = await call({ type: CAROUSEL_FORMAT, state: 'all', limit: '200' });
    expect(ids(alias.body)).toEqual(ids(tipo.body));
    expect(ids(alias.body)).toEqual([uid(4), uid(5), uid(6)].sort());
    expect(alias.body).toMatchObject({ type: CAROUSEL_FORMAT, carousel: true, carousels: 3 });
  });

  it('se combina con la plataforma y con el grupo de Arreglos', async () => {
    const conPlataforma = await call({ type: CAROUSEL_FORMAT, platform: OTRA_PLATAFORMA, state: 'all', limit: '200' });
    expect(ids(conPlataforma.body)).toEqual([uid(4), uid(6)].sort());
    // `types` se cuenta con la plataforma puesta: es lo que daría cada tipo con los demás filtros.
    expect(conPlataforma.body.types).toEqual({ [SERIE]: 1, [CAROUSEL_FORMAT]: 2, post: 1, formato_nuevo: 2 });
    const conGrupo = await call({ type: 'formato_nuevo', state: 'corregida', limit: '200' });
    expect(ids(conGrupo.body)).toEqual([uid(10)]);
  });

  it('`brand_topics` ilegible: no rompe, lo registra con su código y lo declara', async () => {
    temas = () => json({ code: '42703', message: 'column recurring_format does not exist' }, 400);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await call({ state: 'all', limit: '200' });
    expect(out.status).toBe(200);
    expect(out.body.types_source).toBe('unavailable');
    // Sin series, el tipo cae al formato: la pieza 3 vuelve a ser carrusel y las otras dos, posts.
    expect(out.body.types).toEqual({ [CAROUSEL_FORMAT]: 4, post: 5, formato_nuevo: 3 });
    expect(err.mock.calls.some((c) => String(c[0]).startsWith('[TIPO] brand_topics ilegible'))).toBe(true);
  });

  it('una red caída al leer los temas tampoco rompe la bandeja', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    temas = () => { throw new Error('red caída'); };
    expect((await fetchRecurringFormats()).source).toBe('unavailable');
    expect((await call({ state: 'all' })).status).toBe(200);
  });
});

describe('el selector «Tipo» de la interfaz', () => {
  it('etiquetas: carrusel en castellano; el resto, el valor con mayúscula inicial', () => {
    expect(pieceTypeLabel(CAROUSEL_FORMAT)).toBe('Carrusel');
    expect(pieceTypeLabel('post')).toBe('Post');
    expect(pieceTypeLabel(SERIE)).toBe('Serie_inventada');
  });

  it('opciones del dato: «Todos» y sólo los tipos con piezas; el elegido no desaparece', () => {
    expect(pieceTypeOptions({ post: 2, [SERIE]: 0, [CAROUSEL_FORMAT]: 1 }, '')).toEqual([
      ['', 'Todos'], [CAROUSEL_FORMAT, 'Carrusel (1)'], ['post', 'Post (2)'],
    ]);
    expect(pieceTypeOptions({ post: 2 }, SERIE).map(([v]) => v)).toEqual(['', 'post', SERIE]);
    expect(pieceTypeOptions(undefined, '')).toEqual([['', 'Todos']]);
  });

  it('Calibración y Arreglos usan el selector, no el interruptor; sin marcas ni series en el código', () => {
    const MOD = readFileSync(new URL('../src/modules/iid/ApprovalCalibrationModule.tsx', import.meta.url), 'utf8');
    expect(MOD).toContain('types={data?.types}');
    expect(MOD).not.toMatch(/CarouselToggle|carousel/);
    // Sólo código: los comentarios pueden contar la historia con nombres; el código no los usa.
    const soloCodigo = (src: string) => src.split('\n')
      .filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('{/*'); })
      .join('\n');
    const SRC = ['./calibration-queue.ts', './_calibrationShared.ts', '../src/modules/iid/pieceUi.tsx']
      .map((f) => soloCodigo(readFileSync(new URL(f, import.meta.url), 'utf8'))).join('\n');
    expect(SRC).not.toMatch(/['"]podcast|podcast-|NeuroneSCF|ForumPHs|LucienSael|UnrealvilleStudio/);
  });
});
