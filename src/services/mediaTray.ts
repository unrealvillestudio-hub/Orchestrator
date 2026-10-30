/**
 * mediaTray.ts — Orchestrator · LA BANDEJA DE MEDIOS (cliente tipado)
 *
 *   GET  /api/media-tray    → lo que un agente subió y espera una decisión
 *   POST /api/media-decide  → promover o descartar, con motivo obligatorio
 *
 * No hay un tercer verbo. «Dejarlo para luego» no es una acción de esta bandeja: es cerrar la
 * pestaña, y el objeto sigue ahí con un día más de espera a la vista.
 *
 * Reutiliza el error tipado y el separador de fallos de las demás bandejas: dos clientes del mismo
 * mecanismo divergen en el primer cambio.
 */
import { CalibrationError } from './calibrationInbox';
import { fetchWithTimeout, mensajeDeFallo } from './fetchWithTimeout';

export { CalibrationError } from './calibrationInbox';

/** Un objeto esperando decisión, tal como lo sirve el servidor. */
export interface MediaItem {
  object_path: string;
  brand_id: string;
  /** Qué principal pidió el permiso. Lo escribe el corredor, no el agente. */
  subido_por: string | null;
  subido_en: string | null;
  bytes: number | null;
  mime: string | null;
  /**
   * En qué bucket vive. Desde el 2026-10-30 la zona de entrada es un bucket PRIVADO distinto del
   * público, así que la ruta sola ya no dice dónde está el objeto.
   */
  bucket: string;
  /**
   * La imagen misma: la tarjeta muestra el artefacto, no su descripción. URL **firmada y
   * temporal**, porque el bucket de entrada es privado. `null` = no se pudo firmar, y entonces la
   * tarjeta no muestra el artefacto — así que no se decide sobre ella.
   */
  url: string | null;
  dias_esperando: number | null;
  /** Un intento anterior que no se consumó, si lo hubo. */
  decidido?: { decision: string; outcome: string; decided_at: string };
}

export interface MediaTray {
  total: number;
  /** Cuántos llevan una semana o más esperando. Nada caduca solo en esta zona. */
  esperando: number;
  by_brand: Record<string, number>;
  items: MediaItem[];
  /** De qué buckets se leyó. Una bandeja vacía y una que miró donde no era se ven distintas. */
  buckets?: string[];
  /** Cuántos objetos llegan sin URL firmada. Cero es lo normal. */
  sin_url?: number;
  aviso_firmas?: string;
  /** `false` = el registro de decisiones no existe todavía: se lee, no se decide. */
  decisiones_legibles: boolean;
  aviso?: string;
}

export interface MediaDecisionResult {
  ok: boolean;
  decision: 'promote' | 'discard';
  object_path: string;
  destination_path?: string;
  brand_id: string;
  outcome: string;
  detail?: string;
  desenlace_registrado: boolean;
}

function fallo(data: unknown, status: number): never {
  const d = (data ?? {}) as { detail?: unknown; message?: unknown; error?: unknown };
  throw new CalibrationError(String(d?.detail || d?.message || d?.error || `Error ${status}`), status, data);
}

export async function fetchMediaTray(token: string): Promise<MediaTray> {
  let res: Response;
  try {
    res = await fetchWithTimeout('own-api', '/api/media-tray', { headers: { Authorization: `Bearer ${token}` } });
  } catch (err) {
    throw new CalibrationError(mensajeDeFallo(err, false), 0, { cause: String(err) });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) fallo(data, res.status);
  return data as MediaTray;
}

/**
 * PROMOVER O DESCARTAR. El motivo es obligatorio y el servidor lo exige otra vez: una validación que
 * sólo vive en la pantalla la salta cualquiera que llame al endpoint a mano.
 *
 * El DESTINO no se manda. Lo deriva el servidor de la ruta de origen; mandarlo desde aquí sería
 * ofrecerle al cliente elegir dónde escribe dentro del bucket.
 */
export async function decideMedia(
  token: string, objectPath: string, decision: 'promote' | 'discard', motive: string,
): Promise<MediaDecisionResult> {
  let res: Response;
  try {
    res = await fetchWithTimeout('own-api', '/api/media-decide', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ object_path: objectPath, decision, motive }),
    });
  } catch (err) {
    // Una escritura que no respondió no es segura de repetir a ciegas, y aquí menos: puede haber
    // movido el objeto. `mensajeDeFallo` lo dice en vez de invitar a reintentar.
    throw new CalibrationError(mensajeDeFallo(err, true), 0, { cause: String(err) });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) fallo(data, res.status);
  return data as MediaDecisionResult;
}
