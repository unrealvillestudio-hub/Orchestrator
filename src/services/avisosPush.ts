/**
 * AVISOS PUSH PROPIOS — el lado del navegador (Sam, 2026-11-12).
 *
 * La campanita suscribe ESTE dispositivo al push del navegador con la llave pública del canal `web_push` y guarda
 * la suscripción en `/api/push-subscription`. Desde entonces, el despachador de alertas manda aquí los avisos de
 * las reglas que tengan ruta al operador por `web_push` («Sesión: <nombre>» cuando una sesión de trabajo espera).
 */
import { fetchWithTimeout } from './fetchWithTimeout';

export type EstadoDeAvisos =
  | 'sin_soporte'   // el navegador no tiene service worker o push (o no es contexto seguro)
  | 'bloqueado'     // el permiso de notificaciones está denegado: sólo se cambia en los ajustes del sistema
  | 'apagado'       // se puede activar
  | 'activo';       // este dispositivo está suscrito

export function hayPush(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && 'serviceWorker' in navigator
    && 'PushManager' in window && 'Notification' in window;
}

/** Llave VAPID en base64url → bytes, como la pide `PushManager.subscribe`. */
export function llaveABytes(b64url: string): Uint8Array<ArrayBuffer> {
  const norm = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(norm + '==='.slice((norm.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function api<T>(token: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<T> {
  const res = await fetchWithTimeout('own-api', '/api/push-subscription', {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({})) as T & { detail?: string; error?: string };
  if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
  return data;
}

async function registro(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration('/')) ?? navigator.serviceWorker.register('/sw.js');
}

export async function estadoDeAvisos(): Promise<EstadoDeAvisos> {
  if (!hayPush()) return 'sin_soporte';
  if (Notification.permission === 'denied') return 'bloqueado';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub && Notification.permission === 'granted' ? 'activo' : 'apagado';
}

/**
 * Pide permiso, se suscribe y guarda la suscripción. Si el dispositivo ya estaba suscrito, la vuelve a guardar:
 * así una fila desactivada por un 410 vuelve a quedar activa sin que nadie toque la base.
 */
export async function activarAvisos(token: string): Promise<EstadoDeAvisos> {
  if (!hayPush()) return 'sin_soporte';
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') return permiso === 'denied' ? 'bloqueado' : 'apagado';
  const { public_key } = await api<{ public_key: string | null }>(token, 'GET');
  if (!public_key) throw new Error('el canal de avisos todavía no está configurado');
  const reg = await registro();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // Una suscripción hecha con otra llave no sirve: el servicio de push rechazaría cada aviso.
  const llaveActual = sub?.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
  const llaveNueva = llaveABytes(public_key);
  if (sub && (!llaveActual || llaveActual.length !== llaveNueva.length || llaveActual.some((b, i) => b !== llaveNueva[i]))) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: llaveNueva });
  await api(token, 'POST', { subscription: sub.toJSON(), user_agent: navigator.userAgent });
  return 'activo';
}

export async function desactivarAvisos(token: string): Promise<EstadoDeAvisos> {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    await api(token, 'DELETE', { endpoint: sub.endpoint }).catch(() => { /* la baja local manda igual */ });
    await sub.unsubscribe();
  }
  return 'apagado';
}
