import { describe, it, expect } from 'vitest';
import {
  canonicalizeSignature, manualTextOf, manualImagesOf, buildManualItems, manualChannelKey,
  cleanPostLink, manualDrainRow, manualPasteOf,
  ARTICLE_FORMAT, CAROUSEL_FORMAT, manualArticleOf, articleBodyHtml, articleBodyText,
  type ManualPieceInput, type ManualSlotRow,
} from './_manualShared.js';

// Identificadores ficticios a propósito: si la lógica dependiera de una marca o un canal reales,
// estas pruebas fallarían.
const BRAND = 'BrandAlpha';
const MANUAL = 'surface_manual';
const OTHER = 'surface_other';
const SIG = 'Firma — de la voz.';

function piece(over: Partial<ManualPieceInput> = {}, assets: ManualPieceInput['assets'] = {}): ManualPieceInput {
  return { id: 'p-1', brand_id: BRAND, platform: MANUAL, format: 'post', assets, ...over };
}

describe('canonicalizeSignature — misma regla que el drenaje', () => {
  it('pone la firma una sola vez, al final, detrás de los hashtags', () => {
    expect(canonicalizeSignature(`Cuerpo\n\n${SIG}\n\n#uno #dos`, SIG)).toBe(`Cuerpo\n\n#uno #dos\n\n${SIG}`);
  });
  it('es idempotente', () => {
    const una = canonicalizeSignature('Cuerpo', SIG);
    expect(canonicalizeSignature(una, SIG)).toBe(una);
  });
  it('sin firma declarada no toca el texto', () => {
    expect(canonicalizeSignature('Cuerpo', null)).toBe('Cuerpo');
  });
});

describe('manualTextOf — título + cuerpo + hashtags + firma en un bloque', () => {
  const assets = {
    copy: { title: 'El título', aife_filtered: 'Maestro #m', raw: 'Crudo' },
    social: { adapted: [{ platform: OTHER, copy: 'Otro canal' }, { platform: MANUAL, copy: 'Adaptado #tag' }] },
    builder_meta: { signature_closer: { text: SIG } },
  };
  it('usa el adaptado del canal de la franja y le pone título y firma', () => {
    expect(manualTextOf(piece({}, assets), MANUAL)).toBe(`El título\n\nAdaptado #tag\n\n${SIG}`);
  });
  it('acepta el adaptado serializado como cadena', () => {
    const a = { ...assets, social: { adapted: JSON.stringify(assets.social.adapted) } };
    expect(manualTextOf(piece({}, a), MANUAL)).toBe(`El título\n\nAdaptado #tag\n\n${SIG}`);
  });
  it('sin adaptado del canal cae al texto juzgado', () => {
    expect(manualTextOf(piece({}, assets), 'surface_sin_adaptado')).toBe(`El título\n\nMaestro #m\n\n${SIG}`);
  });
  it('no repite el título si el texto ya abre con él', () => {
    const a = { ...assets, social: { adapted: [{ platform: MANUAL, copy: 'El título\n\nCuerpo' }] } };
    expect(manualTextOf(piece({}, a), MANUAL)).toBe(`El título\n\nCuerpo\n\n${SIG}`);
  });
});

describe('manualImagesOf — las fotos en el orden en que se publican', () => {
  it('carrusel: láminas ordenadas por n', () => {
    const p = piece({ format: 'carousel' }, {
      image: { url: 'https://cdn/portada.png' },
      carousel: { slides: [{ n: 2, url: 'https://cdn/2.png' }, { n: 1, url: 'https://cdn/1.png' }] },
    });
    expect(manualImagesOf(p)).toEqual(['https://cdn/1.png', 'https://cdn/2.png']);
  });
  it('carrusel con una sola lámina válida: la portada', () => {
    const p = piece({ format: 'carousel' }, { image: { url: 'https://cdn/portada.png' }, carousel: { slides: [{ n: 1, url: 'https://cdn/1.png' }] } });
    expect(manualImagesOf(p)).toEqual(['https://cdn/portada.png']);
  });
  it('sin imagen: lista vacía', () => {
    expect(manualImagesOf(piece())).toEqual([]);
  });
});

describe('buildManualItems — sólo canales manuales, lo atrasado primero', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const slots: ManualSlotRow[] = [
    { id: 's-2', brand_id: BRAND, platform_key: MANUAL, slot_at: '2026-10-02T00:00:00Z', status: 'reserved', piece_id: 'p-2' },
    { id: 's-1', brand_id: BRAND, platform_key: MANUAL, slot_at: '2026-09-30T13:00:00Z', status: 'manual_pending', piece_id: 'p-1' },
    { id: 's-3', brand_id: BRAND, platform_key: OTHER, slot_at: '2026-09-30T13:00:00Z', status: 'reserved', piece_id: 'p-3' },
    { id: 's-4', brand_id: BRAND, platform_key: MANUAL, slot_at: '2026-09-30T13:00:00Z', status: 'manual_pending', piece_id: 'p-desconocida' },
  ];
  const pieces = new Map<string, ManualPieceInput>([
    ['p-1', piece({ id: 'p-1' }, { copy: { raw: 'Uno' } })],
    ['p-2', piece({ id: 'p-2' }, { copy: { raw: 'Dos' } })],
    ['p-3', piece({ id: 'p-3', platform: OTHER }, { copy: { raw: 'Tres' } })],
  ]);
  const items = buildManualItems(slots, new Set([manualChannelKey(BRAND, MANUAL)]), pieces, { [BRAND]: 'America/New_York' }, now);

  it('excluye canales no manuales y franjas sin pieza legible', () => {
    expect(items.map((i) => i.slot_id)).toEqual(['s-1', 's-2']);
  });
  it('marca como «toca ya» lo que ya pasó', () => {
    expect(items.map((i) => i.due)).toEqual([true, false]);
  });
  it('lleva el huso de la marca', () => {
    expect(items[0].timezone).toBe('America/New_York');
  });
});

describe('«Publicada» — el link es la prueba', () => {
  it('acepta un enlace http(s) y lo devuelve limpio', () => {
    expect(cleanPostLink('  https://surface.example/p/123  ')).toBe('https://surface.example/p/123');
  });
  it('rechaza lo que no es un enlace', () => {
    for (const v of ['', '   ', 'publicado', 'ftp://x/y', 'https://a b', null, undefined, 42]) {
      expect(cleanPostLink(v)).toBeNull();
    }
  });
  it('la fila de bitácora cumple la prueba del efecto: PUBLISHED con post y fecha', () => {
    const row = manualDrainRow(
      { id: 's-1', brand_id: BRAND, platform_key: MANUAL, slot_at: '2026-10-01T00:00:00Z', piece_id: 'p-1' },
      'https://surface.example/p/1', 'run-1', '2026-10-01T10:00:00Z');
    expect(row.outcome).toBe('PUBLISHED');
    expect(row.platform_post_id).toBe('https://surface.example/p/1');
    expect(row.published_at).toBe('2026-10-01T10:00:00Z');
    expect(row.slot_id).toBe('s-1');
    expect(row.piece_id).toBe('p-1');
  });
});

describe('artículo — título, portada y cuerpo por separado', () => {
  const POST = 'https://blog.example/post/uno';
  const CUERPO = [
    'Primer párrafo con **negrita**.',
    '## Un subtítulo',
    'Segundo párrafo.\nCon salto simple.',
    POST,
  ].join('\n\n');
  const assets: ManualPieceInput['assets'] = {
    copy: { title: 'El título del artículo', aife_filtered: CUERPO, raw: 'Crudo' },
    image: { url: 'https://storage.example/portada.png' },
    builder_meta: { signature_closer: { text: SIG } },
    source_piece: { piece_id: 'p-origen', post_url: POST, title: 'Post original' },
  };
  const art = () => piece({ format: ARTICLE_FORMAT }, assets);

  it('la constante es un formato, distinta del carrusel', () => {
    expect(ARTICLE_FORMAT).toBe('article');
    expect(ARTICLE_FORMAT).not.toBe(CAROUSEL_FORMAT);
  });

  it('el título va aparte, en texto plano', () => {
    expect(manualArticleOf(art(), MANUAL).title).toBe('El título del artículo');
  });

  it('el cuerpo NO lleva el título delante y lleva la firma una vez, al final', () => {
    const md = manualArticleOf(art(), MANUAL).body_markdown;
    expect(md.startsWith('El título')).toBe(false);
    expect(md).toBe(`${CUERPO}\n\n${SIG}`);
    expect(md.split(SIG).length - 1).toBe(1);
  });

  it('la firma que ya venía dentro del cuerpo no se duplica', () => {
    const a = { ...assets, copy: { ...assets!.copy, aife_filtered: `${CUERPO}\n\n${SIG}` } };
    expect(manualArticleOf(piece({ format: ARTICLE_FORMAT }, a), MANUAL).body_markdown).toBe(`${CUERPO}\n\n${SIG}`);
  });

  it('sin `aife_filtered` cae a `raw`', () => {
    const a = { ...assets, copy: { title: 'T', raw: 'Sólo crudo' } };
    expect(manualArticleOf(piece({ format: ARTICLE_FORMAT }, a), MANUAL).body_markdown).toBe(`Sólo crudo\n\n${SIG}`);
  });

  it('HTML: subtítulo, negrita, párrafos, enlace al original y firma', () => {
    expect(manualArticleOf(art(), MANUAL).body_html).toBe(
      '<p>Primer párrafo con <strong>negrita</strong>.</p>'
      + '<h2>Un subtítulo</h2>'
      + '<p>Segundo párrafo.<br>Con salto simple.</p>'
      + `<p><a href="${POST}">${POST}</a></p>`
      + `<p>${SIG}</p>`,
    );
  });

  it('HTML seguro: se escapa todo antes de interpretar nada', () => {
    const html = articleBodyHtml('<script>alert(1)</script> **<b>x</b>**\n\n## <img src=x onerror=y>');
    expect(html).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt; <strong>&lt;b&gt;x&lt;/b&gt;</strong></p>'
      + '<h2>&lt;img src=x onerror=y&gt;</h2>',
    );
  });

  it('HTML seguro: sólo enlaza http(s), y nunca un esquema peligroso', () => {
    const html = articleBodyHtml('Uno\n\njavascript:alert(1) data:text/html,x https://ok.example/a?b=1&c="2"', 1);
    expect(html).not.toContain('href="javascript');
    expect(html).not.toContain('href="data');
    expect(html).toContain('<a href="https://ok.example/a?b=1&amp;c=">https://ok.example/a?b=1&amp;c=</a>');
  });

  it('HTML: la URL sólo se enlaza en el párrafo del original, no en el resto', () => {
    const html = articleBodyHtml('Ver https://a.example/x.\n\nhttps://b.example/y', 1);
    expect(html).toBe('<p>Ver https://a.example/x.</p><p><a href="https://b.example/y">https://b.example/y</a></p>');
  });

  it('HTML: la puntuación final no forma parte del enlace', () => {
    expect(articleBodyHtml('Original: https://b.example/y.', 0))
      .toBe('<p>Original: <a href="https://b.example/y">https://b.example/y</a>.</p>');
  });

  it('texto plano: sin `## ` ni marcas de negrita', () => {
    expect(articleBodyText('## Sub\n\nTexto **fuerte**.')).toBe('Sub\n\nTexto fuerte.');
    expect(manualArticleOf(art(), MANUAL).body_text).not.toMatch(/##|\*\*/u);
  });

  it('portada y original: sólo enlaces http(s)', () => {
    const a = manualArticleOf(art(), MANUAL);
    expect(a.cover_url).toBe('https://storage.example/portada.png');
    expect(a.source_url).toBe(POST);
    const sinDatos = manualArticleOf(piece({ format: ARTICLE_FORMAT }, {
      copy: { title: 'T', raw: `Cuerpo\n\n${POST}` }, image: { url: 'javascript:alert(1)' },
    }), MANUAL);
    expect(sinDatos.cover_url).toBeNull();
    expect(sinDatos.source_url).toBe(POST); // sin `source_piece`, el último párrafo del cuerpo
  });

  it('buildManualItems añade `article` sólo a los artículos y no toca `text`', () => {
    const now = new Date('2026-10-22T12:00:00Z');
    const slots: ManualSlotRow[] = [
      { id: 's-a', brand_id: BRAND, platform_key: MANUAL, slot_at: '2026-10-22T10:00:00Z', status: 'manual_pending', piece_id: 'p-a' },
      { id: 's-p', brand_id: BRAND, platform_key: MANUAL, slot_at: '2026-10-22T11:00:00Z', status: 'manual_pending', piece_id: 'p-p' },
    ];
    const pieces = new Map<string, ManualPieceInput>([
      ['p-a', piece({ id: 'p-a', format: ARTICLE_FORMAT }, assets)],
      ['p-p', piece({ id: 'p-p', format: 'post' }, assets)],
    ]);
    const [a, p] = buildManualItems(slots, new Set([manualChannelKey(BRAND, MANUAL)]), pieces, null, now);
    expect(a.article?.title).toBe('El título del artículo');
    expect(a.text).toBe(manualPasteOf(pieces.get('p-a')!, MANUAL).text);
    expect(p.article).toBeUndefined();
    expect(p.text).toBe(`El título del artículo\n\n${CUERPO}\n\n${SIG}`);
  });
});
