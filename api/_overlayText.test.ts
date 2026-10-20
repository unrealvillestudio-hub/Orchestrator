import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { imageOverlayOf, overlayMarkupOf, parseOverlayMarkup, emphasisColorOptions, overlayEditorSeed, overlayViewAfterApply } from './_overlayText.js';

/**
 * EL TEXTO DE LA IMAGEN SE ESCRIBE EN LA BANDEJA (2026-10-19). Sam: ajustar «en sitio» dónde se corta cada
 * línea, qué palabras van resaltadas y el texto mismo, y que «solo cambie en la imagen». Los titulares de
 * estas pruebas son los de sus capturas del 2026-10-19.
 */
describe('del marcado a lo que el motor espera', () => {
  it('Enter es línea y *así* es resaltado', () => {
    expect(parseOverlayMarkup('¿Por qué el color\n*SE VA ANTES*\nde la próxima cita?'))
      .toEqual({ ok: true, headline: '¿Por qué el color\nSE VA ANTES\nde la próxima cita?', emphasis: ['SE VA ANTES'] });
  });
  it('líneas vacías y espacios sobran; un resaltado repetido cuenta una vez', () => {
    expect(parseOverlayMarkup('  Tu *PUNTA* y tu *RAÍZ*  \n\n no tienen la misma edad. '))
      .toEqual({ ok: true, headline: 'Tu PUNTA y tu RAÍZ\nno tienen la misma edad.', emphasis: ['PUNTA', 'RAÍZ'] });
  });
  it('lo que no se puede componer se dice antes de mandar nada', () => {
    expect(parseOverlayMarkup('').ok).toBe(false);
    expect(parseOverlayMarkup('Hola *mundo').ok).toBe(false);
    expect(parseOverlayMarkup('Hola ** mundo').ok).toBe(false);
    expect(parseOverlayMarkup('*a* *b* *c* *d*').ok).toBe(false);
    expect(parseOverlayMarkup('x'.repeat(301)).ok).toBe(false);
  });
});

describe('de lo que la imagen lleva al marcado', () => {
  it('marca el énfasis entre asteriscos, el más largo primero', () => {
    expect(overlayMarkupOf('Nunca te preguntó DÓNDE VIVES.', ['DÓNDE VIVES'])).toBe('Nunca te preguntó *DÓNDE VIVES*.');
    expect(overlayMarkupOf('75 MINUTOS de blowout. MENOS DE 5 en el estacionamiento.', ['75 MINUTOS', 'MENOS DE 5']))
      .toBe('*75 MINUTOS* de blowout. *MENOS DE 5* en el estacionamiento.');
  });
  it('ida y vuelta: el marcado de lo compuesto se vuelve a leer igual', () => {
    const h = '¿Por qué el color SE VA ANTES de la próxima cita?';
    expect(parseOverlayMarkup(overlayMarkupOf(h, ['SE VA ANTES']))).toEqual({ ok: true, headline: h, emphasis: ['SE VA ANTES'] });
  });
});

describe('lo que la tarjeta recibe', () => {
  it('lo escrito a mano manda y se marca como escrito', () => {
    expect(imageOverlayOf({ image: { overlay_override: { headline: 'A\nB', subheadline: null, emphasis: ['B'] }, overlay: { headline: 'otro' } } }))
      .toEqual({ headline: 'A\nB', subheadline: null, emphasis: ['B'], written: true, emphasis_role: null });
  });
  it('sin texto escrito, lo que se compuso', () => {
    expect(imageOverlayOf({ image: { overlay: { headline: 'Compuesto', subheadline: 'Bajada', emphasis: [] } } }))
      .toEqual({ headline: 'Compuesto', subheadline: 'Bajada', emphasis: [], written: false, emphasis_role: null });
  });
  it('sin imagen o sin texto, null', () => {
    expect(imageOverlayOf({})).toBeNull();
    expect(imageOverlayOf({ image: { overlay: null } })).toBeNull();
  });
});

describe('el cableado', () => {
  const sinComentarios = (src: string) => src.split('\n')
    .filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('{/*'); }).join('\n');
  const API = sinComentarios(readFileSync(new URL('./recompose-image.ts', import.meta.url), 'utf8'));
  const MOD = sinComentarios(readFileSync(new URL('../src/modules/iid/pieceActions.tsx', import.meta.url), 'utf8'));
  it('con texto de la imagen no se regenera la escena ni se pide directriz', () => {
    expect(API).toContain('if (tieneImagen && !directive && !conTexto) {');
    const i = API.indexOf('if (conTexto) {');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(API.indexOf("regenerate_image: true"), 'la rama del texto sale antes de la que regenera');
    expect(API.slice(i, i + 900)).toContain('regenerate_image: false');
    expect(API).toContain('if (ef.body.overlay_override_applied !== true) {');
  });
  it('el panel manda el texto parseado, y null para volver al copy', () => {
    expect(MOD).toContain('overlay_override: override');
    expect(MOD).toContain('submitOverlay(true)');
  });
});

// ── 2026-10-19 · el color del resaltado y el editor a la vista ──────────────────────────────────

describe('el color del resaltado', () => {
  // Una marca INVENTADA: sus roles y colores son dato, ninguno del ecosistema.
  const TOK = [
    { brand_id: 'MarcaX', canal: null, tokens: { palette: { headline_emphasis: 'oro' }, layout: { emphasis_contrast: { fallbacks: ['mar', 'oro', 'sin_hex'] } } } },
    { brand_id: 'MarcaX', canal: 'CAROUSEL', tokens: { palette: { headline_emphasis: 'otro' } } },
  ];
  const PAL = [{ role: 'oro', hex: '#D4A017' }, { role: 'mar', hex: '#1E5AA8' }, { role: 'otro', hex: '#000000' }];
  it('las opciones son las que la marca declara: la de siempre primero, sin repetir, sólo con hex', () => {
    expect(emphasisColorOptions(TOK, PAL, 'MarcaX')).toEqual([
      { role: 'oro', hex: '#D4A017', is_default: true },
      { role: 'mar', hex: '#1E5AA8', is_default: false },
    ]);
  });
  it('sin fila general de la marca, ninguna opción (el editor no muestra el selector)', () => {
    expect(emphasisColorOptions(TOK, PAL, 'OtraMarca')).toEqual([]);
  });
  it('el texto escrito conserva el color elegido', () => {
    expect(imageOverlayOf({ image: { overlay_override: { headline: 'A', emphasis: [], emphasis_role: 'mar' } } })?.emphasis_role).toBe('mar');
  });
});

describe('el cableado del editor', () => {
  const sin = (s: string) => s.split('\n').filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('{/*'); }).join('\n');
  const MOD = sin(readFileSync(new URL('../src/modules/iid/pieceActions.tsx', import.meta.url), 'utf8'));
  const API = sin(readFileSync(new URL('./recompose-image.ts', import.meta.url), 'utf8'));
  it('«Texto de la imagen» tiene su botón y abre el editor en su pestaña', () => {
    expect(MOD).toContain("onClick={() => { open('regen'); setRegenTab('text'); }}");
    expect(MOD).toContain('Texto de la imagen');
  });
  it('el color viaja si se tocó un chip (también el de siempre) y hay resaltado', () => {
    expect(MOD).toContain('...(overlayRole && parsed.emphasis.length ? { emphasis_role: overlayRole } : {})');
    // 2026-10-20 — medido en 6738a414: el chip de siempre mandaba null y el compositor lo cambiaba por contraste.
    expect(MOD).toContain('onClick={() => setOverlayRole(c.role)}');
    expect(MOD).not.toContain('setOverlayRole(c.is_default ? null : c.role)');
  });
  it('las fuentes de la investigación van plegadas', () => {
    expect(MOD).toContain('<details className="group">');
    expect(MOD).toContain("`Ver las ${s.sources.length} fuentes`");
  });
  it('el endpoint sirve los colores por GET y devuelve el cambio de modo del motor', () => {
    expect(API).toContain("if (req.method === 'GET') return coloresDelResaltado(req, res);");
    expect(API).toContain('mode_switched: ef.body.mode_switched ?? null,');
  });
  it('la tarjeta dice cuándo el carril repintó en lugar de editar', () => {
    // 2026-10-20 — diferencia declarada: el carril ya no repinta desde cero, pinta la misma escena con el cambio.
    expect(MOD).toContain('Se pintó la misma escena con el cambio: {regenNote.cambioDeModo}.');
  });
});

describe('el editor abre con el texto que la imagen lleva ahora (2026-10-20)', () => {
  // Medido en intel.piece_edits, pieza 5b842958: dos correcciones seguidas volvieron a escribir el texto de la primera.
  const sin = (s: string) => s.split('\n').filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('{/*'); }).join('\n');
  const MOD = sin(readFileSync(new URL('../src/modules/iid/pieceActions.tsx', import.meta.url), 'utf8'));
  const API = sin(readFileSync(new URL('./recompose-image.ts', import.meta.url), 'utf8'));
  it('la semilla del editor sale del texto vigente, con su resaltado y su color', () => {
    expect(overlayEditorSeed({ headline: 'Uno dos\ntres', subheadline: 'b', emphasis: ['dos'], written: true, emphasis_role: 'accent_x' }))
      .toEqual({ markup: 'Uno *dos*\ntres', sub: 'b', role: 'accent_x' });
    expect(overlayEditorSeed(null)).toEqual({ markup: '', sub: '', role: null });
  });
  it('después de aplicar, lo vigente es exactamente lo que se mandó; volver al copy no se conoce hasta releer', () => {
    const v = overlayViewAfterApply({ headline: 'A\nB', subheadline: null, emphasis: ['B'], emphasis_role: 'r' });
    expect(v).toEqual({ headline: 'A\nB', subheadline: null, emphasis: ['B'], written: true, emphasis_role: 'r' });
    expect(overlayEditorSeed(v).markup).toBe('A\n*B*');
    expect(overlayViewAfterApply(null)).toBeNull();
  });
  it('el editor ya no se siembra con lo que la tarjeta trajo al cargar', () => {
    expect(MOD).not.toContain('overlayMarkupOf(piece.image_overlay');
    expect(MOD).toContain('sembrarEditor(overlayVigente);');
    expect(MOD).toContain('setOverlayVigente(overlayViewAfterApply(override));');
    expect(MOD).toContain('if (r.overlay !== undefined) { setOverlayVigente(r.overlay); if (!overlayTocado.current) sembrarEditor(r.overlay); }');
  });
  it('el GET devuelve el texto vigente leído de la pieza', () => {
    expect(API).toContain('overlay: imageOverlayOf(piece.assets),');
  });
  it('una vista previa vieja que llega tarde no pisa la corregida, en las dos bandejas', () => {
    for (const f of ['ApprovalCalibrationModule.tsx', 'PublishQueueModule.tsx']) {
      const src = sin(readFileSync(new URL(`../src/modules/iid/${f}`, import.meta.url), 'utf8'));
      expect(src).toContain('if (alive && !rehecha.current) { setArtHtml(r.html); setArtUrl(r.artifact_url); }');
      expect(src).toContain('if (r.html) { rehecha.current = true; setArtHtml(r.html); setArtErr(null); }');
    }
  });
});
