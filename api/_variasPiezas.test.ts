import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  parsePieceSearch, idMatchesSearch, unmatchedTerms, searchSummary, splitSearchTerms,
  checkSearchDraft, searchErrorBody,
  SearchTooShort, SearchNotAnId, SearchTooMany, SEARCH_MIN_PREFIX, SEARCH_MAX_TERMS,
} from './_pieceSearch.js';
import { isCarouselPiece, CAROUSEL_FORMAT } from './_manualShared.js';
import { isCarouselContentPiece, carouselParam, type ContentPiece } from './_calibrationShared.js';
import historyHandler from './evaluated-history.js';
import calibrationHandler from './calibration-queue.js';
import publishHandler from './publish-queue.js';

/**
 * VARIAS PIEZAS A LA VEZ Y FILTRO «CARRUSEL» (Sam, 2026-10-06).
 *
 * «En el Orchestrator en todas sus tabs de evaluación incluyendo Historial quiero poder filtrar por
 * número de pieza por varias piezas a la vez separadas por coma o como quieras … y en el filtro por
 * plataformas quiero ver carrousels.»
 *
 * Lo que estas pruebas fijan:
 *   1. el parser: coma, espacio, salto de línea, repetidos, prefijos cortos y texto libre;
 *   2. la coincidencia, por prefijo y por id completo, y qué ids NO encontraron nada;
 *   3. el criterio de carrusel es el de la tarjeta (`isCarouselPiece`), no uno nuevo;
 *   4. las bandejas, de punta a punta con su handler, con una MARCA y una PLATAFORMA inventadas:
 *      si algo dependiera de una marca o una plataforma reales, fallarían.
 *
 * Los uuid son ficticios y las marcas, inventadas.
 */

const MARCA_N1 = 'MarcaN1Inventada';
const OTRA_MARCA = 'OtraMarcaDeOtroRubro';
const PLATAFORMA_N1 = 'plataforma_n1';
const OTRA_PLATAFORMA = 'otra_plataforma';

/** uuid ficticio con un prefijo de 8 legible. */
const uid = (prefijo8: string, n: number) => `${prefijo8}-0000-4000-8000-${String(n).padStart(12, '0')}`;

// ── 1 · el parser ────────────────────────────────────────────────────────────────
describe('el parser acepta varios ids', () => {
  it('separados por coma, con o sin espacio', () => {
    const s = parsePieceSearch('4f13cc52, 6bb3ebc0,aaaaaaaa')!;
    expect(s.terms.map((t) => t.q)).toEqual(['4f13cc52', '6bb3ebc0', 'aaaaaaaa']);
    expect(s.q).toBe('4f13cc52, 6bb3ebc0, aaaaaaaa');
    expect(s.mode).toBe('prefix');
  });

  it('separados por espacios, tabuladores, saltos de línea y punto y coma, mezclados', () => {
    const s = parsePieceSearch('  4f13cc52   6bb3ebc0\naaaaaaaa\r\n\tbbbbbbbb;cccccccc  ')!;
    expect(s.terms.map((t) => t.q)).toEqual(['4f13cc52', '6bb3ebc0', 'aaaaaaaa', 'bbbbbbbb', 'cccccccc']);
  });

  it('una columna pegada de una hoja (sólo saltos de línea) no se fusiona en un solo prefijo', () => {
    expect(splitSearchTerms('4f13cc52\n6bb3ebc0\n')).toEqual(['4f13cc52', '6bb3ebc0']);
  });

  it('quita repetidos, también si sólo cambian las mayúsculas, y respeta el orden de llegada', () => {
    const s = parsePieceSearch('6BB3EBC0, 4f13cc52, 6bb3ebc0, 4F13CC52')!;
    expect(s.terms.map((t) => t.q)).toEqual(['6bb3ebc0', '4f13cc52']);
  });

  it('mezcla uuid completo y prefijo: cada término guarda su modo', () => {
    const s = parsePieceSearch(`${uid('aaaaaaaa', 1)}, bbbbbbbb`)!;
    expect(s.terms[0]).toMatchObject({ mode: 'uuid', exact: uid('aaaaaaaa', 1), prefix: null });
    expect(s.terms[1]).toMatchObject({ mode: 'prefix', exact: null, prefix: 'bbbbbbbb' });
    // Basta un prefijo para que la búsqueda dependa del lote.
    expect(s.mode).toBe('prefix');
  });

  it('sólo uuid completos → modo uuid: no depende del lote', () => {
    expect(parsePieceSearch(`${uid('aaaaaaaa', 1)} ${uid('bbbbbbbb', 2)}`)!.mode).toBe('uuid');
  });

  it('sólo separadores → null: no buscar NO es buscar y no encontrar', () => {
    expect(parsePieceSearch(' , ;\n ')).toBeNull();
  });

  it('un prefijo corto lanza y NOMBRA todos los cortos, no sólo el primero', () => {
    expect(SEARCH_MIN_PREFIX).toBe(8);
    let err: unknown;
    try { parsePieceSearch('4f13cc52, 6bb3, abc1234'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(SearchTooShort);
    expect((err as SearchTooShort).terms).toEqual(['6bb3', 'abc1234']);
  });

  it('un término que no es hexadecimal lanza y lo nombra, aunque los demás valgan', () => {
    let err: unknown;
    try { parsePieceSearch('4f13cc52, xxxxxxxx'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(SearchNotAnId);
    expect((err as SearchNotAnId).terms).toEqual(['xxxxxxxx']);
  });

  it('más del tope → lanza, no recorta en silencio', () => {
    const muchos = Array.from({ length: SEARCH_MAX_TERMS + 1 }, (_, i) => i.toString(16).padStart(8, '0')).join(',');
    expect(() => parsePieceSearch(muchos)).toThrow(SearchTooMany);
  });

  it('el 400 dice qué ids fallan, con el mismo texto en la caja del front', () => {
    const body = searchErrorBody(new SearchTooShort('6bb3', ['6bb3']))!;
    expect(body.error).toBe('search_too_short');
    expect(body.detail).toContain('6bb3');
    const caja = checkSearchDraft('4f13cc52, 6bb3');
    expect(caja.error).toBe(body.detail);
    expect(caja.count).toBe(2);
  });

  it('la caja envía los ids normalizados y unidos por coma', () => {
    expect(checkSearchDraft(' 4F13CC52\n6bb3ebc0 ')).toEqual({ q: '4f13cc52,6bb3ebc0', count: 2, error: null });
  });
});

// ── 2 · la coincidencia ──────────────────────────────────────────────────────────
describe('la coincidencia, por prefijo y por id completo', () => {
  const A = uid('aaaaaaaa', 1);
  const B = uid('bbbbbbbb', 2);
  const C = uid('cccccccc', 3);

  it('por prefijo: casa cualquiera de los términos', () => {
    const s = parsePieceSearch('aaaaaaaa, bbbbbbbb');
    expect(idMatchesSearch(A, s)).toBe(true);
    expect(idMatchesSearch(B, s)).toBe(true);
    expect(idMatchesSearch(C, s)).toBe(false);
  });

  it('por id completo: sólo el exacto, no otro con el mismo prefijo', () => {
    const s = parsePieceSearch(A);
    expect(idMatchesSearch(A, s)).toBe(true);
    expect(idMatchesSearch(uid('aaaaaaaa', 9), s)).toBe(false);
  });

  it('sin distinguir mayúsculas en ninguno de los dos lados', () => {
    expect(idMatchesSearch(A.toUpperCase(), parsePieceSearch('AAAAAAAA'))).toBe(true);
  });

  it('dice qué términos no encontraron nada', () => {
    const s = parsePieceSearch(`aaaaaaaa, ${B}, dddddddd`);
    expect(unmatchedTerms([A, B, C], s)).toEqual(['dddddddd']);
  });

  it('el resumen cuenta filas y lista los que faltan', () => {
    const s = parsePieceSearch('aaaaaaaa, dddddddd')!;
    expect(searchSummary(s, [A, A], false)).toEqual({
      q: 'aaaaaaaa, dddddddd', mode: 'prefix', truncated: false,
      terms: ['aaaaaaaa', 'dddddddd'], matched: 2, missing: ['dddddddd'],
    });
  });
});

// ── 3 · el criterio de carrusel es el de la tarjeta ──────────────────────────────
describe('qué es un carrusel', () => {
  const U = (n: number) => `https://cdn.test/l${n}.png`;
  const pieza = (over: Partial<ContentPiece>) =>
    ({ id: uid('aaaaaaaa', 1), brand_id: MARCA_N1, platform: PLATAFORMA_N1, status: 'awaiting_approval', ...over }) as ContentPiece;

  it('formato carrusel con dos o más láminas con imagen → sí, en cualquier plataforma', () => {
    for (const platform of [PLATAFORMA_N1, OTRA_PLATAFORMA]) {
      expect(isCarouselContentPiece(pieza({
        platform, format: CAROUSEL_FORMAT,
        assets: { carousel: { slides: [{ n: 1, url: U(1) }, { n: 2, url: U(2) }] } },
      }))).toBe(true);
    }
  });

  it('carrusel con una sola lámina con imagen → no: se publica y se ve como una foto', () => {
    expect(isCarouselContentPiece(pieza({
      format: CAROUSEL_FORMAT,
      assets: { image: { url: U(1) }, carousel: { slides: [{ n: 1, url: U(1) }, { n: 2, url: '' }] } },
    }))).toBe(false);
  });

  it('láminas sin formato carrusel → no: manda el formato declarado', () => {
    expect(isCarouselContentPiece(pieza({
      format: 'post', assets: { carousel: { slides: [{ n: 1, url: U(1) }, { n: 2, url: U(2) }] } },
    }))).toBe(false);
  });

  it('es exactamente el criterio con el que la tarjeta pinta la tira de láminas', () => {
    const SHARED = readFileSync(new URL('./_calibrationShared.ts', import.meta.url), 'utf8');
    const MANUAL = readFileSync(new URL('./_manualShared.ts', import.meta.url), 'utf8');
    expect(MANUAL).toMatch(/export function isCarouselPiece[\s\S]{0,120}manualImagesOf\(piece\)\.length >= 2/);
    expect(SHARED).toMatch(/return laminas\.length >= 2/);
    expect(SHARED).toMatch(/isCarouselContentPiece[\s\S]{0,200}isCarouselPiece\(/);
  });

  it('el parámetro se enciende con 1 o true y con nada más', () => {
    expect(carouselParam('1')).toBe(true);
    expect(carouselParam('true')).toBe(true);
    expect(carouselParam(['1'])).toBe(true);
    for (const v of [undefined, '', '0', 'false', 'carrusel']) expect(carouselParam(v)).toBe(false);
  });

  it('isCarouselPiece y el formato son los de la publicación manual', () => {
    expect(isCarouselPiece({ id: 'x', brand_id: MARCA_N1, format: CAROUSEL_FORMAT, assets: { carousel: { slides: [{ url: U(1) }, { url: U(2) }] } } })).toBe(true);
  });
});

// ── 4 · las bandejas, de punta a punta, con marca y plataforma inventadas ────────
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
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const call = async (handler: (rq: VercelRequest, rs: VercelResponse) => unknown, query: Record<string, string>) => {
  const { res, out } = fakeRes();
  await handler({ method: 'GET', query, headers: { authorization: `Bearer ${adminToken()}` } } as unknown as VercelRequest, res);
  return out;
};

const U = (n: number) => `https://cdn.test/l${n}.png`;
/** 60 piezas: tres pantallas de 20. Las buscadas quedan en la primera y en la ÚLTIMA. */
const PIEZAS: ContentPiece[] = Array.from({ length: 60 }, (_, i) => {
  const n = i + 1;
  const carrusel = n % 10 === 0; // 6 carruseles
  return {
    id: uid(`e${String(n).padStart(7, '0')}`, n),
    brand_id: n % 2 ? MARCA_N1 : OTRA_MARCA,
    queue_id: null,
    platform: n % 3 ? PLATAFORMA_N1 : OTRA_PLATAFORMA,
    format: carrusel ? CAROUSEL_FORMAT : 'post',
    status: 'awaiting_approval',
    created_at: new Date(Date.UTC(2026, 8, 1) + n * 3_600_000).toISOString(),
    discarded_at: null,
    assets: carrusel
      ? { image: { url: U(1) }, carousel: { slides: [{ n: 1, url: U(1) }, { n: 2, url: U(2) }] } }
      : { image: { url: U(1) } },
  } as unknown as ContentPiece;
});
const CORPUS = PIEZAS.map((p, i) => ({
  piece_id: p.id, brand_id: p.brand_id, platform: p.platform, format: p.format,
  verdict: i % 4 ? 'approved' : 'fixable', created_at: p.created_at,
}));

describe('las bandejas buscan varias piezas y filtran carruseles — marca N+1', () => {
  /**
   * Sin búsqueda, Historial esconde lo que sigue vivo en otra bandeja («una pieza, una pestaña»). En
   * las pruebas de Historial las piezas ya terminaron: la lectura de piezas vivas vuelve vacía.
   */
  let vivas = true;
  beforeEach(() => {
    vivas = true;
    vi.stubEnv('SUPABASE_URL', 'https://proyecto.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role');
    vi.stubEnv('ORCHESTRATOR_NSCF_IID_INTEL_JWT_SECRET', SECRET);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/approval_calibration_archive?')) return json([]);
      if (u.includes('/approval_calibration?') && u.includes('select=piece_id,brand_id,voice')) return json(CORPUS);
      if (u.includes('/content_pieces?format=eq.')) {
        return json(PIEZAS.filter((p) => p.format === CAROUSEL_FORMAT).map((p) => ({
          id: p.id, brand_id: p.brand_id, format: p.format, image: p.assets?.image, carousel: p.assets?.carousel,
        })));
      }
      if (u.includes('/content_pieces?')) return json(vivas ? PIEZAS : []);
      return json([]);
    }));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const primera = PIEZAS[59].id; // la más reciente → primera pantalla
  const ultima = PIEZAS[0].id;   // la más antigua → última pantalla

  it('Historial encuentra dos piezas aunque una esté fuera de la página, y dice cuál no existe', async () => {
    const out = await call(historyHandler, { q: `${primera.slice(0, 8)}, ${ultima.toUpperCase()}\nfffffff0`, limit: '20' });
    expect(out.status).toBe(200);
    expect(out.body.rows.map((r: { piece_id: string }) => r.piece_id).sort()).toEqual([primera, ultima].sort());
    expect(out.body.search).toMatchObject({ matched: 2, missing: ['fffffff0'], truncated: false });
  });

  it('lo que falta se calcula sobre TODO el resultado, no sobre la página: con una fila por página, nada falta', async () => {
    for (const h of [historyHandler, calibrationHandler, publishHandler]) {
      const out = await call(h, { q: `${primera.slice(0, 8)}, ${ultima.slice(0, 8)}`, state: 'all', limit: '1' });
      expect(out.body.search).toMatchObject({ matched: 2, missing: [] });
    }
  });

  it('Historial filtra carruseles con el criterio de la tarjeta, combinable con el canal', async () => {
    vivas = false;
    const solo = await call(historyHandler, { carousel: '1', limit: '200' });
    expect(solo.body.total).toBe(6);
    expect(solo.body.carousel).toBe(true);
    const conCanal = await call(historyHandler, { carousel: '1', channel: OTRA_PLATAFORMA, limit: '200' });
    // n % 10 === 0 y n % 3 === 0 → 30 y 60.
    expect(conCanal.body.rows.map((r: { piece_id: string }) => r.piece_id).sort())
      .toEqual([PIEZAS[29].id, PIEZAS[59].id].sort());
  });

  it('Historial sin el filtro no lee content_pieces para carruseles', async () => {
    await call(historyHandler, { q: primera.slice(0, 8) });
    const urls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('content_pieces?format=eq.'))).toBe(false);
  });

  it('Calibración busca varias piezas fuera de la página y cuenta carruseles', async () => {
    const out = await call(calibrationHandler, { q: `${primera.slice(0, 8)} ${ultima.slice(0, 8)}`, state: 'all', limit: '20' });
    expect(out.status).toBe(200);
    expect(out.body.pieces.map((p: { piece_id: string }) => p.piece_id).sort()).toEqual([primera, ultima].sort());
    expect(out.body.search).toMatchObject({ matched: 2, missing: [] });
  });

  it('Calibración: «Carrusel» de cualquier plataforma y combinado con una', async () => {
    const todas = await call(calibrationHandler, { carousel: '1', state: 'all', limit: '200' });
    expect(todas.body.pieces).toHaveLength(6);
    expect(todas.body.carousels).toBe(6);
    const unaPlataforma = await call(calibrationHandler, { carousel: '1', platform: PLATAFORMA_N1, state: 'all', limit: '200' });
    expect(unaPlataforma.body.pieces.every((p: { platform: string }) => p.platform === PLATAFORMA_N1)).toBe(true);
    expect(unaPlataforma.body.pieces).toHaveLength(4);
    // Las opciones de plataforma siguen saliendo del dato: el carrusel no entra como plataforma.
    expect(todas.body.platforms).toEqual([OTRA_PLATAFORMA, PLATAFORMA_N1]);
  });

  it('Publicación: varias piezas y carruseles', async () => {
    const out = await call(publishHandler, { q: `${primera.slice(0, 8)},${ultima.slice(0, 8)}`, limit: '20' });
    expect(out.status).toBe(200);
    expect(out.body.pieces.map((p: { piece_id: string }) => p.piece_id).sort()).toEqual([primera, ultima].sort());
    const car = await call(publishHandler, { carousel: '1', limit: '200' });
    expect(car.body.pieces).toHaveLength(6);
  });

  it('un id inválido es un 400 que lo nombra, en las tres', async () => {
    for (const h of [historyHandler, calibrationHandler, publishHandler]) {
      const out = await call(h, { q: `${primera.slice(0, 8)}, 6bb3` });
      expect(out.status).toBe(400);
      expect(out.body).toMatchObject({ error: 'search_too_short', terms: ['6bb3'] });
    }
  });
});

// ── 5 · lo que fijan los endpoints, leído en la fuente ───────────────────────────
const soloCodigo = (src: string) => src.split('\n')
  .filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('{/*'); })
  .join('\n');
const leer = (f: string) => soloCodigo(readFileSync(new URL(f, import.meta.url), 'utf8'));

describe('las cuatro bandejas comparten parser, resumen y error', () => {
  const BANDEJAS = ['./calibration-queue.ts', './publish-queue.ts', './challenged-queue.ts', './evaluated-history.ts'];
  it('todas responden con `searchSummary` y `searchErrorBody`', () => {
    for (const f of BANDEJAS) {
      const src = leer(f);
      expect(src, f).toContain('searchSummary(search, ');
      expect(src, f).toContain('searchErrorBody(err)');
    }
  });

  it('el filtro de carrusel usa el criterio compartido, nunca el literal del formato', () => {
    for (const f of ['./calibration-queue.ts', './publish-queue.ts', './evaluated-history.ts']) {
      const src = leer(f);
      expect(src, f).not.toMatch(/['"]carousel['"]/);
    }
    expect(leer('./calibration-queue.ts')).toContain('isCarouselContentPiece(p)');
    expect(leer('./publish-queue.ts')).toContain('isCarouselContentPiece(p)');
    expect(leer('./evaluated-history.ts')).toContain('fetchCarouselPieceIds()');
  });

  it('el carrusel filtra ANTES de contar marcas y antes de paginar', () => {
    for (const f of ['./calibration-queue.ts', './publish-queue.ts']) {
      const src = leer(f);
      const filtro = src.indexOf('if (carousel) scoped = scoped.filter');
      expect(filtro, f).toBeGreaterThan(-1);
      expect(filtro, f).toBeLessThan(src.indexOf('by_brand: Record<string, number>'));
      expect(filtro, f).toBeLessThan(src.indexOf('.slice(offset, offset + limit)'));
    }
  });

  it('el front usa el mismo parser que el server y un solo componente de búsqueda', () => {
    const UI = readFileSync(new URL('../src/modules/iid/pieceUi.tsx', import.meta.url), 'utf8');
    expect(UI).toContain("from '../../../api/_pieceSearch'");
    expect(UI).toMatch(/<textarea/);
    const MODS = ['ApprovalCalibrationModule', 'PublishQueueModule', 'EvaluatedHistoryModule', 'ChallengedInboxModule']
      .map((m) => readFileSync(new URL(`../src/modules/iid/${m}.tsx`, import.meta.url), 'utf8'));
    for (const m of MODS) expect(m).not.toMatch(/parsePieceSearch|splitSearchTerms/);
  });
});

describe('multimarca — cero marcas y cero plataformas en lo que este cambio escribe', () => {
  const MARCAS = /NeuroneSCF|ForumPHs|LucienSael|UnrealvilleStudio|SamPublisher|D7Herbal|VivoseMask|VizosCosmetics|DiamondDetails|PatriciaOsorio/;
  const PLATAFORMAS = /['"](meta_ig|meta_fb|tiktok|instagram|facebook|linkedin|blog)['"]/i;
  it('ni el parser, ni los endpoints, ni los componentes nombran una marca o una plataforma', () => {
    for (const f of ['./_pieceSearch.ts', './calibration-queue.ts', './publish-queue.ts', './evaluated-history.ts', './challenged-queue.ts']) {
      const src = leer(f);
      expect(src, f).not.toMatch(MARCAS);
      expect(src, f).not.toMatch(PLATAFORMAS);
    }
    const UI = soloCodigo(readFileSync(new URL('../src/modules/iid/pieceUi.tsx', import.meta.url), 'utf8'));
    expect(UI).not.toMatch(MARCAS);
  });
});
