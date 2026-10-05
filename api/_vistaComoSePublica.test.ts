import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  buildHtml, publishedTextOf, channelLayoutOf, editorialToHtml, esc,
  CHANNEL_LAYOUT_BY_PROVIDER, PROVIDERS_WITH_INLINE_EMPHASIS, type ContentPiece,
} from './_calibrationShared';
import fx from './_vistaComoSePublica.fixtures.json';

/**
 * 2026-10-05 — Sam: «la ui aún no se ve tal y como se vería publicada». La vista previa pintaba el
 * texto ADAPTADO en todos los canales, y los blogs publican el MAESTRO (con `##`, `>` y `![img-N]`);
 * además pintaba un <h1> en Instagram y Facebook, que no publican título.
 *
 * Las tres piezas del fixture son REALES, leídas con SELECT el 2026-10-05; el primer bloque prueba
 * que la transcripción es exacta contra los md5 que devolvió la base.
 */
const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

type Fixture = (typeof fx.piezas)[number];
const pieza = (f: Fixture) => f.piece as unknown as ContentPiece;
const porCaso = (caso: string) => fx.piezas.find((p) => p.caso === caso)!;
const blogs = fx.piezas.filter((p) => p.provider !== 'meta_graph');
const meta = porCaso('meta_graph');

/** El contenido del <div class="text"> del artefacto. */
function textoDelArtefacto(html: string): string {
  const i = html.indexOf('<div class="text"');
  const desde = html.indexOf('>', i) + 1;
  return html.slice(desde, html.indexOf('</div>\n', desde));
}

afterEach(() => vi.restoreAllMocks());

describe('el fixture es la pieza real, byte a byte', () => {
  it.each(fx.piezas.map((p) => [p.caso, p] as const))('%s: maestro, adaptado y título coinciden con los md5 de la base', (_c, f) => {
    const a = f.piece.assets;
    expect(md5(a.copy.aife_filtered)).toBe(f.db.master_md5);
    expect(md5(a.social.adapted[0].copy)).toBe(f.db.adapted_md5);
    expect(md5(a.copy.title)).toBe(f.db.title_md5);
  });

  it('meta: el copy_text del fixture es el de scheduled_posts', () => {
    expect(md5(meta.publicado.copy_text!)).toBe(meta.publicado.copy_text_md5);
  });
});

describe('publishedTextOf — el texto que publica cada canal', () => {
  it.each(blogs.map((p) => [p.caso, p] as const))('%s publica el MAESTRO, no el adaptado', (_c, f) => {
    const r = publishedTextOf(pieza(f), f.provider)!;
    expect(r.source).toBe('master_copy');
    expect(r.text).toBe(f.piece.assets.copy.aife_filtered.trim());
    expect(r.text).not.toBe(f.piece.assets.social.adapted[0].copy);
  });

  it('meta_graph publica el adaptado del canal con la firma canónica: igual a scheduled_posts.copy_text', () => {
    const r = publishedTextOf(pieza(meta), 'meta_graph')!;
    expect(r.source).toBe('channel_adapted');
    expect(r.text).toBe(meta.publicado.copy_text);
    // Y no es el adaptado crudo: el drenaje le pone la firma, que el adaptado no traía.
    expect(r.text).not.toBe(meta.piece.assets.social.adapted[0].copy);
  });

  it('la firma canónica es idempotente: un adaptado ya firmado no gana otra firma', () => {
    const firmado = { ...meta.piece, assets: { ...meta.piece.assets, social: { adapted: [{ platform: 'meta_ig', copy: meta.publicado.copy_text }] } } };
    expect(publishedTextOf(firmado as unknown as ContentPiece, 'meta_graph')!.text).toBe(meta.publicado.copy_text);
  });

  it('meta_graph sin adaptaciones: rama degradada — maestro sin marcas de imagen y con la firma', () => {
    const p = { id: 'x', brand_id: 'MarcaN1', platform: 'meta_ig', assets: {
      copy: { aife_filtered: 'Uno.\n\n![img-1]\n\nDos.' }, builder_meta: { signature_closer: { text: '— Firma' } } } };
    expect(publishedTextOf(p, 'meta_graph')).toEqual({ text: 'Uno.\n\nDos.\n\n— Firma', source: 'channel_degraded' });
  });

  it('meta_graph con adaptaciones de otros canales y ninguna para éste: el drenaje no publica', () => {
    const p = { platform: 'meta_ig', assets: { copy: { aife_filtered: 'M' }, social: { adapted: [{ platform: 'meta_fb', copy: 'F' }] } } };
    expect(publishedTextOf(p, 'meta_graph')).toEqual({ text: '', source: 'no_copy_for_channel' });
  });

  it('meta_graph lee el adaptado serializado como cadena y compara el canal sin mayúsculas, como el drenaje', () => {
    const p = { platform: 'META_IG', assets: { social: { adapted: JSON.stringify([{ platform: 'meta_ig', copy: 'Hola' }]) } } };
    expect(publishedTextOf(p, 'meta_graph')).toEqual({ text: 'Hola', source: 'channel_adapted' });
  });

  it('un proveedor fuera del mapa no se adivina: null', () => {
    expect(publishedTextOf(pieza(meta), 'proveedor_nuevo')).toBeNull();
    expect(publishedTextOf(pieza(meta), null)).toBeNull();
  });
});

describe('buildHtml — la vista como se publica', () => {
  it.each(blogs.map((p) => [p.caso, p] as const))('%s: subtítulos e imágenes dentro del texto, exactamente como el maestro', (_c, f) => {
    const html = buildHtml(pieza(f), { provider: f.provider });
    const master = f.piece.assets.copy.aife_filtered;
    // El cuerpo es el maestro pintado con la regla del publicador, ni más ni menos.
    expect(textoDelArtefacto(html)).toBe(editorialToHtml(master.trim(), esc, f.piece.assets.inline_images));
    const subtitulos = master.split('\n').filter((l) => /^## /.test(l)).length;
    expect(subtitulos).toBeGreaterThan(0);
    expect(html.match(/<h2 class="sec">/g)?.length).toBe(subtitulos);
    const listas = f.piece.assets.inline_images.filter((e) => e.status === 'ok');
    expect(html.match(/<figure class="inline-figure">/g)?.length).toBe(listas.length);
    for (const e of listas) expect(html).toContain(e.url);
    expect(html).not.toContain('![img-');
    expect(html).not.toMatch(/>## /);
  });

  it.each(blogs.map((p) => [p.caso, p] as const))('%s: título y después portada, como el renderizador del canal', (_c, f) => {
    const html = buildHtml(pieza(f), { provider: f.provider });
    const t = html.indexOf(`<h1 class="title">${esc(f.piece.assets.copy.title)}</h1>`);
    const portada = html.indexOf(f.piece.assets.image.url);
    expect(t).toBeGreaterThan(0);
    expect(portada).toBeGreaterThan(t);
    expect(html.indexOf('<div class="text"')).toBeGreaterThan(portada);
  });

  it('meta_graph: sin <h1>, medios y después el texto que salió en scheduled_posts', () => {
    const html = buildHtml(pieza(meta), { provider: 'meta_graph' });
    expect(html).not.toContain('<h1');
    expect(html).not.toContain(esc(meta.piece.assets.copy.title));
    expect(textoDelArtefacto(html)).toBe(esc(meta.publicado.copy_text!));
    expect(html.indexOf('<div class="text"')).toBeGreaterThan(html.indexOf(meta.piece.assets.image.url));
    // El maestro sigue disponible, plegado, para ver qué hizo la adaptación.
    expect(html).toContain('Ver el texto maestro');
  });

  it('un canal que publica título y la pieza no lo trae: se dice', () => {
    const f = porCaso('vercel_html');
    const sinTitulo = { ...f.piece, assets: { ...f.piece.assets, copy: { aife_filtered: 'Cuerpo.' } } };
    const html = buildHtml(sinTitulo as unknown as ContentPiece, { provider: 'vercel_html' });
    expect(html).not.toContain('<h1');
    expect(html).toContain('Sin título: este canal publica uno');
  });

  it('los medios son los mismos que antes: el bloque de imagen no cambia', () => {
    for (const f of fx.piezas) {
      const antes = buildHtml(pieza(f), { provider: null });
      const media = antes.slice(antes.indexOf('    <div class="media'), antes.indexOf('\n    <div class="body">'));
      expect(media.length).toBeGreaterThan(20);
      expect(buildHtml(pieza(f), { provider: f.provider })).toContain(media);
    }
  });
});

/**
 * GOLDEN — calculado el 2026-10-05 con `buildHtml` de `origin/main` a612b24, ANTES de este cambio,
 * sobre las tres piezas del fixture. Lo que no debía cambiar, no cambió.
 */
const GOLDEN_SIN_PROVEEDOR: Record<string, string> = {
  vercel_html: '9ea7bdcdb0f84389289f09bb1d4f332287eac168f4a4b511cc0ce7c5099c222f',
  shopify_blog: 'c0802333a39133765142f8f7bd275b6d859f76f3da4d2ad2c535e5e25045b535',
  meta_graph: 'ed191f131311802645fdbb583a5568e709c235d4f2690a407113fcb9e06bd8e7',
};
const GOLDEN_MARCO: Record<string, { head: string; tail: string }> = {
  vercel_html: { head: 'c62346b5c7f1bbd69c0a856f0bc668537ecf8b24367572a77693d501cf5d7871', tail: '6f3a7da036899587908b0d06f0c9eb6096a83b1e6e38f3126fab99b5d16e832b' },
  shopify_blog: { head: '1c8a834be695e29fa1d9b21dc142f31fabf7ceb648e184ec65355e533f9e1b94', tail: 'eeb2a1250cffe5c50e6537a2500e497a1c0625c7f50fa7cc918883dbee5b6b05' },
  meta_graph: { head: '13b00b2dec80a4a1b1dce58eeb11744384252e9a7704f52fdf9d6f4fdd5507f7', tail: 'e042662bedce5cc8b6782a79ba5327d1c0162fd5d88ae5fd644b9384cfb38966' },
};
const AVISO_FUERA_DEL_MAPA = /\n {6}<div class="textsrc textsrc--warn">⚠ El proveedor «[^»]*» de este canal no está en el mapa de la vista publicada[^\n]*<\/div>/;

describe('golden — lo que no cambia', () => {
  it.each(fx.piezas.map((p) => [p.caso, p] as const))('%s: con el proveedor sin resolver, la vista es byte a byte la de antes', (_c, f) => {
    expect(sha(buildHtml(pieza(f), { provider: null }))).toBe(GOLDEN_SIN_PROVEEDOR[f.caso]);
  });

  it.each(fx.piezas.map((p) => [p.caso, p] as const))('%s: con un proveedor fuera del mapa, la de antes más UN aviso, y queda en el log', (_c, f) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = buildHtml(pieza(f), { provider: 'proveedor_texto_plano' });
    expect(html).toMatch(AVISO_FUERA_DEL_MAPA);
    expect(sha(html.replace(AVISO_FUERA_DEL_MAPA, ''))).toBe(GOLDEN_SIN_PROVEEDOR[f.caso]);
    expect(log).toHaveBeenCalledWith('[preview] PREVIEW_PROVIDER_UNMAPPED', f.piece.brand_id, f.piece.platform, 'proveedor_texto_plano');
  });

  it.each(fx.piezas.map((p) => [p.caso, p] as const))('%s: con su proveedor, cabecera, estilos y pie son los de antes', (_c, f) => {
    const html = buildHtml(pieza(f), { provider: f.provider });
    expect(sha(html.slice(0, html.indexOf('    </div>\n') + 11))).toBe(GOLDEN_MARCO[f.caso].head);
    expect(sha(html.slice(html.indexOf('\n      <div class="meta">')))).toBe(GOLDEN_MARCO[f.caso].tail);
  });
});

describe('marca N+1 — una marca inventada, de otro rubro y otro país, entra por dato', () => {
  const N1 = 'MarcaInventadaN1';
  it('un blog de la marca nueva (su canal con proveedor de marcado) se ve como su publicador lo publica', () => {
    const p = { id: 'n1-blog', brand_id: N1, platform: 'blog_n1', format: 'post', assets: {
      copy: { title: 'Titre', aife_filtered: 'Intro.\n\n## Section\n\n![img-1]\n\nFin.' },
      image: { url: 'https://cdn.test/cover.png' },
      inline_images: [{ n: 1, status: 'ok', url: 'https://cdn.test/i1.png', alt: 'a' }],
      social: { adapted: [{ platform: 'blog_n1', copy: 'Intro. Section. Fin.' }] } } } as unknown as ContentPiece;
    for (const provider of ['vercel_html', 'shopify_blog']) {
      const html = buildHtml(p, { provider });
      expect(html).toContain('<h2 class="sec">Section</h2>');
      expect(html).toContain('https://cdn.test/i1.png');
      expect(html.indexOf('<h1 class="title">Titre</h1>')).toBeLessThan(html.indexOf('https://cdn.test/cover.png'));
    }
  });

  it('su canal social con meta_graph: adaptado firmado y sin título', () => {
    const p = { id: 'n1-ig', brand_id: N1, platform: 'canal_social_n1', assets: {
      copy: { title: 'Titre', aife_filtered: 'Maître.' },
      social: { adapted: [{ platform: 'canal_social_n1', copy: 'Adapté.' }] },
      builder_meta: { signature_closer: { text: '— N1' } } } } as unknown as ContentPiece;
    const html = buildHtml(p, { provider: 'meta_graph' });
    expect(textoDelArtefacto(html)).toBe('Adapté.\n\n— N1');
    expect(html).not.toContain('<h1');
  });

  it('el mapa y el bloque de la vista no nombran ninguna marca (sin comentarios: CC_PROTOCOL §14.1)', () => {
    const src = readFileSync(new URL('./_calibrationShared.ts', import.meta.url), 'utf8');
    const bloque = src.slice(src.indexOf('export type PublishedTextRule'), src.indexOf('function buildLegacyHtml'))
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(bloque.length).toBeGreaterThan(2000);
    for (const nombre of ['NeuroneSCF', 'ForumPHs', 'LucienSael', 'UnrealvilleStudio', 'brand_id ==', "brand_id === '"])
      expect(bloque).not.toContain(nombre);
    for (const k of Object.keys(CHANNEL_LAYOUT_BY_PROVIDER)) expect(k).toMatch(/^[a-z]+_[a-z]+$/);
  });

  it('los proveedores que publican el maestro son los mismos que pintan el formato editorial', () => {
    const maestro = Object.entries(CHANNEL_LAYOUT_BY_PROVIDER).filter(([, l]) => l.text === 'master').map(([k]) => k).sort();
    expect(maestro).toEqual([...PROVIDERS_WITH_INLINE_EMPHASIS].sort());
    expect(channelLayoutOf('  vercel_html ')).toEqual(CHANNEL_LAYOUT_BY_PROVIDER.vercel_html);
    expect(channelLayoutOf('toString')).toBeNull();
  });
});
