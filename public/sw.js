/*
 * UNRLVL Orchestrator — service worker de los AVISOS PUSH PROPIOS (Sam, 2026-11-12).
 *
 * Sólo hace dos cosas, y a propósito no hace ninguna más (no guarda copias, no intercepta peticiones: una
 * copia vieja del Orchestrator sería peor que no tener la app abierta):
 *
 *   · `push` → enseña el aviso que cifró el despachador de alertas (`ops-alert-dispatch`, transporte `web_push`).
 *     `requireInteraction: true`: en la computadora el aviso NO se cierra solo, se queda hasta que Sam lo cierra.
 *     `renotify: true` con el mismo `tag`: si llega otra vez el mismo aviso, vuelve a sonar.
 *   · `notificationclick` → abre el Orchestrator, o lo trae al frente si ya está abierto.
 *
 * El sonido es el del sistema para las notificaciones de la app: no se puede elegir desde aquí.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let aviso = {};
  try { aviso = event.data ? event.data.json() : {}; } catch { aviso = { body: event.data ? event.data.text() : '' }; }
  const titulo = typeof aviso.title === 'string' && aviso.title ? aviso.title : 'Orchestrator';
  event.waitUntil(self.registration.showNotification(titulo, {
    body: typeof aviso.body === 'string' ? aviso.body : '',
    tag: typeof aviso.tag === 'string' && aviso.tag ? aviso.tag : undefined,
    renotify: Boolean(aviso.tag),
    requireInteraction: true,
    silent: false,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    vibrate: [200, 100, 200],
    data: { ref: aviso.ref ?? null },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const v of ventanas) {
      if (new URL(v.url).origin === self.location.origin && 'focus' in v) return v.focus();
    }
    return self.clients.openWindow('/');
  })());
});
