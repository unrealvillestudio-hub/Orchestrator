// AVISOS PUSH PROPIOS (2026-11-12) — la suscripción que guarda la campanita, el manifiesto y el service worker.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { filaDeSuscripcion, llavePublicaDelCanal } from './_pushSubscription';

const RAIZ = join(__dirname, '..');
const P256 = 'B' + 'A'.repeat(86);          // 87 caracteres: 65 bytes en base64url
const AUTH = 'x'.repeat(22);                // 16 bytes
const buena = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: P256, auth: AUTH } };

describe('filaDeSuscripcion', () => {
  it('arma la fila con el operador de la SESIÓN, no con lo que mande el navegador', () => {
    const v = filaDeSuscripcion('sam', { ...buena, operator_sub: 'otro' } as never, 'Mozilla/5.0', new Date('2026-11-12T18:00:00Z'));
    expect(v).toEqual({ fila: {
      operator_sub: 'sam', endpoint: buena.endpoint, p256dh: P256, auth: AUTH,
      user_agent: 'Mozilla/5.0', active: true, last_seen_at: '2026-11-12T18:00:00.000Z',
    } });
  });

  it('rechaza lo que el CHECK de la tabla rechazaría, con su motivo', () => {
    expect(filaDeSuscripcion('', buena, null)).toEqual({ error: 'la sesión no trae operador' });
    expect(filaDeSuscripcion('sam', { ...buena, endpoint: 'http://x' }, null)).toMatchObject({ error: expect.stringMatching(/https/) });
    expect(filaDeSuscripcion('sam', { ...buena, keys: { p256dh: 'corta', auth: AUTH } }, null)).toMatchObject({ error: expect.stringMatching(/p256dh/) });
    expect(filaDeSuscripcion('sam', { ...buena, keys: { p256dh: P256, auth: 'a+b/' } }, null)).toMatchObject({ error: expect.stringMatching(/auth/) });
    expect(filaDeSuscripcion('sam', null, null)).toMatchObject({ error: expect.any(String) });
  });
});

describe('llavePublicaDelCanal', () => {
  it('lee la llave pública del canal y descarta lo que no lo es', () => {
    expect(llavePublicaDelCanal([{ config: { vapid_public_key: P256 } }])).toBe(P256);
    expect(llavePublicaDelCanal([])).toBeNull();
    expect(llavePublicaDelCanal([{ config: {} }])).toBeNull();
    expect(llavePublicaDelCanal([{ config: { vapid_public_key: 'demasiado-corta' } }])).toBeNull();
  });
});

describe('la app instalable', () => {
  it('el manifiesto declara lo que Android pide para instalar', () => {
    const m = JSON.parse(readFileSync(join(RAIZ, 'public/manifest.webmanifest'), 'utf8'));
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('/');
    const tamanos = m.icons.map((i: { sizes: string }) => i.sizes);
    expect(tamanos).toContain('192x192');
    expect(tamanos).toContain('512x512');
    expect(m.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
  });

  it('el service worker enseña el aviso sin cerrarse solo y abre la app al tocarlo', () => {
    const sw = readFileSync(join(RAIZ, 'public/sw.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sw).toMatch(/addEventListener\('push'/);
    expect(sw).toMatch(/requireInteraction: true/);
    expect(sw).toMatch(/addEventListener\('notificationclick'/);
    expect(sw).toMatch(/openWindow\('\/'\)/);
    expect(sw, 'guardar copias del Orchestrator serviría pantallas viejas').not.toMatch(/addEventListener\('fetch'/);
  });

  it('index.html enlaza el manifiesto y main.tsx registra el service worker', () => {
    expect(readFileSync(join(RAIZ, 'index.html'), 'utf8')).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"/);
    expect(readFileSync(join(RAIZ, 'src/main.tsx'), 'utf8')).toMatch(/serviceWorker\.register\('\/sw\.js'\)/);
  });

  it('la campanita ya no se esconde en el móvil', () => {
    const app = readFileSync(join(RAIZ, 'src/App.tsx'), 'utf8');
    expect(app).toMatch(/<CampanaDeAvisos token=\{session\.session_token\} \/>/);
    expect(app).not.toMatch(/hidden md:block p-2[^"]*">\s*<Bell /);
  });
});
