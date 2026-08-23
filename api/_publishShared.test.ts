import { describe, it, expect } from 'vitest';
import {
  RESOLVED_STATUSES, channelOf, channelBlocks, indexChannels,
  type ChannelInfo,
} from './_publishShared.js';
import type { ContentPiece } from './_calibrationShared.js';

/**
 * Pruebas del bloqueo por canal — PUBLISH-UI-01 §4.2.
 *
 * POR QUÉ EXISTEN: el caso "pieza cuyo canal no está operativo" NO tiene ejemplo en vivo
 * hoy. Medido contra la base el 2026-08-23: la única pieza publicable es de un canal que sí
 * está configurado, y las piezas de canales sin configurar están en `status='rejected'`
 * (Sam las rechazó), así que la bandeja no las lista. Que el caso no ocurra hoy es un hecho
 * del estado del sistema, no algo que se arregle ensuciando la fuente con material que no
 * corresponde publicar. Por eso el bloqueo se cubre acá y no con un dato inventado.
 *
 * Los identificadores de las fixtures son ficticios a propósito: si la lógica dependiera del
 * nombre de una marca o de un canal reales, estas pruebas fallarían.
 */

// ── Fixtures ─────────────────────────────────────────────────────────────────────
const BRAND_A = 'BrandAlpha';
const BRAND_B = 'BrandBeta';
const CHANNEL_LIVE = 'surface_one';
const CHANNEL_OFF = 'surface_two';
const CHANNEL_UNKNOWN = 'surface_three';

function piece(over: Partial<ContentPiece> = {}): ContentPiece {
  return { id: 'p-1', brand_id: BRAND_A, platform: CHANNEL_LIVE, ...over };
}

// Se indexa con la MISMA funcion que usa el endpoint: la clave del mapa no se
// reimplementa aca, asi la prueba no puede quedar desincronizada del codigo real.
const CATALOG = indexChannels([
  { brand_id: BRAND_A, platform_key: CHANNEL_LIVE, provider: 'provider_x', active: true, config: {} },
  { brand_id: BRAND_A, platform_key: CHANNEL_OFF, provider: 'provider_y', active: false, config: {} },
]);

// ── Estados que salen de la bandeja ──────────────────────────────────────────────
describe('RESOLVED_STATUSES', () => {
  it('saca de la bandeja lo que ya salió del circuito', () => {
    expect(RESOLVED_STATUSES).toContain('scheduled');
    expect(RESOLVED_STATUSES).toContain('published');
    expect(RESOLVED_STATUSES).toContain('failed');
  });

  it('saca lo rechazado: una pieza que Sam rechazó no es material publicable', () => {
    expect(RESOLVED_STATUSES).toContain('rejected');
  });

  it('deja pasar lo que todavía no se resolvió', () => {
    expect(RESOLVED_STATUSES).not.toContain('awaiting_approval');
    expect(RESOLVED_STATUSES).not.toContain('draft');
  });
});

// ── Resolución del canal ─────────────────────────────────────────────────────────
describe('channelOf', () => {
  it('canal con fila activa → operativo, con su proveedor, sin motivo de bloqueo', () => {
    const info = channelOf(piece(), CATALOG);
    expect(info.status).toBe('operational');
    expect(info.platform_key).toBe(CHANNEL_LIVE);
    expect(info.provider).toBe('provider_x');
    expect(info.reason).toBeNull();
    expect(channelBlocks(info)).toBe(false);
  });

  it('canal con fila apagada → inactivo y bloquea, diciendo que está desactivado', () => {
    const info = channelOf(piece({ platform: CHANNEL_OFF }), CATALOG);
    expect(info.status).toBe('inactive');
    expect(channelBlocks(info)).toBe(true);
    expect(info.reason).toContain(CHANNEL_OFF);
    expect(info.reason).toContain('desactivado');
  });

  it('canal sin fila → no configurado y bloquea, nombrando el canal en el motivo', () => {
    const info = channelOf(piece({ platform: CHANNEL_UNKNOWN }), CATALOG);
    expect(info.status).toBe('missing');
    expect(channelBlocks(info)).toBe(true);
    expect(info.reason).toContain(CHANNEL_UNKNOWN);
    expect(info.reason).toContain('no configurado');
  });

  it('una marca NO hereda el canal de otra: mismo platform_key, otra marca → bloquea', () => {
    // La marca N+1 entra sembrando su propia fila. Sin ella, no publica — aunque el canal
    // exista para otra marca. Es el corazón del test de la marca N+1 en esta unidad.
    const info = channelOf(piece({ brand_id: BRAND_B }), CATALOG);
    expect(info.status).toBe('missing');
    expect(channelBlocks(info)).toBe(true);
  });

  it('pieza sin canal declarado → undeclared y bloquea', () => {
    for (const platform of [null, undefined, '', '   ']) {
      const info = channelOf(piece({ platform }), CATALOG);
      expect(info.status).toBe('undeclared');
      expect(info.platform_key).toBeNull();
      expect(channelBlocks(info)).toBe(true);
    }
  });

  it('catálogo vacío → todo bloquea; ninguna pieza sale por defecto', () => {
    const info = channelOf(piece(), new Map());
    expect(info.status).toBe('missing');
    expect(channelBlocks(info)).toBe(true);
  });
});

// ── El motivo tiene que ser legible, no un código ────────────────────────────────
describe('motivo del bloqueo', () => {
  it('todo canal bloqueado trae un motivo no vacío para mostrar en la tarjeta', () => {
    const bloqueados: ChannelInfo[] = [
      channelOf(piece({ platform: CHANNEL_OFF }), CATALOG),
      channelOf(piece({ platform: CHANNEL_UNKNOWN }), CATALOG),
      channelOf(piece({ platform: null }), CATALOG),
      channelOf(piece({ brand_id: BRAND_B }), CATALOG),
    ];
    for (const info of bloqueados) {
      expect(channelBlocks(info)).toBe(true);
      expect(info.reason).toBeTruthy();
      expect((info.reason ?? '').length).toBeGreaterThan(10);
    }
  });
});
