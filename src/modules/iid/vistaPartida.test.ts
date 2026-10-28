import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { partirVista } from './vistaPartida';
import { researchCaseHeadline } from './pieceActions';

const doc = (media: string) => `<html><head><style>.x{}</style></head><body><div class="head">M · ig</div>${media}<div class="body">Texto</div></body></html>`;

describe('la vista previa partida en imagen y texto (Sam, 2026-10-28)', () => {
  it('una imagen: sale su dirección y el texto queda con el bloque oculto', () => {
    const v = partirVista(doc('<div class="media"><img src="https://x/a.png?x=1&amp;y=2" alt="preview" /></div>'))!;
    expect(v.imagenes).toEqual(['https://x/a.png?x=1&y=2']);
    expect(v.carrusel).toBe(false);
    expect(v.textoHtml).toContain('<style>.media{display:none!important}</style></head>');
    expect(v.textoHtml).toContain('<div class="body">Texto</div>');
  });

  it('un carrusel: todas las láminas en orden', () => {
    const v = partirVista(doc('<div class="media carousel" aria-label="Carrusel de 2 láminas">\n<div class="strip"><figure class="slide"><img src="https://x/1.png" alt="lámina 1" /><figcaption>1 / 2</figcaption></figure><figure class="slide"><img src="https://x/2.png" alt="lámina 2" /><figcaption>2 / 2</figcaption></figure></div>\n<div class="carousel-note">Carrusel · 2 láminas</div>\n</div>'))!;
    expect(v.carrusel).toBe(true);
    expect(v.imagenes).toEqual(['https://x/1.png', 'https://x/2.png']);
  });

  it('sin imagen, o sin artefacto todavía, no se parte nada', () => {
    const solo = doc('<div class="media media--none">Sin imagen (canal solo-texto)</div>');
    expect(partirVista(solo)).toEqual({ imagenes: [], carrusel: false, textoHtml: solo });
    expect(partirVista(doc(''))!.imagenes).toEqual([]);
    expect(partirVista(null)).toBeNull();
  });

  it('las imágenes en línea del cuerpo no se confunden con la de la pieza', () => {
    const v = partirVista(doc('<div class="media"><img src="https://x/a.png" /></div><figure class="inline-figure"><img src="https://x/b.png"></figure>'))!;
    expect(v.imagenes).toEqual(['https://x/a.png']);
  });
});

describe('la investigación, abajo de todo y plegada', () => {
  it('el título dice qué es y cuántas fuentes', () => {
    expect(researchCaseHeadline({ tone: 'ok', text: 'x', link: null, sources: [{ url: 'u', title: 't' }, { url: 'v', title: 't' }] })).toBe('Investigación terminada · 2 fuentes');
    expect(researchCaseHeadline({ tone: 'wait', text: 'x', link: null, sources: [] })).toBe('Investigación en curso');
  });
});

describe('la tarjeta por zonas: el orden de Sam', () => {
  const MOD = readFileSync(new URL('./pieceActions.tsx', import.meta.url), 'utf8');
  it('imagen y sus correcciones, texto, lectura y las suyas, veredicto, investigación plegada al final', () => {
    const i = MOD.indexOf('if (textView !== undefined) {');
    const zonas = MOD.slice(i, MOD.indexOf('\n  return (\n', i + 10) > 0 ? MOD.indexOf('\n  }\n', i) : undefined);
    const orden = ['{media}', "enZona('imagen'", '{textView}', '{reader}', "enZona('texto'", '{beforeVerdict}', "enZona('veredicto'", 'plegada />'];
    const pos = orden.map((t) => zonas.indexOf(t));
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
  });
  it('Calibración y Publicación montan la tarjeta por zonas', () => {
    for (const f of ['ApprovalCalibrationModule.tsx', 'PublishQueueModule.tsx']) {
      const m = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
      expect(m, f).toContain('media={<ImagenSiHay vista={vista} pieceId={piece.piece_id} />}');
    }
  });
});
