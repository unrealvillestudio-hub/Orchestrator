import { describe, it, expect } from 'vitest';
import { buildHtml, blocksOf, hasBlockMarks, PROVIDERS_WITH_INLINE_EMPHASIS, type ContentPiece } from './_calibrationShared';

/**
 * 2026-10-02 — F1 (Sam: «markdown mínimo»). La bandeja muestra lo que publica el CANAL: en un blog,
 * `## Subtítulo` como subtítulo y `> Cita` como cita; en un canal de texto plano, las marcas tal
 * cual y un aviso. Mismo contrato que los `api/_inline.js` de los sitios y `blog-promoter`.
 */
const texto = 'Lede with **bold**.\n\n## The **mechanism**\n\nA # and a > inside a sentence.\n\n> One line\n> two lines';
const pieza = {
  id: 'p1', brand_id: 'MarcaN1', platform: 'canal_bajo_prueba', status: 'awaiting_approval',
  assets: { copy: { title: 'T', aife_filtered: texto } },
} as ContentPiece;

describe('el formato editorial en la vista previa', () => {
  it('blocksOf reconoce sólo ## y > al principio del bloque', () => {
    expect(blocksOf(texto).map((b) => b.t)).toEqual(['p', 'h', 'p', 'quote']);
    expect(hasBlockMarks('Text with a # and a > in it.')).toBe(false);
  });

  it('un canal de blog pinta subtítulo y cita, sin marcas a la vista', () => {
    for (const provider of PROVIDERS_WITH_INLINE_EMPHASIS) {
      const html = buildHtml(pieza, { provider });
      expect(html).toContain('<h2 class="sec">The mechanism</h2>');
      expect(html).toContain('<blockquote class="pull">One line<br>\ntwo lines</blockquote>');
      expect(html).toContain('<p>A # and a &gt; inside a sentence.</p>');
      expect(html).not.toMatch(/## The|&gt; One line/);
      expect(html).not.toContain('saldrían visibles');
    }
  });

  it('entre bloques quedan saltos de línea: el texto legible (textContent) no pega los párrafos', () => {
    const html = buildHtml(pieza, { provider: 'vercel_html' });
    const cuerpo = html.slice(html.indexOf('<div class="text" data-rich>'));
    const plano = cuerpo.slice(0, cuerpo.indexOf('</div>')).replace(/<[^>]+>/g, '');
    expect(plano).toContain('Lede with bold.\n\nThe mechanism\n\nA # and a &gt; inside a sentence.');
  });

  it('el subtítulo va escapado', () => {
    const malo = { ...pieza, assets: { copy: { title: 'T', aife_filtered: '## <img src=x onerror=alert(1)>' } } } as ContentPiece;
    const html = buildHtml(malo, { provider: 'vercel_html' });
    expect(html).toContain('<h2 class="sec">&lt;img src=x onerror=alert(1)&gt;</h2>');
  });

  it('un canal de texto plano muestra las marcas literales y avisa, aunque no haya negrita', () => {
    const sinNegrita = { ...pieza, assets: { copy: { title: 'T', aife_filtered: 'Intro.\n\n## Heading\n\nBody.' } } } as ContentPiece;
    const html = buildHtml(sinNegrita, { provider: 'proveedor_texto_plano' });
    expect(html).toContain('## Heading');
    expect(html).not.toContain('<h2 class="sec">');
    expect(html).toContain('saldrían visibles tal cual');
  });
});
