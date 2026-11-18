/**
 * 2026-11-18 — LA TARJETA Y EL EDITOR MUESTRAN EL MISMO TEXTO.
 *
 * Caso [reportado por Sam]: pieza `95385260`, blog (`shopify_blog`). La tarjeta pintaba el maestro
 * (`copy.aife_filtered`, lo que publica el blog) y «Editar texto» cargaba el adaptado del canal, que el auto-fix había
 * reparado. Lo que se veía no era lo que se editaba. Este test fija que el editor carga el cuerpo de lo que el canal
 * PUBLICA, con la misma regla que la vista (`publishedTextOf`).
 */
import { describe, it, expect } from 'vitest';
import { editableBodyOf, publishedTextOf, toContext, CHANNEL_LAYOUT_BY_PROVIDER, type ContentPiece } from './_calibrationShared';
import { pieceBody, type RawPiece } from './_challengedShared';

const MAESTRO = 'Intro.\n\n## Sección\n\nNeurone diseñó los Rituals & Kits pensando en este patrón exacto.';
const ADAPTADO = 'Por eso el kit, en primera persona, resuelve ese quiebre.';
const blog = {
  id: 'p1', brand_id: 'marca_n1', platform: 'blog_marca', status: 'challenged',
  assets: {
    copy: { title: 'T', raw: 'Crudo distinto', aife_filtered: MAESTRO },
    social: { adapted: [{ platform: 'blog_marca', copy: ADAPTADO }] },
  },
};

describe('editableBodyOf — el editor carga lo que pinta la tarjeta', () => {
  it('canal que publica el maestro: el editor carga el maestro, igual que la vista', () => {
    for (const [prov, layout] of Object.entries(CHANNEL_LAYOUT_BY_PROVIDER)) {
      if (layout.text !== 'master') continue;
      expect(editableBodyOf(blog, prov)).toBe(MAESTRO);
      expect(editableBodyOf(blog, prov)).toBe(publishedTextOf(blog, prov)!.text);
    }
  });
  it('meta_graph: el adaptado del canal (sin la firma que añade el publicador) — como antes', () => {
    expect(editableBodyOf(blog, 'meta_graph')).toBe(ADAPTADO);
  });
  it('proveedor ausente o fuera del mapa: lo de antes (el adaptado), no se adivina', () => {
    expect(editableBodyOf(blog, null)).toBe(ADAPTADO);
    expect(editableBodyOf(blog, 'proveedor_nuevo')).toBe(ADAPTADO);
  });
  it('sin aife_filtered, el maestro es raw', () => {
    const sinAife = { ...blog, assets: { ...blog.assets, copy: { raw: 'Solo crudo' } } };
    expect(editableBodyOf(sinAife, 'shopify_blog')).toBe('Solo crudo');
  });
  it('toContext lleva al editor el texto del proveedor', () => {
    expect(toContext(blog as unknown as ContentPiece, { provider: 'shopify_blog' }).body).toBe(MAESTRO);
    expect(toContext(blog as unknown as ContentPiece).body).toBe(ADAPTADO);
  });
  it('la bandeja de retenidas usa la misma regla', () => {
    expect(pieceBody(blog as unknown as RawPiece, 'vercel_html')).toBe(MAESTRO);
    expect(pieceBody(blog as unknown as RawPiece)).toBe(ADAPTADO);
  });
  it('marca N+1: ni una marca en la regla — sólo proveedores', () => {
    const otra = { ...blog, brand_id: 'otra_marca_cualquiera', platform: 'web_otra' };
    otra.assets = { ...blog.assets, social: { adapted: [{ platform: 'web_otra', copy: ADAPTADO }] } };
    expect(editableBodyOf(otra, 'vercel_html')).toBe(MAESTRO);
  });
});
