/**
 * LA ROTACIÓN DE ESTILOS (Sam, 2026-11-17: «el carril deberá rotarlos entre cada generación»; contrato VideoLab §4 ter.7).
 * VideoLab sugiere; el Orchestrator la toma como estilo por defecto SÓLO en una generación nueva y la congela al aplicar.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { suggestedPresetsOf, labBaseUrl, groupPresets } from './_pieceText';
import { videoTextDraftOf, textLayersFromDraft } from '../src/modules/iid/OnScreenTextEditor';

const FILAS = [
  { preset_key: 'h1', layer: 'hook', name: 'H1', brand_id: null, status: 'proposed', sort: 1 },
  { preset_key: 'h2', layer: 'hook', name: 'H2', brand_id: null, status: 'validated_by_judgment', sort: 2 },
  { preset_key: 'k1', layer: 'key_title', name: 'K1', brand_id: null, status: 'proposed', sort: 1 },
  { preset_key: 'k2', layer: 'key_title', name: 'K2', brand_id: null, status: 'proposed', sort: 2 },
  { preset_key: 'c1', layer: 'cta', name: 'C1', brand_id: null, status: 'proposed', sort: 1 },
  { preset_key: 'c2', layer: 'cta', name: 'C2', brand_id: null, status: 'proposed', sort: 2 },
];
const PRESETS = groupPresets(FILAS, 'MarcaA');
const RESP = { status: 'ok', suggested: { hook: { preset_key: 'h2', pool: ['h2'] }, key_title: { preset_key: 'k2', pool: ['k1', 'k2'] },
  cta: { preset_key: 'retirado_o_desconocido', pool: [] }, role: null, caption: null }, basis: { jobs_considered: 3, rule: 'least_recently_used' } };

describe('la sugerencia de VideoLab, reducida a lo que se ofrece', () => {
  it('toma la sugerida si se ofrece y descarta la que no', () => {
    expect(suggestedPresetsOf(RESP, PRESETS)).toEqual({ hook: 'h2', key_title: 'k2' });
  });
  it('una respuesta que no es ok no sugiere nada', () => {
    expect(suggestedPresetsOf({ status: 'error' }, PRESETS)).toBeNull();
    expect(suggestedPresetsOf(null, PRESETS)).toBeNull();
    expect(suggestedPresetsOf(RESP, null)).toBeNull();
  });
  it('la dirección de VideoLab sale de lab_configs y sólo si es https', () => {
    expect(labBaseUrl({ api_endpoint: 'https://lab.example.app/' })).toBe('https://lab.example.app');
    expect(labBaseUrl({ api_endpoint: 'http://inseguro' })).toBeNull();
    expect(labBaseUrl(null)).toBeNull();
  });
});

const BASE = {
  presets: PRESETS, cast: [], accent_options: [], strip_options: [],
  proposals: { hooks: [{ text: 'G', pattern_key: 'p' }], key_phrases: [{ text: 'Frase A', line_index: 0 }, { text: 'Frase B', line_index: 1 }], share_ctas: [{ text: 'CTA', pattern_key: 's' }] },
};

describe('el editor: la sugerencia es el estilo por defecto sólo en una generación nueva', () => {
  it('generación nueva: cada capa arranca con la sugerida; las demás, con la primera', () => {
    const d = videoTextDraftOf({ ...BASE, current: { text_layers: null, hook: null }, suggested_presets: { hook: 'h2', key_title: 'k2' } } as any);
    expect(d.hook.preset_key).toBe('h2');
    expect(d.cta.preset_key).toBe('c1');
    expect(d.key_titles.map((k) => k.preset_key)).toEqual(['k2', 'k2']);
  });
  it('se congela: lo aplicado lleva la sugerida', () => {
    const d = videoTextDraftOf({ ...BASE, current: { text_layers: null, hook: null }, suggested_presets: { hook: 'h2' } } as any);
    d.hook.choice = 0;
    expect(textLayersFromDraft(d, BASE.proposals as any, 30000).hook?.preset_key).toBe('h2');
  });
  it('una pieza ya editada conserva su estilo aunque llegue otra sugerencia', () => {
    const cur = { hook: { text: 'G', preset_key: 'h1', start_ms: 0, end_ms: 2000, emphasis: [] }, roles: [], captions: null, key_titles: [], cta: null, identity: { strip: false, identity_role: null } };
    const d = videoTextDraftOf({ ...BASE, current: { text_layers: cur, hook: null }, suggested_presets: { hook: 'h2' } } as any);
    expect(d.hook.preset_key).toBe('h1');
  });
  it('sin sugerencia (VideoLab falló), el primero, como antes', () => {
    const d = videoTextDraftOf({ ...BASE, current: { text_layers: null, hook: null }, suggested_presets: null } as any);
    expect(d.hook.preset_key).toBe('h1');
  });
});

describe('el servidor sólo pide la rotación en una generación nueva', () => {
  const src = readFileSync('api/piece-text.ts', 'utf8');
  it('la condición es que la pieza no tenga text_layers', () => {
    expect(src).toMatch(/medium === 'video' && !assets\?\.video\?\.text_layers && presets\.presets\s*\n?\s*\? await sugerenciaDeEstilos/);
  });
  it('la dirección de VideoLab sale de lab_configs, no del código', () => {
    expect(src).not.toMatch(/https:\/\/[a-z0-9-]*video-lab/i);
    expect(src).toMatch(/lab_configs\?lab_key=eq\.videolab/);
  });
});
