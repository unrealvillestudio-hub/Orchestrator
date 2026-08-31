/**
 * UNRLVL Orchestrator — api/_pieceMetrics.ts  (FIX-CARD-06)
 *
 * Lo que la CABECERA de una pieza necesita para decir, sin abrir nada, si la pieza cabe
 * en su canal y si cierra como el genoma manda:
 *
 *     marca · canal · formato · 300/2200 car · 3/30 hashtags · firma ✓
 *
 * ── POR QUÉ VIVE ACÁ Y NO EN LA UI ────────────────────────────────────────────────
 * Los topes NO son constantes: salen de `public.platform_configs`, una fila por canal
 * (`char_limit`, `char_target`, `hashtag_limit`). La firma esperada tampoco: sale de
 * `public.brand_voice_genome.application_constraints -> signature_closer`, resuelta por
 * `brand_id`/`voice_id`. Las dos son lecturas con service_role, así que se hacen en el
 * server y viajan resueltas a la tarjeta. En el cliente no hay ni un número de tope.
 *
 * ── LA REGLA DEL COLOR, Y POR QUÉ «SIN DATO» NO ES VERDE ──────────────────────────
 * Verde exige DOS cosas: que el tope esté sembrado y que la pieza lo cumpla. Un tope
 * ausente no se aproxima ni se supone — se declara ámbar CON MOTIVO, nombrando la
 * columna que falta. Pintar verde lo que nadie midió es el defecto que ya hizo
 * rechazar material bueno en esta misma bandeja (ver `WatcherBadge`, SIGN-01 corte D):
 * una ausencia con forma de aprobación.
 *
 * ── QUÉ TEXTO SE MIDE ─────────────────────────────────────────────────────────────
 * El que sale por ESE canal: `assets.social.adapted[]` con `platform` igual al de la
 * pieza. Ese es el texto que el canal recibe, y el tope es del canal. Medir el maestro
 * (`copy.aife_filtered`, que puede ser de largo editorial) contra el tope de un canal
 * corto produce rojos falsos sobre piezas que salen perfectas. Cuando no hay adaptación
 * para el canal, se cae al maestro y se DECLARA cuál se contó (`text_source`), porque
 * un número sin decir qué contó no es comparable.
 *
 * Cero identificadores de marca, de canal o de voz en este archivo: todo es dato.
 */

import { SB_URL, SB_KEY, bodyTextOf, type ContentPiece } from './_calibrationShared.js';

// ── Contrato hacia la tarjeta ────────────────────────────────────────────────────

/** Qué texto se contó. Viaja a la UI: un número sin su fuente no se puede comparar. */
export type TextSource = 'channel_adapted' | 'master_copy' | 'empty';

/**
 * Estado de un conteo contra su tope.
 *   ok          → hay tope sembrado y la pieza lo cumple
 *   over_target → pasa el objetivo, no el tope duro
 *   over_limit  → pasa el tope duro: el canal la corta
 *   no_data     → el tope no está sembrado. NUNCA verde, siempre con motivo.
 */
export type LimitStatus = 'ok' | 'over_target' | 'over_limit' | 'no_data';

export interface CountAgainstLimit {
  count: number;
  /** `char_target` / — · null cuando la columna no está sembrada. */
  target: number | null;
  /** `char_limit` / `hashtag_limit` · null cuando la columna no está sembrada. */
  limit: number | null;
  status: LimitStatus;
  /** Qué falta y dónde se siembra. null cuando hay dato. */
  reason: string | null;
}

/**
 * Estado de la firma. Es una COMPARACIÓN entre la que el genoma declara y la que la
 * pieza estampa — nunca una inferencia sobre el texto.
 *   match        → la pieza cierra con la firma declarada
 *   mismatch     → el genoma declara una firma y la pieza no cierra con ella
 *   not_declared → el genoma dice `signature_closer: null`: esta voz NO firma (decisión)
 *   no_voice     → la pieza no declara voz, y la firma se resuelve por voz
 *   no_data      → no hay genoma activo para esa voz, o la clave nunca se sembró
 */
export type SignatureStatus = 'match' | 'mismatch' | 'not_declared' | 'no_voice' | 'no_data';

export interface SignatureCheck {
  /** La del genoma. null cuando no hay ninguna declarada. */
  expected: string | null;
  /** Con qué cierra la pieza de verdad. null si no cierra con nada. */
  stamped: string | null;
  status: SignatureStatus;
  reason: string | null;
}

export interface PieceMetrics {
  chars: CountAgainstLimit;
  hashtags: CountAgainstLimit;
  signature: SignatureCheck;
  /** El canal contra el que se midió (`content_pieces.platform`). null si no declara. */
  platform: string | null;
  text_source: TextSource;
}

// ── Catálogos (dato, leído en runtime) ───────────────────────────────────────────

/** Topes de un canal. Cada columna puede venir sin sembrar, y eso se dice. */
export interface PlatformLimits {
  char_limit: number | null;
  char_target: number | null;
  hashtag_limit: number | null;
}

/**
 * Topes por canal. `null` = la tabla no se pudo consultar (no es lo mismo que un canal
 * sin fila): la cabecera degrada a «sin dato» declarando cuál de las dos ausencias es.
 */
export type PlatformCatalog = Map<string, PlatformLimits> | null;

/**
 * Firmas declaradas por voz.
 *   entrada ausente → no hay genoma activo para esa (marca, voz)
 *   `null`          → el genoma existe pero nunca sembró `signature_closer`
 *   `[]`            → el genoma declara `signature_closer: null`: esta voz no firma
 *   `[...]`         → variantes declaradas (una pieza que cierre con cualquiera cumple)
 * El mapa entero en `null` = la tabla no se pudo consultar.
 */
export type SignatureCatalog = Map<string, string[] | null> | null;

/** Clave del mapa de firmas. Separador NUL: no aparece dentro de un identificador. */
export function voiceKey(brandId: string, voiceId: string): string {
  return `${brandId}\u0000${voiceId}`;
}

function publicHeaders(): Record<string, string> {
  return { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Accept-Profile': 'public' };
}

export const PLATFORMS_CAP = 500;
export const GENOMES_CAP = 1000;

/** Fila cruda de `public.platform_configs`. Sólo lo que la cabecera necesita. */
interface PlatformConfigRow {
  id?: string | null;
  char_limit?: number | null;
  char_target?: number | null;
  hashtag_limit?: number | null;
}

/** Puro y exportado: el índice no se reimplementa en la prueba ni en un segundo endpoint. */
export function indexPlatformLimits(rows: PlatformConfigRow[]): Map<string, PlatformLimits> {
  const map = new Map<string, PlatformLimits>();
  for (const r of Array.isArray(rows) ? rows : []) {
    const id = typeof r?.id === 'string' ? r.id.trim() : '';
    if (!id) continue;
    map.set(id, {
      char_limit: intOrNull(r.char_limit),
      char_target: intOrNull(r.char_target),
      hashtag_limit: intOrNull(r.hashtag_limit),
    });
  }
  return map;
}

function intOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Topes por canal. Se leen los ACTIVOS y los inactivos: un canal apagado sigue teniendo
 * tope, y la cabecera no es quien decide si el canal publica (eso es `_publishShared`).
 */
export async function fetchPlatformLimits(): Promise<PlatformCatalog> {
  const url = `${SB_URL()}/rest/v1/platform_configs`
    + `?select=id,char_limit,char_target,hashtag_limit&limit=${PLATFORMS_CAP}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: publicHeaders() });
  } catch {
    return null;
  }
  if (!res.ok) {
    console.warn(`[piece-metrics] platform_configs no disponible (${res.status}) — topes = sin dato`);
    return null;
  }
  const rows = (await res.json().catch(() => [])) as PlatformConfigRow[];
  return indexPlatformLimits(Array.isArray(rows) ? rows : []);
}

/** Fila cruda de `public.brand_voice_genome` (sólo la rama que declara la firma). */
interface GenomeRow {
  brand_id?: string | null;
  voice_id?: string | null;
  application_constraints?: Record<string, unknown> | null;
}

/** Las variantes declaradas de una firma. `{text, text_en}`; se deduplica y se limpia. */
function closerVariants(node: unknown): string[] {
  if (typeof node === 'string') {
    const s = node.trim();
    return s ? [s] : [];
  }
  if (!node || typeof node !== 'object') return [];
  const out: string[] = [];
  for (const key of ['text', 'text_en']) {
    const v = (node as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.trim() && !out.includes(v.trim())) out.push(v.trim());
  }
  return out;
}

/**
 * Puro y exportado por el mismo motivo que `indexPlatformLimits`. Distingue las tres
 * ausencias, porque el ecosistema las distingue: una voz que no firma se escribe con
 * `null` EXPLÍCITO, y la clave ausente es indistinguible de un olvido si se colapsan.
 */
export function indexSignatureClosers(rows: GenomeRow[]): Map<string, string[] | null> {
  const map = new Map<string, string[] | null>();
  for (const r of Array.isArray(rows) ? rows : []) {
    const brand = typeof r?.brand_id === 'string' ? r.brand_id.trim() : '';
    const voice = typeof r?.voice_id === 'string' ? r.voice_id.trim() : '';
    if (!brand || !voice) continue;
    const ac = (r.application_constraints && typeof r.application_constraints === 'object')
      ? r.application_constraints
      : null;
    if (!ac || !Object.prototype.hasOwnProperty.call(ac, 'signature_closer')) {
      map.set(voiceKey(brand, voice), null); // nunca sembrada
      continue;
    }
    map.set(voiceKey(brand, voice), closerVariants(ac.signature_closer)); // [] = no firma
  }
  return map;
}

/** Firmas declaradas, sólo de genomas ACTIVOS (un genoma retirado no gobierna piezas). */
export async function fetchSignatureClosers(): Promise<SignatureCatalog> {
  const url = `${SB_URL()}/rest/v1/brand_voice_genome`
    + `?active=is.true&select=brand_id,voice_id,application_constraints&limit=${GENOMES_CAP}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: publicHeaders() });
  } catch {
    return null;
  }
  if (!res.ok) {
    console.warn(`[piece-metrics] brand_voice_genome no disponible (${res.status}) — firma esperada = sin dato`);
    return null;
  }
  const rows = (await res.json().catch(() => [])) as GenomeRow[];
  return indexSignatureClosers(Array.isArray(rows) ? rows : []);
}

// ── Conteos ──────────────────────────────────────────────────────────────────────

/**
 * Un hashtag es `#` seguido de letras, dígitos o guion bajo, y NO precedido por uno de
 * ellos. Así `C#` no cuenta y `#Ñandú` sí (la clase es Unicode: el sistema opera en más
 * de un idioma y un conteo que sólo entienda ASCII miente en la mitad de las piezas).
 */
const HASHTAG = /(?<![\p{L}\p{N}_])#[\p{L}\p{N}_]+/gu;

export function countHashtags(text: string): number {
  let n = 0;
  for (const _m of text.matchAll(HASHTAG)) n += 1;
  return n;
}

/**
 * El texto que sale por el canal de la pieza. Prefiere la adaptación de ESE canal;
 * cae al maestro cuando no hay, y siempre declara cuál contó.
 */
export function channelTextOf(piece: ContentPiece): { text: string; source: TextSource } {
  const platform = (piece.platform ?? '').trim();
  const adapted = piece.assets?.social?.adapted;
  if (platform && Array.isArray(adapted)) {
    for (const a of adapted) {
      const p = typeof a?.platform === 'string' ? a.platform.trim() : '';
      const copy = typeof a?.copy === 'string' ? a.copy.trim() : '';
      if (p === platform && copy) return { text: copy, source: 'channel_adapted' };
    }
  }
  const master = bodyTextOf(piece).trim();
  return master ? { text: master, source: 'master_copy' } : { text: '', source: 'empty' };
}

// ── Evaluación contra los topes ──────────────────────────────────────────────────

function noData(count: number, reason: string): CountAgainstLimit {
  return { count, target: null, limit: null, status: 'no_data', reason };
}

/**
 * Un conteo contra su par (objetivo, tope). Las DOS columnas hacen falta para verde:
 * con el objetivo sin sembrar no se puede afirmar «dentro del objetivo», y afirmarlo
 * igual es exactamente lo que la regla del color prohíbe.
 */
export function against(
  count: number,
  target: number | null,
  limit: number | null,
  missing: { limit: string; target: string },
): CountAgainstLimit {
  if (limit === null) return noData(count, missing.limit);
  if (count > limit) {
    return { count, target, limit, status: 'over_limit', reason: null };
  }
  if (target === null) return { count, target: null, limit, status: 'no_data', reason: missing.target };
  if (count > target) return { count, target, limit, status: 'over_target', reason: null };
  return { count, target, limit, status: 'ok', reason: null };
}

/** El cierre real de la pieza: la última línea con contenido. null si no hay ninguna. */
export function lastLineOf(text: string): string | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : null;
}

/**
 * Compara la firma declarada por el genoma con la que la pieza estampa. No infiere:
 * si el genoma no declara nada, lo dice; no adivina una firma a partir del texto.
 */
export function signatureOf(
  piece: ContentPiece,
  text: string,
  closers: SignatureCatalog,
): SignatureCheck {
  const stamped = lastLineOf(text);
  const voice = (piece.voice ?? '').trim();

  if (closers === null) {
    return {
      expected: null, stamped, status: 'no_data',
      reason: 'No se pudo leer `brand_voice_genome`: la firma esperada no está disponible.',
    };
  }
  if (!voice) {
    return {
      expected: null, stamped, status: 'no_voice',
      reason: 'La pieza no declara voz, y `signature_closer` se resuelve por `brand_id`/`voice_id`.',
    };
  }

  const declared = closers.get(voiceKey(piece.brand_id, voice));
  if (declared === undefined) {
    return {
      expected: null, stamped, status: 'no_data',
      reason: `Sin genoma activo para \`${piece.brand_id}\`/\`${voice}\`: no hay firma esperada contra la cual comparar.`,
    };
  }
  if (declared === null) {
    return {
      expected: null, stamped, status: 'no_data',
      reason: `El genoma de \`${voice}\` no siembra \`signature_closer\`. Una voz que no firma se declara con \`null\` explícito.`,
    };
  }
  if (declared.length === 0) {
    return {
      expected: null, stamped, status: 'not_declared',
      reason: `El genoma de \`${voice}\` declara \`signature_closer: null\`: esta voz no firma.`,
    };
  }

  const trimmed = text.trimEnd();
  const hit = declared.find((v) => trimmed.endsWith(v));
  if (hit) return { expected: hit, stamped: hit, status: 'match', reason: null };
  return {
    expected: declared[0], stamped, status: 'mismatch',
    reason: 'La pieza no cierra con la firma que el genoma declara para su voz.',
  };
}

/**
 * Todo lo que la cabecera muestra, resuelto contra el dato. Los dos catálogos entran
 * como parámetro (nunca se leen acá dentro): así la evaluación se prueba sin red y el
 * endpoint los lee UNA vez por request, no una por pieza.
 */
export function metricsOf(
  piece: ContentPiece,
  limits: PlatformCatalog,
  closers: SignatureCatalog,
): PieceMetrics {
  const platform = (piece.platform ?? '').trim() || null;
  const { text, source } = channelTextOf(piece);
  const chars = text.length;
  const tags = countHashtags(text);

  const row = platform && limits ? limits.get(platform) : undefined;

  let charCount: CountAgainstLimit;
  let tagCount: CountAgainstLimit;
  if (!platform) {
    const why = 'La pieza no declara canal: los topes viven en `public.platform_configs` por canal.';
    charCount = noData(chars, why);
    tagCount = noData(tags, why);
  } else if (limits === null) {
    const why = 'No se pudo leer `public.platform_configs`: los topes no están disponibles.';
    charCount = noData(chars, why);
    tagCount = noData(tags, why);
  } else if (!row) {
    const why = `Sin fila en \`public.platform_configs\` para \`${platform}\`: el canal no declara topes.`;
    charCount = noData(chars, why);
    tagCount = noData(tags, why);
  } else {
    charCount = against(chars, row.char_target, row.char_limit, {
      limit: `\`platform_configs.char_limit\` sin sembrar para \`${platform}\`.`,
      target: `\`platform_configs.char_target\` sin sembrar para \`${platform}\`.`,
    });
    // Los hashtags tienen tope duro y no objetivo: se pasa el mismo valor a los dos, así
    // «dentro del tope» es verde sin inventar un objetivo que la tabla no declara.
    tagCount = against(tags, row.hashtag_limit, row.hashtag_limit, {
      limit: `\`platform_configs.hashtag_limit\` sin sembrar para \`${platform}\`.`,
      target: `\`platform_configs.hashtag_limit\` sin sembrar para \`${platform}\`.`,
    });
  }

  return {
    chars: charCount,
    hashtags: tagCount,
    signature: signatureOf(piece, text, closers),
    platform,
    text_source: source,
  };
}
