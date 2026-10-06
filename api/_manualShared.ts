/**
 * UNRLVL Orchestrator — api/_manualShared.ts  (PUBLICACIÓN MANUAL · bloque PURO)
 *
 * Lo que la pestaña «Manual» de Publicación necesita para que Sam publique a mano una pieza
 * cuyo canal no lo publica el drenaje: el TEXTO COMPLETO tal como saldría y las FOTOS en orden.
 * Sin DB, sin red, sin reloj — se prueba en `_manualShared.test.ts`.
 *
 * QUÉ CANAL ES MANUAL LO DICE EL DATO. `intel.brand_publish_channels.publication_path = 'manual'`.
 * Acá no hay ninguna plataforma, proveedor ni marca nombrados: un canal que mañana pase a manual
 * aparece en la pestaña sin tocar este archivo, y uno que pase a drenaje desaparece igual.
 *
 * EL TEXTO ES EL QUE PUBLICARÍA EL DRENAJE, no otro. Se arma con la MISMA regla que
 * `content-scheduler/buildPlacementRows` (repo `unrlvl-iid-functions`):
 *   1. el adaptado de `assets.social.adapted` para el canal de la franja, si existe;
 *   2. si no, el texto juzgado (`copy.aife_filtered`, o `copy.raw`) — la rama degradada;
 *   3. y en los dos casos, la firma de la voz UNA vez y al final (`canonicalizeSignature`).
 * Delante va el TÍTULO, en el mismo bloque (Sam, 2026-10-01: «no me separes title de body ni de
 * hashtags ni de las firmas»): en los canales manuales el título no va pintado en ningún sitio,
 * así que si no viaja en el texto se pierde. Si el texto ya abre con el título, no se repite.
 */

// ── SIGNCANON ── COPIA del bloque SIGNCANON de `unrlvl-iid-functions`
// (`content-run-stage` y `content-scheduler`, SIGN-02, 2026-09-15). Se copia porque el Orchestrator
// no comparte módulos con las Edge Functions. Si la regla cambia allá, cambia acá: dos firmas
// canónicas distintas harían que la pestaña muestre un texto y el drenaje publique otro.

/** Escapa un literal para incrustarlo en una expresión regular. */
function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** Quita TODAS las apariciones exactas de la firma, con el espacio que las precede. */
function stripSignatureOccurrences(text: unknown, sig: unknown): string {
  const cuerpo = String(text ?? '');
  const firma = String(sig ?? '').trim();
  if (!firma) return cuerpo;
  return cuerpo.replace(new RegExp(`\\s*${escapeForRegExp(firma)}`, 'gu'), '');
}

/** La firma de la voz, exactamente una vez, al final. Sin firma declarada, el texto no se toca. */
export function canonicalizeSignature(text: unknown, sig: unknown): string {
  const original = String(text ?? '');
  const firma = String(sig ?? '').trim();
  if (!firma) return original;
  const cuerpo = stripSignatureOccurrences(original, firma).replace(/\s+$/u, '');
  return cuerpo ? `${cuerpo}\n\n${firma}` : firma;
}
// ── SIGNCANON:END ──

export interface ManualPieceInput {
  id: string;
  brand_id: string;
  platform?: string | null;
  format?: string | null;
  assets?: {
    copy?: { title?: string | null; aife_filtered?: string | null; raw?: string | null } | null;
    social?: { adapted?: unknown } | null;
    image?: { url?: string | null } | null;
    carousel?: { slides?: Array<{ n?: number | null; url?: string | null }> | null } | null;
    builder_meta?: { signature_closer?: { text?: string | null } | null } | null;
  } | null;
}

/**
 * Las adaptaciones por canal, vengan como vengan. Mismo criterio que `leerAdaptadas` del drenaje:
 * hay piezas que guardan el arreglo serializado como cadena.
 */
export function adaptedRows(assets: ManualPieceInput['assets']): Array<{ platform: string; copy: string }> {
  const bruto = assets?.social?.adapted;
  let rows: unknown = bruto;
  if (typeof bruto === 'string' && bruto.trim()) {
    try { rows = JSON.parse(bruto); } catch { rows = null; }
  }
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((a): a is { platform: string; copy: string } =>
      !!a && typeof a.platform === 'string' && typeof a.copy === 'string' && a.copy.length > 0);
}

/**
 * El texto completo para pegar en la plataforma: título + cuerpo + hashtags + firma, en un bloque.
 * `platformKey` es el canal de la FRANJA, que es el que manda (una franja es un canal, y sólo ése).
 */
export function manualTextOf(piece: ManualPieceInput, platformKey: string): string {
  return manualPasteOf(piece, platformKey).text;
}

/**
 * De dónde salió el cuerpo del bloque de la pestaña:
 *   channel_adapted — el adaptado del canal de la franja;
 *   master_copy     — no hay adaptado para ese canal: el texto juzgado (rama degradada);
 *   empty           — no hay cuerpo (el bloque es, como mucho, el título).
 */
export type ManualPasteSource = 'channel_adapted' | 'master_copy' | 'empty';

/**
 * EL BLOQUE QUE LA PESTAÑA «MANUAL» ENTREGA PARA PEGAR, y de dónde salió su cuerpo. Es la única
 * regla: `manualTextOf` la devuelve tal cual y la vista previa de un canal que se publica a mano la
 * pinta tal cual (`_calibrationShared.ts`, `publishedTextOf`). Si cambia aquí, cambian las dos.
 */
export function manualPasteOf(piece: ManualPieceInput, platformKey: string): { text: string; source: ManualPasteSource } {
  const assets = piece.assets ?? {};
  const sig = assets.builder_meta?.signature_closer?.text ?? null;
  const k = String(platformKey ?? '').toLowerCase();

  const propia = adaptedRows(assets).find((a) => a.platform.toLowerCase() === k);
  const base = propia ? propia.copy : (assets.copy?.aife_filtered ?? assets.copy?.raw ?? '');
  const cuerpo = base ? canonicalizeSignature(base, sig).trim() : '';
  const source: ManualPasteSource = !cuerpo ? 'empty' : propia ? 'channel_adapted' : 'master_copy';

  const titulo = String(assets.copy?.title ?? '').trim();
  if (!titulo) return { text: cuerpo, source };
  if (!cuerpo) return { text: titulo, source };
  if (cuerpo.startsWith(titulo)) return { text: cuerpo, source };
  return { text: `${titulo}\n\n${cuerpo}`, source };
}

/**
 * Las fotos en el orden en que se publican. Un carrusel declarado con 2 o más láminas sale lámina
 * por lámina (mismo criterio que `carouselMediaOf` del drenaje); si no, la imagen de la pieza.
 */
export function manualImagesOf(piece: ManualPieceInput): string[] {
  const assets = piece.assets ?? {};
  const esUrl = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//.test(u);
  if (String(piece.format ?? '') === 'carousel') {
    const slides = Array.isArray(assets.carousel?.slides) ? assets.carousel!.slides! : [];
    const urls = slides.slice()
      .sort((a, b) => Number(a?.n ?? 0) - Number(b?.n ?? 0))
      .map((s) => s?.url)
      .filter(esUrl);
    if (urls.length >= 2) return urls.slice(0, 10);
  }
  const portada = assets.image?.url;
  return esUrl(portada) ? [portada] : [];
}

// ── La lista ─────────────────────────────────────────────────────────────────────
export interface ManualSlotRow {
  id: string;
  brand_id: string;
  platform_key: string;
  slot_at: string;
  status: string;
  piece_id: string | null;
}

export interface ManualItem {
  slot_id: string;
  piece_id: string;
  brand_id: string;
  platform_key: string;
  slot_at: string;
  /** Huso IANA de la marca; `null` si no está sembrado (la pantalla lo dice, no inventa uno). */
  timezone: string | null;
  /** `true` cuando la hora ya pasó: le toca a Sam ahora. */
  due: boolean;
  format: string | null;
  text: string;
  images: string[];
}

/**
 * Cruza franjas, canales manuales y piezas. Una franja sin pieza, o de un canal que no es manual,
 * no entra. Orden: la más antigua primero — lo atrasado es lo primero que hay que publicar.
 */
export function buildManualItems(
  slots: ManualSlotRow[],
  manualChannels: Set<string>,
  pieces: Map<string, ManualPieceInput>,
  timezones: Record<string, string> | null,
  now: Date,
): ManualItem[] {
  const out: ManualItem[] = [];
  for (const s of Array.isArray(slots) ? slots : []) {
    if (!s?.piece_id) continue;
    if (!manualChannels.has(manualChannelKey(s.brand_id, s.platform_key))) continue;
    const piece = pieces.get(s.piece_id);
    if (!piece) continue;
    const t = Date.parse(s.slot_at);
    out.push({
      slot_id: s.id,
      piece_id: s.piece_id,
      brand_id: s.brand_id,
      platform_key: s.platform_key,
      slot_at: s.slot_at,
      timezone: timezones?.[s.brand_id] ?? null,
      due: Number.isFinite(t) && t <= now.getTime(),
      format: piece.format ?? null,
      text: manualTextOf(piece, s.platform_key),
      images: manualImagesOf(piece),
    });
  }
  return out.sort((a, b) => Date.parse(a.slot_at) - Date.parse(b.slot_at));
}

/** Clave de canal. Separador NUL: no puede aparecer dentro de un identificador. */
export function manualChannelKey(brandId: string, platformKey: string): string {
  return `${brandId}\u0000${platformKey}`;
}

// ── «Publicada» ──────────────────────────────────────────────────────────────────
/**
 * La prueba de que salió: el link del post. La base no acepta una publicación sin ella
 * (`brand_publish_drain_log_prueba_del_efecto` exige `platform_post_id` no vacío cuando el
 * desenlace es `PUBLISHED`), y la pantalla tampoco: marcar sin link sería afirmar sin medir.
 * Devuelve el link limpio, o `null` si no es un enlace http(s).
 */
export function cleanPostLink(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s || s.length > 500 || /\s/.test(s)) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? s : null;
  } catch {
    return null;
  }
}

/** Estados de franja que se pueden marcar publicadas a mano: tienen pieza y no salieron. */
export const MARKABLE_SLOT_STATUSES = ['manual_pending', 'reserved'] as const;

/**
 * La fila de bitácora de una publicación a mano. Mismo desenlace que el drenaje (`PUBLISHED`)
 * para que el resto del carril —acuses, cobertura, conteos— la lea igual; el `detail` dice que
 * fue a mano.
 */
export function manualDrainRow(
  slot: { id: string; brand_id: string; platform_key: string; slot_at: string; piece_id: string },
  link: string, runId: string, at: string,
) {
  return {
    run_id: runId,
    brand_id: slot.brand_id,
    platform_key: slot.platform_key,
    slot_id: slot.id,
    piece_id: slot.piece_id,
    slot_at: slot.slot_at,
    outcome: 'PUBLISHED',
    detail: 'MANUAL_PUBLISHED: publicada a mano y marcada desde el Orchestrator',
    platform_post_id: link,
    published_at: at,
  };
}
