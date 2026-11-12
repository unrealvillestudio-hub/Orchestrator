/**
 * UNRLVL Orchestrator — api/_pushSubscription.ts
 *
 * AVISOS PUSH PROPIOS (Sam, 2026-11-12): «una app nuestra exclusiva para esta clase de alertas […] Pitido y push
 * kind notification nuestra». El Orchestrator instalado se suscribe al push del navegador y la suscripción se
 * guarda en `alerting.push_subscriptions` (migración `20261112180000` de unrlvl-iid-functions). El despachador
 * de alertas (`ops-alert-dispatch`, transporte `web_push`) cifra y manda cada aviso a esas filas.
 *
 * Este módulo es PURO: valida lo que manda el navegador y arma la fila. La ruta (`api/push-subscription.ts`)
 * sólo autentica y escribe.
 */

/** Lo que `PushSubscription.toJSON()` entrega en el navegador. */
export interface SuscripcionDelNavegador {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown } | null;
}

/** La fila que se escribe. `operator_sub` sale SIEMPRE de la sesión verificada, nunca del cuerpo. */
export interface FilaDeSuscripcion {
  operator_sub: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  active: true;
  last_seen_at: string;
}

const B64URL = /^[A-Za-z0-9_-]+$/;

/**
 * Valida la suscripción y devuelve la fila, o el motivo por el que no vale. Los límites son los del CHECK de
 * la tabla: una llave pública P-256 sin comprimir son 65 bytes (87 caracteres) y el secreto `auth`, 16 (22).
 * Validar aquí da un 400 con su motivo en lugar de un 400 opaco de PostgREST.
 */
export function filaDeSuscripcion(
  sub: string, s: SuscripcionDelNavegador | null | undefined, userAgent: unknown, ahora = new Date(),
): { fila: FilaDeSuscripcion } | { error: string } {
  const operador = String(sub ?? '').trim();
  if (!operador) return { error: 'la sesión no trae operador' };
  const endpoint = typeof s?.endpoint === 'string' ? s.endpoint.trim() : '';
  if (!/^https:\/\/[^\s]+$/.test(endpoint) || endpoint.length > 1000) return { error: 'endpoint inválido: tiene que ser https' };
  const p256dh = typeof s?.keys?.p256dh === 'string' ? s.keys.p256dh.trim() : '';
  const auth = typeof s?.keys?.auth === 'string' ? s.keys.auth.trim() : '';
  if (!B64URL.test(p256dh) || p256dh.length < 80 || p256dh.length > 100) return { error: 'llave p256dh inválida' };
  if (!B64URL.test(auth) || auth.length < 16 || auth.length > 32) return { error: 'secreto auth inválido' };
  const ua = typeof userAgent === 'string' && userAgent.trim() ? userAgent.trim().slice(0, 300) : null;
  return {
    fila: { operator_sub: operador, endpoint, p256dh, auth, user_agent: ua, active: true, last_seen_at: ahora.toISOString() },
  };
}

/** La llave pública vive en `alert_channels.config` (una sola fuente para el navegador y el despachador). */
export function llavePublicaDelCanal(filas: unknown): string | null {
  if (!Array.isArray(filas) || !filas.length) return null;
  const k = (filas[0] as { config?: { vapid_public_key?: unknown } })?.config?.vapid_public_key;
  return typeof k === 'string' && B64URL.test(k) && k.length === 87 ? k : null;
}
