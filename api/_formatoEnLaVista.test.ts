import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildHtml, blocksOf, hasBlockMarks, stripInlineImageMarks, INLINE_IMAGES_CONTRACT_MAX,
  PROVIDERS_WITH_INLINE_EMPHASIS, type ContentPiece,
} from './_calibrationShared';

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

/**
 * 2026-10-02 — F2 (Sam: imágenes dentro del artículo). Un bloque `![img-N]` cita la imagen `n = N`
 * de `assets.inline_images`. Se pinta SÓLO con entrada `ok` y url https; en cualquier otro caso el
 * bloque desaparece, y en un canal plano la marca se elimina. Marca inventada, valores disjuntos.
 */
describe('las imágenes dentro del artículo en la vista previa', () => {
  const URL_OK = 'https://cdn.marca-inventada.example/inline/1.webp';
  const cuerpo = 'Primer párrafo.\n\nSegundo párrafo.\n\n![img-1]\n\nTercer párrafo.\n\n![img-2]\n\nÚltimo.';
  const conImagenes = (inline_images: unknown, texto = cuerpo) => ({
    id: 'p-f2', brand_id: 'MarcaInventadaF2', platform: 'canal_inventado', status: 'scheduled',
    assets: { copy: { title: 'T', aife_filtered: texto }, inline_images },
  }) as unknown as ContentPiece;
  const FIG = `<figure class="inline-figure"><img src="${URL_OK}" alt="Una escena con &quot;comillas&quot;" loading="lazy" decoding="async"></figure>`;

  it('blocksOf reconoce la marca sólo cuando es el bloque entero, y sólo de 1 a 3', () => {
    expect(blocksOf(cuerpo).map((b) => b.t)).toEqual(['p', 'p', 'img', 'p', 'img', 'p']);
    expect(blocksOf('  ![img-3]  ')).toEqual([{ t: 'img', text: '![img-3]', n: 3 }]);
    expect(INLINE_IMAGES_CONTRACT_MAX).toBe(3);
    for (const noEsMarca of ['![img-4]', '![img-0]', 'Ver ![img-1] aquí.', '![img-1] y texto', '![IMG-1]'])
      expect(blocksOf(noEsMarca).map((b) => b.t)).toEqual(['p']);
  });

  it('entrada ok + https → figura con alt escapado, en el lugar de la marca', () => {
    for (const provider of PROVIDERS_WITH_INLINE_EMPHASIS) {
      const html = buildHtml(conImagenes([
        { n: 1, after: 1, focus: 'Segundo párrafo.', alt: 'Una escena con "comillas"', url: URL_OK, path: 'x/1.webp', status: 'ok' },
      ]), { provider });
      expect(html).toContain(FIG);
      expect(html.indexOf('Segundo párrafo.')).toBeLessThan(html.indexOf(FIG));
      expect(html.indexOf(FIG)).toBeLessThan(html.indexOf('Tercer párrafo.'));
      // La 2 no tiene entrada: desaparece. Ninguna marca queda a la vista.
      expect(html.match(/inline-figure"/g)?.length).toBe(1);
      expect(html).not.toContain('![img-');
    }
  });

  it('planned, failed, sin entrada o sin dato → el bloque no pinta nada', () => {
    const casos: unknown[] = [
      [{ n: 1, alt: 'a', url: URL_OK, status: 'planned' }],
      [{ n: 1, alt: 'a', url: URL_OK, status: 'failed' }],
      [{ n: 3, alt: 'a', url: URL_OK, status: 'ok' }],
      [],
      null,
      undefined,
      'no-es-un-array',
      [null, 7, { n: '1', url: URL_OK, status: 'ok' }],
    ];
    for (const inline of casos) {
      const html = buildHtml(conImagenes(inline), { provider: 'vercel_html' });
      expect(html).not.toContain('<figure class="inline-figure"');
      expect(html).not.toContain('![img-');
      expect(html).toContain('<p>Segundo párrafo.</p>\n\n<p>Tercer párrafo.</p>');
    }
  });

  it('una url que no es https no se pinta', () => {
    for (const url of ['http://cdn.marca-inventada.example/1.webp', 'javascript:alert(1)', '//cdn.example/1.webp', '', null]) {
      const html = buildHtml(conImagenes([{ n: 1, alt: 'a', url, status: 'ok' }]), { provider: 'vercel_html' });
      expect(html).not.toContain('<figure class="inline-figure"');
      expect(html).not.toContain('![img-');
    }
  });

  it('el alt va escapado y nunca rompe el atributo', () => {
    const html = buildHtml(conImagenes([{ n: 1, alt: '"><script>x</script>', url: URL_OK, status: 'ok' }]), { provider: 'vercel_html' });
    expect(html).toContain('alt="&quot;&gt;&lt;script&gt;x&lt;/script&gt;"');
    expect(html).not.toContain('<script>x');
  });

  it('un canal plano elimina la marca y no avisa por ella', () => {
    const inline = [{ n: 1, alt: 'a', url: URL_OK, status: 'ok' }];
    const html = buildHtml(conImagenes(inline), { provider: 'proveedor_texto_plano' });
    expect(html).not.toContain('![img-');
    expect(html).not.toContain('<figure class="inline-figure"');
    expect(html).toContain('Segundo párrafo.\n\nTercer párrafo.\n\nÚltimo.');
    expect(html).not.toContain('saldrían visibles');
    // Canal sin resolver: misma salida plana, sin la marca.
    expect(buildHtml(conImagenes(inline), { provider: null })).not.toContain('![img-');
  });

  it('stripInlineImageMarks deja intacto un texto sin marcas y no toca una marca a mitad de frase', () => {
    const sin = 'Uno.\n\n\nDos ![img-1] dentro.\n';
    expect(stripInlineImageMarks(sin)).toBe(sin);
    expect(stripInlineImageMarks('A.\n\n![img-2]\n\nB.')).toBe('A.\n\nB.');
    expect(hasBlockMarks('A.\n\n![img-1]\n\nB.')).toBe(false);
  });

  it('el bloque de imágenes no nombra ninguna marca del ecosistema', () => {
    const src = readFileSync(new URL('./_calibrationShared.ts', import.meta.url), 'utf8');
    const bloque = src.slice(src.indexOf('export const INLINE_IMAGES_CONTRACT_MAX'),
                             src.indexOf('export async function fetchChannelProvider'));
    expect(bloque.length).toBeGreaterThan(500);
    for (const nombre of ['NeuroneSCF', 'ForumPHs', 'LucienSael', 'UnrealvilleStudio', 'brand_id'])
      expect(bloque).not.toContain(nombre);
  });
});
