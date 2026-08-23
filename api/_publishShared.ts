/**
 * UNRLVL Orchestrator — api/_publishShared.ts  (PUBLISH-UI-01 · parcial de solo lectura)
 *
 * Lo ESPECÍFICO de la bandeja de publicación. Todo lo común —fuente `content_pieces`,
 * `latestPerQueue`, traza de `watcher_log`, conteo de intentos, `generationOf`— se importa
 * de `_calibrationShared.ts`; acá no se reimplementa nada de eso.
 *
 * (Si aparece una tercera bandeja, el núcleo común conviene renombrarlo a `_piecesShared.ts`:
 *  hoy sirve a dos bandejas con nombre de una. No se hace en este PR para no mezclar.)
 *
 * ── Qué NO hace este módulo ───────────────────────────────────────────────────────
 * No aprueba, no programa, no publica. La bandeja de publicación es de SOLO LECTURA en
 * esta entrega: el eje de "colocación de una pieza ya producida en la franja de su canal"
 * NO EXISTE en el ecosistema (verificado el 2026-08-23; ver el cuerpo del PR). Ni
 * `content-scheduler` ni `scheduled_posts` lo ofrecen:
 *   · content-scheduler v2.1 selecciona `intel.iid_content_queue` con
 *     `orchestrator_status='pending'` — es decir, ANTES de que la pieza exista — y escribe
 *     `iid_content_queue.scheduled_for`. Una pieza producida ya no es candidata suya.
 *   · `public.scheduled_posts` es una tabla sin endpoint, sin columna que la ate a una
 *     pieza, escrita automáticamente por el carril y hoy sin ningún consumidor.
 * Hasta que ese eje exista, aprobar desde acá sería prometer una fecha que nadie honra.
 */

import {
  SB_URL, SB_KEY,
  type ContentPiece, type PieceContext,
} from './_calibrationShared.js';

// ── Qué pieza es candidata a publicarse ──────────────────────────────────────────
/**
 * Estados que ya salieron del circuito de publicación: la pieza se programó, salió, la
 * rechazaron o falló. Son ejes de ESTADO del sistema (los del CHECK de
 * `content.content_pieces`), no vocabulario de marca ni de canal — cualquier marca los
 * atraviesa igual.
 *
 * `rejected` está acá a propósito: es una pieza que Sam rechazó, no material publicable.
 * Meterla en la bandeja para tener casos de prueba sería ensuciar la fuente.
 *
 * Lo que queda: `draft` y `awaiting_approval`.
 */
export const RESOLVED_STATUSES = ['scheduled', 'published', 'rejected', 'failed'];

// ── Canal de destino ─────────────────────────────────────────────────────────────
/**
 * Un canal operativo de una marca. La fila manda: un canal nuevo se habilita sembrando
 * `intel.brand_publish_channels`, sin tocar código. Acá no hay ninguna lista de canales
 * ni de proveedores — `platform_key` y `provider` son dato, siempre.
 */
export interface PublishChannel {
  brand_id: string;
  platform_key: string;
  provider: string;
  active: boolean;
  config: Record<string, unknown> | null;
}

/** Estado operativo del canal de una pieza. */
export type ChannelStatus = 'operational' | 'inactive' | 'missing' | 'undeclared';

export interface ChannelInfo {
  /** El canal que la pieza declara (`content_pieces.platform`). */
  platform_key: string | null;
  status: ChannelStatus;
  provider: string | null;
  /** Motivo legible cuando no está operativo. null si lo está. */
  reason: string | null;
}

/** Clave del mapa de canales. Separador NUL: no puede aparecer dentro de un identificador. */
function channelKey(brandId: string, platformKey: string): string {
  return `${brandId}\u0000${platformKey}`;
}

/**
 * Todos los canales declarados (activos e inactivos). Se traen los inactivos a propósito:
 * "existe pero está apagado" y "no existe" son dos motivos distintos, y el operador
 * necesita leer cuál de los dos le toca.
 */
/**
 * Indexa las filas por (marca, canal). Puro y exportado a propósito: la resolución del canal
 * se prueba sin red, y el índice no se reimplementa en dos lados.
 */
export function indexChannels(rows: PublishChannel[]): Map<string, PublishChannel> {
  const map = new Map<string, PublishChannel>();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r?.brand_id || !r?.platform_key) continue;
    map.set(channelKey(r.brand_id, r.platform_key), r);
  }
  return map;
}

export const CHANNELS_CAP = 1000;
export async function fetchPublishChannels(): Promise<Map<string, PublishChannel>> {
  const url = `${SB_URL()}/rest/v1/brand_publish_channels`
    + `?select=brand_id,platform_key,provider,active,config&limit=${CHANNELS_CAP}`;
  const res = await fetch(url, {
    headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Accept-Profile': 'intel' },
  });
  if (!res.ok) {
    throw new Error(`brand_publish_channels read failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
  return indexChannels((await res.json().catch(() => [])) as PublishChannel[]);
}

/**
 * Resuelve el canal de una pieza contra el catálogo. Todo se decide por dato: la pieza
 * declara su `platform`, la tabla dice si eso está operativo para su marca.
 */
export function channelOf(piece: ContentPiece, channels: Map<string, PublishChannel>): ChannelInfo {
  const platform_key = (piece.platform ?? '').trim() || null;
  if (!platform_key) {
    return { platform_key: null, status: 'undeclared', provider: null, reason: 'La pieza no declara canal de destino.' };
  }
  const row = channels.get(channelKey(piece.brand_id, platform_key));
  if (!row) {
    return { platform_key, status: 'missing', provider: null, reason: `Canal \`${platform_key}\` no configurado` };
  }
  if (!row.active) {
    return { platform_key, status: 'inactive', provider: row.provider ?? null, reason: `Canal \`${platform_key}\` desactivado` };
  }
  return { platform_key, status: 'operational', provider: row.provider ?? null, reason: null };
}

/** Un canal bloquea la salida cuando no está operativo. */
export function channelBlocks(info: ChannelInfo): boolean {
  return info.status !== 'operational';
}

/** Lo que la tarjeta de publicación muestra: el contexto de la pieza + su canal. */
export type PublishablePiece = PieceContext & { channel: ChannelInfo };
