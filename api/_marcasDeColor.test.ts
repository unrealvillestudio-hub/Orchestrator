import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { overlayMarkupOf, parseOverlayMarkup, overlayEditorSeed, boldPairsMarked, MARK_EMPHASIS, MARK_COLOR, MARK_BOLD } from './_overlayText.js';
import { parseSubMarkup, subMarkupOf, textStylePayload, textStyleDraftOf, SUB_EDITOR_HELP } from './_textStyle.js';
import { textStyleOf, textStyleWantsColor, textStyleWantsBold } from './_textStyleShape.js';
import { verificarTextoImagen } from './_verificarFormato.js';

/**
 * LAS MARCAS NUEVAS DEL TEXTO DE LA IMAGEN (Sam, 2026-10-29/30). «Aparte del resaltado por asteriscos que convierte el
 * texto resaltado en mayúsculas cerradas, haya otra opción para que resalte solo en color»; aprobado «Sí, así»:
 * `^así^` = el resaltado de la marca (como hasta hoy), `*así*` = sólo color, `_así_` = cursiva, `~así~` = sombra al revés.
 * Las piezas que ya existen guardan listas, no marcado: vuelven al editor con `^…^` y salen igual.
 */
describe('las marcas: ^ resaltado, * sólo color', () => {
  it('la tabla de marcas', () => {
    expect(MARK_EMPHASIS).toBe('^');
    expect(MARK_COLOR).toBe('*');
  });
  it('*así* es sólo color; ^así^ es el resaltado; se pueden anidar con _ y ~', () => {
    expect(parseOverlayMarkup('El *precio* de la ^cosecha^ _baja_'))
      .toEqual({ ok: true, headline: 'El precio de la cosecha baja', emphasis: ['cosecha'], shadow_spans: [], italic_spans: ['baja'], color_spans: ['precio'], bold_spans: [] });
    expect(parseOverlayMarkup('*_Uno dos_* ~tres~'))
      .toEqual({ ok: true, headline: 'Uno dos tres', emphasis: [], shadow_spans: ['tres'], italic_spans: ['Uno dos'], color_spans: ['Uno dos'], bold_spans: [] });
  });
  it('lo que no cierra se dice', () => {
    expect(parseOverlayMarkup('Hola *mundo')).toEqual({ ok: false, error: 'Un asterisco (*) de color sin pareja en «Hola *mundo».' });
    expect(parseOverlayMarkup('Hola ^mundo')).toEqual({ ok: false, error: 'Un acento circunflejo (^) de resaltado sin pareja en «Hola ^mundo».' });
    expect(parseOverlayMarkup('Hola ** mundo')).toEqual({ ok: false, error: 'Hay un tramo de color vacío (**).' });
    expect(parseOverlayMarkup('*a* *b* *c* *d*')).toEqual({ ok: false, error: 'Hay 4 tramos de color; el máximo es 3.' });
  });
  it('ida y vuelta: el marcado de lo compuesto se vuelve a leer igual', () => {
    const h = 'El precio de la cosecha baja';
    const m = overlayMarkupOf(h, ['cosecha'], [], ['baja'], ['precio']);
    expect(m).toBe('El *precio* de la ^cosecha^ _baja_');
    expect(parseOverlayMarkup(m)).toEqual({ ok: true, headline: h, emphasis: ['cosecha'], shadow_spans: [], italic_spans: ['baja'], color_spans: ['precio'], bold_spans: [] });
  });
  it('una pieza que ya existe (sólo `emphasis` guardado) abre con ^…^ y vuelve a mandar lo mismo', () => {
    const s = overlayEditorSeed({ headline: 'Nunca te preguntó DÓNDE VIVES.', subheadline: null, emphasis: ['DÓNDE VIVES'], written: true,
      emphasis_role: null, text_shadow: null, shadow_spans: [], rule_role: null } as any);
    expect(s.markup).toBe('Nunca te preguntó ^DÓNDE VIVES^.');
    const p = parseOverlayMarkup(s.markup);
    expect(p.ok && p.emphasis).toEqual(['DÓNDE VIVES']);
    expect(p.ok && p.color_spans).toEqual([]);
  });
  it('la semilla trae los tramos de color guardados en el bloque del titular', () => {
    const s = overlayEditorSeed({ headline: 'Uno dos tres', subheadline: null, emphasis: [], written: true, emphasis_role: null,
      text_shadow: null, shadow_spans: [], rule_role: null, text_style: { headline: { color_spans: ['dos'] } } } as any);
    expect(s.markup).toBe('Uno *dos* tres');
  });
});

describe('la bajada y lo que viaja', () => {
  it('la bajada con *color* y ^resaltado^ vuelve a su texto y a sus tramos', () => {
    const ts = textStyleOf({ sub: { emphasis: ['el vecino'], color_spans: ['el clima'] } });
    const m = subMarkupOf('No fue el clima. Fue el vecino.', ts);
    expect(m).toBe('No fue *el clima*. Fue ^el vecino^.');
    expect(parseSubMarkup(m)).toEqual({ ok: true, sub: 'No fue el clima. Fue el vecino.', emphasis: ['el vecino'], shadow_spans: [], italic_spans: [], color_spans: ['el clima'], bold_spans: [] });
  });
  it('color_spans viaja en el bloque, y el color elegido de la bajada vale también para sus tramos de color', () => {
    const d = textStyleDraftOf(null);
    expect(textStylePayload(d, { emphasis: [], shadow_spans: [], color_spans: ['el clima'] }, { color_spans: ['Uno'], bold_spans: [] }))
      .toEqual({ headline: { color_spans: ['Uno'] }, sub: { color_spans: ['el clima'] } });
    const conColor = { ...d, sub: { ...d.sub, emphasisRole: 'accent_x' } };
    expect(textStylePayload(conColor, { emphasis: [], shadow_spans: [], color_spans: ['el clima'], bold_spans: [] }))
      .toEqual({ sub: { emphasis_role: 'accent_x', color_spans: ['el clima'] } });
    expect(textStylePayload(conColor, { emphasis: [], shadow_spans: [], color_spans: [], bold_spans: [] })).toBeNull();
  });
  it('textStyleWantsColor', () => {
    expect(textStyleWantsColor({ headline: { color_spans: ['x'] } })).toBe(true);
    expect(textStyleWantsColor({ sub: { color_spans: [] }, headline: { italic_spans: ['x'] } })).toBe(false);
    expect(textStyleWantsColor(null)).toBe(false);
  });
  it('«Verificar formato» enseña el tramo de color', () => {
    const r = verificarTextoImagen('El *precio* ^baja^', 'titular');
    expect(r.ok && r.color_spans).toEqual(['precio']);
    expect(r.ok && r.tramos.find((t) => t.text === 'precio')).toEqual({ text: 'precio', resaltado: false, cursiva: false, sombra: false, color: true, negrita: false });
  });
});

describe('+así+ es negrita (2026-10-30, ImageLab ≥ 1.22.0)', () => {
  it('un par bien formado es negrita; un + suelto es texto', () => {
    expect(MARK_BOLD).toBe('+');
    expect(parseOverlayMarkup('El +precio+ baja')).toEqual({ ok: true, headline: 'El precio baja', emphasis: [], shadow_spans: [], italic_spans: [], color_spans: [], bold_spans: ['precio'] });
    for (const t of ['+50 % y +20 %', '1 + 1 = 2', 'Ahorra +30 %']) {
      const r = parseOverlayMarkup(t);
      expect(r.ok && r.headline).toBe(t);
      expect(r.ok && r.bold_spans).toEqual([]);
    }
    expect(boldPairsMarked('Sube +50 %+ hoy')).toBe('Sube \u000150 %\u0001 hoy');
  });
  it('se anida con las demás marcas, y vuelve igual al editor', () => {
    const p = parseOverlayMarkup('^+El contrato+^ y +_nada_+ más');
    expect(p).toEqual({ ok: true, headline: 'El contrato y nada más', emphasis: ['El contrato'], shadow_spans: [], italic_spans: ['nada'], color_spans: [], bold_spans: ['El contrato', 'nada'] });
    const m = overlayMarkupOf('El contrato y nada más', ['El contrato'], [], ['nada'], [], ['El contrato', 'nada']);
    expect(parseOverlayMarkup(m)).toEqual(p);
  });
  it('máximo 3 tramos en negrita', () => {
    expect(parseOverlayMarkup('+a+ +b+ +c+ +d+')).toEqual({ ok: false, error: 'Hay 4 tramos en negrita; el máximo es 3.' });
  });
  it('la bajada, lo que viaja y «Verificar formato»', () => {
    expect(parseSubMarkup('No fue +el clima+.')).toEqual({ ok: true, sub: 'No fue el clima.', emphasis: [], shadow_spans: [], italic_spans: [], color_spans: [], bold_spans: ['el clima'] });
    expect(subMarkupOf('No fue el clima.', textStyleOf({ sub: { bold_spans: ['el clima'] } }))).toBe('No fue +el clima+.');
    expect(textStylePayload(textStyleDraftOf(null), { emphasis: [], shadow_spans: [], bold_spans: ['el clima'] }, { bold_spans: ['Uno'] }))
      .toEqual({ headline: { bold_spans: ['Uno'] }, sub: { bold_spans: ['el clima'] } });
    expect(textStyleWantsBold({ headline: { bold_spans: ['x'] } })).toBe(true);
    expect(textStyleWantsBold({ headline: { color_spans: ['x'] } })).toBe(false);
    const r = verificarTextoImagen('El +precio+ baja', 'titular');
    expect(r.ok && r.tramos.find((t) => t.text === 'precio')).toEqual({ text: 'precio', resaltado: false, cursiva: false, sombra: false, color: false, negrita: true });
  });
  it('sin acuse del motor, 409 `text_bold_unsupported` (imagen y lámina)', () => {
    const RI = readFileSync(new URL('./recompose-image.ts', import.meta.url), 'utf8');
    expect(RI.match(/textStyleWantsBold\(/g)?.length).toBe(2);
    expect(RI.match(/ef\.body\.text_bold_applied !== true/g)?.length).toBe(2);
    expect(SUB_EDITOR_HELP).toContain('+así+ la negrita');
  });
});

describe('el cableado', () => {
  const PA = readFileSync(new URL('../src/modules/iid/pieceActions.tsx', import.meta.url), 'utf8');
  const RI = readFileSync(new URL('./recompose-image.ts', import.meta.url), 'utf8');
  it('el editor manda los tramos de color del titular y de la bajada', () => {
    expect(PA).toContain('{ italic_spans: parsed.italic_spans, color_spans: parsed.color_spans, bold_spans: parsed.bold_spans }');
    expect(PA).toContain('italic_spans: subP.italic_spans, color_spans: subP.color_spans, bold_spans: subP.bold_spans }, { emphasis_role_in_block: true })');
  });
  it('sin acuse del motor, 409 `text_color_unsupported` (imagen y lámina)', () => {
    expect(RI.match(/textStyleWantsColor\(/g)?.length).toBe(2);
    expect(RI.match(/ef\.body\.text_color_applied !== true/g)?.length).toBe(2);
    expect(RI.match(/error: 'text_color_unsupported'/g)?.length).toBe(2);
  });
  it('las ayudas nombran las marcas nuevas', () => {
    expect(SUB_EDITOR_HELP).toContain('^así^ resalta');
    expect(SUB_EDITOR_HELP).toContain('*así* cambia sólo el color');
    expect(PA).toContain("'Enter = nueva línea. ^Así^ = resaltado");
  });
});
