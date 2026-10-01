import { describe, it, expect } from 'vitest';
import {
  canonicalizeSignature, manualTextOf, manualImagesOf, buildManualItems, manualChannelKey,
  cleanPostLink, manualDrainRow,
  type ManualPieceInput, type ManualSlotRow,
} from './_manualShared.js';

// Identificadores ficticios a propósito: si la lógica dependiera de una marca o un canal reales,
// estas pruebas fallarían.
const BRAND = 'BrandAlpha';
const MANUAL = 'surface_manual';
const OTHER = 'surface_other';
const SIG = 'Firma — de la voz.';

function piece(over: Partial<ManualPieceInput> = {}, assets: ManualPieceInput['assets'] = {}): ManualPieceInput {
  return { id: 'p-1', brand_id: BRAND, platform: MANUAL, format: 'post', assets, ...over };
}

describe('canonicalizeSignature — misma regla que el drenaje', () => {
  it('pone la firma una sola vez, al final, detrás de los hashtags', () => {
    expect(canonicalizeSignature(`Cuerpo\n\n${SIG}\n\n#uno #dos`, SIG)).toBe(`Cuerpo\n\n#uno #dos\n\n${SIG}`);
  });
  it('es idempotente', () => {
    const una = canonicalizeSignature('Cuerpo', SIG);
    expect(canonicalizeSignature(una, SIG)).toBe(una);
  });
  it('sin firma declarada no toca el texto', () => {
    expect(canonicalizeSignature('Cuerpo', null)).toBe('Cuerpo');
  });
});

describe('manualTextOf — título + cuerpo + hashtags + firma en un bloque', () => {
  const assets = {
    copy: { title: 'El título', aife_filtered: 'Maestro #m', raw: 'Crudo' },
    social: { adapted: [{ platform: OTHER, copy: 'Otro canal' }, { platform: MANUAL, copy: 'Adaptado #tag' }] },
    builder_meta: { signature_closer: { text: SIG } },
  };
  it('usa el adaptado del canal de la franja y le pone título y firma', () => {
    expect(manualTextOf(piece({}, assets), MANUAL)).toBe(`El título\n\nAdaptado #tag\n\n${SIG}`);
  });
  it('acepta el adaptado serializado como cadena', () => {
    const a = { ...assets, social: { adapted: JSON.stringify(assets.social.adapted) } };
    expect(manualTextOf(piece({}, a), MANUAL)).toBe(`El título\n\nAdaptado #tag\n\n${SIG}`);
  });
  it('sin adaptado del canal cae al texto juzgado', () => {
    expect(manualTextOf(piece({}, assets), 'surface_sin_adaptado')).toBe(`El título\n\nMaestro #m\n\n${SIG}`);
  });
  it('no repite el título si el texto ya abre con él', () => {
    const a = { ...assets, social: { adapted: [{ platform: MANUAL, copy: 'El título\n\nCuerpo' }] } };
    expect(manualTextOf(piece({}, a), MANUAL)).toBe(`El título\n\nCuerpo\n\n${SIG}`);
  });
});

describe('manualImagesOf — las fotos en el orden en que se publican', () => {
  it('carrusel: láminas ordenadas por n', () => {
    const p = piece({ format: 'carousel' }, {
      image: { url: 'https://cdn/portada.png' },
      carousel: { slides: [{ n: 2, url: 'https://cdn/2.png' }, { n: 1, url: 'https://cdn/1.png' }] },
    });
    expect(manualImagesOf(p)).toEqual(['https://cdn/1.png', 'https://cdn/2.png']);
  });
  it('carrusel con una sola lámina válida: la portada', () => {
    const p = piece({ format: 'carousel' }, { image: { url: 'https://cdn/portada.png' }, carousel: { slides: [{ n: 1, url: 'https://cdn/1.png' }] } });
    expect(manualImagesOf(p)).toEqual(['https://cdn/portada.png']);
  });
  it('sin imagen: lista vacía', () => {
    expect(manualImagesOf(piece())).toEqual([]);
  });
});

describe('buildManualItems — sólo canales manuales, lo atrasado primero', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const slots: ManualSlotRow[] = [
    { id: 's-2', brand_id: BRAND, platform_key: MANUAL, slot_at: '2026-10-02T00:00:00Z', status: 'reserved', piece_id: 'p-2' },
    { id: 's-1', brand_id: BRAND, platform_key: MANUAL, slot_at: '2026-09-30T13:00:00Z', status: 'manual_pending', piece_id: 'p-1' },
    { id: 's-3', brand_id: BRAND, platform_key: OTHER, slot_at: '2026-09-30T13:00:00Z', status: 'reserved', piece_id: 'p-3' },
    { id: 's-4', brand_id: BRAND, platform_key: MANUAL, slot_at: '2026-09-30T13:00:00Z', status: 'manual_pending', piece_id: 'p-desconocida' },
  ];
  const pieces = new Map<string, ManualPieceInput>([
    ['p-1', piece({ id: 'p-1' }, { copy: { raw: 'Uno' } })],
    ['p-2', piece({ id: 'p-2' }, { copy: { raw: 'Dos' } })],
    ['p-3', piece({ id: 'p-3', platform: OTHER }, { copy: { raw: 'Tres' } })],
  ]);
  const items = buildManualItems(slots, new Set([manualChannelKey(BRAND, MANUAL)]), pieces, { [BRAND]: 'America/New_York' }, now);

  it('excluye canales no manuales y franjas sin pieza legible', () => {
    expect(items.map((i) => i.slot_id)).toEqual(['s-1', 's-2']);
  });
  it('marca como «toca ya» lo que ya pasó', () => {
    expect(items.map((i) => i.due)).toEqual([true, false]);
  });
  it('lleva el huso de la marca', () => {
    expect(items[0].timezone).toBe('America/New_York');
  });
});

describe('«Publicada» — el link es la prueba', () => {
  it('acepta un enlace http(s) y lo devuelve limpio', () => {
    expect(cleanPostLink('  https://surface.example/p/123  ')).toBe('https://surface.example/p/123');
  });
  it('rechaza lo que no es un enlace', () => {
    for (const v of ['', '   ', 'publicado', 'ftp://x/y', 'https://a b', null, undefined, 42]) {
      expect(cleanPostLink(v)).toBeNull();
    }
  });
  it('la fila de bitácora cumple la prueba del efecto: PUBLISHED con post y fecha', () => {
    const row = manualDrainRow(
      { id: 's-1', brand_id: BRAND, platform_key: MANUAL, slot_at: '2026-10-01T00:00:00Z', piece_id: 'p-1' },
      'https://surface.example/p/1', 'run-1', '2026-10-01T10:00:00Z');
    expect(row.outcome).toBe('PUBLISHED');
    expect(row.platform_post_id).toBe('https://surface.example/p/1');
    expect(row.published_at).toBe('2026-10-01T10:00:00Z');
    expect(row.slot_id).toBe('s-1');
    expect(row.piece_id).toBe('p-1');
  });
});
