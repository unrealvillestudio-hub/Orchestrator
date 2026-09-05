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
 * No aprueba, no programa, no publica, y no escribe NADA. La bandeja de publicación es de
 * SOLO LECTURA: muestra a dónde va cada pieza, si su canal está operativo y —desde PR-C—
 * cuándo sale.
 *
 * No aprueba por DISEÑO, no por carencia: aprobar es del carril de CALIBRACIÓN, que es
 * donde se juzga la pieza. Aprobar allá sella la habilitación y `content-scheduler` (modo
 * `placement`) calcula la franja.
 *
 * > ⛔ NO OPERATIVO — motivo anterior, derogado. Se conserva por trazabilidad y NO se
 * > obedece: *«el eje de colocación de una pieza ya producida en la franja de su canal NO
 * > EXISTE en el ecosistema (verificado el 2026-08-23); ni content-scheduler ni
 * > scheduled_posts lo ofrecen; hasta que ese eje exista, aprobar desde acá sería prometer
 * > una fecha que nadie honra.»*
 * >
 * > Ese eje EXISTE desde PLACE-01 (`content-scheduler` en modo `placement`, franjas en
 * > `intel.brand_publish_slots`). El mismo aviso ya se había retirado de `publish-queue.ts`
 * > por obsoleto; acá sobrevivió. Un comentario que describe un sistema que ya cambió es
 * > peor que ninguno: enseña a desconfiar de los comentarios.
 */

import {
  SB_URL, SB_KEY,
  type ContentPiece, type PieceContext,
} from './_calibrationShared.js';
import type { PieceSlot } from './_publishSlots.js';

// ── Qué pieza es candidata a publicarse ──────────────────────────────────────────
/**
 * Estados que ya salieron del circuito de publicación: la pieza salió, la rechazaron o
 * falló. Son ejes de ESTADO del sistema (los del CHECK de `content.content_pieces`), no
 * vocabulario de marca ni de canal — cualquier marca los atraviesa igual.
 *
 * `rejected` está acá a propósito: es una pieza que Sam rechazó, no material publicable.
 * Meterla en la bandeja para tener casos de prueba sería ensuciar la fuente.
 *
 * ── PR-C · POR QUÉ `scheduled` YA NO ESTÁ EN ESTA LISTA ──────────────────────────
 * No es un ajuste de filtro: es que el SIGNIFICADO de `scheduled` cambió con PLACE-01 y la
 * constante se quedó describiendo el sistema anterior.
 *
 * Cuando se escribió, no existía el eje de colocación: `scheduled` era el estado terminal
 * de un planificador que programaba filas de cola ANTES de producirlas, y una pieza con ese
 * estado efectivamente ya no era asunto de esta bandeja. Desde PLACE-01, `scheduled`
 * significa otra cosa: la pieza está APROBADA y tiene una franja reservada en
 * `intel.brand_publish_slots`. Es decir, exactamente la pieza que una cola de publicación
 * tiene que listar — la que todavía no salió y tiene fecha comprometida.
 *
 * Medido el 2026-09-05: las 10 piezas con franja reservada y las 15 aprobadas sin franja
 * están TODAS en `scheduled`. Con la constante anterior, la cola no mostraba ni una.
 *
 * `published`, `rejected` y `failed` siguen fuera: ésos sí salieron del circuito.
 * Lo que queda: `draft`, `awaiting_approval`, `deferred` y `scheduled`.
 */
export const RESOLVED_STATUSES = ['published', 'rejected', 'failed'];

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

/**
 * Lo que la tarjeta de publicación muestra: el contexto de la pieza, su canal y su franja.
 *
 * `slot` es el COMPROMISO de esta pieza —la franja que tiene reservada—, no una previsión:
 * la previsión vive en la bandeja de calibración y se llama `forecast_slot` justamente para
 * que las dos no se puedan confundir. `slot: null` es un estado real (aprobada y sin franja,
 * o todavía sin aprobar), no un hueco de datos.
 */
export type PublishablePiece = PieceContext & { channel: ChannelInfo; slot: PieceSlot | null };
