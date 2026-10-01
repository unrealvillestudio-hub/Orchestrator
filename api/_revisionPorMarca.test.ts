import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  TODAS, effectiveReviewScope, filterByReviewScope, inReviewScope, signerOf,
  requireReviewer, guardPiece, type Reviewer,
} from './_reviewScope.js';

/**
 * REVISIÓN POR MARCA (2026-10-01) — un operador que no es admin trabaja las bandejas de Sam, pero
 * sólo en las marcas que tiene asignadas para revisar. Lo que estas pruebas fijan:
 *   1. el alcance es la intersección de lo asignado y su `brand_scope`, y sin asignación no hay nada;
 *   2. admin no cambia: ve todo y no paga ninguna lectura más;
 *   3. una pieza de otra marca no se lee ni se toca, y el veredicto se firma con la sesión;
 *   4. todas las bandejas pasan por la puerta nueva, y el Historial sigue siendo sólo de admin.
 * Las marcas de abajo son datos de prueba, no ramas del código.
 */

// ── 1 · el alcance ──────────────────────────────────────────────────────────────
describe('effectiveReviewScope', () => {
  it('admin revisa todo, sin mirar la tabla', () => {
    expect(effectiveReviewScope('admin', [], null)).toBe(TODAS);
  });
  it('sin filas asignadas, o sin poder leerlas, no revisa nada (fail-closed)', () => {
    expect(effectiveReviewScope('seeder', ['MarcaA'], [])).toBeNull();
    expect(effectiveReviewScope('seeder', ['MarcaA'], null)).toBeNull();
  });
  it('es la intersección de lo asignado y su brand_scope', () => {
    expect(effectiveReviewScope('seeder', ['MarcaA', 'MarcaB', 'MarcaC'], ['MarcaA'])).toEqual(['MarcaA']);
    expect(effectiveReviewScope('seeder', ['MarcaB'], ['MarcaA'])).toBeNull();
  });
  it("con brand_scope '*' vale lo asignado, sin duplicados", () => {
    expect(effectiveReviewScope('seeder', ['*'], ['MarcaA', 'MarcaA', ' MarcaB '])).toEqual(['MarcaA', 'MarcaB']);
  });
});

describe('filterByReviewScope / inReviewScope', () => {
  const filas = [{ brand_id: 'MarcaA', n: 1 }, { brand_id: 'MarcaB', n: 2 }];
  it('con TODAS devuelve el mismo array: el camino de admin no cambia', () => {
    expect(filterByReviewScope(filas, TODAS)).toBe(filas);
  });
  it('con una lista deja sólo sus marcas', () => {
    expect(filterByReviewScope(filas, ['MarcaB']).map((f) => f.n)).toEqual([2]);
  });
  it('una pieza sin marca nunca está en el alcance de un revisor', () => {
    expect(inReviewScope(['MarcaA'], null)).toBe(false);
    expect(inReviewScope(TODAS, null)).toBe(true);
  });
});

describe('signerOf', () => {
  const revisor = { sub: 'revisora', role: 'seeder', brand_scope: ['MarcaA'], review: ['MarcaA'] } as Reviewer;
  const admin = { sub: 'sam', role: 'admin', brand_scope: ['*'], review: TODAS } as Reviewer;
  it('un revisor firma siempre con su sesión, diga lo que diga el body', () => {
    expect(signerOf(revisor, 'sam')).toBe('revisora');
  });
  it('admin conserva lo de antes: puede declarar el evaluador', () => {
    expect(signerOf(admin, 'otro')).toBe('otro');
    expect(signerOf(admin, '')).toBe('sam');
  });
});

// ── 2 y 3 · la puerta y la guarda, con la red simulada ──────────────────────────
const SECRET = 'secreto-de-prueba';
const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function token(payload: Record<string, unknown>): string {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 3600 }));
  const s = b64u(createHmac('sha256', SECRET).update(`${h}.${p}`).digest());
  return `${h}.${p}.${s}`;
}
function fakeRes() {
  const out: { status?: number; body?: any } = {};
  const res = {
    status(c: number) { out.status = c; return res; },
    json(b: unknown) { out.body = b; return res; },
  } as unknown as VercelResponse;
  return { res, out };
}
const req = {} as VercelRequest;
const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('requireReviewer y guardPiece', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://proyecto.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role');
    vi.stubEnv('ORCHESTRATOR_NSCF_IID_INTEL_JWT_SECRET', SECRET);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('admin entra con TODAS y sin ninguna lectura a la base de datos', async () => {
    const { res } = fakeRes();
    const s = await requireReviewer(req, res, token({ sub: 'sam', role: 'admin', brand_scope: ['*'] }));
    expect(s?.review).toBe(TODAS);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await guardPiece(res, s!, 'cualquier-pieza')).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un revisor entra con sus marcas asignadas, recortadas por su brand_scope', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [{ brand_id: 'MarcaA' }, { brand_id: 'MarcaZ' }]));
    const { res } = fakeRes();
    const s = await requireReviewer(req, res, token({ sub: 'revisora', role: 'seeder', brand_scope: ['MarcaA', 'MarcaB'] }));
    expect(s?.review).toEqual(['MarcaA']);
    expect(String(fetchMock.mock.calls[0][0])).toContain('operator_review_scope?operator_sub=eq.revisora');
  });

  it('sin la tabla (404 de PostgREST) un revisor recibe 403', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { code: '42P01' }));
    const { res, out } = fakeRes();
    const s = await requireReviewer(req, res, token({ sub: 'revisora', role: 'seeder', brand_scope: ['MarcaA'] }));
    expect(s).toBeNull();
    expect(out.status).toBe(403);
  });

  it('una pieza de otra marca: 403, y una de la suya pasa', async () => {
    const revisor = { sub: 'revisora', role: 'seeder', brand_scope: ['MarcaA'], review: ['MarcaA'] } as Reviewer;
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [{ brand_id: 'MarcaB' }]));
    const a = fakeRes();
    expect(await guardPiece(a.res, revisor, 'pieza-b')).toBe(false);
    expect(a.out.status).toBe(403);

    fetchMock.mockResolvedValueOnce(jsonResponse(200, [{ brand_id: 'MarcaA' }]));
    const b = fakeRes();
    expect(await guardPiece(b.res, revisor, 'pieza-a')).toBe(true);

    fetchMock.mockResolvedValueOnce(jsonResponse(200, []));
    const c = fakeRes();
    expect(await guardPiece(c.res, revisor, 'no-existe')).toBe(false);
    expect(c.out.status).toBe(404);
  });
});

// ── 4 · el cableado, sobre la fuente que se compila ─────────────────────────────
const fuente = (f: string) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
const sinComentarios = (src: string) => src.split('\n')
  .filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*'); })
  .join('\n');

describe('cada bandeja pasa por la puerta nueva', () => {
  const LECTURAS = ['calibration-queue.ts', 'publish-queue.ts', 'challenged-queue.ts', 'manual-queue.ts'];
  const POR_PIEZA = ['preview-render.ts', 'recompose-image.ts', 'calibration-verdict.ts', 'calibration-discard.ts', 'piece-edit.ts'];
  const POR_FILA = ['challenge-verdict.ts', 'manual-published.ts'];

  for (const f of [...LECTURAS, ...POR_PIEZA, ...POR_FILA, 'review-scope.ts']) {
    it(`${f} usa requireReviewer y no requireAdmin`, () => {
      const c = sinComentarios(fuente(f));
      expect(c).toContain('requireReviewer(');
      expect(c).not.toContain('requireAdmin(');
    });
  }
  for (const f of LECTURAS) {
    it(`${f} filtra por el alcance antes de contar`, () => {
      expect(sinComentarios(fuente(f))).toContain('filterByReviewScope(');
    });
  }
  for (const f of POR_PIEZA) {
    it(`${f} comprueba la marca de la pieza`, () => {
      expect(sinComentarios(fuente(f))).toContain('guardPiece(');
    });
  }
  for (const f of POR_FILA) {
    it(`${f} comprueba la marca de la fila`, () => {
      expect(sinComentarios(fuente(f))).toContain('inReviewScope(');
    });
  }
  it('calibration-verdict firma con signerOf: un revisor no puede firmar como otro', () => {
    expect(sinComentarios(fuente('calibration-verdict.ts'))).toContain('signerOf(session, body.evaluated_by)');
  });
  it('el Historial sigue siendo sólo de admin', () => {
    expect(sinComentarios(fuente('evaluated-history.ts'))).toContain('requireAdmin(');
  });
});
