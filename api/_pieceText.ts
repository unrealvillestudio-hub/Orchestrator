/**
 * UNRLVL Orchestrator — api/_pieceText.ts (2026-11-16 · contrato «Texto en pantalla» v1, §4)
 *
 * EL TEXTO EN PANTALLA DE UNA PIEZA: QUÉ SE LE PIDE A CADA LAB Y QUÉ SE GUARDA. Funciones PURAS: sin red, sin base.
 * La ruta (`api/piece-text.ts`) hace la entrada y la salida; aquí vive todo lo que se puede probar sin montarla.
 *
 * ── REGLA LABS ───────────────────────────────────────────────────────────────────────────────────
 * El Orchestrator ORQUESTA. Los ganchos, las frases clave y los CTA los escribe CopyLab (`short_video_text`); el texto
 * sobre el video lo dibuja VideoLab (`mode: text_layers`). Aquí sólo se arma el pedido con el dato de la pieza, se
 * valida la forma de lo que eligió quien edita y se guarda el resultado. Ninguna frase ni ningún píxel salen de aquí.
 *
 * ── REGLA MULTIMARCA ─────────────────────────────────────────────────────────────────────────────
 * Ni una marca, ni un color, ni una fuente en este archivo: los presets son filas de `videolab_text_presets` (la de la
 * marca manda sobre la del sistema), los colores son roles de `brand_palette` que la marca declara para el resaltado
 * y para su franja (los mismos que ya ofrece el editor de imagen), y el idioma sale de `public.brands`.
 */

// ── Tipos del dato ─────────────────────────────────────────────────────────────────────────────

export const TEXT_LAYERS = ['hook', 'role', 'caption', 'key_title', 'cta'] as const;
export type TextLayer = (typeof TEXT_LAYERS)[number];

export const SHARE_GOALS = ['share', 'comment', 'follow', 'save'] as const;
export type ShareGoal = (typeof SHARE_GOALS)[number];

/** Una persona del video, como la espera CopyLab (`source.cast[]`) y como la dibuja VideoLab (`roles[]`). */
export interface CastMember { person_id: string; name: string; role: 'host' | 'guest'; title: string }
export interface ScriptLine { speaker_role: 'host' | 'guest' | 'vo'; speaker_name: string; text: string }
export interface SourceClaim { text: string; source_url: string }

export interface CopyLabSource {
  title: string;
  copy: string;
  claims: SourceClaim[];
  current_hook: string | null;
  script_lines: ScriptLine[] | null;
  cast: CastMember[];
}

/** Lo que VideoLab recibe en `previousOutputs.text_layers` (contrato §3.2). */
export interface TextLayers {
  hook: { text: string; preset_key: string; start_ms: number; end_ms: number; emphasis: string[]; pattern_key?: string | null } | null;
  roles: Array<{ person_id: string; text: string; show: boolean; at_ms: number; dur_ms: number; preset_key: string }>;
  captions: { enabled: boolean; preset_key: string; accent_role: string } | null;
  key_titles: Array<{ text: string; at_ms: number; dur_ms: number; preset_key: string }>;
  cta: { text: string; at_ms: number; preset_key: string; pattern_key?: string | null } | null;
  identity: { strip: boolean; strip_role: string | null };
}

export interface PresetView { preset_key: string; layer: TextLayer; name: string; description: string; status: string | null; brand_override: boolean }
export type PresetsByLayer = Record<TextLayer, PresetView[]>;

// ── Leer la pieza ──────────────────────────────────────────────────────────────────────────────

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const obj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ¿La pieza es de video? Mismo criterio que `esPiezaDeVideo` (una url no vacía en `assets.video.url`). */
export function mediumOf(assets: unknown): 'video' | 'image' {
  const url = (assets as any)?.video?.url;
  return typeof url === 'string' && url.length > 0 ? 'video' : 'image';
}

/** ¿El video tiene la versión limpia (sin texto) y la línea de tiempo que el render de texto necesita? */
export function hasCleanVideo(assets: unknown): boolean {
  const v = (assets as any)?.video;
  return !!str(v?.clean_video?.url) && obj(v?.timeline);
}

export const NO_CLEAN_VIDEO =
  'Este video no tiene versión limpia; se podrá editar el texto cuando VideoLab la genere.';

/**
 * Las personas del video, en la forma del contrato. Sólo se aceptan listas estructuradas (`assets.video.cast_members`
 * o `assets.video.cast` como lista): un `cast` en texto libre es una nota de producción, no un dato que se pueda
 * mandar a un lab, y se ignora en vez de adivinar nombres de una frase.
 */
export function castOf(assets: unknown): CastMember[] {
  const v = (assets as any)?.video ?? {};
  const lista = Array.isArray(v.cast_members) ? v.cast_members : Array.isArray(v.cast) ? v.cast : [];
  const out: CastMember[] = [];
  for (const c of lista) {
    const person_id = str(c?.person_id);
    const name = str(c?.name ?? c?.display_name);
    if (!person_id || !name || out.some((o) => o.person_id === person_id)) continue;
    out.push({ person_id, name, role: c?.role === 'host' ? 'host' : 'guest', title: str(c?.title) });
  }
  return out;
}

/** Las líneas del guion, si el video las guarda (`assets.video.script_lines`). `null` = no hay guion guardado. */
export function scriptLinesOf(assets: unknown): ScriptLine[] | null {
  const raw = (assets as any)?.video?.script_lines;
  if (!Array.isArray(raw)) return null;
  const out: ScriptLine[] = [];
  for (const l of raw) {
    const text = str(l?.text);
    if (!text) continue;
    const r = l?.speaker_role;
    out.push({ speaker_role: r === 'host' || r === 'guest' ? r : 'vo', speaker_name: str(l?.speaker_name), text });
  }
  return out.length ? out : null;
}

/**
 * Las afirmaciones con fuente del hallazgo (`intel.iid_findings.claims`), en la forma de CopyLab. La cifra viaja
 * DENTRO del texto (`claim: value`): CopyLab sólo admite cifras que estén en `claims[].text` o en el copy, así que
 * separar el valor de la frase sería quitarle a CopyLab la única fuente de la cifra.
 */
export function claimsOf(raw: unknown): SourceClaim[] {
  const out: SourceClaim[] = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    const frase = str(c?.claim ?? c?.text);
    const valor = str(c?.value);
    const text = frase && valor ? `${frase}: ${valor}` : (frase || valor);
    if (!text) continue;
    out.push({ text, source_url: str(c?.source_url) });
  }
  return out;
}

/** El gancho que la pieza lleva hoy: el del video si lo tiene; si no, el titular de la imagen. */
export function currentHookOf(assets: unknown): string | null {
  const a = assets as any;
  const delVideo = str(a?.video?.text_layers?.hook?.text);
  if (delVideo) return delVideo;
  const ov = a?.image?.overlay_override;
  const escrito = str(ov?.headline);
  if (escrito) return escrito.replace(/\s*\n\s*/g, ' ');
  const compuesto = str(a?.image?.overlay?.headline ?? a?.image?.composed_text?.headline);
  return compuesto ? compuesto.replace(/\s*\n\s*/g, ' ') : null;
}

/** El `source` que se manda a CopyLab, armado SÓLO con dato de la pieza y de su hallazgo. PURO. */
export function buildCopyLabSource(piece: { assets?: unknown }, findingClaims: unknown): CopyLabSource {
  const a = (piece.assets ?? {}) as any;
  const video = mediumOf(a) === 'video';
  return {
    title: str(a?.copy?.title),
    copy: str(a?.copy?.aife_filtered) || str(a?.copy?.raw),
    claims: claimsOf(findingClaims),
    current_hook: currentHookOf(a),
    script_lines: video ? scriptLinesOf(a) : null,
    cast: video ? castOf(a) : [],
  };
}

/** El idioma que CopyLab admite, desde lo que la marca declara (`es-PA` → `es`). `null` = la marca no declara uno que sirva. */
export function copyLabLanguageOf(declared: unknown): 'es' | 'en' | null {
  const p = str(declared).toLowerCase().slice(0, 2);
  return p === 'es' || p === 'en' ? p : null;
}

/** El objetivo de la pieza para los CTA. Lo elige quien edita; sin elección, la del editor de video: el reenvío. */
export function goalOf(raw: unknown): ShareGoal {
  return (SHARE_GOALS as readonly string[]).includes(raw as string) ? (raw as ShareGoal) : 'share';
}

/** El pedido completo a CopyLab (contrato §2). En imagen sólo se piden ganchos. PURO. */
export function buildCopyLabBody(opts: {
  brandId: string; medium: 'video' | 'image'; language: 'es' | 'en'; source: CopyLabSource;
  goal: ShareGoal; recentPatternKeys: string[];
}) {
  return {
    brandId: opts.brandId,
    params: {
      mode: 'short_video_text',
      task: opts.medium === 'video' ? 'all' : 'hooks',
      medium: opts.medium,
      language: opts.language,
      source: opts.source,
      goal: opts.goal,
      recent_pattern_keys: opts.recentPatternKeys,
    },
  };
}

// ── La regla N = 8 ─────────────────────────────────────────────────────────────────────────────

/** Cuántas piezas anteriores de la misma marca y plataforma cuentan para no repetir el patrón del gancho. */
export const RECENT_PIECES_N = 8;

/**
 * Los `pattern_key` de gancho de las últimas N piezas (ya ordenadas, la más reciente primero). Se leen de donde cada
 * medio los guarda: `assets.video.hook_pattern_key`, `assets.video.text_layers.hook.pattern_key` o
 * `assets.image.hook_pattern_key`. Una pieza sin clave cuenta igual en la ventana: la regla habla de piezas seguidas,
 * no de piezas con gancho registrado. PURO.
 */
export function recentPatternKeysOf(rows: Array<{ id?: unknown; assets?: unknown }>, excludeId: string): string[] {
  const out: string[] = [];
  const ventana = (rows ?? []).filter((r) => r?.id !== excludeId).slice(0, RECENT_PIECES_N);
  for (const r of ventana) {
    const a = r?.assets as any;
    for (const k of [a?.video?.hook_pattern_key, a?.video?.text_layers?.hook?.pattern_key, a?.image?.hook_pattern_key]) {
      const key = str(k);
      if (key && !out.includes(key)) out.push(key);
    }
  }
  return out;
}

// ── Los presets ────────────────────────────────────────────────────────────────────────────────

/**
 * Los presets activos agrupados por capa, con la fila de la marca por encima de la del sistema (misma `preset_key`).
 * Ordenados por `sort`. Un preset retirado no se ofrece. PURO.
 */
export function groupPresets(rows: unknown, brandId: string): PresetsByLayer {
  const elegidos = new Map<string, any>();
  for (const r of Array.isArray(rows) ? rows : []) {
    const key = str(r?.preset_key);
    if (!key || r?.active === false || r?.status === 'retired') continue;
    if (!(TEXT_LAYERS as readonly string[]).includes(r?.layer)) continue;
    const deMarca = r?.brand_id === brandId;
    if (r?.brand_id != null && !deMarca) continue;
    const previo = elegidos.get(key);
    if (!previo || (deMarca && previo.brand_id !== brandId)) elegidos.set(key, r);
  }
  const out = Object.fromEntries(TEXT_LAYERS.map((l) => [l, [] as PresetView[]])) as PresetsByLayer;
  [...elegidos.values()]
    .sort((x, y) => (Number(x.sort ?? 100) - Number(y.sort ?? 100)) || String(x.preset_key).localeCompare(String(y.preset_key)))
    .forEach((r) => out[r.layer as TextLayer].push({
      preset_key: r.preset_key, layer: r.layer, name: str(r.name) || r.preset_key, description: str(r.description),
      status: typeof r.status === 'string' ? r.status : null, brand_override: r.brand_id === brandId,
    }));
  return out;
}

// ── Lo que quien edita eligió ──────────────────────────────────────────────────────────────────

export const HOOK_TEXT_MAX = 140;
export const LINE_TEXT_MAX = 160;
export const KEY_TITLES_MAX = 6;
export const ROLES_MAX = 6;

/**
 * Valida y normaliza las capas de texto elegidas. Comprueba la FORMA y que cada preset sea de su capa y cada color un
 * rol que la marca ofrece; lo que se dibuja y dónde lo decide VideoLab. Devuelve la lista de errores en vez de parar en
 * el primero: quien edita corrige todo de una vez. PURO.
 */
export function validateTextLayers(
  raw: unknown,
  ctx: { presets: PresetsByLayer | null; accentRoles: string[]; stripRoles: string[]; durationMs: number | null; castIds: string[] },
): { ok: true; value: TextLayers } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!obj(raw)) return { ok: false, errors: ['text_layers debe ser un objeto'] };
  const ms = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : NaN);
  const dentro = (n: number, campo: string) => {
    if (!Number.isFinite(n) || n < 0) { errors.push(`${campo} debe ser un número de milisegundos ≥ 0`); return; }
    if (ctx.durationMs != null && n > ctx.durationMs) errors.push(`${campo} (${n} ms) pasa del final del video (${ctx.durationMs} ms)`);
  };
  const preset = (layer: TextLayer, key: unknown, campo: string): string => {
    const k = str(key);
    if (!k) { errors.push(`${campo}: falta preset_key`); return k; }
    if (ctx.presets && !ctx.presets[layer].some((p) => p.preset_key === k)) errors.push(`${campo}: el preset «${k}» no existe o no es de la capa ${layer}`);
    return k;
  };
  const texto = (v: unknown, campo: string, max: number): string => {
    const t = str(v);
    if (!t) errors.push(`${campo}: falta el texto`);
    else if (t.length > max) errors.push(`${campo}: ${t.length} caracteres, el máximo es ${max}`);
    return t;
  };

  let hook: TextLayers['hook'] = null;
  if (raw.hook != null) {
    const h = raw.hook;
    if (!obj(h)) errors.push('hook debe ser un objeto o null');
    else {
      const start = ms(h.start_ms ?? 0), end = ms(h.end_ms);
      dentro(start, 'hook.start_ms'); dentro(end, 'hook.end_ms');
      if (Number.isFinite(start) && Number.isFinite(end) && end <= start) errors.push('hook.end_ms debe ser mayor que hook.start_ms');
      hook = {
        text: texto(h.text, 'hook', HOOK_TEXT_MAX), preset_key: preset('hook', h.preset_key, 'hook'),
        start_ms: start, end_ms: end,
        emphasis: Array.isArray(h.emphasis) ? h.emphasis.map(str).filter(Boolean).slice(0, 3) : [],
        pattern_key: str(h.pattern_key) || null,
      };
    }
  }

  const roles: TextLayers['roles'] = [];
  if (raw.roles != null && !Array.isArray(raw.roles)) errors.push('roles debe ser una lista');
  for (const [i, r] of (Array.isArray(raw.roles) ? raw.roles : []).slice(0, ROLES_MAX).entries()) {
    const campo = `roles[${i}]`;
    if (!obj(r)) { errors.push(`${campo} debe ser un objeto`); continue; }
    const person_id = str(r.person_id);
    if (!person_id) errors.push(`${campo}: falta person_id`);
    else if (ctx.castIds.length && !ctx.castIds.includes(person_id)) errors.push(`${campo}: la persona ${person_id} no sale en este video`);
    const at = ms(r.at_ms), dur = ms(r.dur_ms);
    dentro(at, `${campo}.at_ms`);
    if (!(dur > 0)) errors.push(`${campo}.dur_ms debe ser mayor que 0`);
    roles.push({ person_id, text: texto(r.text, campo, LINE_TEXT_MAX), show: r.show !== false, at_ms: at, dur_ms: dur, preset_key: preset('role', r.preset_key, campo) });
  }

  let captions: TextLayers['captions'] = null;
  if (raw.captions != null) {
    const c = raw.captions;
    if (!obj(c)) errors.push('captions debe ser un objeto o null');
    else {
      const accent = str(c.accent_role);
      if (!accent) errors.push('captions: falta accent_role');
      else if (!ctx.accentRoles.includes(accent)) errors.push(`captions: el color «${accent}» no es uno de los que la marca ofrece`);
      captions = { enabled: c.enabled !== false, preset_key: preset('caption', c.preset_key, 'captions'), accent_role: accent };
    }
  }

  const key_titles: TextLayers['key_titles'] = [];
  if (raw.key_titles != null && !Array.isArray(raw.key_titles)) errors.push('key_titles debe ser una lista');
  const kts = Array.isArray(raw.key_titles) ? raw.key_titles : [];
  if (kts.length > KEY_TITLES_MAX) errors.push(`key_titles: ${kts.length} títulos, el máximo es ${KEY_TITLES_MAX}`);
  for (const [i, k] of kts.slice(0, KEY_TITLES_MAX).entries()) {
    const campo = `key_titles[${i}]`;
    if (!obj(k)) { errors.push(`${campo} debe ser un objeto`); continue; }
    const at = ms(k.at_ms), dur = ms(k.dur_ms);
    dentro(at, `${campo}.at_ms`);
    if (!(dur > 0)) errors.push(`${campo}.dur_ms debe ser mayor que 0`);
    key_titles.push({ text: texto(k.text, campo, LINE_TEXT_MAX), at_ms: at, dur_ms: dur, preset_key: preset('key_title', k.preset_key, campo) });
  }

  let cta: TextLayers['cta'] = null;
  if (raw.cta != null) {
    const c = raw.cta;
    if (!obj(c)) errors.push('cta debe ser un objeto o null');
    else {
      const at = ms(c.at_ms);
      dentro(at, 'cta.at_ms');
      cta = { text: texto(c.text, 'cta', LINE_TEXT_MAX), at_ms: at, preset_key: preset('cta', c.preset_key, 'cta'), pattern_key: str(c.pattern_key) || null };
    }
  }

  const idRaw = obj(raw.identity) ? raw.identity : {};
  const strip = idRaw.strip === true;
  const stripRole = str(idRaw.strip_role) || null;
  if (strip && stripRole && !ctx.stripRoles.includes(stripRole)) errors.push(`identity: el color «${stripRole}» no es uno de los de la franja de la marca`);
  const identity = { strip, strip_role: strip ? stripRole : null };

  if (!hook && !roles.some((r) => r.show) && !(captions?.enabled) && !key_titles.length && !cta && !strip) {
    errors.push('no hay ninguna capa de texto elegida: el video quedaría limpio');
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: { hook, roles, captions, key_titles, cta, identity } };
}

// ── El pedido a VideoLab ───────────────────────────────────────────────────────────────────────

/** El pedido de sólo texto a VideoLab (contrato §3.2). Lo valida antes `validateTextLayers`. PURO. */
export function buildVideoLabBody(opts: {
  brandId: string; pieceId: string; platform: string; parentJobId: string | null;
  cleanVideoUrl: string; timeline: unknown; textLayers: TextLayers;
}) {
  return {
    brandId: opts.brandId,
    pieceId: opts.pieceId,
    // El libro de costos y `lab_jobs.parent_job_id` piden un UUID: sólo se manda cuando la pieza lo tiene.
    ...(opts.parentJobId && UUID.test(opts.parentJobId) ? { parentJobId: opts.parentJobId } : {}),
    params: { mode: 'text_layers', platform: opts.platform, format: 'reel' },
    previousOutputs: {
      base_video: { url: opts.cleanVideoUrl },
      timeline: opts.timeline,
      text_layers: opts.textLayers,
    },
  };
}

/** La URL de ejecución de un lab desde su fila de `lab_configs`. `null` = la fila no trae dónde llamarlo. PURO. */
export function labExecuteUrl(row: { api_endpoint?: unknown; execute_path?: unknown } | null | undefined): string | null {
  const base = str(row?.api_endpoint).replace(/\/+$/, '');
  if (!/^https:\/\//.test(base)) return null;
  const path = str(row?.execute_path) || '/api/execute';
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

// ── El job terminado ───────────────────────────────────────────────────────────────────────────

/** El código de error de un job fallido: el del `output_parsed`, o el prefijo `ETIQUETA:` de `error_msg`. PURO. */
export function errorLabelOf(job: { error_msg?: unknown; output_parsed?: unknown }): { error_label: string; detail: string } {
  const out = job?.output_parsed as any;
  const msg = str(job?.error_msg);
  const m = /^([A-Z][A-Z0-9_]+):\s*([\s\S]*)$/.exec(msg);
  const error_label = str(out?.error_label) || (m ? m[1] : 'VIDEOLAB_FAILED');
  return { error_label, detail: m ? m[2] : (msg || str(out?.error) || 'VideoLab no devolvió el motivo') };
}

/** `v1` → `v2`; `3` → `4`; sin versión, `v2` (la que había era la primera). PURO. */
export function nextVersion(v: unknown): string {
  const m = /^(v?)(\d+)$/i.exec(str(String(v ?? '')));
  if (!m) return 'v2';
  return `${m[1] || ''}${Number(m[2]) + 1}`;
}

export const VIDEO_HISTORY_MAX = 10;

/**
 * Los `assets` de la pieza después de un render de texto TERMINADO: el video de ahora pasa a `video_history[]` (la más
 * reciente primero, con tope) y `video` queda con el nuevo, su versión siguiente, sus capas y la clave del gancho. La
 * versión limpia y la línea de tiempo se conservan: son la base de la próxima edición. PURO.
 */
export function assetsAfterTextJob(assets: any, job: { id: string; output_parsed?: any }, nowIso: string): any {
  const a = { ...(assets ?? {}) };
  const actual = { ...(a.video ?? {}) };
  const pending = actual.pending_text_job ?? null;
  delete actual.pending_text_job;
  const out = job.output_parsed ?? {};
  const nuevo = out.video ?? {};
  const layers = out.text_layers ?? pending?.text_layers ?? null;
  const durMs = Number(nuevo.duration_ms);
  const video = {
    ...actual,
    url: nuevo.url,
    poster_url: nuevo.poster_url ?? actual.poster_url ?? null,
    storage_path: nuevo.storage_path ?? null,
    width: nuevo.width ?? actual.width ?? null,
    height: nuevo.height ?? actual.height ?? null,
    duration_s: Number.isFinite(durMs) && durMs > 0 ? Math.round(durMs / 10) / 100 : actual.duration_s ?? null,
    clean_video: out.clean_video?.url ? out.clean_video : actual.clean_video ?? null,
    timeline: actual.timeline ?? null,
    text_layers: layers,
    hook_pattern_key: layers?.hook?.pattern_key ?? null,
    version: nextVersion(actual.version),
    text_job_id: job.id,
    cost_usd: typeof out.cost_usd === 'number' ? out.cost_usd : null,
    updated_at: nowIso,
  };
  const historial = Array.isArray(a.video_history) ? a.video_history : [];
  a.video_history = [{ ...actual, replaced_at: nowIso }, ...historial].slice(0, VIDEO_HISTORY_MAX);
  a.video = video;
  return a;
}

/** Los `assets` cuando el job falló: se quita el pedido pendiente y se deja constancia del último fallo. PURO. */
export function assetsAfterFailedJob(assets: any, failure: { error_label: string; detail: string; job_id: string }, nowIso: string): any {
  const a = { ...(assets ?? {}) };
  const v = { ...(a.video ?? {}) };
  delete v.pending_text_job;
  v.last_text_job_error = { ...failure, at: nowIso };
  a.video = v;
  return a;
}
