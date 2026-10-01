import { describe, it, expect } from 'vitest';
import { buildHtml, type ContentPiece } from './_calibrationShared';

/**
 * 2026-10-01 — Sam aprobó dos carruseles (`8a1a5e89`, `69f34e2b`) viendo sólo la portada: el
 * artefacto pintaba únicamente `assets.image.url`. La vista tiene que mostrar TODAS las láminas, en
 * el orden en que se publican, y una pieza que no es carrusel sigue como estaba.
 */
const U = (n: number) => `https://cdn.test/l${n}.png`;
const base = { id: 'p1', brand_id: 'MarcaN1', platform: 'meta_ig', status: 'awaiting_approval' } as ContentPiece;

describe('el artefacto muestra el carrusel entero', () => {
  it('pinta todas las láminas en orden de publicación (por n, no por posición en el arreglo)', () => {
    const html = buildHtml({
      ...base, format: 'carousel',
      assets: {
        image: { url: U(1) },
        carousel: { slides: [{ n: 3, url: U(3) }, { n: 1, url: U(1) }, { n: 2, url: U(2) }] },
      },
    } as ContentPiece);
    const pos = [1, 2, 3].map((n) => html.indexOf(U(n)));
    expect(pos.every((p) => p > 0)).toBe(true);
    expect(pos).toEqual([...pos].sort((a, b) => a - b));
    expect(html).toContain('Carrusel · 3 láminas');
    expect(html).toContain('3 / 3');
  });

  it('una pieza que no es carrusel sigue mostrando sólo su imagen', () => {
    const html = buildHtml({ ...base, format: 'post', assets: { image: { url: U(9) } } } as ContentPiece);
    expect(html).toContain(U(9));
    expect(html).not.toContain('Carrusel ·');
  });

  it('un carrusel con una sola lámina con imagen cae a la portada (mismo criterio que el drenaje)', () => {
    const html = buildHtml({
      ...base, format: 'carousel',
      assets: { image: { url: U(1) }, carousel: { slides: [{ n: 1, url: U(1) }, { n: 2, url: '' }] } },
    } as ContentPiece);
    expect(html).not.toContain('Carrusel ·');
    expect(html).toContain(U(1));
  });
});
