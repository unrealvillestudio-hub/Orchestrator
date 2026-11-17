/**
 * EL ESTADO DE UN ESTILO DE TEXTO (Sam, 2026-11-17: sólo admin, vale para todas las marcas, incluye «Retirar», se
 * registra quién y cuándo). Cubre las transiciones, qué fila se cambia, los retirados, la lista en pantalla y el
 * endpoint con la base y la sesión simuladas: un no-admin no escribe, la escritura lleva ancla y deja autor y fecha.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { nextPresetStatus, presetRowToChange, retiredPresetsOf, groupPresets } from './_pieceText';
import { withPresetStatus } from '../src/modules/iid/OnScreenTextEditor';
import handler from './text-preset-status';

describe('transiciones del estado', () => {
  it('validar sólo desde propuesto', () => {
    expect(nextPresetStatus('validate', 'proposed')).toEqual({ ok: true, status: 'validated_by_judgment' });
    expect(nextPresetStatus('validate', 'validated_by_data').ok).toBe(false);
    expect(nextPresetStatus('validate', 'retired').ok).toBe(false);
  });
  it('retirar desde cualquiera menos retirado', () => {
    for (const st of ['proposed', 'validated_by_judgment', 'validated_by_data']) expect(nextPresetStatus('retire', st)).toEqual({ ok: true, status: 'retired' });
    expect(nextPresetStatus('retire', 'retired').ok).toBe(false);
  });
  it('reactivar sólo desde retirado, y vuelve a propuesto', () => {
    expect(nextPresetStatus('reactivate', 'retired')).toEqual({ ok: true, status: 'proposed' });
    expect(nextPresetStatus('reactivate', 'proposed').ok).toBe(false);
  });
  it('una acción desconocida no pasa', () => {
    expect(nextPresetStatus('borrar', 'proposed').ok).toBe(false);
  });
});

const FILAS = [
  { id: 's1', preset_key: 'k1', layer: 'hook', name: 'Uno', brand_id: null, active: true, status: 'proposed', sort: 1 },
  { id: 's2', preset_key: 'k2', layer: 'hook', name: 'Dos', brand_id: null, active: true, status: 'retired', sort: 2 },
  { id: 'b2', preset_key: 'k3', layer: 'cta', name: 'Tres de marca', brand_id: 'MarcaA', active: true, status: 'retired', sort: 3 },
  { id: 'o9', preset_key: 'k4', layer: 'cta', name: 'De otra marca', brand_id: 'MarcaB', active: true, status: 'retired', sort: 4 },
];

describe('qué fila se cambia y qué se reactiva', () => {
  it('sin fila de marca, la de sistema (vale para todas las marcas)', () => {
    expect(presetRowToChange(FILAS, 'k1', 'MarcaA')?.id).toBe('s1');
  });
  it('con fila de marca, la de la marca: la misma que muestra el selector', () => {
    const conMarca = [...FILAS, { id: 'm1', preset_key: 'k1', layer: 'hook', brand_id: 'MarcaA', active: true, status: 'proposed' }];
    expect(presetRowToChange(conMarca, 'k1', 'MarcaA')?.id).toBe('m1');
    expect(groupPresets(conMarca, 'MarcaA').hook.find((p) => p.preset_key === 'k1')?.brand_override).toBe(true);
  });
  it('nunca la fila de otra marca', () => {
    expect(presetRowToChange(FILAS, 'k4', 'MarcaA')).toBeNull();
  });
  it('los retirados: los de sistema y los de la marca, no los de otra marca', () => {
    expect(retiredPresetsOf(FILAS, 'MarcaA').map((p) => p.preset_key).sort()).toEqual(['k2', 'k3']);
  });
  it('un retirado que tiene otra fila viva no aparece como retirado', () => {
    const viva = [...FILAS, { id: 'm2', preset_key: 'k2', layer: 'hook', brand_id: 'MarcaA', active: true, status: 'proposed' }];
    expect(retiredPresetsOf(viva, 'MarcaA').map((p) => p.preset_key)).toEqual(['k3']);
  });
});

describe('la lista en pantalla cambia sin volver a pedir propuestas', () => {
  const prop = { presets: groupPresets(FILAS, 'MarcaA'), retired_presets: retiredPresetsOf(FILAS, 'MarcaA') } as any;
  it('validar cambia el estado en su sitio', () => {
    const p = withPresetStatus(prop, 'k1', 'validated_by_judgment');
    expect(p.presets!.hook.find((x) => x.preset_key === 'k1')?.status).toBe('validated_by_judgment');
  });
  it('retirar lo saca de la capa y lo pasa a retirados; reactivar lo devuelve', () => {
    const r = withPresetStatus(prop, 'k1', 'retired');
    expect(r.presets!.hook.map((x) => x.preset_key)).not.toContain('k1');
    expect(r.retired_presets!.map((x) => x.preset_key)).toContain('k1');
    const back = withPresetStatus(r, 'k1', 'proposed');
    expect(back.presets!.hook.map((x) => x.preset_key)).toContain('k1');
    expect(back.retired_presets!.map((x) => x.preset_key)).not.toContain('k1');
  });
});

// ── El endpoint, con la base y la sesión simuladas ──────────────────────────────────────────
const SECRET = 'secreto-de-prueba';
const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function token(payload: Record<string, unknown>): string {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${h}.${p}.${b64u(createHmac('sha256', SECRET).update(`${h}.${p}`).digest())}`;
}
function fakeRes() {
  const out: { status?: number; body?: any } = {};
  const res = { status(c: number) { out.status = c; return res; }, json(b: unknown) { out.body = b; return res; }, setHeader() { return res; }, end() { return res; } } as unknown as VercelResponse;
  return { res, out };
}
const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const pedido = (body: Record<string, unknown>, role = 'admin') =>
  ({ method: 'POST', headers: { authorization: `Bearer ${token({ sub: role === 'admin' ? 'sam' : 'operadora', role, brand_scope: role === 'admin' ? ['*'] : ['MarcaA'] })}` }, body, query: {} }) as unknown as VercelRequest;

describe('POST /api/text-preset-status', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://proyecto.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role');
    vi.stubEnv('ORCHESTRATOR_NSCF_IID_INTEL_JWT_SECRET', SECRET);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('un admin valida: escribe estado, autor y fecha, con ancla en el estado leído', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [FILAS[0]])).mockResolvedValueOnce(jsonResponse(200, [{ id: 's1' }]));
    const { res, out } = fakeRes();
    await handler(pedido({ preset_key: 'k1', brand_id: 'MarcaA', action: 'validate' }), res);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, status: 'validated_by_judgment', status_changed_by: 'sam' });
    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toContain('id=eq.s1');
    expect(String(url)).toContain('status=eq.proposed');
    expect(init.method).toBe('PATCH');
    const escrito = JSON.parse(init.body);
    expect(escrito.status).toBe('validated_by_judgment');
    expect(escrito.status_changed_by).toBe('sam');
    expect(typeof escrito.status_changed_at).toBe('string');
  });

  it('quien no es admin recibe 403 y no se escribe nada', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, [{ brand_id: 'MarcaA', views: ['calibration'] }]));
    const { res, out } = fakeRes();
    await handler(pedido({ preset_key: 'k1', brand_id: 'MarcaA', action: 'validate' }, 'seeder'), res);
    expect(out.status).toBe(403);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('una transición imposible responde 409 sin escribir', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [FILAS[1]]));
    const { res, out } = fakeRes();
    await handler(pedido({ preset_key: 'k2', brand_id: 'MarcaA', action: 'validate' }), res);
    expect(out.status).toBe(409);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('si otra mano cambió el estado entretanto, 409 y no se pisa', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [FILAS[0]])).mockResolvedValueOnce(jsonResponse(200, []));
    const { res, out } = fakeRes();
    await handler(pedido({ preset_key: 'k1', brand_id: 'MarcaA', action: 'retire' }), res);
    expect(out.status).toBe(409);
    expect(out.body.error).toBe('status_changed');
  });

  it('acción desconocida o datos que faltan: 400', async () => {
    const a = fakeRes(); await handler(pedido({ preset_key: 'k1', brand_id: 'MarcaA', action: 'borrar' }), a.res);
    const b = fakeRes(); await handler(pedido({ brand_id: 'MarcaA', action: 'validate' }), b.res);
    expect([a.out.status, b.out.status]).toEqual([400, 400]);
  });
});

describe('sin marcas en el código', () => {
  it('ni el endpoint ni las funciones nombran una marca', () => {
    const MARCAS = /NeuroneSCF|ForumPHs|LucienSael|SamPublisher|D7Herbal|VivoseMask|VizosCosmetics|DiamondDetails|PatriciaOsorio/i;
    for (const f of ['api/text-preset-status.ts', 'api/_pieceText.ts']) expect(readFileSync(f, 'utf8')).not.toMatch(MARCAS);
  });
});
