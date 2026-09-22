import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  indexBrandTimezones, indexByPiece, indexNextFree, timezoneOf, slotOf, forecastFor,
  releaseSlotsForPiece, urgentChannels, isUrgentPiece,
  type PublishSlotRow,
} from './_publishSlots.js';
import type { ContentPiece } from './_calibrationShared.js';

/**
 * PR-C — CUÁNDO SALE UNA PIEZA.
 *
 * Lo que estas pruebas fijan no es el formato de una fecha: es que la fecha salga del DATO.
 * Un desfase cableado también haría aparecer la hora, y acertaría hasta el cambio de horario.
 *
 * Los identificadores de las fixtures son ficticios a propósito: si algo dependiera del
 * nombre de una marca, de un canal o de un huso reales, estas pruebas fallarían.
 */

// ── Fixtures ─────────────────────────────────────────────────────────────────────
const BRAND_A = 'BrandAlpha';
const BRAND_B = 'BrandBeta';
const CHANNEL_ONE = 'surface_one';
const CHANNEL_TWO = 'surface_two';
// Husos ficticios pero válidos como forma IANA: lo que se prueba es que viajen tal cual,
// no que el motor los sepa resolver (eso es de la pantalla, y tiene su propia prueba).
const ZONE_A = 'Region/CityOne';
const ZONE_B = 'Region/City_Two';

function piece(over: Partial<ContentPiece> = {}): ContentPiece {
  return { id: 'p-1', brand_id: BRAND_A, platform: CHANNEL_ONE, ...over };
}
function slot(over: Partial<PublishSlotRow> = {}): PublishSlotRow {
  return {
    brand_id: BRAND_A, platform_key: CHANNEL_ONE,
    slot_at: '2026-09-08T17:30:00+00:00', status: 'free', piece_id: null,
    ...over,
  };
}

const ZONES = indexBrandTimezones([
  { id: BRAND_A, publish_timezone: ZONE_A },
  { id: BRAND_B, publish_timezone: ZONE_B },
  // Marca sin huso sembrado: existe la fila, la columna está vacía.
  { id: 'BrandGamma', publish_timezone: null },
]);

// ── El huso sale del catálogo, nunca del código ──────────────────────────────────
describe('el huso es dato', () => {
  it('cada marca lleva el suyo, y dos marcas distintas dan dos husos distintos', () => {
    expect(timezoneOf(BRAND_A, ZONES)).toBe(ZONE_A);
    expect(timezoneOf(BRAND_B, ZONES)).toBe(ZONE_B);
  });

  it('marca con la columna vacía → null: no se hereda el de otra marca ni se supone uno', () => {
    expect(timezoneOf('BrandGamma', ZONES)).toBeNull();
  });

  it('marca que no está en el catálogo → null', () => {
    expect(timezoneOf('BrandDelta', ZONES)).toBeNull();
  });

  it('catálogo ilegible → null para todas: sin dato no se sitúa ninguna hora', () => {
    expect(timezoneOf(BRAND_A, null)).toBeNull();
  });
});

// ── La franja RESERVADA: el compromiso ───────────────────────────────────────────
describe('slotOf — el compromiso', () => {
  const SLOTS = indexByPiece([
    slot({ piece_id: 'p-1', status: 'reserved', slot_at: '2026-09-08T17:30:00+00:00' }),
  ]);

  it('pieza con franja → instante, estado y el huso de SU marca', () => {
    const s = slotOf(piece(), SLOTS, ZONES);
    expect(s).toEqual({ slot_at: '2026-09-08T17:30:00+00:00', status: 'reserved', timezone: ZONE_A });
  });

  it('pieza sin franja → null, que es un estado real y no un hueco de datos', () => {
    expect(slotOf(piece({ id: 'p-2' }), SLOTS, ZONES)).toBeNull();
  });

  it('la franja se muestra aunque falte el huso: la ausencia viaja declarada, no oculta la fecha', () => {
    const s = slotOf(piece({ brand_id: 'BrandGamma' }), SLOTS, ZONES);
    expect(s?.slot_at).toBe('2026-09-08T17:30:00+00:00');
    expect(s?.timezone).toBeNull();
  });

  it('una pieza no puede quedar con dos franjas: gana la primera y no se pintan dos fechas', () => {
    const dobles = indexByPiece([
      slot({ piece_id: 'p-1', status: 'reserved', slot_at: '2026-09-08T17:30:00+00:00' }),
      slot({ piece_id: 'p-1', status: 'reserved', slot_at: '2026-09-09T17:30:00+00:00' }),
    ]);
    expect(slotOf(piece(), dobles, ZONES)?.slot_at).toBe('2026-09-08T17:30:00+00:00');
  });
});

// ── La PREVISIÓN: no es lo mismo, y por eso no se llama igual ────────────────────
describe('forecastFor — la previsión', () => {
  const LIBRES = indexNextFree([
    slot({ slot_at: '2026-09-20T15:00:00+00:00' }),
    slot({ slot_at: '2026-09-10T15:00:00+00:00' }),                       // la más temprana
    slot({ platform_key: CHANNEL_TWO, slot_at: '2026-09-11T15:00:00+00:00' }),
    slot({ brand_id: BRAND_B, slot_at: '2026-09-09T15:00:00+00:00' }),
  ]);

  it('devuelve la franja libre MÁS TEMPRANA de la marca × canal de la pieza', () => {
    expect(forecastFor(piece(), LIBRES, ZONES)).toEqual({
      slot_at: '2026-09-10T15:00:00+00:00', timezone: ZONE_A,
    });
  });

  it('el orden no se confía a la consulta: una respuesta desordenada no da una previsión falsa', () => {
    const desordenado = indexNextFree([
      slot({ slot_at: '2026-09-20T15:00:00+00:00' }),
      slot({ slot_at: '2026-09-10T15:00:00+00:00' }),
    ]);
    expect(desordenado.size).toBe(1);
    expect(forecastFor(piece(), desordenado, ZONES)?.slot_at).toBe('2026-09-10T15:00:00+00:00');
  });

  it('cada canal tiene la suya: dos canales de la misma marca no comparten previsión', () => {
    expect(forecastFor(piece({ platform: CHANNEL_TWO }), LIBRES, ZONES)?.slot_at)
      .toBe('2026-09-11T15:00:00+00:00');
  });

  it('cada marca tiene la suya, con SU huso: es la prueba de que el huso sale del dato', () => {
    const a = forecastFor(piece(), LIBRES, ZONES);
    const b = forecastFor(piece({ brand_id: BRAND_B }), LIBRES, ZONES);
    expect(a?.timezone).toBe(ZONE_A);
    expect(b?.timezone).toBe(ZONE_B);
    expect(a?.timezone).not.toBe(b?.timezone);
  });

  it('canal sin franja libre → null: es información sobre el canal, no un error', () => {
    expect(forecastFor(piece({ platform: 'surface_sin_politica' }), LIBRES, ZONES)).toBeNull();
  });

  it('pieza que no declara canal → null: no se le adivina un canal para darle fecha', () => {
    expect(forecastFor(piece({ platform: null }), LIBRES, ZONES)).toBeNull();
  });

  it('sin franjas libres → null para todas', () => {
    expect(forecastFor(piece(), new Map(), ZONES)).toBeNull();
  });
});

// ── Lo que no puede estar escrito en este archivo ────────────────────────────────
const SRC = readFileSync(new URL('./_publishSlots.ts', import.meta.url), 'utf8');

describe('ni un huso, ni un desfase, ni una marca en el código', () => {
  it('no aparece ningún nombre IANA real', () => {
    // Un `America/...` cableado ataría la fecha a una región; el huso es dato de la marca.
    expect(SRC).not.toMatch(/\b(America|Europe|Asia|Africa|Australia|Pacific|Atlantic|Indian)\//);
  });

  it('no aparece ningún desfase horario', () => {
    // Un desfase acertaría hasta el cambio de horario y luego mentiría en silencio. El
    // `CHECK` de producción ya los rechaza en la base por ese mismo motivo.
    const CODE = SRC.split('\n')
      .filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*'); })
      .join('\n');
    expect(CODE).not.toMatch(/[+-]\d{2}:\d{2}/);
  });

  it('no aparece ninguna marca ni ningún canal del ecosistema', () => {
    for (const nombre of ['NeuroneSCF', 'ForumPHs', 'LucienSael', 'UnrealvilleStudio', 'meta_ig', 'meta_fb', 'tiktok'])
      expect(SRC).not.toContain(nombre);
  });

  // U-3 CAMBIÓ ESTE CASO, Y SE DEJA ESCRITO POR QUÉ. Hasta U-3 el módulo no escribía nada y
  // este caso lo fijaba con `not.toMatch(/method:\s*'(POST|PATCH|PUT|DELETE)'/)`. La
  // liberación de franja lo vuelve falso por construcción. Borrarlo habría quitado la
  // protección entera; lo que se hace es ACOTARLO a lo que sigue siendo cierto y que es más
  // estrecho que antes: existe UNA escritura, es un PATCH, y va contra la tabla de franjas.
  // Un POST, un DELETE, un segundo PATCH o un upsert siguen siendo fallo.
  it('la ÚNICA escritura es el PATCH de liberación: ni POST, ni DELETE, ni upsert', () => {
    const escrituras = SRC.match(/method:\s*'(POST|PATCH|PUT|DELETE)'/g) ?? [];
    expect(escrituras).toEqual(["method: 'PATCH'"]);
    expect(SRC).not.toMatch(/\bupsert\b/i);
  });

  it('esa escritura sólo puede tocar franjas, nunca piezas', () => {
    // El PATCH apunta a `brand_publish_slots`. Que este módulo escribiera en `content_pieces`
    // sería invertir el orden que U-3 fija: la pieza la sella el llamador, ANTES.
    expect(SRC).toContain('/rest/v1/brand_publish_slots');
    expect(SRC).not.toMatch(/method:\s*'PATCH'[\s\S]{0,600}content_pieces/);
  });
});

// ── U-3 · LA LIBERACIÓN DE FRANJA ────────────────────────────────────────────────
/**
 * Sin red y sin base: `fetch` va doblado. Lo que se fija acá no es que PostgREST responda
 * —eso sólo se sabe contra la base real, y su verificación es la del brief—, sino que la
 * petición que sale es la correcta y que NINGÚN fallo escapa hacia el llamador.
 *
 * El `piece_id` de las fixtures es ficticio: si algo dependiera de una pieza o una marca
 * reales, estas pruebas fallarían.
 */
const PIEZA = 'piece-ficticia-0001';

function doblarFetch(impl: (url: string, init: RequestInit) => unknown) {
  const llamadas: Array<{ url: string; init: RequestInit }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string, init: RequestInit) => {
    llamadas.push({ url: String(url), init });
    return Promise.resolve(impl(String(url), init));
  }) as unknown as typeof fetch;
  return { llamadas, restaurar: () => { globalThis.fetch = original; } };
}

const respuesta = (status: number, cuerpo: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => cuerpo,
  text: async () => (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)),
});

describe('releaseSlotsForPiece — devolver la franja al pozo', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://proyecto-ficticio.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-ficticia';
  });

  it('el PATCH va bien formado: filtra por pieza Y por reserved, y declara Content-Profile', async () => {
    const d = doblarFetch(() => respuesta(200, [{ id: 'slot-1' }]));
    try {
      await releaseSlotsForPiece(PIEZA);
      expect(d.llamadas).toHaveLength(1);
      const { url, init } = d.llamadas[0];

      expect(url).toContain(`piece_id=eq.${PIEZA}`);
      // El filtro por `reserved` es lo que impide pisar una franja ya publicada.
      expect(url).toContain('status=eq.reserved');
      expect(init.method).toBe('PATCH');

      // `Accept-Profile` gobierna la lectura; una ESCRITURA contra `intel` necesita además
      // `Content-Profile`. Sin esta cabecera el PATCH se iría contra el schema por defecto.
      const headers = init.headers as Record<string, string>;
      expect(headers['Content-Profile']).toBe('intel');
      expect(headers['Accept-Profile']).toBe('intel');

      // Los tres campos viajan JUNTOS: el CHECK de la tabla rechaza la fila si falta uno.
      expect(JSON.parse(String(init.body))).toEqual({ status: 'free', piece_id: null, reserved_at: null });
    } finally { d.restaurar(); }
  });

  it('dos franjas devueltas → released 2, y dice cuáles', async () => {
    const d = doblarFetch(() => respuesta(200, [{ id: 'slot-1' }, { id: 'slot-2' }]));
    try {
      expect(await releaseSlotsForPiece(PIEZA))
        .toEqual({ ok: true, released: 2, slot_ids: ['slot-1', 'slot-2'] });
    } finally { d.restaurar(); }
  });

  it('cero franjas NO es error: una pieza puede no tener franja', async () => {
    const d = doblarFetch(() => respuesta(200, []));
    try {
      const r = await releaseSlotsForPiece(PIEZA);
      expect(r.ok).toBe(true);
      expect(r.released).toBe(0);
      expect(r.error).toBeUndefined();
    } finally { d.restaurar(); }
  });

  it('400 de PostgREST → ok false, con el cuerpo del servidor recortado en error', async () => {
    const d = doblarFetch(() => respuesta(400, 'violates check constraint'));
    try {
      const r = await releaseSlotsForPiece(PIEZA);
      expect(r.ok).toBe(false);
      expect(r.released).toBe(0);
      expect(r.error).toContain('400');
      expect(r.error).toContain('violates check constraint');
    } finally { d.restaurar(); }
  });

  it('fetch que lanza → ok false, y la excepción NO escapa hacia el llamador', async () => {
    // Importa que no escape: el llamador ya selló la pieza, y una excepción acá convertiría
    // un veredicto aplicado en un 500 que afirma que no se hizo nada.
    const d = doblarFetch(() => { throw new Error('socket colgado'); });
    try {
      const r = await releaseSlotsForPiece(PIEZA);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/^red: /);
      expect(r.error).toContain('socket colgado');
    } finally { d.restaurar(); }
  });

  it('piece_id vacío → ok false sin llamar a fetch: no se manda un PATCH sin ancla', async () => {
    const d = doblarFetch(() => respuesta(200, []));
    try {
      const r = await releaseSlotsForPiece('   ');
      expect(r).toEqual({ ok: false, released: 0, slot_ids: [], error: 'piece_id vacío' });
      expect(d.llamadas).toHaveLength(0);
    } finally { d.restaurar(); }
  });
});

// ── U-9 · LO URGENTE ES DEL CANAL, NO DE LA PIEZA ───────────────────────────────
//
// Sam definió urgente como «la franja cerca, las próximas 24-48 horas». La lectura literal era
// filtrar por la PREVISIÓN de cada pieza, y esa previsión devuelve la MISMA franja para todas las
// pendientes del canal: con 12 candidatas habría marcado las doce. Un filtro que marca todo no
// filtra, y además dice «12 urgencias» cuando la decisión es una.
//
// Estas pruebas fijan el eje: una franja próxima hace urgente al CANAL, una vez.
describe('urgentChannels · la urgencia es del canal', () => {
  const AHORA = new Date('2026-09-22T12:00:00Z');
  const fila = (marca: string, canal: string, iso: string): PublishSlotRow => ({
    brand_id: marca, platform_key: canal, slot_at: iso, status: 'free', piece_id: null,
  });

  it('EL DEFECTO QUE EVITA: un canal con muchas candidatas aparece UNA vez', () => {
    // `indexNextFree` ya deja una fila por canal; lo que se fija acá es que la urgencia no
    // multiplique por pieza. El canal es uno, la franja es una, la decisión es una.
    const idx = indexNextFree([
      fila('Alfa', 'meta_ig', '2026-09-22T23:00:00Z'),
      fila('Alfa', 'meta_ig', '2026-09-24T23:00:00Z'),
    ]);
    const u = urgentChannels(idx, 48, AHORA);
    expect(u.size).toBe(1);
    expect([...u.values()][0].slot_at).toBe('2026-09-22T23:00:00Z');
  });

  it('fuera de la ventana no es urgente', () => {
    const idx = indexNextFree([fila('Alfa', 'blog', '2026-09-26T12:00:00Z')]);
    expect(urgentChannels(idx, 48, AHORA).size).toBe(0);
    expect(urgentChannels(idx, 168, AHORA).size).toBe(1);
  });

  it('una franja ya vencida tampoco: no queda nada que hacer con ella desde la bandeja', () => {
    const idx = indexNextFree([fila('Alfa', 'x', '2026-09-22T11:00:00Z')]);
    expect(urgentChannels(idx, 48, AHORA).size).toBe(0);
  });

  it('las horas que faltan se redondean HACIA ABAJO', () => {
    // 3 h 55 min son «faltan 3», no «faltan 4»: redondear hacia arriba da más margen del que hay.
    const idx = indexNextFree([fila('Alfa', 'meta_fb', '2026-09-22T15:55:00Z')]);
    expect([...urgentChannels(idx, 48, AHORA).values()][0].hours_left).toBe(3);
  });

  it('si la lectura de franjas se cayó, NADA es urgente — no TODO', () => {
    // Marcar de más enseña a ignorar el filtro, y un filtro ignorado no se recupera.
    expect(urgentChannels(null, 48, AHORA).size).toBe(0);
  });

  it('una fecha ilegible no es urgente: es un dato roto', () => {
    const idx = indexNextFree([fila('Alfa', 'blog', 'no-es-fecha')]);
    expect(urgentChannels(idx, 48, AHORA).size).toBe(0);
  });

  it('la ventana se acota: ni cero ni un año', () => {
    const idx = indexNextFree([fila('Alfa', 'blog', '2026-10-30T12:00:00Z')]);
    expect(urgentChannels(idx, 100_000, AHORA).size).toBe(0); // se topa en una semana
    const cerca = indexNextFree([fila('Alfa', 'blog', '2026-09-22T12:30:00Z')]);
    expect(urgentChannels(cerca, 0, AHORA).size).toBe(1);     // el suelo es 1 h, no 0
  });

  it('cada canal de la misma marca cuenta por separado', () => {
    const idx = indexNextFree([
      fila('Alfa', 'meta_ig', '2026-09-22T23:00:00Z'),
      fila('Alfa', 'meta_fb', '2026-09-23T13:00:00Z'),
    ]);
    expect(urgentChannels(idx, 48, AHORA).size).toBe(2);
  });
});

describe('isUrgentPiece · la pieza hereda la urgencia de su canal', () => {
  const AHORA = new Date('2026-09-22T12:00:00Z');
  const idx = indexNextFree([{
    brand_id: 'Alfa', platform_key: 'meta_ig', slot_at: '2026-09-22T23:00:00Z',
    status: 'free', piece_id: null,
  }]);
  const urgentes = urgentChannels(idx, 48, AHORA);

  it('dos piezas del mismo canal urgente lo son las dos: son candidatas, no urgencias distintas', () => {
    expect(isUrgentPiece({ brand_id: 'Alfa', platform: 'meta_ig' }, urgentes)).toBe(true);
    expect(isUrgentPiece({ brand_id: 'Alfa', platform: 'meta_ig' }, urgentes)).toBe(true);
  });

  it('otro canal de la misma marca no hereda nada', () => {
    expect(isUrgentPiece({ brand_id: 'Alfa', platform: 'meta_fb' }, urgentes)).toBe(false);
  });

  it('otra marca en el mismo canal tampoco', () => {
    expect(isUrgentPiece({ brand_id: 'Beta', platform: 'meta_ig' }, urgentes)).toBe(false);
  });

  it('una pieza sin marca o sin canal no es urgente por descarte', () => {
    expect(isUrgentPiece({ brand_id: 'Alfa', platform: null }, urgentes)).toBe(false);
    expect(isUrgentPiece({ brand_id: '', platform: 'meta_ig' }, urgentes)).toBe(false);
  });
});
