/**
 * LA CAPA «PLATAFORMA» (Sam, 2026-11-18: «un check que habilite una capa que simule los botones y la interfaz de la
 * plataforma a la que va la pieza, así como lo haces en SocialLab»). Todo sale de dato: canal de la marca → plataforma
 * del proveedor; `platform_previews` → maqueta vertical; `account_profiles` → cuenta.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { providerPlatformOf, verticalPreviewOf, cuentaOf, platformUiOf } from './_platformUi';

const canales = [
  { brand_id: 'MarcaA', platform_key: 'canal_corto', config: { provider_platform: 'PROV_V' } },
  { brand_id: 'MarcaA', platform_key: 'canal_feed', config: { provider_platform: 'PROV_F' } },
  { brand_id: 'MarcaB', platform_key: 'canal_corto', config: {} },
];
const previews = [
  { platform: 'PROV_V', media_format: null, layout: 'vertical' },
  { platform: 'PROV_F', media_format: null, layout: 'feed_texto' },
  { platform: 'PROV_F', media_format: 'FORMATO_CORTO', layout: 'vertical' },
];
const perfiles = [
  { brand_id: 'MarcaA', platform: 'PROV_F', username: 'marca_a', display_name: null, picture_url: 'https://ejemplo.invalid/a.jpg' },
];

describe('de dónde sale cada cosa', () => {
  it('la plataforma del proveedor, del canal de la marca', () => {
    expect(providerPlatformOf(canales, 'MarcaA', 'canal_corto')).toBe('PROV_V');
    expect(providerPlatformOf(canales, 'MarcaB', 'canal_corto')).toBeNull();
    expect(providerPlatformOf(canales, 'MarcaA', 'otro')).toBeNull();
  });
  it('la maqueta vertical: la de formato vacío primero; si no, la de un formato', () => {
    expect(verticalPreviewOf(previews, 'PROV_V')?.media_format).toBeNull();
    expect(verticalPreviewOf(previews, 'PROV_F')?.media_format).toBe('FORMATO_CORTO');
    expect(verticalPreviewOf(previews, 'NINGUNA')).toBeNull();
  });
  it('la cuenta: su perfil; si no, otro de la marca con foto; si no, el nombre de la marca', () => {
    expect(cuentaOf(perfiles, 'MarcaA', 'PROV_F')).toEqual({ cuenta: 'marca_a', foto: 'https://ejemplo.invalid/a.jpg' });
    expect(cuentaOf(perfiles, 'MarcaA', 'PROV_V')).toEqual({ cuenta: 'marca_a', foto: 'https://ejemplo.invalid/a.jpg' });
    expect(cuentaOf(perfiles, 'MarcaZ', 'PROV_V')).toEqual({ cuenta: 'MarcaZ', foto: null });
  });
  it('sin canal o sin maqueta vertical, no hay capa (no se inventa)', () => {
    expect(platformUiOf({ brandId: 'MarcaA', platformKey: 'canal_corto', texto: 't', canales, previews, perfiles }))
      .toEqual({ platform: 'PROV_V', layout: 'vertical', cuenta: 'marca_a', foto: 'https://ejemplo.invalid/a.jpg', texto: 't' });
    expect(platformUiOf({ brandId: 'MarcaB', platformKey: 'canal_corto', texto: null, canales, previews, perfiles })).toBeNull();
    expect(platformUiOf({ brandId: 'MarcaA', platformKey: 'canal_corto', texto: null, canales, previews: [], perfiles })).toBeNull();
  });
});

describe('el cableado', () => {
  const ruta = readFileSync('api/piece-text.ts', 'utf8');
  const editor = readFileSync('src/modules/iid/OnScreenTextEditor.tsx', 'utf8');
  const modulo = readFileSync('api/_platformUi.ts', 'utf8');
  it('la ruta lee las tres tablas y manda la capa con la propuesta', () => {
    expect(ruta).toMatch(/leer\(`brand_publish_channels\?brand_id=eq\.\$\{b\}&select=brand_id,platform_key,config`, 'intel'\)/);
    expect(ruta).toMatch(/platform_ui: plataforma,/);
  });
  it('el check está apagado al empezar y sólo aparece si hay capa', () => {
    expect(editor).toMatch(/leerPreferencia\('orchestrator\.vista\.plataforma', 'no'\) === 'si'/);
    expect(editor).toMatch(/\{prop\.platform_ui && \(\n\s*<label/);
  });
  it('ninguna plataforma escrita en el código de la capa', () => {
    expect(modulo.replace(/^\s*(\*|\/\/).*$/gm, '')).not.toMatch(/FACEBOOK|INSTAGRAM|TIKTOK|LINKEDIN|meta_fb|meta_ig|tiktok/);
  });
  it('con la capa encendida, los controles siguen abajo a la derecha, en un recuadro negro por delante de la maqueta (Sam)', () => {
    const visual = readFileSync('src/modules/iid/TextoVisual.tsx', 'utf8');
    expect(editor).toMatch(/controlesArriba=\{plataformaVisible && !!prop\.platform_ui\}/);
    expect(visual).toMatch(/'absolute z-30 bottom-1\.5 right-1\.5 flex flex-wrap items-center justify-end gap-1\.5', controlesArriba && 'rounded-lg bg-black p-1'/);
  });
});
