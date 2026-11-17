/**
 * UNRLVL Orchestrator — api/_pieceSound.ts (2026-11-17 · contrato VideoLab v1.10.0 §4 ter.8, VideoLab#42; librería:
 * VoiceLab v1.2 §3 ter, VoiceLab#12)
 *
 * EL SONIDO DE UNA PIEZA DE VIDEO: QUÉ SE LE PIDE A VIDEOLAB Y CÓMO SE VALIDA. Funciones PURAS: sin red, sin base.
 * Boceto aprobado por Sam el 2026-11-17 («Boceto aprobado, cada momento se puede apagar, usa tus 6 presets»):
 * dos familias, FONDO y EFECTOS, cada una con presets, volumen y librería; el fondo rota, los efectos no.
 *
 * ── REGLA LABS ───────────────────────────────────────────────────────────────────────────────────
 * La librería es de VoiceLab (`GET /api/sound-library`); los presets son de VideoLab (`videolab_sound_presets`), que
 * coloca y mezcla. Aquí sólo se valida la forma de lo que eligió quien edita y se arma `text_layers.sound`.
 *
 * ── REGLA MULTIMARCA ─────────────────────────────────────────────────────────────────────────────
 * Ni una marca, ni un sonido, ni un preset con nombre en este archivo: todo es fila de una tabla (la de la marca manda
 * sobre la del sistema). Las únicas enumeraciones son las del contrato: familias y momentos.
 */

// ── Vocabulario del contrato ────────────────────────────────────────────────────────────────────

/** Familias de preset (`videolab_sound_presets.kind`). `mixed` es la forma v1.9.0: fondo y efectos en uno. */
export const SOUND_KINDS = ['bed', 'effects', 'mixed'] as const;
export type SoundKind = (typeof SOUND_KINDS)[number];

/** Los momentos que suenan en los efectos (`fn` de la librería). `music_bed` sólo vale para el fondo. */
export const EFFECT_FNS = ['block_entry', 'cta', 'digit_land', 'impact', 'shot_cut', 'word_pop'] as const;
export type EffectFn = (typeof EFFECT_FNS)[number];
export const BED_FN = 'music_bed';

/** Volúmenes (contrato v1.10.0): desplazamiento sobre lo que fija el preset, en pasos de 1. */
export const BED_LEVEL = { min: -6, max: 6, step: 1, unit: 'LU' } as const;
export const FX_GAIN = { min: -12, max: 6, step: 1, unit: 'dB' } as const;

export interface SoundPresetView {
  preset_key: string; kind: SoundKind; name: string; description: string;
  status: string | null; brand_override: boolean;
  /** Fondo: la cama del preset (`spec.bed.sound`). */
  bed_sound?: string | null;
  under_voice_lu?: number | null;
  /** Efectos: el sonido de cada momento según el preset; un momento ausente no suena. */
  sounds_by_fn?: Partial<Record<EffectFn, string>>;
  /** Efectos: estilos de texto con sonido propio (`by_text_preset`), para contar los golpes. */
  text_presets_with_impact?: string[];
}
export interface SoundPresets { bed: SoundPresetView[]; effects: SoundPresetView[] }

export interface LibrarySound {
  sound_key: string; fn: string; description: string; duration_ms: number | null;
  loudness_lufs: number | null; license: string | null; url: string | null;
}

/** Lo que viaja a VideoLab en `text_layers.sound` (forma v1.10.0). */
export interface SoundLayer {
  platform?: string;
  enabled?: boolean;
  bed?: { preset_key?: string; sound_key?: string; enabled?: boolean; level_lu?: number };
  effects?: { preset_key?: string; enabled?: boolean; gain_db?: number; sounds_by_fn?: Partial<Record<EffectFn, string | null>> };
  /** Forma v1.9.0: un preset `mixed`. Se conserva al leer lo guardado; la ventana nueva no la escribe. */
  preset_key?: string;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const obj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// ── Presets ─────────────────────────────────────────────────────────────────────────────────────

/** El sonido de cada momento según el mapa de entradas de un preset (`spec.cues`). PURO. */
export function soundsByFnOf(spec: any): Partial<Record<EffectFn, string>> {
  const c = spec?.cues ?? {};
  const out: Partial<Record<EffectFn, string>> = {};
  const poner = (fn: EffectFn, s: unknown) => { const k = str((s as any)?.sound); if (k) out[fn] = k; };
  const porCapa = c?.block_entry?.by_layer ?? {};
  poner('block_entry', porCapa.hook ?? porCapa.key_title);
  poner('cta', porCapa.cta);
  poner('word_pop', porCapa.role);
  const porEstilo = Object.values(c?.block_entry?.by_text_preset ?? {});
  if (porEstilo.length) poner('impact', porEstilo[0]);
  poner('digit_land', c?.digit_land);
  poner('shot_cut', c?.shot_cut);
  return out;
}

/**
 * Los presets que ve una marca, separados por familia: activos, no retirados, la fila de la marca manda sobre la del
 * sistema. Sin columna `kind` (base anterior a v1.10.0) un preset es `mixed` y no se ofrece en la ventana nueva. PURO.
 */
export function groupSoundPresets(rows: unknown, brandId: string): SoundPresets & { retired: SoundPresetView[] } {
  const elegidos = new Map<string, any>();
  for (const r of Array.isArray(rows) ? rows : []) {
    const key = str(r?.preset_key);
    if (!key || r?.active === false) continue;
    const deMarca = r?.brand_id === brandId;
    if (r?.brand_id != null && !deMarca) continue;
    const previo = elegidos.get(key);
    if (!previo || (deMarca && previo.brand_id !== brandId)) elegidos.set(key, r);
  }
  const out = { bed: [] as SoundPresetView[], effects: [] as SoundPresetView[], retired: [] as SoundPresetView[] };
  [...elegidos.values()]
    .sort((x, y) => (Number(x.sort ?? 100) - Number(y.sort ?? 100)) || String(x.preset_key).localeCompare(String(y.preset_key)))
    .forEach((r) => {
      const kind: SoundKind = (SOUND_KINDS as readonly string[]).includes(r?.kind) ? r.kind : 'mixed';
      if (kind === 'mixed') return;
      const v: SoundPresetView = {
        preset_key: r.preset_key, kind, name: str(r.name) || r.preset_key, description: str(r.description),
        status: typeof r.status === 'string' ? r.status : null, brand_override: r.brand_id === brandId,
        ...(kind === 'bed'
          ? { bed_sound: str(r?.spec?.bed?.sound) || null, under_voice_lu: num(r?.spec?.bed?.under_voice_lu) }
          : { sounds_by_fn: soundsByFnOf(r?.spec), text_presets_with_impact: Object.keys(r?.spec?.cues?.block_entry?.by_text_preset ?? {}) }),
      };
      if (r.status === 'retired') out.retired.push(v);
      else out[kind].push(v);
    });
  return out;
}

/** La librería tal como la lista VoiceLab, con lo que la ventana usa; filas sin `sound_key` o sin `fn`, fuera. PURO. */
export function libraryOf(raw: unknown): LibrarySound[] {
  const r0 = raw as any;
  const rows = Array.isArray(r0?.sounds) ? r0.sounds : Array.isArray(r0?.library) ? r0.library : Array.isArray(r0) ? r0 : [];
  return rows
    .map((r: any) => ({
      sound_key: str(r?.sound_key), fn: str(r?.fn), description: str(r?.description),
      duration_ms: num(r?.duration_ms), loudness_lufs: num(r?.loudness_lufs), license: str(r?.license) || null,
      url: /^https:\/\//.test(str(r?.url)) ? str(r.url) : null,
    }))
    .filter((r: LibrarySound) => r.sound_key && r.fn);
}

// ── Validación del pedido ───────────────────────────────────────────────────────────────────────

/**
 * Valida `text_layers.sound` contra el catálogo que ve la marca. Ausente = sin sonido (`null`). Un preset de otra
 * familia, un sonido de otro momento o un volumen fuera de rango son errores con el campo nombrado: NO se acota en
 * silencio. `library` null = la librería no se pudo leer: entonces no se acepta ninguna elección desde la librería
 * (un sonido que no se pudo comprobar no se manda). PURO.
 */
export function validateSound(raw: unknown, ctx: { presets: SoundPresets; library: LibrarySound[] | null }):
  { ok: true; value: SoundLayer | null } | { ok: false; errors: string[] } {
  if (raw == null) return { ok: true, value: null };
  if (!obj(raw)) return { ok: false, errors: ['sound debe ser un objeto'] };
  const errors: string[] = [];
  const out: SoundLayer = {};
  if (raw.enabled !== undefined) { if (typeof raw.enabled !== 'boolean') errors.push('sound.enabled debe ser sí o no'); else out.enabled = raw.enabled; }
  if (raw.platform !== undefined) { const p = str(raw.platform); if (!p) errors.push('sound.platform vacío'); else out.platform = p; }

  const deLibreria = (key: unknown, fn: string, campo: string): string | null => {
    const k = str(key);
    if (!k) { errors.push(`${campo}: falta el sonido`); return null; }
    if (!ctx.library) { errors.push(`${campo}: la librería de sonidos no respondió; no se puede comprobar «${k}»`); return null; }
    const s = ctx.library.find((x) => x.sound_key === k);
    if (!s) { errors.push(`${campo}: «${k}» no está en la librería`); return null; }
    if (s.fn !== fn) { errors.push(`${campo}: «${k}» es un sonido de «${s.fn}», no de «${fn}»`); return null; }
    return k;
  };
  const rango = (v: unknown, r: { min: number; max: number; step: number; unit: string }, campo: string): number | undefined => {
    if (v === undefined || v === null) return undefined;
    const n = num(v);
    if (n === null || n < r.min || n > r.max || Math.round(n / r.step) * r.step !== n) {
      errors.push(`${campo}: debe ir de ${r.min} a ${r.max} ${r.unit} en pasos de ${r.step}`); return undefined;
    }
    return n === 0 ? undefined : n;
  };
  const preset = (key: unknown, lista: SoundPresetView[], familia: string, campo: string): string | undefined => {
    if (key === undefined || key === null) return undefined;
    const k = str(key);
    if (!lista.some((p) => p.preset_key === k)) { errors.push(`${campo}: el preset «${k}» no existe, está retirado o no es de ${familia}`); return undefined; }
    return k;
  };

  if (raw.bed !== undefined && raw.bed !== null) {
    if (!obj(raw.bed)) errors.push('sound.bed debe ser un objeto');
    else {
      const b: NonNullable<SoundLayer['bed']> = {};
      const pk = preset(raw.bed.preset_key, ctx.presets.bed, 'fondo', 'sound.bed.preset_key'); if (pk) b.preset_key = pk;
      if (raw.bed.sound_key !== undefined && raw.bed.sound_key !== null) { const k = deLibreria(raw.bed.sound_key, BED_FN, 'sound.bed.sound_key'); if (k) b.sound_key = k; }
      if (raw.bed.enabled !== undefined) { if (typeof raw.bed.enabled !== 'boolean') errors.push('sound.bed.enabled debe ser sí o no'); else b.enabled = raw.bed.enabled; }
      const lv = rango(raw.bed.level_lu, BED_LEVEL, 'sound.bed.level_lu'); if (lv !== undefined) b.level_lu = lv;
      // v1.10.0 §4 ter.8: con la familia encendida el preset es obligatorio; la librería y el volumen van encima.
      if (b.enabled !== false && !b.preset_key) errors.push('sound.bed: falta el preset de fondo (la librería y el volumen van encima del preset)');
      out.bed = b;
    }
  }
  if (raw.effects !== undefined && raw.effects !== null) {
    if (!obj(raw.effects)) errors.push('sound.effects debe ser un objeto');
    else {
      const e: NonNullable<SoundLayer['effects']> = {};
      const pk = preset(raw.effects.preset_key, ctx.presets.effects, 'efectos', 'sound.effects.preset_key'); if (pk) e.preset_key = pk;
      if (raw.effects.enabled !== undefined) { if (typeof raw.effects.enabled !== 'boolean') errors.push('sound.effects.enabled debe ser sí o no'); else e.enabled = raw.effects.enabled; }
      const g = rango(raw.effects.gain_db, FX_GAIN, 'sound.effects.gain_db'); if (g !== undefined) e.gain_db = g;
      if (raw.effects.sounds_by_fn !== undefined && raw.effects.sounds_by_fn !== null) {
        if (!obj(raw.effects.sounds_by_fn)) errors.push('sound.effects.sounds_by_fn debe ser un objeto');
        else {
          const m: Partial<Record<EffectFn, string | null>> = {};
          for (const [fn, k] of Object.entries(raw.effects.sounds_by_fn)) {
            if (!(EFFECT_FNS as readonly string[]).includes(fn)) { errors.push(`sound.effects.sounds_by_fn: «${fn}» no es un momento de los efectos`); continue; }
            if (k === null) { m[fn as EffectFn] = null; continue; } // silencio: ese momento no suena (Sam, 2026-11-17)
            const ok = deLibreria(k, fn, `sound.effects.sounds_by_fn.${fn}`); if (ok) m[fn as EffectFn] = ok;
          }
          if (Object.keys(m).length) e.sounds_by_fn = m;
        }
      }
      if (e.enabled !== false && !e.preset_key) errors.push('sound.effects: falta el preset de efectos (la librería y el volumen van encima del preset)');
      out.effects = e;
    }
  }
  if (raw.preset_key !== undefined) errors.push('sound.preset_key es la forma anterior (un solo preset); la ventana manda fondo y efectos por separado');
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

// ── El borrador de la ventana ───────────────────────────────────────────────────────────────────

export interface SoundDraft {
  bed: { on: boolean; preset_key: string; sound_key: string | null; level_lu: number };
  effects: { on: boolean; preset_key: string; gain_db: number; overrides: Partial<Record<EffectFn, string | null>> };
}

/**
 * El borrador con el que abre la ventana: lo guardado si lo hay; si no, la sugerencia de la rotación para el fondo y el
 * primer preset de efectos. Lo guardado manda siempre sobre la sugerencia. PURO.
 */
export function soundDraftOf(current: unknown, presets: SoundPresets, suggestedBed: string | null): SoundDraft {
  const c: SoundLayer = obj(current) ? (current as SoundLayer) : {};
  const bedKey = c.bed?.preset_key && presets.bed.some((p) => p.preset_key === c.bed!.preset_key) ? c.bed.preset_key
    : (suggestedBed && presets.bed.some((p) => p.preset_key === suggestedBed) ? suggestedBed : presets.bed[0]?.preset_key ?? '');
  const fxKey = c.effects?.preset_key && presets.effects.some((p) => p.preset_key === c.effects!.preset_key) ? c.effects.preset_key
    : presets.effects[0]?.preset_key ?? '';
  const guardado = obj(current);
  return {
    bed: { on: guardado ? (c.enabled !== false && !!c.bed && c.bed.enabled !== false) : true, preset_key: bedKey, sound_key: c.bed?.sound_key ?? null, level_lu: c.bed?.level_lu ?? 0 },
    effects: { on: guardado ? (c.enabled !== false && !!c.effects && c.effects.enabled !== false) : true, preset_key: fxKey, gain_db: c.effects?.gain_db ?? 0, overrides: { ...(c.effects?.sounds_by_fn ?? {}) } },
  };
}

/** Lo que se manda a VideoLab a partir del borrador. Lo que coincide con el preset no viaja (el preset manda). PURO. */
export function soundFromDraft(d: SoundDraft, presets: SoundPresets): SoundLayer {
  const fx = presets.effects.find((p) => p.preset_key === d.effects.preset_key);
  const overrides: Partial<Record<EffectFn, string | null>> = {};
  for (const [fn, k] of Object.entries(d.effects.overrides) as Array<[EffectFn, string | null]>) {
    if (k === undefined) continue;
    if (k === (fx?.sounds_by_fn?.[fn] ?? null)) continue; // igual que el preset: no hace falta mandarlo
    overrides[fn] = k;
  }
  const bedPreset = presets.bed.find((p) => p.preset_key === d.bed.preset_key);
  const sonidoFondo = d.bed.sound_key && d.bed.sound_key !== bedPreset?.bed_sound ? d.bed.sound_key : null;
  return {
    bed: d.bed.on
      ? { preset_key: d.bed.preset_key, ...(sonidoFondo ? { sound_key: sonidoFondo } : {}), ...(d.bed.level_lu ? { level_lu: d.bed.level_lu } : {}) }
      : { enabled: false, ...(d.bed.preset_key ? { preset_key: d.bed.preset_key } : {}) },
    effects: d.effects.on
      ? { preset_key: d.effects.preset_key, ...(d.effects.gain_db ? { gain_db: d.effects.gain_db } : {}), ...(Object.keys(overrides).length ? { sounds_by_fn: overrides } : {}) }
      : { enabled: false, ...(d.effects.preset_key ? { preset_key: d.effects.preset_key } : {}) },
  };
}

/** El sonido que suena en un momento con el borrador: el elegido, el del preset, o `null` (en silencio). PURO. */
export function effectSoundNow(d: SoundDraft, presets: SoundPresets, fn: EffectFn): string | null {
  if (fn in d.effects.overrides) return d.effects.overrides[fn] ?? null;
  return presets.effects.find((p) => p.preset_key === d.effects.preset_key)?.sounds_by_fn?.[fn] ?? null;
}

/** El sonido de fondo que suena con el borrador: el de la librería si se eligió, si no el del preset. PURO. */
export function bedSoundNow(d: SoundDraft, presets: SoundPresets): string | null {
  return d.bed.sound_key ?? presets.bed.find((p) => p.preset_key === d.bed.preset_key)?.bed_sound ?? null;
}

// ── Cuántas veces suena cada momento en la pieza ────────────────────────────────────────────────

/**
 * Cuántas veces aparece cada momento en la pieza, de lo que se puede saber sin renderizar: entradas de texto (gancho y
 * títulos clave), llamada a la acción, roles visibles, títulos con estilo de golpe (dato del preset de efectos),
 * cifras en los títulos clave y cortes de toma del timeline (cambio de `shot_id`, la misma regla del motor:
 * `render/src/sound.mjs`, `shotCuts`). `null` = no se sabe. PURO.
 */
export function cueCountsOf(textLayers: any, timeline: any, impactPresets: string[]): Record<EffectFn, number | null> {
  const kt: any[] = Array.isArray(textLayers?.key_titles) ? textLayers.key_titles : [];
  const roles: any[] = Array.isArray(textLayers?.roles) ? textLayers.roles : [];
  const caras = Array.isArray(timeline?.faces) ? [...timeline.faces].sort((a: any, b: any) => a.start_ms - b.start_ms) : null;
  let cortes: number | null = null;
  if (caras) {
    const set = new Set<number>();
    for (let k = 1; k < caras.length; k++) if (caras[k].shot_id !== caras[k - 1].shot_id && caras[k].start_ms > 0) set.add(caras[k].start_ms);
    cortes = set.size;
  }
  const golpes = kt.filter((k) => impactPresets.includes(k?.preset_key)).length;
  return {
    block_entry: (textLayers?.hook ? 1 : 0) + kt.length - golpes,
    cta: textLayers?.cta ? 1 : 0,
    word_pop: roles.filter((r) => r?.show !== false).length,
    impact: golpes,
    digit_land: kt.reduce((n, k) => n + ((String(k?.text ?? '').match(/\d+(?:[.,]\d+)*/g) ?? []).length), 0),
    shot_cut: cortes,
  };
}
