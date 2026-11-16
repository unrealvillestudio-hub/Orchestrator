import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  assetsAfterFailedJob, assetsAfterTextJob, buildCopyLabBody, buildCopyLabSource, buildVideoLabBody, castOf, claimsOf,
  copyLabLanguageOf, currentHookOf, errorLabelOf, goalOf, groupPresets, hasCleanVideo, labExecuteUrl, mediumOf,
  nextVersion, NO_CLEAN_VIDEO, recentPatternKeysOf, validateTextLayers, RECENT_PIECES_N, VIDEO_HISTORY_MAX,
  type PresetsByLayer,
} from './_pieceText.js';
import { textLayersFromDraft, videoTextDraftOf, OWN } from '../src/modules/iid/VideoTextEditor';

/**
 * TEXTO EN PANTALLA (contrato v1 §4, 2026-11-16). Las marcas, colores y personas de estas pruebas son de MENTIRA a
 * propósito: el código no sabe de ninguna, y una prueba con una marca real lo escondería.
 */

const CLEAN = { url: 'https://cdn.test/clean.mp4', storage_path: 'x/clean.mp4' };
const TIMELINE = { words: [{ text: 'hola', start_ms: 0, end_ms: 300, person_id: 'p-1' }], turns: [] };
const videoPiece = (extra: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111', brand_id: 'MarcaPrueba', platform: 'meta_fb',
  orchestrator_job_id: '22222222-2222-4222-8222-222222222222',
  assets: {
    copy: { title: 'Título de prueba', aife_filtered: 'Copy con 1 % y 51 % de dato.' },
    image: { url: 'https://cdn.test/portada.jpg' },
    video: {
      url: 'https://cdn.test/v1.mp4', poster_url: 'https://cdn.test/p1.jpg', version: 'v1', duration_s: 61.16,
      cast: 'nota libre de producción',
      cast_members: [
        { person_id: 'p-1', name: 'Persona Uno', role: 'host', title: 'Conductora' },
        { person_id: 'p-2', name: 'Persona Dos', role: 'guest', title: 'Invitado' },
      ],
      script_lines: [{ speaker_role: 'host', speaker_name: 'Persona Uno', text: 'El 51 % decide.' }],
      ...extra,
    },
  },
});

const P = (layer: string, key: string, extra: Record<string, unknown> = {}) =>
  ({ preset_key: key, layer, name: key, description: `${key} desc`, brand_id: null, active: true, sort: 100, status: 'proposed', ...extra });
const PRESET_ROWS = [
  ...['hook_pop_words', 'hook_mask_wipe', 'hook_type_on', 'hook_punch_settle', 'hook_line_slide'].map((k, i) => P('hook', k, { sort: i })),
  ...['role_chip_slide', 'role_rule_draw', 'role_fade_rise', 'role_card_two_line', 'role_label_minimal'].map((k, i) => P('role', k, { sort: i })),
  ...['caption_karaoke_accent', 'caption_box_accent', 'caption_clean'].map((k, i) => P('caption', k, { sort: i })),
  P('key_title', 'key_title_rule'), P('key_title', 'key_title_stamp'),
  P('cta', 'cta_pill_shimmer'), P('cta', 'cta_card_rise'),
];
const PRESETS = groupPresets(PRESET_ROWS, 'MarcaPrueba');
const CTX = { presets: PRESETS, accentRoles: ['accent_a', 'accent_b'], stripRoles: ['strip_a'], durationMs: 61160, castIds: ['p-1', 'p-2'] };

// ── 1 · propose: el pedido a CopyLab ──────────────────────────────────────────────────────────
describe('propose arma el pedido a CopyLab sólo con dato de la pieza', () => {
  const claims = [
    { claim: 'Porcentaje mínimo del fondo', value: '1%', source_url: 'https://fuente.test/a', source_name: 'A' },
    { claim: 'Mayoría para usarlo', value: '51% de los propietarios', source_url: 'https://fuente.test/b' },
  ];

  it('las cifras de las afirmaciones viajan DENTRO del texto, con su fuente', () => {
    expect(claimsOf(claims)).toEqual([
      { text: 'Porcentaje mínimo del fondo: 1%', source_url: 'https://fuente.test/a' },
      { text: 'Mayoría para usarlo: 51% de los propietarios', source_url: 'https://fuente.test/b' },
    ]);
  });

  it('video: copy, título, claims, elenco estructurado y guion; el `cast` en texto libre no se adivina', () => {
    const src = buildCopyLabSource(videoPiece(), claims);
    expect(src.copy).toBe('Copy con 1 % y 51 % de dato.');
    expect(src.title).toBe('Título de prueba');
    expect(src.claims).toHaveLength(2);
    expect(src.cast.map((c) => c.person_id)).toEqual(['p-1', 'p-2']);
    expect(src.script_lines).toEqual([{ speaker_role: 'host', speaker_name: 'Persona Uno', text: 'El 51 % decide.' }]);
    expect(castOf({ video: { url: 'x', cast: 'S1 alguien · S3 otra' } })).toEqual([]);
  });

  it('el gancho vigente sale del video; si no lo hay, del titular de la imagen', () => {
    expect(currentHookOf(videoPiece({ text_layers: { hook: { text: 'Gancho vigente' } } }).assets)).toBe('Gancho vigente');
    expect(currentHookOf({ image: { overlay_override: { headline: 'Línea uno\nlínea dos' } } })).toBe('Línea uno línea dos');
    expect(currentHookOf({})).toBeNull();
  });

  it('el cuerpo sigue el contrato §2 y lleva los patrones recientes', () => {
    const body = buildCopyLabBody({
      brandId: 'MarcaPrueba', medium: 'video', language: 'es', source: buildCopyLabSource(videoPiece(), claims),
      goal: 'share', recentPatternKeys: ['pk_a', 'pk_b'],
    });
    expect(body.brandId).toBe('MarcaPrueba');
    expect(body.params).toMatchObject({ mode: 'short_video_text', task: 'all', medium: 'video', language: 'es', goal: 'share', recent_pattern_keys: ['pk_a', 'pk_b'] });
    expect(body.params.source.claims[1].text).toContain('51%');
  });

  it('imagen: sólo ganchos, sin elenco ni guion', () => {
    const img = { id: 'i', assets: { copy: { raw: 'copy' }, image: { url: 'u', overlay_override: { headline: 'Titular' } } } };
    expect(mediumOf(img.assets)).toBe('image');
    const src = buildCopyLabSource(img, []);
    expect(src.cast).toEqual([]);
    expect(src.script_lines).toBeNull();
    const body = buildCopyLabBody({ brandId: 'B', medium: 'image', language: 'en', source: src, goal: 'share', recentPatternKeys: [] });
    expect(body.params).toMatchObject({ task: 'hooks', medium: 'image', language: 'en' });
  });

  it('el idioma sale de lo que la marca declara; sin uno admitido, null (la ruta responde 422)', () => {
    expect(copyLabLanguageOf('es-PA')).toBe('es');
    expect(copyLabLanguageOf('EN')).toBe('en');
    expect(copyLabLanguageOf('pt-BR')).toBeNull();
    expect(copyLabLanguageOf(null)).toBeNull();
  });

  it('objetivo: el elegido si es válido, si no el reenvío', () => {
    expect(goalOf('save')).toBe('save');
    expect(goalOf('cualquiera')).toBe('share');
  });
});

describe('regla N = 8: los patrones de gancho de las últimas piezas de la marca y la plataforma', () => {
  it('lee las tres ubicaciones, sin repetir, y excluye la propia pieza', () => {
    const rows = [
      { id: 'self', assets: { video: { hook_pattern_key: 'propio' } } },
      { id: 'a', assets: { video: { hook_pattern_key: 'pk_1' } } },
      { id: 'b', assets: { video: { text_layers: { hook: { pattern_key: 'pk_2' } } } } },
      { id: 'c', assets: { image: { hook_pattern_key: 'pk_1' } } },
      { id: 'd', assets: { image: { hook_pattern_key: 'pk_3' } } },
    ];
    expect(recentPatternKeysOf(rows, 'self')).toEqual(['pk_1', 'pk_2', 'pk_3']);
  });

  it('la ventana es de N piezas seguidas, tengan clave o no', () => {
    const rows = Array.from({ length: RECENT_PIECES_N + 2 }, (_, i) => ({ id: `r${i}`, assets: i === RECENT_PIECES_N ? { video: { hook_pattern_key: 'fuera' } } : {} }));
    expect(recentPatternKeysOf(rows, 'x')).toEqual([]);
  });
});

// ── 2 · presets y colores ─────────────────────────────────────────────────────────────────────
describe('presets: la fila de la marca manda sobre la del sistema', () => {
  it('agrupa por capa en orden y respeta la sobrescritura de marca', () => {
    expect(PRESETS.hook.map((p) => p.preset_key)).toEqual(['hook_pop_words', 'hook_mask_wipe', 'hook_type_on', 'hook_punch_settle', 'hook_line_slide']);
    expect(PRESETS.role).toHaveLength(5);
    expect(PRESETS.caption).toHaveLength(3);
    const g = groupPresets([...PRESET_ROWS, P('hook', 'hook_pop_words', { brand_id: 'MarcaPrueba', name: 'De la marca' }), P('hook', 'hook_x', { brand_id: 'OtraMarca' })], 'MarcaPrueba');
    expect(g.hook.find((p) => p.preset_key === 'hook_pop_words')).toMatchObject({ name: 'De la marca', brand_override: true });
    expect(g.hook.some((p) => p.preset_key === 'hook_x')).toBe(false);
  });

  it('retirados e inactivos no se ofrecen', () => {
    const g = groupPresets([P('cta', 'a', { status: 'retired' }), P('cta', 'b', { active: false }), P('cta', 'c')], 'M');
    expect(g.cta.map((p) => p.preset_key)).toEqual(['c']);
  });
});

// ── 3 · apply: validación y pedido a VideoLab ─────────────────────────────────────────────────
const LAYERS_OK = {
  hook: { text: 'Un gancho', preset_key: 'hook_pop_words', start_ms: 0, end_ms: 2600, emphasis: ['gancho'], pattern_key: 'pk_1' },
  roles: [{ person_id: 'p-1', text: 'Persona Uno — Conductora', show: true, at_ms: 400, dur_ms: 3800, preset_key: 'role_chip_slide' }],
  captions: { enabled: true, preset_key: 'caption_karaoke_accent', accent_role: 'accent_a' },
  key_titles: [{ text: 'El 51 % decide', at_ms: 12000, dur_ms: 2500, preset_key: 'key_title_rule' }],
  cta: { text: 'Reenvíalo', at_ms: 52000, preset_key: 'cta_pill_shimmer' },
  identity: { strip: true, strip_role: 'strip_a' },
};

describe('apply valida lo elegido antes de pagar un render', () => {
  it('un pedido completo y correcto pasa', () => {
    const v = validateTextLayers(LAYERS_OK, CTX);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value.hook?.pattern_key).toBe('pk_1');
  });

  it('preset de otra capa, color fuera de la marca, persona ajena y tiempos fuera del video se dicen todos juntos', () => {
    const v = validateTextLayers({
      ...LAYERS_OK,
      hook: { ...LAYERS_OK.hook, preset_key: 'role_chip_slide', end_ms: 0 },
      roles: [{ ...LAYERS_OK.roles[0], person_id: 'ajena' }],
      captions: { ...LAYERS_OK.captions, accent_role: '#ff0000' },
      cta: { ...LAYERS_OK.cta, at_ms: 999_999 },
      identity: { strip: true, strip_role: 'accent_b' },
    }, CTX);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.errors.join(' | ')).toMatch(/no es de la capa hook/);
      expect(v.errors.join(' | ')).toMatch(/end_ms debe ser mayor/);
      expect(v.errors.join(' | ')).toMatch(/no sale en este video/);
      expect(v.errors.join(' | ')).toMatch(/«#ff0000» no es uno/);
      expect(v.errors.join(' | ')).toMatch(/pasa del final del video/);
      expect(v.errors.join(' | ')).toMatch(/franja de la marca/);
    }
  });

  it('sin ninguna capa elegida no se manda nada', () => {
    const v = validateTextLayers({ hook: null, roles: [], captions: null, key_titles: [], cta: null, identity: { strip: false } }, CTX);
    expect(v.ok).toBe(false);
  });

  it('no es un objeto → error', () => {
    expect(validateTextLayers('hola', CTX).ok).toBe(false);
  });

  it('el pedido a VideoLab sigue el §3.2: video limpio, línea de tiempo y capas', () => {
    const v = validateTextLayers(LAYERS_OK, CTX);
    if (!v.ok) throw new Error('debía validar');
    const body = buildVideoLabBody({
      brandId: 'MarcaPrueba', pieceId: videoPiece().id, platform: 'meta_fb', parentJobId: videoPiece().orchestrator_job_id,
      cleanVideoUrl: CLEAN.url, timeline: TIMELINE, textLayers: v.value,
    });
    expect(body).toMatchObject({
      brandId: 'MarcaPrueba', pieceId: videoPiece().id, parentJobId: videoPiece().orchestrator_job_id,
      params: { mode: 'text_layers', platform: 'meta_fb', format: 'reel' },
      previousOutputs: { base_video: { url: CLEAN.url }, timeline: TIMELINE },
    });
    expect(body.previousOutputs.text_layers.captions?.accent_role).toBe('accent_a');
    // Un parentJobId que no es UUID no viaja: VideoLab lo rechazaría.
    expect('parentJobId' in buildVideoLabBody({ brandId: 'b', pieceId: 'p', platform: 'tiktok', parentJobId: 'no-uuid', cleanVideoUrl: 'u', timeline: {}, textLayers: v.value })).toBe(false);
  });

  it('un video sin versión limpia no se puede editar, y la frase lo dice', () => {
    expect(hasCleanVideo(videoPiece().assets)).toBe(false);
    expect(hasCleanVideo(videoPiece({ clean_video: CLEAN }).assets)).toBe(false); // falta la línea de tiempo
    expect(hasCleanVideo(videoPiece({ clean_video: CLEAN, timeline: TIMELINE }).assets)).toBe(true);
    expect(NO_CLEAN_VIDEO).toBe('Este video no tiene versión limpia; se podrá editar el texto cuando VideoLab la genere.');
  });
});

describe('dónde vive cada lab lo dice lab_configs', () => {
  it('base + execute_path; sin https no hay URL', () => {
    expect(labExecuteUrl({ api_endpoint: 'https://lab.test/', execute_path: '/api/execute' })).toBe('https://lab.test/api/execute');
    expect(labExecuteUrl({ api_endpoint: 'https://lab.test' })).toBe('https://lab.test/api/execute');
    expect(labExecuteUrl({ api_endpoint: '' })).toBeNull();
    expect(labExecuteUrl(null)).toBeNull();
  });
});

// ── 4 · el sondeo: el video nuevo y el historial ──────────────────────────────────────────────
describe('cuando VideoLab termina, el video de ahora pasa al historial', () => {
  const pending = { job_id: 'job-1', requested_at: 't0', text_layers: LAYERS_OK };
  const antes = videoPiece({ clean_video: CLEAN, timeline: TIMELINE, pending_text_job: pending }).assets;
  const job = { id: 'job-1', output_parsed: {
    video: { url: 'https://cdn.test/v2.mp4', poster_url: 'https://cdn.test/p2.jpg', width: 720, height: 1280, duration_ms: 61160 },
    clean_video: { url: CLEAN.url }, text_layers: LAYERS_OK, cost_usd: 0.02,
  } };

  it('swap: versión siguiente, capas, clave del gancho, limpio y línea de tiempo conservados', () => {
    const a = assetsAfterTextJob(antes, job, '2026-11-16T12:00:00Z');
    expect(a.video).toMatchObject({
      url: 'https://cdn.test/v2.mp4', poster_url: 'https://cdn.test/p2.jpg', version: 'v2', duration_s: 61.16,
      hook_pattern_key: 'pk_1', text_job_id: 'job-1', clean_video: { url: CLEAN.url }, timeline: TIMELINE,
    });
    expect(a.video.pending_text_job).toBeUndefined();
    expect(a.video_history[0]).toMatchObject({ url: 'https://cdn.test/v1.mp4', version: 'v1', replaced_at: '2026-11-16T12:00:00Z' });
    expect(a.video_history[0].pending_text_job).toBeUndefined();
    // el resto de la pieza no se toca
    expect(a.copy).toEqual(antes.copy);
    expect(a.image).toEqual(antes.image);
  });

  it('el historial se acumula con tope, la más reciente primero', () => {
    const viejo = Array.from({ length: VIDEO_HISTORY_MAX }, (_, i) => ({ url: `old${i}` }));
    const a = assetsAfterTextJob({ ...antes, video_history: viejo }, job, 't');
    expect(a.video_history).toHaveLength(VIDEO_HISTORY_MAX);
    expect(a.video_history[0].url).toBe('https://cdn.test/v1.mp4');
  });

  it('fallo: se quita el pendiente y se deja el motivo', () => {
    const f = errorLabelOf({ error_msg: 'VIDEOLAB_BAD_REQUEST: preset inexistente' });
    expect(f).toEqual({ error_label: 'VIDEOLAB_BAD_REQUEST', detail: 'preset inexistente' });
    const a = assetsAfterFailedJob(antes, { ...f, job_id: 'job-1' }, 't');
    expect(a.video.pending_text_job).toBeUndefined();
    expect(a.video.url).toBe('https://cdn.test/v1.mp4');
    expect(a.video.last_text_job_error).toMatchObject({ error_label: 'VIDEOLAB_BAD_REQUEST', job_id: 'job-1' });
  });

  it('versiones', () => {
    expect(nextVersion('v1')).toBe('v2');
    expect(nextVersion('7')).toBe('8');
    expect(nextVersion(undefined)).toBe('v2');
  });
});

// ── 5 · el editor: del borrador a las capas ───────────────────────────────────────────────────
describe('el editor traduce lo elegido a la forma del contrato', () => {
  const prop = {
    presets: PRESETS as PresetsByLayer,
    cast: castOf(videoPiece().assets),
    accent_options: [{ role: 'accent_a', hex: '#111111', is_default: true }],
    strip_options: [{ role: 'strip_a', hex: '#222222', is_default: true }],
    proposals: {
      hooks: [{ text: 'Gancho A', pattern_key: 'pk_a' }, { text: 'Gancho B', pattern_key: 'pk_b' }],
      key_phrases: [{ text: 'Frase clave', line_index: 0 }],
      share_ctas: [{ text: 'Mándaselo a quien administra', pattern_key: 'share_1' }],
    },
    current: { text_layers: null, hook: null },
  };

  it('abre sin nada elegido y con el primer estilo de cada capa', () => {
    const d = videoTextDraftOf(prop);
    expect(d.hook.choice).toBeNull();
    expect(d.hook.preset_key).toBe('hook_pop_words');
    expect(d.roles.map((r) => r.show)).toEqual([false, false]);
    expect(d.captions.accent_role).toBe('accent_a');
    const layers = textLayersFromDraft(d, prop.proposals, 61160);
    expect(layers.hook).toBeNull();
    expect(layers.roles).toEqual([]);
  });

  it('propuesta elegida lleva su pattern_key; el gancho propio, null; el CTA sin segundo va 6 s antes del final', () => {
    const d = videoTextDraftOf(prop);
    d.hook.choice = 1;
    d.roles[0].show = true;
    d.captions.enabled = true;
    d.key_titles[0].on = true; d.key_titles[0].at_s = 12;
    d.cta.choice = 0;
    d.strip.on = true;
    const l = textLayersFromDraft(d, prop.proposals, 61160);
    expect(l.hook).toMatchObject({ text: 'Gancho B', pattern_key: 'pk_b', start_ms: 0, end_ms: 2600 });
    expect(l.roles).toEqual([{ person_id: 'p-1', text: 'Persona Uno — Conductora', show: true, at_ms: 400, dur_ms: 3800, preset_key: 'role_chip_slide' }]);
    expect(l.key_titles).toEqual([{ text: 'Frase clave', at_ms: 12000, dur_ms: 2500, preset_key: 'key_title_rule' }]);
    expect(l.cta).toMatchObject({ at_ms: 55160, pattern_key: 'share_1' });
    expect(l.identity).toEqual({ strip: true, strip_role: 'strip_a' });
    expect(validateTextLayers(l, CTX).ok).toBe(true);

    d.hook.choice = OWN; d.hook.own = 'Mi gancho';
    expect(textLayersFromDraft(d, prop.proposals, 61160).hook).toMatchObject({ text: 'Mi gancho', pattern_key: null });
  });
});

// ── 6 · reglas del sistema sobre la fuente ────────────────────────────────────────────────────
const ROUTE = readFileSync(new URL('./piece-text.ts', import.meta.url), 'utf8');
const LIB = readFileSync(new URL('./_pieceText.ts', import.meta.url), 'utf8');
const UI = readFileSync(new URL('../src/modules/iid/VideoTextEditor.tsx', import.meta.url), 'utf8');
const ACTIONS = readFileSync(new URL('../src/modules/iid/pieceActions.tsx', import.meta.url), 'utf8');

describe('reglas LABS y MULTIMARCA', () => {
  it('ninguna URL de lab escrita: se lee de lab_configs y no se toca `active`', () => {
    for (const src of [ROUTE, LIB, UI]) expect(src).not.toMatch(/https:\/\/[a-z0-9-]+\.vercel\.app/);
    expect(ROUTE).toContain("labUrl('copylab')");
    expect(ROUTE).toContain("labUrl('videolab')");
    expect(ROUTE).toMatch(/lab_configs\?lab_key=eq\./);
    expect(ROUTE).not.toMatch(/active=eq\.true&select=lab_key|lab_configs[^\n]*PATCH/);
  });

  it('ni una marca del ecosistema en el código', () => {
    for (const src of [ROUTE, LIB, UI]) {
      for (const marca of ['NeuroneSCF', 'ForumPHs', 'LucienSael', 'UnrealvilleStudio', 'D7Herbal', 'fphs', 'nscf']) {
        expect(src).not.toContain(marca);
      }
      expect(src.replace(/\/\/.*$/gm, '')).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    }
  });

  it('el Orchestrator no escribe copy: los textos llegan de CopyLab', () => {
    expect(ROUTE).toContain('buildCopyLabBody(');
    expect(ROUTE).toContain('buildVideoLabBody(');
    expect(LIB).toContain("mode: 'short_video_text'");
    expect(LIB).toContain("mode: 'text_layers'");
  });

  it('la ruta de proponer llama al modelo con el plazo del modelo y está registrada con maxDuration', () => {
    expect(ROUTE).toContain("fetchWithTimeout('model', copylab");
    const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
    expect(vercel.functions['api/piece-text.ts'].maxDuration).toBe(60);
  });

  it('una pieza sellada no se edita, y se comprueba antes de llamar a un lab', () => {
    const guarda = ROUTE.indexOf('piece.discarded_at');
    expect(guarda).toBeGreaterThan(-1);
    expect(guarda).toBeLessThan(ROUTE.indexOf("labUrl('copylab')"));
  });

  it('las secciones abren plegadas: <details> sin `open`', () => {
    expect(UI).toContain('<details');
    expect(UI).not.toMatch(/<details[^>]*\sopen[\s>=]/);
    for (const t of ['Gancho', 'Rol de las personas', 'Subtítulos', 'Títulos clave', 'CTA de reenvío', 'Franja', 'Ganchos propuestos', 'Escribir uno propio']) {
      expect(UI).toContain(t);
    }
  });

  it('pieceActions monta el editor de video en «Editar texto» y los ganchos en el texto de la imagen', () => {
    expect(ACTIONS).toMatch(/panel === 'edit' && piece\.has_video/);
    expect(ACTIONS).toContain('<VideoTextEditor');
    expect(ACTIONS).toContain('<HookProposals');
  });
});
