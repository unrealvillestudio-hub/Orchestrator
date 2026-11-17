/**
 * LA VENTANA VISUAL DEL TEXTO EN PANTALLA (Sam, 2026-11-17; boceto aprobado el mismo día).
 *
 * Cubre: las marcas por palabra ⇄ tramos del contrato (`textoMarcas.ts`); que el servidor valide los campos nuevos
 * (v1.4.0 estilos en línea y alineación, v1.7.0 `captions.keywords`) y los deje pasar a VideoLab; que el borrador los
 * conserve al reabrir y al aplicar; las miniaturas (una capa, un estilo); las palabras clave candidatas; el motor de
 * cada estilo como dato; y que la vista previa sólo LEE (no crea jobs ni escribe en la base).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  validateTextLayers, layersForVariant, keywordCandidatesOf, buildSceneBody, groupPresets, type PresetsByLayer, type TextLayers,
} from './_pieceText';
import {
  wordRanges, marksByWord, spansFromWords, toggleMark, markupOf, pruneMarks, contrastOnDark, keywordShare,
} from '../src/modules/iid/textoMarcas';
import { videoTextDraftOf, textLayersFromDraft, blockStyleOf, styleFields } from '../src/modules/iid/OnScreenTextEditor';
import { sceneFocusRect, sceneWindow } from '../src/modules/iid/TextoVisual';

const TXT = '¿Quieres usar el Fondo de Reserva para reparar la bomba? No puedes.';

describe('marcas por palabra ⇄ tramos literales', () => {
  it('las palabras y su posición', () => {
    expect(wordRanges('a  bb c').map((w) => [w.word, w.start])).toEqual([['a', 0], ['bb', 3], ['c', 6]]);
  });
  it('una racha de palabras es un tramo; dos rachas, dos tramos', () => {
    const m = [false, false, false, true, true, true, false, false, false, false, true, true];
    expect(spansFromWords(TXT, m)).toEqual(['Fondo de Reserva', 'No puedes.']);
  });
  it('los tramos marcan su PRIMERA aparición, como VideoLab', () => {
    const marks = marksByWord('el gato y el perro', { emphasis: ['el'] });
    expect(marks.map((s) => s.has('emphasis'))).toEqual([true, false, false, false, false]);
  });
  it('poner y quitar una marca', () => {
    const a = toggleMark(TXT, {}, 'italic_spans', [10, 11]);
    expect(a.ok && a.marks.italic_spans).toEqual(['No puedes.']);
    const b = a.ok ? toggleMark(TXT, a.marks, 'italic_spans', [10, 11]) : null;
    expect(b?.ok && b.marks.italic_spans).toBeUndefined();
  });
  it('más de 3 tramos se dice antes de mandar', () => {
    const r = toggleMark(TXT, {}, 'bold_spans', [0, 2, 4, 6]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/3 tramos/);
  });
  it('un tramo de más de 60 caracteres se dice antes de mandar', () => {
    const largo = 'una frase con muchas palabras seguidas que pasa de sesenta caracteres de largo sin duda';
    const r = toggleMark(largo, {}, 'color_spans', wordRanges(largo).map((_, i) => i));
    expect(r.ok).toBe(false);
  });
  it('el marcado del editor de imagen, y las marcas que ya no están en el texto se caen', () => {
    expect(markupOf('a b c', { emphasis: ['b'], bold_spans: ['c'] })).toBe('a ^b^ +c+');
    expect(pruneMarks('texto nuevo', { emphasis: ['viejo'], italic_spans: ['nuevo'] })).toEqual({ italic_spans: ['nuevo'] });
  });
  it('contraste sobre video oscuro y porcentaje de palabras clave', () => {
    expect(contrastOnDark('#FFFFFF')).toBeGreaterThan(10);
    expect(contrastOnDark('#5C3472')).toBeLessThan(3);
    expect(keywordShare(['El', 'Fondo,', 'de', 'Reserva'], ['fondo'])).toBe(25);
  });
});

const PRESETS = groupPresets([
  { preset_key: 'h1', layer: 'hook', name: 'H1', brand_id: null, status: 'proposed', spec: { engine: 'html' } },
  { preset_key: 'k1', layer: 'key_title', name: 'K1', brand_id: null, status: 'proposed', spec: {} },
  { preset_key: 'c1', layer: 'cta', name: 'C1', brand_id: null, status: 'proposed', spec: { engine: 'html' } },
  { preset_key: 'cap', layer: 'caption', name: 'Cap', brand_id: null, status: 'proposed', spec: { engine: 'html', active_word: { mode: 'keywords' } } },
  { preset_key: 'r1', layer: 'role', name: 'R1', brand_id: null, status: 'proposed', spec: {} },
], 'MarcaA') as PresetsByLayer;
const CTX = { presets: PRESETS, accentRoles: ['acento_a', 'acento_b'], stripRoles: ['franja_a'], durationMs: 60000, castIds: ['p-1'] };
const BASE = {
  hook: { text: TXT, preset_key: 'h1', start_ms: 0, end_ms: 2800, emphasis: ['Fondo de Reserva'] },
  roles: [], captions: null, key_titles: [], cta: null, identity: { strip: false, identity_role: null },
};

describe('el motor y las palabras clave de cada estilo son dato', () => {
  it('engine y uses_keywords salen del spec', () => {
    expect(PRESETS.hook[0].engine).toBe('html');
    expect(PRESETS.key_title[0].engine).toBe('ass');
    expect(PRESETS.caption[0].uses_keywords).toBe(true);
    expect(PRESETS.hook[0].uses_keywords).toBeUndefined();
  });
});

describe('el servidor valida los campos nuevos y los deja pasar', () => {
  it('estilos en línea y alineación válidos pasan tal cual', () => {
    const v = validateTextLayers({ ...BASE, hook: { ...BASE.hook, align: 'left', emphasis_role: 'acento_b', italic_spans: ['No puedes.'], bold_spans: ['bomba?'], color_spans: ['reparar'] } }, CTX);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value.hook).toMatchObject({ align: 'left', emphasis_role: 'acento_b', italic_spans: ['No puedes.'], bold_spans: ['bomba?'], color_spans: ['reparar'], emphasis: ['Fondo de Reserva'] });
  });
  it('un tramo que no está en el texto, una alineación rara o un color ajeno son errores', () => {
    const v = validateTextLayers({ ...BASE, hook: { ...BASE.hook, align: 'justify', emphasis_role: 'ajeno', italic_spans: ['no existe'] } }, CTX);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      const e = v.errors.join(' | ');
      expect(e).toMatch(/align/); expect(e).toMatch(/emphasis_role/); expect(e).toMatch(/no aparece en el texto/);
    }
  });
  it('más de 3 tramos es un error', () => {
    const v = validateTextLayers({ ...BASE, hook: { ...BASE.hook, bold_spans: ['usar', 'el', 'para', 'la'] } }, CTX);
    expect(v.ok).toBe(false);
  });
  it('título clave y CTA aceptan los mismos campos', () => {
    const v = validateTextLayers({ ...BASE,
      key_titles: [{ text: 'Al menos el 1 %', at_ms: 1000, dur_ms: 2000, preset_key: 'k1', align: 'center', bold_spans: ['1 %'] }],
      cta: { text: 'Hágalo, reenvíeselo.', at_ms: 5000, preset_key: 'c1', color_spans: ['reenvíeselo.'], align: 'right' } }, CTX);
    expect(v.ok).toBe(true);
    if (v.ok) { expect(v.value.key_titles[0]).toMatchObject({ align: 'center', bold_spans: ['1 %'] }); expect(v.value.cta).toMatchObject({ align: 'right', color_spans: ['reenvíeselo.'] }); }
  });
  it('captions.keywords: hasta 12, sin repetir; más es un error', () => {
    const ok = validateTextLayers({ ...BASE, captions: { enabled: true, preset_key: 'cap', accent_role: 'acento_a', keywords: ['Fondo', 'Fondo', 'Reserva'] } }, CTX);
    expect(ok.ok && ok.value.captions?.keywords).toEqual(['Fondo', 'Reserva']);
    const mal = validateTextLayers({ ...BASE, captions: { enabled: true, preset_key: 'cap', accent_role: 'acento_a', keywords: Array.from({ length: 13 }, (_, i) => `p${i}`) } }, CTX);
    expect(mal.ok).toBe(false);
  });
});

describe('el borrador conserva los estilos al reabrir y al aplicar', () => {
  const prop = {
    presets: PRESETS, cast: [], accent_options: [], strip_options: [],
    proposals: { hooks: [{ text: TXT, pattern_key: 'p' }], key_phrases: [], share_ctas: [] },
  };
  it('lo guardado reabre con sus marcas, alineación y color, y vuelve igual', () => {
    const cur: TextLayers = { ...BASE, hook: { ...BASE.hook, align: 'right', emphasis_role: 'acento_a', italic_spans: ['No puedes.'] } } as any;
    const d = videoTextDraftOf({ ...prop, current: { text_layers: cur, hook: null } } as any);
    expect(d.hook.style).toEqual({ align: 'right', emphasis_role: 'acento_a', marks: { emphasis: ['Fondo de Reserva'], italic_spans: ['No puedes.'] } });
    const l = textLayersFromDraft(d, prop.proposals as any, 60000);
    expect(l.hook).toMatchObject({ align: 'right', emphasis_role: 'acento_a', emphasis: ['Fondo de Reserva'], italic_spans: ['No puedes.'] });
  });
  it('sin estilo, no viaja ningún campo de más', () => {
    expect(styleFields('hola', blockStyleOf(null))).toEqual({});
  });
  it('las palabras clave de los subtítulos viajan', () => {
    const d = videoTextDraftOf({ ...prop, current: { text_layers: { ...BASE, captions: { enabled: true, preset_key: 'cap', accent_role: 'acento_a', keywords: ['Fondo'] } }, hook: null } } as any);
    expect(textLayersFromDraft(d, prop.proposals as any, 60000).captions?.keywords).toEqual(['Fondo']);
  });
});

describe('miniaturas, palabras clave candidatas y pedido de escena', () => {
  const capas: TextLayers = { ...BASE, roles: [{ person_id: 'p-1', text: 'Nombre — Cargo', show: true, at_ms: 9000, dur_ms: 3000, preset_key: 'r1' }],
    key_titles: [{ text: 'Al menos el 1 %', at_ms: 12000, dur_ms: 2000, preset_key: 'k1' }] } as any;
  it('una miniatura lleva sólo su capa, con su estilo, desde el segundo 0', () => {
    const v = layersForVariant(capas, 'key_title', 'k-otro')!;
    expect(v.hook).toBeNull();
    expect(v.key_titles).toEqual([{ text: 'Al menos el 1 %', at_ms: 0, dur_ms: 2000, preset_key: 'k-otro', place: undefined }]);
    expect(layersForVariant(capas, 'cta', 'c1')).toBeNull();
    expect(layersForVariant(capas, 'role', 'r-otro')?.roles[0]).toMatchObject({ at_ms: 0, preset_key: 'r-otro' });
  });
  it('palabras clave candidatas: las de las frases que de verdad se dicen, de 4 letras o más', () => {
    const timeline = { words: [{ text: 'El' }, { text: 'Fondo' }, { text: 'de' }, { text: 'Reserva,' }, { text: 'paga' }] };
    expect(keywordCandidatesOf(timeline, ['El Fondo de Reserva', 'otra cosa'])).toEqual(['Fondo', 'Reserva']);
  });
  it('el pedido de escena es el del contrato §4 ter.6', () => {
    expect(buildSceneBody({ brandId: 'MarcaA', platform: 'plat', timeline: { words: [] }, durationMs: 60000, textLayers: capas }))
      .toEqual({ brandId: 'MarcaA', params: { platform: 'plat', format: 'reel' }, previousOutputs: { text_layers: capas, timeline: { words: [] } }, duration_ms: 60000 });
  });
  it('la miniatura enfoca los bloques y la ventana de tiempo es la de la escena', () => {
    const scene = { canvas: { width: 1080, height: 1920 }, blocks: [{ rect: { x: 100, y: 200, w: 400, h: 100 }, start_ms: 500, end_ms: 2500 }] };
    expect(sceneFocusRect(scene, 10)).toEqual({ x: 90, y: 190, w: 420, h: 120 });
    expect(sceneWindow(scene)).toEqual({ start: 500, end: 2500 });
  });
});

describe('la vista previa sólo lee', () => {
  const src = readFileSync('api/piece-text.ts', 'utf8');
  const escenas = src.slice(src.indexOf('async function escenas'), src.indexOf('async function aplicar'));
  it('no crea jobs, no escribe en la base y llama a /api/text-scene', () => {
    expect(escenas).toMatch(/\/api\/text-scene/);
    expect(escenas).not.toMatch(/guardarAssets|lab_jobs|method: 'PATCH'|\/api\/execute|buildVideoLabBody/);
  });
  it('la dirección de VideoLab sale de lab_configs, no del código', () => {
    expect(escenas).toMatch(/lab_configs\?lab_key=eq\.videolab/);
    expect(src).not.toMatch(/https:\/\/[a-z0-9-]*video-lab/i);
  });
  it('ningún archivo nuevo nombra una marca', () => {
    const MARCAS = /NeuroneSCF|ForumPHs|LucienSael|SamPublisher|D7Herbal|VivoseMask|VizosCosmetics|DiamondDetails|PatriciaOsorio/i;
    for (const f of ['src/modules/iid/TextoVisual.tsx', 'src/modules/iid/textoMarcas.ts']) expect(readFileSync(f, 'utf8')).not.toMatch(MARCAS);
  });
});
