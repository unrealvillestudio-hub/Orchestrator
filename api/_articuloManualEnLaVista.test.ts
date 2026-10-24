import { describe, it, expect } from 'vitest';
import { buildHtml, CHANNEL_LAYOUT_BY_PROVIDER, type ContentPiece } from './_calibrationShared';

/**
 * 2026-10-24 — Sam: «Por qué en el preview en Calibration no se ven las imagenes internas del artículo?». Un artículo en
 * un canal que se publica a mano se ve como lo entrega la pestaña Manual: portada (con su texto alternativo, o el aviso
 * de que falta), título y cuerpo con su formato y sus imágenes. Un post del mismo canal sigue como antes.
 * Marca y canal INVENTADOS: la regla sale de la regla del proveedor (`manual_paste`) y del formato, no de una red.
 */
const MANUALES = Object.entries(CHANNEL_LAYOUT_BY_PROVIDER).filter(([, l]) => l.text === 'manual_paste').map(([p]) => p);
const LIMPIA = 'https://storage.example/limpia.png';
const CUERPO = ['Entrada con **fuerza**.', '## Un subtítulo', 'Texto.', '![img-1]', '> Una cita.', 'https://blog.example/post'].join('\n\n');
const articulo = (image: Record<string, unknown>, format = 'article') => ({
  id: 'p1', brand_id: 'MarcaN1', platform: 'canal_manual_bajo_prueba', format, status: 'awaiting_approval',
  assets: {
    copy: { title: 'El título <b>', aife_filtered: CUERPO },
    image: { url: 'https://storage.example/portada.png', ...image },
    inline_images: [{ n: 1, url: 'https://storage.example/1.webp', alt: 'Una foto', status: 'ok' }],
  },
}) as unknown as ContentPiece;

describe('el artículo de un canal manual en la vista previa', () => {
  it('hay proveedores manuales en el mapa', () => {
    expect(MANUALES.length).toBeGreaterThan(0);
  });

  it('portada con su alt, título y cuerpo con subtítulo, negrita, cita e imagen; sin marcas a la vista', () => {
    for (const provider of MANUALES) {
      const html = buildHtml(articulo({ clean_url: LIMPIA, alt: 'Un invernadero al amanecer', alt_for: LIMPIA }), { provider });
      expect(html).toContain('<img src="https://storage.example/portada.png" alt="Un invernadero al amanecer" />');
      expect(html).toContain('Texto alternativo de la portada: Un invernadero al amanecer');
      expect(html).toContain('<h1 class="title">El título &lt;b&gt;</h1>');
      expect(html).toContain('<h2 class="sec">Un subtítulo</h2>');
      expect(html).toContain('<strong>fuerza</strong>');
      expect(html).toContain('<blockquote class="pull">Una cita.</blockquote>');
      expect(html).toContain('<img src="https://storage.example/1.webp" alt="Una foto"');
      expect(html).not.toMatch(/## |!\[img-|\*\*/);
    }
  });

  it('sin alt para ESTA foto, lo dice', () => {
    const html = buildHtml(articulo({ clean_url: 'https://storage.example/otra.png', alt: 'Viejo', alt_for: LIMPIA }), { provider: MANUALES[0] });
    expect(html).toContain('⚠ La portada todavía no tiene texto alternativo.');
    expect(html).not.toContain('Viejo');
  });

  it('un post del mismo canal sigue como antes: sin la vista de artículo', () => {
    const html = buildHtml(articulo({}, 'post'), { provider: MANUALES[0] });
    expect(html).not.toContain('Texto alternativo de la portada');
    expect(html).not.toContain('<h2 class="sec">');
  });
});
