/**
 * UNRLVL Orchestrator — api/_manualShared.ts  (PUBLICACIÓN MANUAL · bloque PURO)
 *
 * Lo que la pestaña «Manual» de Publicación necesita para que Sam publique a mano una pieza
 * cuyo canal no lo publica el drenaje: el TEXTO COMPLETO tal como saldría y las FOTOS en orden.
 * Sin DB, sin red, sin reloj — se prueba en `_manualShared.test.ts`.
 *
 * QUÉ CANAL ES MANUAL LO DICE EL DATO. `intel.brand_publish_channels.publication_path = 'manual'`.
 * Aquí no hay ninguna plataforma, proveedor ni marca nombrados: un canal que mañana pase a manual
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
// no comparte módulos con las Edge Functions. Si la regla cambia allá, cambia aquí: dos firmas
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
    /** Sólo en piezas derivadas de otra (p. ej. un artículo hecho a partir de un post del blog). */
    source_piece?: { piece_id?: string | null; post_url?: string | null; title?: string | null } | null;
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
  const { cuerpo, source } = manualBodyOf(piece, platformKey);
  const titulo = String(assets.copy?.title ?? '').trim();
  if (!titulo) return { text: cuerpo, source };
  if (!cuerpo) return { text: titulo, source };
  if (cuerpo.startsWith(titulo)) return { text: cuerpo, source };
  return { text: `${titulo}\n\n${cuerpo}`, source };
}

/**
 * EL CUERPO, sin título: la base que corresponde al canal de la franja (adaptado, o texto juzgado)
 * con la firma canónica una vez al final. Es la mitad de `manualPasteOf`, separada para que el
 * artículo (`manualArticleOf`) entregue el cuerpo sin el título delante y con LA MISMA regla de base
 * y de firma: no hay una segunda forma de elegir el texto ni de firmarlo.
 */
function manualBodyOf(piece: ManualPieceInput, platformKey: string): { base: string; sig: string | null; cuerpo: string; source: ManualPasteSource } {
  const assets = piece.assets ?? {};
  const sig = assets.builder_meta?.signature_closer?.text ?? null;
  const k = String(platformKey ?? '').toLowerCase();

  const propia = adaptedRows(assets).find((a) => a.platform.toLowerCase() === k);
  const base = propia ? propia.copy : (assets.copy?.aife_filtered ?? assets.copy?.raw ?? '');
  const cuerpo = base ? canonicalizeSignature(base, sig).trim() : '';
  const source: ManualPasteSource = !cuerpo ? 'empty' : propia ? 'channel_adapted' : 'master_copy';
  return { base, sig, cuerpo, source };
}

/**
 * El valor de `content_pieces.format` que declara un carrusel. Es el eje FORMATO del sistema —el mismo
 * que ya leía `manualImagesOf`—, no una plataforma ni una marca: un carrusel de cualquier marca, en
 * cualquier plataforma, lo declara igual. Se nombra aquí una vez para que el filtro «Carrusel» de las
 * bandejas y este criterio no puedan divergir.
 */
export const CAROUSEL_FORMAT = 'carousel';

/**
 * Las fotos en el orden en que se publican. Un carrusel declarado con 2 o más láminas sale lámina
 * por lámina (mismo criterio que `carouselMediaOf` del drenaje); si no, la imagen de la pieza.
 */
export function manualImagesOf(piece: ManualPieceInput): string[] {
  const assets = piece.assets ?? {};
  const esUrl = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//.test(u);
  if (String(piece.format ?? '') === CAROUSEL_FORMAT) {
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

/**
 * ¿ES UN CARRUSEL? El MISMO criterio con el que la vista decide pintar la tira de láminas
 * (`_calibrationShared.ts → mediaBlockOf`: `laminas.length >= 2`) y con el que el drenaje y la
 * pestaña Manual publican lámina por lámina: formato carrusel y al menos dos láminas con imagen.
 * No se inventa otro: un «carrusel» con una sola lámina se publica y se ve como una foto, y el
 * filtro tiene que decir lo mismo que la tarjeta.
 *
 * Lo usa el filtro «Carrusel» de las bandejas (2026-10-06, Sam: «en el filtro por plataformas quiero
 * ver carrousels»).
 */
export function isCarouselPiece(piece: ManualPieceInput): boolean {
  return manualImagesOf(piece).length >= 2;
}

// ── ARTÍCULO (Sam, 2026-10-22) ───────────────────────────────────────────────────
/**
 * El valor de `content_pieces.format` que declara un artículo. Mismo eje que `CAROUSEL_FORMAT`:
 * un formato, no una plataforma ni una marca. Un artículo de cualquier marca, en cualquier canal
 * manual, llega a la pestaña igual.
 */
export const ARTICLE_FORMAT = 'article';

/**
 * Lo que la pestaña entrega de un artículo, en piezas sueltas: el editor de artículos de la
 * plataforma pide el título en un campo, la portada en otro y el cuerpo en un tercero, así que aquí
 * —al revés que en un post— el título NO va pegado al cuerpo.
 *
 *   title          — texto plano.
 *   cover_url      — la portada 16:9 compuesta; `null` si la pieza no tiene una URL http(s).
 *   body_markdown  — el cuerpo (`markdown_min`) sin título, con la firma canónica una vez al final.
 *   body_html      — el mismo cuerpo en HTML mínimo y SEGURO (ver `articleBodyHtml`): es lo que el
 *                    editor conserva como subtítulos al pegar.
 *   body_text      — el mismo cuerpo en texto plano, para portapapeles sin HTML.
 *   source_url     — el post original del blog; `null` si no hay un enlace http(s) válido.
 */
export interface ManualArticle {
  title: string;
  cover_url: string | null;
  body_markdown: string;
  body_html: string;
  body_text: string;
  source_url: string | null;
}

const SUBTITULO = /^##\s+(.*)$/u;
// Un enlace termina en el primer espacio o comilla; la puntuación de cierre de frase no es parte de él.
const URL_SUELTA = /https?:\/\/[^\s<>"'`]+/gu;
const PUNTUACION_FINAL = /[.,;:!?)\]]+$/u;

/** Escapa TODO lo que el HTML interpreta. Va antes de cualquier otra transformación. */
function escapeHtml(s: string): string {
  return s.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;').replace(/'/gu, '&#39;');
}

/** Negrita: lo único que se interpreta dentro de un texto YA escapado. */
function negrita(escapado: string): string {
  return escapado.replace(/\*\*(.+?)\*\*/gu, '<strong>$1</strong>');
}

/**
 * Una línea en HTML. Con `enlazar`, cada URL suelta que pase `cleanPostLink` —http(s) y nada más:
 * ni `javascript:` ni `data:`— se vuelve `<a href>`; el resto se escapa y sólo entonces se le
 * interpreta la negrita.
 */
function lineaHtml(linea: string, enlazar: boolean): string {
  if (!enlazar) return negrita(escapeHtml(linea));
  let out = '';
  let desde = 0;
  for (const m of linea.matchAll(URL_SUELTA)) {
    const inicio = m.index ?? 0;
    const bruta = m[0];
    const url = bruta.replace(PUNTUACION_FINAL, '');
    const limpia = cleanPostLink(url);
    if (!limpia) continue;
    out += negrita(escapeHtml(linea.slice(desde, inicio)));
    out += `<a href="${escapeHtml(limpia)}">${escapeHtml(limpia)}</a>`;
    desde = inicio + url.length;
  }
  return out + negrita(escapeHtml(linea.slice(desde)));
}

/** Párrafos del `markdown_min`: bloques separados por una línea en blanco. */
function parrafosDe(md: string): string[] {
  return md.split(/\n[ \t]*\n/u).map((p) => p.trim()).filter(Boolean);
}

/**
 * `markdown_min` → HTML mínimo y seguro. Primero se escapa todo; después, y sólo sobre lo escapado:
 * `## x` → `<h2>`, `**x**` → `<strong>`, párrafo → `<p>` (saltos simples → `<br>`) y, en el párrafo
 * indicado por `parrafoEnlace` (el del post original), las URL sueltas → `<a href>`. Nada más.
 */
export function articleBodyHtml(md: string, parrafoEnlace: number | null = null): string {
  return parrafosDe(md).map((p, i) => {
    const enlazar = i === parrafoEnlace;
    const bloques: string[] = [];
    let lineas: string[] = [];
    const cerrar = () => {
      if (lineas.length) bloques.push(`<p>${lineas.map((l) => lineaHtml(l, enlazar)).join('<br>')}</p>`);
      lineas = [];
    };
    for (const linea of p.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const h = SUBTITULO.exec(linea);
      if (h) { cerrar(); bloques.push(`<h2>${lineaHtml(h[1].trim(), false)}</h2>`); }
      else lineas.push(linea);
    }
    cerrar();
    return bloques.join('');
  }).join('');
}

/** `markdown_min` → texto plano: sin `## ` al inicio de línea ni marcas de negrita. */
export function articleBodyText(md: string): string {
  return md.split('\n')
    .map((l) => l.replace(/^(\s*)##\s+/u, '$1').replace(/\*\*(.+?)\*\*/gu, '$1'))
    .join('\n');
}

/**
 * El artículo listo para el editor. El cuerpo sale de la MISMA base y con la MISMA firma que el
 * bloque de un post (`manualBodyOf`); lo único que cambia es que no lleva el título delante.
 *
 * El párrafo del post original es el ÚLTIMO del cuerpo SIN firma —lo estampa el sistema—: la firma
 * canónica va detrás, así que en el cuerpo firmado ese párrafo es el penúltimo, y es ése el que se
 * enlaza, no la firma.
 */
export function manualArticleOf(piece: ManualPieceInput, platformKey: string): ManualArticle {
  const assets = piece.assets ?? {};
  const { base, sig, cuerpo } = manualBodyOf(piece, platformKey);
  const sinFirma = base ? stripSignatureOccurrences(base, sig).trim() : '';
  const parrafosSinFirma = parrafosDe(sinFirma);
  const parrafoEnlace = parrafosSinFirma.length ? parrafosSinFirma.length - 1 : null;

  const ultimo = parrafoEnlace === null ? '' : parrafosSinFirma[parrafoEnlace];
  const enlaceDelCuerpo = cleanPostLink(ultimo.replace(PUNTUACION_FINAL, ''));
  const portada = assets.image?.url;

  return {
    title: String(assets.copy?.title ?? '').trim(),
    cover_url: cleanPostLink(portada),
    body_markdown: cuerpo,
    body_html: articleBodyHtml(cuerpo, parrafoEnlace),
    body_text: articleBodyText(cuerpo),
    source_url: cleanPostLink(assets.source_piece?.post_url) ?? enlaceDelCuerpo,
  };
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
  /** Sólo cuando `format === ARTICLE_FORMAT`: título, portada y cuerpo por separado. */
  article?: ManualArticle;
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
      ...(String(piece.format ?? '') === ARTICLE_FORMAT ? { article: manualArticleOf(piece, s.platform_key) } : {}),
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
