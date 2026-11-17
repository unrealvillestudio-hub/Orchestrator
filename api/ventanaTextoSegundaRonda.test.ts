/**
 * VENTANA DE TEXTO, SEGUNDA RONDA (Sam, 2026-11-17, después de probarla en producción).
 *
 * Cubre: el marcado escrito a mano (`^ _ + *`) pasa a marcas y deja el texto limpio, también en lo ya guardado; los
 * saltos de línea viajan hasta VideoLab; la cabecera plegada de las marcas dice lo que hay; y el doble «Aplicar» ya no
 * deja huérfano un render (ancla en el servidor y botón bloqueado mientras el pedido viaja).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseMarkup, mergeMarks } from '../src/modules/iid/textoMarcas';
import { ownWithMarkup, resumenEstilo, videoTextDraftOf, textLayersFromDraft } from '../src/modules/iid/OnScreenTextEditor';
import { validateTextLayers, groupPresets, type PresetsByLayer } from './_pieceText';

const TXT = '¿Quieres usar el Fondo de Reserva ^para reparar la bomba?^ *No puedes*.';

describe('el marcado escrito a mano pasa a marcas', () => {
  it('pares completos: el texto queda limpio y cada tramo en su marca', () => {
    expect(parseMarkup(TXT)).toEqual({
      text: '¿Quieres usar el Fondo de Reserva para reparar la bomba? No puedes.',
      marks: { emphasis: ['para reparar la bomba?'], color_spans: ['No puedes'] },
    });
    expect(parseMarkup('a _b_ +c+')).toEqual({ text: 'a b c', marks: { italic_spans: ['b'], bold_spans: ['c'] } });
  });
  it('un símbolo sin pareja se queda (quien escribe aún no cerró el tramo), y un + suelto en una cuenta no es marca', () => {
    expect(parseMarkup('cuesta 1+2 y ^abierto')).toEqual({ text: 'cuesta 1+2 y ^abierto', marks: {} });
  });
  it('se suman a las marcas que ya había, sin repetir', () => {
    expect(mergeMarks({ emphasis: ['Fondo'] }, { emphasis: ['Fondo', 'bomba'], bold_spans: ['No'] })).toEqual({ emphasis: ['Fondo', 'bomba'], bold_spans: ['No'] });
    const r = ownWithMarkup('hola ^mundo^', { align: 'left', emphasis_role: null, marks: { italic_spans: ['hola'] } });
    expect(r).toEqual({ own: 'hola mundo', style: { align: 'left', emphasis_role: null, marks: { italic_spans: ['hola'], emphasis: ['mundo'] } } });
  });
  it('un gancho guardado con el marcado escrito (pieza real, 2026-11-17) abre limpio y con sus marcas', () => {
    const presets = groupPresets([{ preset_key: 'h1', layer: 'hook', name: 'H1', brand_id: null, status: 'proposed', spec: { engine: 'html' } }], 'MarcaA') as PresetsByLayer;
    const d = videoTextDraftOf({
      presets, cast: [], accent_options: [], strip_options: [], proposals: { hooks: [], key_phrases: [], share_ctas: [] },
      current: { text_layers: { hook: { text: TXT, preset_key: 'h1', start_ms: 0, end_ms: 2800, emphasis: [] }, roles: [], captions: null, key_titles: [], cta: null, identity: { strip: false, identity_role: null } }, hook: null },
    } as any);
    expect(d.hook.own).toBe('¿Quieres usar el Fondo de Reserva para reparar la bomba? No puedes.');
    expect(d.hook.style.marks).toEqual({ emphasis: ['para reparar la bomba?'], color_spans: ['No puedes'] });
  });
});

describe('los saltos de línea viajan hasta VideoLab', () => {
  it('el borrador los conserva y el validador los deja pasar (VideoLab respeta \\n hasta max_lines)', () => {
    const presets = groupPresets([{ preset_key: 'h1', layer: 'hook', name: 'H1', brand_id: null, status: 'proposed', spec: {} }], 'MarcaA') as PresetsByLayer;
    const d = videoTextDraftOf({ presets, cast: [], accent_options: [], strip_options: [], proposals: { hooks: [], key_phrases: [], share_ctas: [] }, current: { text_layers: null, hook: null } } as any);
    d.hook.choice = 'own'; d.hook.own = '¿Usar el Fondo\nde Reserva?';
    const capas = textLayersFromDraft(d, { hooks: [], key_phrases: [], share_ctas: [] } as any, 60000);
    expect(capas.hook?.text).toBe('¿Usar el Fondo\nde Reserva?');
    const v = validateTextLayers(capas, { presets, accentRoles: [], stripRoles: [], durationMs: 60000, castIds: [] });
    expect(v.ok && v.value.hook?.text).toBe('¿Usar el Fondo\nde Reserva?');
  });
});

describe('la cabecera plegada de «Marcas, alineación y color»', () => {
  it('dice cuántas marcas hay, la alineación y el color', () => {
    expect(resumenEstilo({ align: null, emphasis_role: null, marks: {} })).toBe('sin marcas');
    expect(resumenEstilo({ align: 'left', emphasis_role: 'acento_a', marks: { emphasis: ['a'], italic_spans: ['b'] } })).toBe('2 marcas · izquierda · acento_a');
  });
});

describe('el doble «Aplicar» ya no deja un render huérfano', () => {
  const ruta = readFileSync('api/piece-text.ts', 'utf8');
  const editor = readFileSync('src/modules/iid/OnScreenTextEditor.tsx', 'utf8');
  const sonido = readFileSync('src/modules/iid/ControlesDeSonido.tsx', 'utf8');
  it('el servidor enlaza el render sólo si no hay otro pendiente (gana el primero; el segundo, 409)', () => {
    expect(ruta).toMatch(/\(opts\.sinPendiente \? '&assets->video->>pending_text_job=is\.null' : ''\)/);
    expect(ruta).toMatch(/guardarAssets\(piece\.id, nuevos, assets\.video\.url, \{ sinPendiente: true \}\)/);
  });
  it('las dos ventanas bloquean «Aplicar» mientras el pedido viaja', () => {
    expect(editor).toMatch(/disabled=\{sinLimpio \|\| enCurso \|\| enviando \|\| !p\}/);
    expect(sonido).toMatch(/disabled=\{enCurso \|\| ocupado \|\| !cat\.has_clean_video\}/);
  });
});
