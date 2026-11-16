import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { labAppsOf, labNameOf } from '../src/modules/labs/MenuDeLabs';

/** MENÚ DE LABS (2026-11-16): qué labs salen y a dónde llevan es dato de `lab_configs.ui_url`. */
describe('labAppsOf', () => {
  it('toma sólo filas con app https, sin duplicados y en orden', () => {
    expect(labAppsOf([
      { lab_key: 'zlab', ui_url: 'https://z.test' },
      { lab_key: 'alab', ui_url: 'https://a.test' },
      { lab_key: 'alab', ui_url: 'https://a2.test' },
      { lab_key: 'sinapp', ui_url: null },
      { lab_key: 'inseguro', ui_url: 'http://x.test' },
    ])).toEqual([{ lab_key: 'alab', ui_url: 'https://a.test' }, { lab_key: 'zlab', ui_url: 'https://z.test' }]);
    expect(labAppsOf(null)).toEqual([]);
  });
  it('el nombre sale de la configuración de la UI, o es la clave', () => {
    expect(labNameOf('sociallab')).toBe('SocialLab');
    expect(labNameOf('labdesconocido')).toBe('labdesconocido');
  });
  it('el menú no escribe ninguna dirección de lab: la lee de lab_configs', () => {
    const src = readFileSync(new URL('../src/modules/labs/MenuDeLabs.tsx', import.meta.url), 'utf8');
    expect(src).not.toMatch(/https:\/\/[a-z0-9-]+\.vercel\.app/);
    expect(src).toContain('lab_configs?select=lab_key,ui_url');
  });
});
