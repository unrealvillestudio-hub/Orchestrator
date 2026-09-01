/**
 * UNRLVL Orchestrator — api/evaluated-history.ts  (BRIEF-02 · historial de evaluadas)
 *
 * HISTORIAL DE PIEZAS YA EVALUADAS. Sólo lectura, sin excepción: sin POST, sin PATCH, sin
 * DELETE. Este endpoint no aprueba, no rechaza, no descarta y no edita.
 *
 * EL DEFECTO QUE CIERRA. Una pieza calibrada desaparece de la bandeja y no hay forma de
 * volver a verla — ni de nombrarla. Sin `piece_id` a mano no se puede señalar una pieza
 * concreta para trabajarla después, que es la operación que hoy no existe.
 *
 * ── DOS TABLAS, UNA LISTA ────────────────────────────────────────────────────────
 * El corpus vive en dos sitios y la diferencia importa:
 *   · `intel.approval_calibration`          — corpus VIVO
 *   · `intel.approval_calibration_archive`  — lo archivado, con `archived_at`/`archived_reason`
 *
 * Se leen POR SEPARADO y se unen en JS, con un campo `source` en cada fila. No se crea vista
 * ni RPC: el resto de la carpeta evita `SECURITY DEFINER` a propósito (ver la cabecera de
 * `_calibrationShared.ts`) y este endpoint no es la excepción.
 *
 * `source` ES EL EJE DE GENERACIÓN DE ESTE TAB, y por eso el filtro no es opcional. Lo
 * archivado es, por construcción, de una generación anterior a su corte; mezclar las dos sin
 * poder separarlas reintroduce exactamente la confusión que el archivado vino a resolver. No
 * se recalcula la generación contra `intel.pipeline_cutoffs` como hacen las otras bandejas
 * porque el corpus guarda la fecha del VEREDICTO, no la de la pieza: sería otra magnitud con
 * el mismo nombre. Queda declarado por si Sam prefiere el otro eje.
 *
 * ── UN VEREDICTO DESCONOCIDO SE MUESTRA, NO SE DESCARTA ──────────────────────────
 * El filtro de veredicto acepta CUALQUIER valor y lo compara exacto; `all` no filtra. No hay
 * lista cerrada de veredictos en este archivo: el eje se amplió una vez (`fixable`) y volverá
 * a ampliarse. Enumerarlos aquí obligaría a editar este archivo cada vez, y —peor— una fila
 * con un veredicto que el código no conociera desaparecería del historial sin decir nada.
 * `by_verdict` se descubre del dato, igual que `by_brand` y `by_channel`.
 *
 * GET /api/evaluated-history?from=&to=&brand=&channel=&verdict=&source=&limit=&offset=
 *   Auth: admin JWT vía `Authorization: Bearer <session_token>` — nunca por query string.
 *
 * Devuelve: { total, by_brand, by_channel, by_verdict, limit, offset, rows[], truncated? }
 * Orden: fecha de evaluación, más reciente primero.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, extractToken, requireAdmin, SB_URL, SB_KEY } from './_calibrationShared.js';
// El lector en voz alta necesita saber en qué idioma leer. Mismo catálogo y misma resolución
// que las otras tres bandejas: una marca nueva entra sembrando su fila, no editando código.
import { fetchBrandLanguages, readingLanguageOf } from './_brandLanguage.js';

/** Tope de lectura por tabla. El corpus crece por veredicto humano: decenas al mes. */
export const HISTORY_CAP = 5000;

/** De qué tabla salió la fila. Eje ESTRUCTURAL del endpoint, no dato de marca. */
export const HISTORY_SOURCES = ['all', 'live', 'archived'] as const;
export type HistorySourceFilter = (typeof HISTORY_SOURCES)[number];
export type HistorySource = 'live' | 'archived';

/** Las columnas que el corpus guarda. Las dos tablas comparten esta forma. */
const CORPUS_SELECT = [
  'piece_id', 'brand_id', 'voice', 'domain', 'platform', 'format',
  'psycho_preset', 'audience_frame', 'verdict', 'criterion', 'fix_proposal',
  'evaluated_by', 'created_at', 'artifact_url',
  'watcher_result', 'watcher_gate', 'watcher_rules', 'watcher_rules_evaluated',
].join(',');

/** El archivo añade dos columnas y nada más. */
const ARCHIVE_SELECT = `${CORPUS_SELECT},archived_at,archived_reason`;

export interface EvaluatedRow {
  piece_id: string;
  brand_id: string;
  voice: string | null;
  domain: string | null;
  platform: string | null;
  format: string | null;
  psycho_preset: string | null;
  audience_frame: string | null;
  /** Sin lista cerrada: lo que la fila diga, se muestra. */
  verdict: string;
  criterion: string | null;
  /** La propuesta de corrección, cuando el veredicto la trae. */
  fix_proposal: string | null;
  evaluated_by: string | null;
  created_at: string | null;
  artifact_url: string | null;
  watcher_result: string | null;
  watcher_gate: string | null;
  watcher_rules: string[] | null;
  watcher_rules_evaluated: number | null;
  /** De qué tabla salió. El eje de generación de este tab. */
  source: HistorySource;
  /** Idioma en que se lee la pieza en voz alta, resuelto por marca. `null` = sin dato. */
  reading_language: string | null;
  /** Sólo en `archived`; `null` en el corpus vivo. */
  archived_at: string | null;
  archived_reason: string | null;
}

function intelHeaders(): Record<string, string> {
  return { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Accept-Profile': 'intel' };
}

function intParam(v: unknown, def: number, min: number, max: number): number {
  const n = Array.isArray(v) ? v[0] : v;
  const parsed = typeof n === 'string' ? parseInt(n, 10) : NaN;
  if (!Number.isFinite(parsed)) return def;
  return Math.min(max, Math.max(min, parsed));
}
function strParam(v: unknown): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.trim() ? s.trim() : undefined;
}
function enumParam<T extends string>(v: unknown, allowed: readonly T[], def: T): T {
  const s = strParam(v);
  return (s && (allowed as readonly string[]).includes(s)) ? (s as T) : def;
}

/**
 * Una fecha ISO-8601 válida, o `undefined`. Se valida ANTES de meterla en la consulta: un
 * `from` con basura produciría un filtro que PostgREST rechaza entero, y el operador vería un
 * error de servidor en vez de entender que escribió mal la fecha.
 */
function isoParam(v: unknown): string | undefined {
  const s = strParam(v);
  if (!s) return undefined;
  return Number.isFinite(Date.parse(s)) ? s : undefined;
}

function ms(iso: string | null | undefined): number {
  if (!iso) return -Infinity;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : -Infinity;
}

/** Lee UNA de las dos tablas y marca de dónde salió. Lanza en error de red/HTTP. */
async function fetchCorpusRows(
  table: 'approval_calibration' | 'approval_calibration_archive',
  source: HistorySource,
  range: { from?: string; to?: string },
): Promise<EvaluatedRow[]> {
  const select = source === 'archived' ? ARCHIVE_SELECT : CORPUS_SELECT;
  // El rango se empuja a la consulta: es el filtro más selectivo y el único que puede
  // recortar de verdad la lectura. El resto se resuelve en JS sobre el conjunto ya unido,
  // porque las facetas tienen que contar sobre el mismo universo en las dos tablas.
  const rango = [
    range.from ? `&created_at=gte.${encodeURIComponent(range.from)}` : '',
    range.to ? `&created_at=lte.${encodeURIComponent(range.to)}` : '',
  ].join('');
  const url = `${SB_URL()}/rest/v1/${table}?select=${select}${rango}`
    + `&order=created_at.desc&limit=${HISTORY_CAP}`;

  const res = await fetch(url, { headers: intelHeaders() });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`${table} read failed: ${res.status} ${detail}`);
  }
  const rows = (await res.json().catch(() => [])) as Array<Record<string, unknown>>;
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    piece_id: String(r.piece_id ?? ''),
    brand_id: String(r.brand_id ?? ''),
    voice: (r.voice as string) ?? null,
    domain: (r.domain as string) ?? null,
    platform: (r.platform as string) ?? null,
    format: (r.format as string) ?? null,
    psycho_preset: (r.psycho_preset as string) ?? null,
    audience_frame: (r.audience_frame as string) ?? null,
    verdict: String(r.verdict ?? ''),
    criterion: (r.criterion as string) ?? null,
    fix_proposal: (r.fix_proposal as string) ?? null,
    evaluated_by: (r.evaluated_by as string) ?? null,
    created_at: (r.created_at as string) ?? null,
    artifact_url: (r.artifact_url as string) ?? null,
    watcher_result: (r.watcher_result as string) ?? null,
    watcher_gate: (r.watcher_gate as string) ?? null,
    watcher_rules: Array.isArray(r.watcher_rules) ? (r.watcher_rules as string[]) : null,
    watcher_rules_evaluated: typeof r.watcher_rules_evaluated === 'number' ? r.watcher_rules_evaluated : null,
    source,
    reading_language: null, // lo resuelve el handler, que es quien lee el catálogo una vez
    archived_at: (r.archived_at as string) ?? null,
    archived_reason: (r.archived_reason as string) ?? null,
  }));
}

/** Cuenta por una dimensión, saltándose lo vacío. Las facetas se DESCUBREN del dato. */
function tally(rows: EvaluatedRow[], key: (r: EvaluatedRow) => string | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const session = requireAdmin(req, res, extractToken(req));
  if (!session) return; // requireAdmin ya respondió

  const limit   = intParam(req.query.limit, 50, 1, 200);
  const offset  = intParam(req.query.offset, 0, 0, 10_000_000);
  const from    = isoParam(req.query.from);
  const to      = isoParam(req.query.to);
  const brand   = strParam(req.query.brand);
  const channel = strParam(req.query.channel);
  // Cualquier valor, comparado exacto. `all` (o vacío) = sin filtro. Ver la cabecera.
  const verdict = strParam(req.query.verdict);
  const source  = enumParam<HistorySourceFilter>(req.query.source, HISTORY_SOURCES, 'all');

  try {
    const [live, archived, brandLangs] = await Promise.all([
      source === 'archived' ? Promise.resolve([]) : fetchCorpusRows('approval_calibration', 'live', { from, to }),
      source === 'live' ? Promise.resolve([]) : fetchCorpusRows('approval_calibration_archive', 'archived', { from, to }),
      fetchBrandLanguages(),
    ]);

    const enScope = [...live, ...archived].map((r) => ({
      ...r,
      reading_language: readingLanguageOf(r.brand_id, brandLangs),
    }));

    // LAS FACETAS SE CUENTAN SOBRE EL ÁMBITO (fecha + origen), ANTES de los tres filtros
    // que ellas mismas representan. Si `by_brand` se contara después de filtrar por marca,
    // mostraría siempre una sola marca con el total de la página: dejaría de ser una faceta
    // y sería un eco del filtro. Misma convención que `by_brand` en la bandeja de calibración.
    const by_brand   = tally(enScope, (r) => r.brand_id);
    const by_channel = tally(enScope, (r) => r.platform);
    const by_verdict = tally(enScope, (r) => r.verdict);

    let filtradas = enScope;
    if (brand)   filtradas = filtradas.filter((r) => r.brand_id === brand);
    if (channel) filtradas = filtradas.filter((r) => r.platform === channel);
    if (verdict && verdict !== 'all') filtradas = filtradas.filter((r) => r.verdict === verdict);

    const ordenadas = filtradas.sort((a, b) => ms(b.created_at) - ms(a.created_at));
    const page = ordenadas.slice(offset, offset + limit);

    // Que una de las dos lecturas tope el CAP se DICE: un historial truncado en silencio es
    // peor que uno corto, porque parece completo.
    const truncated = live.length >= HISTORY_CAP || archived.length >= HISTORY_CAP;
    if (truncated) {
      console.warn(`[evaluated-history] lectura al tope ${HISTORY_CAP} — el historial puede estar truncado`);
    }

    return res.status(200).json({
      total: ordenadas.length,
      by_brand,
      by_channel,
      by_verdict,
      limit,
      offset,
      rows: page,
      ...(truncated ? { truncated } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[evaluated-history]', message);
    // El texto del server viaja: `history_failed` a secas no le dice nada al operador, y el
    // caso que más probablemente aparezca —PostgREST todavía sin la tabla en su schema cache—
    // sólo se distingue leyendo lo que respondió la base.
    return res.status(500).json({ error: 'history_failed', message });
  }
}
