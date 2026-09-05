import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  indexBrandTimezones, indexByPiece, indexNextFree, timezoneOf, slotOf, forecastFor,
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

  it('este módulo no escribe: nada de POST, PATCH, DELETE ni upsert', () => {
    expect(SRC).not.toMatch(/method:\s*'(POST|PATCH|PUT|DELETE)'/);
    expect(SRC).not.toMatch(/\bupsert\b/i);
  });
});
