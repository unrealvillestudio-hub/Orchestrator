import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  buildHtml, publishedTextOf, channelLayoutOf, esc,
  CHANNEL_LAYOUT_BY_PROVIDER, type ContentPiece,
} from './_calibrationShared';
import { buildManualItems, manualChannelKey, manualTextOf, type ManualPieceInput } from './_manualShared';
import fx from './_vistaCanalesManuales.fixtures.json';

/**
 * 2026-10-06 — producción dejó `PREVIEW_PROVIDER_UNMAPPED UnrealvilleStudio linkedin linkedin_org`
 * (7 veces) y `... tiktok tiktok_business` (4) en `/api/preview-render`: el mapa por proveedor del
 * PR #68 no tenía los canales que publica una persona.
 *
 * Medido el mismo día: `linkedin_org`, `tiktok_business` y `x_api` son `publication_path = 'manual'`
 * en todas sus filas; lo que sale es el bloque que copia el botón «Copiar texto» de la pestaña
 * Manual (`manualTextOf`): título, línea en blanco, adaptado del canal con la firma. `klaviyo` no
 * tiene publicador de piezas y sigue fuera del mapa.
 *
 * Las tres piezas del fixture son REALES (una por proveedor, en una franja manual abierta).
 */
const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex');

type Fixture = (typeof fx.piezas)[number];
const pieza = (f: Fixture) => f.piece as unknown as ContentPiece;
const casos = fx.piezas.map((p) => [p.caso, p] as const);

/** El texto que Sam pega, escrito a mano desde las columnas, sin pasar por ninguna función. */
const bloqueEsperado = (f: Fixture) => `${f.piece.assets.copy.title}\n\n${f.piece.assets.social.adapted[0].copy}`;

/** El contenido del <div class="text"> del artefacto. */
function textoDelArtefacto(html: string): string {
  const i = html.indexOf('<div class="text"');
  const desde = html.indexOf('>', i) + 1;
  return html.slice(desde, html.indexOf('</div>\n', desde));
}

/** Lo que la pestaña Manual entregaría para esta pieza en una franja de su canal. */
function itemDeLaPestana(f: Fixture) {
  const p = f.piece as unknown as ManualPieceInput;
  const slot = { id: 's-1', brand_id: p.brand_id, platform_key: String(p.platform), slot_at: '2026-10-06T12:00:00Z', status: 'manual_pending', piece_id: p.id };
  const items = buildManualItems([slot], new Set([manualChannelKey(p.brand_id, String(p.platform))]), new Map([[p.id, p]]), null, new Date('2026-10-07T00:00:00Z'));
  expect(items).toHaveLength(1);
  return items[0];
}

afterEach(() => vi.restoreAllMocks());

describe('el fixture es la pieza real, byte a byte', () => {
  it.each(casos)('%s: maestro, adaptado y título coinciden con los md5 de la base', (_c, f) => {
    const a = f.piece.assets;
    expect(md5(a.copy.aife_filtered)).toBe(f.db.master_md5);
    expect(md5(a.social.adapted[0].copy)).toBe(f.db.adapted_md5);
    expect(md5(a.copy.title)).toBe(f.db.title_md5);
    expect(f.publication_path).toBe('manual');
  });
});

describe('publishedTextOf — el canal manual publica el bloque de «Copiar texto»', () => {
  it.each(casos)('%s: título, línea en blanco, adaptado del canal con la firma una vez', (_c, f) => {
    const r = publishedTextOf(pieza(f), f.provider)!;
    expect(r).not.toBeNull();
    expect(r.source).toBe('channel_adapted');
    expect(r.text).toBe(bloqueEsperado(f));
    const firma = f.piece.assets.builder_meta.signature_closer.text;
    expect(r.text.endsWith(`\n\n${firma}`)).toBe(true);
    expect(r.text.split(firma).length - 1).toBe(1);
  });

  it.each(casos)('%s: es exactamente lo que copia la pestaña Manual', (_c, f) => {
    const item = itemDeLaPestana(f);
    expect(publishedTextOf(pieza(f), f.provider)!.text).toBe(item.text);
    expect(item.text).toBe(manualTextOf(f.piece as unknown as ManualPieceInput, f.piece.platform));
  });

  it('el título es el de la pieza, no el del adaptado: la pestaña pega `copy.title`', () => {
    const f = fx.piezas.find((p) => p.caso === 'tiktok_business')!;
    expect(f.piece.assets.social.adapted[0].title).not.toBe(f.piece.assets.copy.title);
    const r = publishedTextOf(pieza(f), f.provider)!;
    expect(r.text.startsWith(`${f.piece.assets.copy.title}\n\n`)).toBe(true);
    expect(r.text).not.toContain(f.piece.assets.social.adapted[0].title);
  });

  it('sin adaptado para el canal: el maestro firmado, con el título delante, y se dice', () => {
    const f = fx.piezas.find((p) => p.caso === 'x_api')!;
    const otra = { ...f.piece, assets: { ...f.piece.assets, social: { adapted: [{ platform: 'otro_canal', copy: 'Otro.' }] } } };
    const r = publishedTextOf(otra as unknown as ContentPiece, 'x_api')!;
    expect(r.source).toBe('manual_master');
    expect(r.text).toBe(`${f.piece.assets.copy.title}\n\n${f.piece.assets.copy.aife_filtered}`);
    const html = buildHtml(otra as unknown as ContentPiece, { provider: 'x_api' });
    expect(html).toContain('la pestaña Manual entrega para pegar el TEXTO MAESTRO');
  });
});

describe('buildHtml — la vista del canal manual', () => {
  it.each(casos)('%s: medios y después el bloque pegado; sin <h1>', (_c, f) => {
    const html = buildHtml(pieza(f), { provider: f.provider });
    expect(textoDelArtefacto(html)).toBe(esc(bloqueEsperado(f)));
    expect(html).not.toContain('<h1');
    expect(html.indexOf('<div class="text"')).toBeGreaterThan(html.indexOf(f.piece.assets.image.url));
    // Las fotos son las que entrega la pestaña, en su orden.
    for (const u of itemDeLaPestana(f).images) expect(html).toContain(esc(u));
  });

  it.each(casos)('%s: el aviso de proveedor fuera del mapa desaparece, y no queda en el log', (_c, f) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = buildHtml(pieza(f), { provider: f.provider });
    expect(html).not.toContain('no está en el mapa de la vista publicada');
    expect(log).not.toHaveBeenCalledWith('[preview] PREVIEW_PROVIDER_UNMAPPED', expect.anything(), expect.anything(), expect.anything());
    expect(channelLayoutOf(f.provider)).toEqual({ text: 'manual_paste', publishesTitle: false, order: 'media_then_text' });
  });

  it.each(casos)('%s: el maestro sigue disponible, plegado, para ver qué hizo la adaptación', (_c, f) => {
    expect(buildHtml(pieza(f), { provider: f.provider })).toContain('Ver el texto maestro');
  });
});

describe('fail-loud — lo que no está medido sigue sin adivinarse', () => {
  const p = { id: 'k1', brand_id: 'MarcaInventadaN1', platform: 'canal_correo_n1', format: 'post', assets: {
    copy: { title: 'Asunto', aife_filtered: 'Cuerpo del correo.' }, social: { adapted: [{ platform: 'canal_correo_n1', copy: 'Adaptado.' }] } } } as unknown as ContentPiece;

  it.each(['klaviyo', 'proveedor_que_no_existe'])('%s: fuera del mapa → null, la vista de antes con su aviso, y queda en el log', (provider) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(channelLayoutOf(provider)).toBeNull();
    expect(publishedTextOf(p, provider)).toBeNull();
    const html = buildHtml(p, { provider });
    expect(html).toContain(`⚠ El proveedor «${provider}» de este canal no está en el mapa de la vista publicada`);
    expect(log).toHaveBeenCalledWith('[preview] PREVIEW_PROVIDER_UNMAPPED', 'MarcaInventadaN1', 'canal_correo_n1', provider);
  });

  it('el mapa tiene exactamente los proveedores medidos', () => {
    expect(Object.keys(CHANNEL_LAYOUT_BY_PROVIDER).sort()).toEqual(
      ['linkedin_org', 'meta_graph', 'shopify_blog', 'tiktok_business', 'vercel_html', 'x_api']);
  });
});

describe('marca N+1 — una marca inventada, de otro rubro y otro país, entra por dato', () => {
  const N1 = 'PanaderiaInventadaN1';
  const p = { id: 'n1-corto', brand_id: N1, platform: 'canal_corto_n1', format: 'post', assets: {
    copy: { title: 'Le pain du jour', aife_filtered: 'Maître long.' },
    image: { url: 'https://cdn.test/n1.png' },
    social: { adapted: [{ platform: 'canal_corto_n1', copy: 'Court. #pain' }] },
    builder_meta: { signature_closer: { text: '— N1' } } } } as unknown as ContentPiece;

  it.each(['linkedin_org', 'tiktok_business', 'x_api'])('su canal manual con %s se ve como lo pegaría Sam', (provider) => {
    const html = buildHtml(p, { provider });
    expect(textoDelArtefacto(html)).toBe(esc('Le pain du jour\n\nCourt. #pain\n\n— N1'));
    expect(html).not.toContain('<h1');
    expect(html.indexOf('https://cdn.test/n1.png')).toBeLessThan(html.indexOf('<div class="text"'));
  });

  it('el bloque nuevo no nombra ninguna marca (sin comentarios: CC_PROTOCOL §14.1)', () => {
    const quitar = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const cal = readFileSync(new URL('./_calibrationShared.ts', import.meta.url), 'utf8');
    const man = readFileSync(new URL('./_manualShared.ts', import.meta.url), 'utf8');
    const bloques = [
      quitar(cal.slice(cal.indexOf('export type PublishedTextRule'), cal.indexOf('function buildLegacyHtml'))),
      quitar(man.slice(man.indexOf('export function manualTextOf'), man.indexOf('export function manualImagesOf'))),
    ];
    for (const b of bloques) {
      expect(b.length).toBeGreaterThan(400);
      for (const nombre of ['NeuroneSCF', 'ForumPHs', 'LucienSael', 'UnrealvilleStudio', 'brand_id ==', "brand_id === '"])
        expect(b).not.toContain(nombre);
    }
  });
});
