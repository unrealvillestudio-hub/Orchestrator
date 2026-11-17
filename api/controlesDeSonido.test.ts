/**
 * CONTROLES DE SONIDO (Sam, 2026-11-17: «Boceto aprobado, cada momento se puede apagar, usa tus 6 presets»).
 *
 * Cubre: presets por familia como dato (la marca manda, los retirados aparte, `mixed` fuera de la ventana nueva); la
 * librería; la validación de `text_layers.sound` (contrato VideoLab v1.10.0: familia, momento, rango, silencio); el
 * borrador (lo guardado manda, la rotación sólo sugiere el fondo); lo que viaja; los momentos de la pieza; que aplicar
 * texto conserve el sonido y aplicar sonido conserve el texto; y que ningún archivo nuevo nombre una marca.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  groupSoundPresets, libraryOf, soundsByFnOf, validateSound, soundDraftOf, soundFromDraft, effectSoundNow, bedSoundNow,
  cueCountsOf, BED_LEVEL, FX_GAIN, type SoundPresets,
} from './_pieceSound';
import { PRESET_CATALOG_TABLES } from './text-preset-status';
// Las filas de `videolab_sound_presets` en producción el 2026-11-17 (contrato v1.10.0, unrlvl-iid-functions#622), en su
// forma real: si el motor cambia la forma del dato, falla este test y no la ventana.
import REALES from './_sonidoPresets.fixtures.json';

const CUES = (o: Record<string, string>) => ({
  cues: {
    block_entry: { by_layer: { hook: { sound: o.entry }, key_title: { sound: o.entry }, cta: { sound: o.cta }, role: { sound: o.role } },
      by_text_preset: o.impact ? { estilo_golpe: { sound: o.impact } } : {} },
    digit_land: o.digit ? { sound: o.digit } : undefined,
    shot_cut: o.cut ? { sound: o.cut } : undefined,
  },
});
const FILAS = [
  { preset_key: 'fondo_a', kind: 'bed', name: 'Fondo A', brand_id: null, active: true, status: 'proposed', sort: 1, spec: { bed: { sound: 'cama_1', under_voice_lu: 14 } } },
  { preset_key: 'fondo_b', kind: 'bed', name: 'Fondo B sistema', brand_id: null, active: true, status: 'proposed', sort: 2, spec: { bed: { sound: 'cama_2', under_voice_lu: 16 } } },
  { preset_key: 'fondo_b', kind: 'bed', name: 'Fondo B de la marca', brand_id: 'MarcaA', active: true, status: 'validated_by_judgment', sort: 2, spec: { bed: { sound: 'cama_3', under_voice_lu: 12 } } },
  { preset_key: 'fondo_otra', kind: 'bed', name: 'De otra marca', brand_id: 'MarcaB', active: true, status: 'proposed', spec: {} },
  { preset_key: 'fondo_ret', kind: 'bed', name: 'Retirado', brand_id: null, active: true, status: 'retired', spec: { bed: { sound: 'cama_1' } } },
  { preset_key: 'fx_a', kind: 'effects', name: 'Efectos A', brand_id: null, active: true, status: 'proposed', sort: 1,
    spec: CUES({ entry: 'e_1', cta: 'c_1', role: 'p_1', impact: 'g_1', digit: 'd_1', cut: 'k_1' }) },
  { preset_key: 'fx_min', kind: 'effects', name: 'Mínimo', brand_id: null, active: true, status: 'proposed', sort: 2,
    spec: { cues: { block_entry: { by_layer: { cta: { sound: 'c_1' } } }, digit_land: { sound: 'd_1' } } } },
  { preset_key: 'v19', name: 'Forma anterior', brand_id: null, active: true, status: 'proposed', spec: { bed: { sound: 'cama_1' } } },
];
const P = groupSoundPresets(FILAS, 'MarcaA');
const PRESETS: SoundPresets = { bed: P.bed, effects: P.effects };
const LIB = libraryOf({ status: 'ok', sounds: [
  { sound_key: 'cama_1', fn: 'music_bed', description: 'Cama uno', duration_ms: 9000, url: 'https://ejemplo.invalid/cama_1.wav' },
  { sound_key: 'cama_9', fn: 'music_bed', description: 'Cama nueve', url: 'http://no-https.invalid/x.wav' },
  { sound_key: 'e_1', fn: 'block_entry' }, { sound_key: 'e_2', fn: 'block_entry' },
  { sound_key: 'c_1', fn: 'cta' }, { sound_key: 'c_2', fn: 'cta' }, { sound_key: 'd_1', fn: 'digit_land' },
  { fn: 'cta' }, { sound_key: 'sin_fn' },
] })!;

describe('presets por familia y librería, como dato', () => {
  it('separa fondo y efectos; la fila de la marca manda; otra marca y la forma anterior quedan fuera; los retirados aparte', () => {
    expect(P.bed.map((p) => p.preset_key)).toEqual(['fondo_a', 'fondo_b']);
    expect(P.bed[1]).toMatchObject({ name: 'Fondo B de la marca', brand_override: true, bed_sound: 'cama_3', under_voice_lu: 12 });
    expect(P.effects.map((p) => p.preset_key)).toEqual(['fx_a', 'fx_min']);
    expect(P.retired.map((p) => p.preset_key)).toEqual(['fondo_ret']);
  });
  it('el sonido de cada momento sale del mapa de entradas; un momento que el preset no trae no suena', () => {
    expect(soundsByFnOf(FILAS[5].spec)).toEqual({ block_entry: 'e_1', cta: 'c_1', word_pop: 'p_1', impact: 'g_1', digit_land: 'd_1', shot_cut: 'k_1' });
    expect(P.effects[1].sounds_by_fn).toEqual({ cta: 'c_1', digit_land: 'd_1' });
    expect(P.effects[0].text_presets_with_impact).toEqual(['estilo_golpe']);
  });
  it('la librería: filas sin clave o sin momento fuera; sólo direcciones https para escuchar', () => {
    expect(LIB.map((s) => s.sound_key)).toEqual(['cama_1', 'cama_9', 'e_1', 'e_2', 'c_1', 'c_2', 'd_1']);
    expect(LIB[0].url).toBe('https://ejemplo.invalid/cama_1.wav');
    expect(LIB[1].url).toBeNull();
  });
  it('otra forma de respuesta no se lee como librería vacía', () => {
    expect(libraryOf([{ sound_key: 'x', fn: 'cta' }])).toBeNull();
    expect(libraryOf({ status: 'error', error_label: 'DB_ERROR' })).toBeNull();
    expect(libraryOf({ status: 'ok', sounds: [] })).toEqual([]);
  });
});

describe('las filas reales de producción (v1.10.0)', () => {
  const R = groupSoundPresets(REALES, 'MarcaA');
  it('6 de fondo y 6 de efectos; la forma anterior (mixed) en ninguna lista', () => {
    expect(R.bed.map((p) => p.name)).toEqual(['Pulso suave', 'Calma cálida', 'Animado y claro', 'Marimba amable', 'Tensión contenida', 'Teclas relajadas']);
    expect(R.effects.map((p) => p.name)).toEqual(['Discreto', 'Cálido', 'Brillante', 'Para cifras', 'Amable', 'Mínimo']);
  });
  it('cada fondo trae su cama; cada efecto, su sonido por momento; «Mínimo» sólo cifra y CTA (los demás vienen en null)', () => {
    expect(R.bed[0]).toMatchObject({ bed_sound: 'bed_soft_pulse', under_voice_lu: 14 });
    expect(R.effects[0].sounds_by_fn).toEqual({ block_entry: 'sfx_block_entry_whoosh', cta: 'sfx_cta_chime', word_pop: 'sfx_word_pop', impact: 'sfx_stamp_impact', digit_land: 'sfx_digit_tick', shot_cut: 'sfx_cut_swish' });
    expect(R.effects[5].sounds_by_fn).toEqual({ cta: 'sfx_cta_chime', digit_land: 'sfx_digit_tick' });
  });
});

describe('validar text_layers.sound (contrato v1.10.0)', () => {
  const ctx = { presets: PRESETS, library: LIB };
  it('una elección completa pasa; un volumen 0 no viaja', () => {
    const v = validateSound({ bed: { preset_key: 'fondo_a', sound_key: 'cama_1', level_lu: -3 }, effects: { preset_key: 'fx_a', gain_db: 0, sounds_by_fn: { cta: 'c_2' } } }, ctx);
    expect(v).toEqual({ ok: true, value: { bed: { preset_key: 'fondo_a', sound_key: 'cama_1', level_lu: -3 }, effects: { preset_key: 'fx_a', sounds_by_fn: { cta: 'c_2' } } } });
  });
  it('apagar un momento es null, y viaja (Sam: «cada momento se puede apagar»)', () => {
    const v = validateSound({ effects: { preset_key: 'fx_a', sounds_by_fn: { shot_cut: null } } }, ctx);
    expect(v.ok && v.value?.effects?.sounds_by_fn).toEqual({ shot_cut: null });
  });
  it('preset de otra familia, sonido de otro momento, momento desconocido y volumen fuera de rango: errores con su campo', () => {
    const v = validateSound({ bed: { preset_key: 'fx_a', sound_key: 'e_1', level_lu: 7 }, effects: { preset_key: 'fondo_a', gain_db: 2.5, sounds_by_fn: { cta: 'e_1', otro: 'x' } } }, ctx);
    expect(v.ok).toBe(false);
    const e = !v.ok ? v.errors.join(' | ') : '';
    expect(e).toMatch(/sound\.bed\.preset_key/); expect(e).toMatch(/sound\.bed\.sound_key.*block_entry/);
    expect(e).toMatch(/level_lu: debe ir de -6 a 6/); expect(e).toMatch(/sound\.effects\.preset_key/);
    expect(e).toMatch(/gain_db/); expect(e).toMatch(/sounds_by_fn\.cta.*block_entry/); expect(e).toMatch(/«otro» no es un momento/);
  });
  it('con la familia encendida el preset es obligatorio (v1.10.0); apagada, no', () => {
    const v = validateSound({ bed: { sound_key: 'cama_1' }, effects: { sounds_by_fn: { cta: 'c_2' } } }, ctx);
    expect(!v.ok && v.errors.join(' | ')).toMatch(/sound\.bed: falta el preset.*sound\.effects: falta el preset/);
    expect(validateSound({ bed: { enabled: false }, effects: { enabled: false } }, ctx).ok).toBe(true);
  });
  it('un preset retirado no se acepta', () => {
    expect(validateSound({ bed: { preset_key: 'fondo_ret' } }, ctx).ok).toBe(false);
  });
  it('sin librería no se manda ningún sonido que no se pudo comprobar; los presets sí', () => {
    expect(validateSound({ bed: { preset_key: 'fondo_a', sound_key: 'cama_1' } }, { presets: PRESETS, library: null }).ok).toBe(false);
    expect(validateSound({ bed: { preset_key: 'fondo_a' } }, { presets: PRESETS, library: null }).ok).toBe(true);
  });
  it('null = sin sonido; la forma anterior de un solo preset no la escribe la ventana', () => {
    expect(validateSound(null, ctx)).toEqual({ ok: true, value: null });
    expect(validateSound({ preset_key: 'v19' }, ctx).ok).toBe(false);
  });
  it('los rangos son los aprobados con el boceto', () => {
    expect([BED_LEVEL.min, BED_LEVEL.max, BED_LEVEL.step]).toEqual([-6, 6, 1]);
    expect([FX_GAIN.min, FX_GAIN.max, FX_GAIN.step]).toEqual([-12, 6, 1]);
  });
});

describe('el borrador de la ventana', () => {
  it('sin sonido guardado: el fondo que sugiere la rotación y el primer preset de efectos, los dos encendidos', () => {
    const d = soundDraftOf(null, PRESETS, 'fondo_b');
    expect(d.bed).toEqual({ on: true, preset_key: 'fondo_b', sound_key: null, level_lu: 0 });
    expect(d.effects).toMatchObject({ on: true, preset_key: 'fx_a', gain_db: 0 });
  });
  it('lo guardado manda sobre la sugerencia, y vuelve igual al aplicar', () => {
    const guardado = { bed: { preset_key: 'fondo_a', level_lu: 2 }, effects: { preset_key: 'fx_a', sounds_by_fn: { shot_cut: null, cta: 'c_2' } } };
    const d = soundDraftOf(guardado, PRESETS, 'fondo_b');
    expect(d.bed.preset_key).toBe('fondo_a');
    expect(soundFromDraft(d, PRESETS)).toEqual(guardado);
  });
  it('lo que coincide con el preset no viaja; apagar envía enabled:false', () => {
    const d = soundDraftOf(null, PRESETS, null);
    d.effects.overrides = { cta: 'c_1', shot_cut: null };
    d.bed.sound_key = 'cama_1';
    expect(soundFromDraft(d, PRESETS)).toEqual({ bed: { preset_key: 'fondo_a' }, effects: { preset_key: 'fx_a', sounds_by_fn: { shot_cut: null } } });
    d.bed.on = false; d.effects.on = false;
    expect(soundFromDraft(d, PRESETS)).toEqual({ bed: { enabled: false, preset_key: 'fondo_a' }, effects: { enabled: false, preset_key: 'fx_a' } });
  });
  it('qué suena ahora en cada momento y de fondo', () => {
    const d = soundDraftOf(null, PRESETS, null);
    d.effects.overrides = { shot_cut: null };
    expect(effectSoundNow(d, PRESETS, 'shot_cut')).toBeNull();
    expect(effectSoundNow(d, PRESETS, 'cta')).toBe('c_1');
    expect(bedSoundNow(d, PRESETS)).toBe('cama_1');
    d.effects.preset_key = 'fx_min';
    expect(effectSoundNow(d, PRESETS, 'block_entry')).toBeNull();
  });
});

describe('los momentos de la pieza', () => {
  it('entradas, CTA, roles, golpes, cifras y cortes de toma (la regla del motor: cambio de shot_id)', () => {
    const capas = {
      hook: { text: 'g' }, cta: { text: 'c' }, roles: [{ show: true }, { show: false }],
      key_titles: [{ text: 'Al menos el 1 % de 2.500', preset_key: 'k' }, { text: 'Sello', preset_key: 'estilo_golpe' }],
    };
    const timeline = { faces: [{ start_ms: 0, shot_id: 1 }, { start_ms: 4000, shot_id: 2 }, { start_ms: 5000, shot_id: 2 }, { start_ms: 9000, shot_id: 1 }] };
    expect(cueCountsOf(capas, timeline, ['estilo_golpe'])).toEqual({ block_entry: 2, cta: 1, word_pop: 1, impact: 1, digit_land: 2, shot_cut: 2 });
    expect(cueCountsOf(null, null, []).shot_cut).toBeNull();
  });
});

describe('el servidor', () => {
  const ruta = readFileSync('api/piece-text.ts', 'utf8');
  it('aplicar texto conserva el sonido guardado; aplicar sonido conserva el texto vigente', () => {
    expect(ruta).toMatch(/let sound: unknown = assets\.video\?\.text_layers\?\.sound \?\? null;/);
    expect(ruta).toMatch(/const vigente = piece\.assets\?\.video\?\.text_layers \?\? SIN_TEXTO;/);
    expect(ruta).toMatch(/pending_text_job: \{ job_id: jobId, requested_at: new Date\(\)\.toISOString\(\), text_layers: capas \}/);
  });
  it('la librería se pide a VoiceLab por lab_configs; ninguna dirección escrita en el código', () => {
    expect(ruta).toMatch(/lab_configs\?lab_key=eq\.voicelab/);
    expect(ruta).toMatch(/\/api\/sound-library\?brandId=/);
    expect(ruta).not.toMatch(/https:\/\/[a-z0-9-]*voice-?lab/i);
  });
  it('el estado de un preset de sonido usa su tabla; un catálogo desconocido no existe', () => {
    expect(PRESET_CATALOG_TABLES).toEqual({ text: 'videolab_text_presets', sound: 'videolab_sound_presets' });
  });
  it('ningún archivo nuevo nombra una marca', () => {
    const MARCAS = /NeuroneSCF|ForumPHs|LucienSael|SamPublisher|D7Herbal|VivoseMask|VizosCosmetics|DiamondDetails|PatriciaOsorio/i;
    for (const f of ['api/_pieceSound.ts', 'src/modules/iid/ControlesDeSonido.tsx']) expect(readFileSync(f, 'utf8')).not.toMatch(MARCAS);
  });
});
