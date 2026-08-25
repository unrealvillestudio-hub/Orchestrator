/**
 * UNRLVL Orchestrator — api/_challengedShared.ts  (CALIB-01-E · bandeja de retenidas)
 *
 * Helpers compartidos por los tres endpoints de la bandeja de retenidas
 * (challenged-queue, challenge-verdict, piece-edit). Prefijo `_` = módulo, NO ruta Vercel
 * (mismo patrón que `_calibrationShared.ts` / `_publishShared.ts`).
 *
 * ── QUÉ ES UNA RETENIDA ──────────────────────────────────────────────────────────
 * CALIB-01 (repo unrlvl-iid-functions) retiene una pieza en vez de destruirla cuando el
 * juez marcó una regla y el `verify_pattern` VERIFICABLE de esa regla NO aparece en el
 * texto. Uno de los dos se equivoca, y quien decide es un humano: el patrón prueba
 * ausencia sólo de lo que el patrón cubre, así que absolver por regex convertiría el
 * detector en un agujero.
 *
 * El 2026-08-25 el sistema escribió esa contradicción en `gate_detail` y tiró cinco piezas
 * igual. La evidencia estuvo escrita durante horas y nadie la vio hasta que se buscó con
 * SQL. Esta bandeja existe para que eso no vuelva a pasar: *loud* significa que llegue a
 * donde Sam mira.
 *
 * ── EL GRANO ES EL ARBITRAJE, NO LA PIEZA ────────────────────────────────────────
 * La bandeja lista filas de `intel.judge_calibration`, que tiene grano `(pieza, regla)`.
 * Una pieza con desacuerdo en dos reglas presenta DOS decisiones: agruparlas obligaría a
 * decidir en bloque sobre reglas distintas, que es justo lo que el arbitraje no debe hacer.
 *
 * ── AUTH Y MUTACIÓN ──────────────────────────────────────────────────────────────
 * La auth es la de siempre: JWT admin verificado acá (`requireAdmin` de
 * `_calibrationShared`), service_role server-side, y el cliente NUNCA toca la DB.
 *
 * Pero las MUTACIONES no se reimplementan: se delegan a las Edge Functions que CALIB-01
 * cortes C y D ya exponen (`judge-arbitration`, `piece-edit`). Ahí viven la idempotencia
 * del arbitraje, el orden diff→texto→guarda de la edición y la guarda determinista con su
 * espejo del corrector. Reescribir esa lógica acá crearía una segunda fuente de verdad que
 * divergiría en el primer cambio — el mismo defecto que CALIB-01 combatió con el espejo.
 * Este repo aporta lo que la EF no puede: el gate de rol.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { SB_URL, SB_KEY } from './_calibrationShared.js';

// ── Tipos del contrato (CALIB-01 §2) ─────────────────────────────────────────────

/** Veredicto del arbitraje. NULL en la tabla = pendiente, y es lo que la bandeja lista. */
export type ChallengeVerdict = 'judge_was_right' | 'rule_failed';
export const CHALLENGE_VERDICTS: readonly ChallengeVerdict[] = ['judge_was_right', 'rule_failed'];

/** Fila cruda de intel.judge_calibration. */
export interface JudgeCalibrationRow {
  id: string;
  piece_id: string | null;
  queue_id: string | null;
  brand_id: string;
  rule_code: string;
  verify_pattern: string | null;
  judge_marked: boolean;
  pattern_found: boolean;
  verdict: ChallengeVerdict | null;
  decided_by: string | null;
  decided_at: string | null;
  note: string | null;
  created_at: string;
}

/** Lo que la bandeja muestra por fila: el arbitraje + su pieza + la regla en disputa. */
export interface ChallengedRow {
  id: string;
  piece_id: string | null;
  brand_id: string;
  created_at: string;
  // La regla en disputa
  rule_code: string;
  rule_statement: string | null;
  verify_pattern: string | null;
  pattern_found: boolean;
  reason: string;
  // La pieza
  piece: {
    id: string;
    title: string | null;
    body: string | null;
    platform: string | null;
    domain: string | null;
    status: string | null;
    pass_type: string | null;
    challenged_at: string | null;
    edited_at: string | null;
    edited_by: string | null;
    created_at: string | null;
  } | null;
}

/**
 * La razón de la retención, en una línea legible. Vive acá y no en la UI para que el
 * server sea la única fuente de la explicación: si mañana hay un segundo motivo de
 * retención, cambia una función y no cinco componentes.
 *
 * Cero marcas, cero códigos: el código de regla llega interpolado como DATO.
 */
export function retentionReason(rule_code: string): string {
  return `el juez marcó ${rule_code} y su patrón verificable no aparece en el texto`;
}

// ── Lectura vía PostgREST (mismo estilo que _calibrationShared) ───────────────────
function sbHeaders(profile: 'content' | 'intel', extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Accept-Profile': profile, ...extra };
}

const CAL_SELECT = 'id,piece_id,queue_id,brand_id,rule_code,verify_pattern,judge_marked,pattern_found,verdict,decided_by,decided_at,note,created_at';

/** Cap defensivo, mismo criterio que PIECES_CAP: si se supera, el llamante lo declara. */
export const CHALLENGED_CAP = 2000;

/**
 * Arbitrajes PENDIENTES (`verdict IS NULL`), más recientes primero.
 *
 * `null` (y no `[]`) cuando la tabla todavía no existe: CALIB-01 cortes A–D se despliegan
 * por separado, así que "la tabla no está migrada" es un estado ESPERADO de este repo, no
 * un error. La bandeja lo distingue del vacío legítimo y lo dice en pantalla — una bandeja
 * vacía porque no hay retenidas y una vacía porque falta el DDL son dos cosas distintas, y
 * confundirlas es exactamente cómo se depura un fallo que no existe.
 */
export async function fetchPendingChallenges(brand?: string): Promise<JudgeCalibrationRow[] | null> {
  const brandFilter = brand ? `&brand_id=eq.${encodeURIComponent(brand)}` : '';
  const url = `${SB_URL()}/rest/v1/judge_calibration?verdict=is.null${brandFilter}`
    + `&select=${CAL_SELECT}&order=created_at.desc&limit=${CHALLENGED_CAP}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: sbHeaders('intel') });
  } catch {
    return null;
  }
  if (res.status === 404 || res.status === 406) return null;   // tabla ausente todavía
  if (!res.ok) throw new Error(`judge_calibration read failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const rows = (await res.json().catch(() => [])) as JudgeCalibrationRow[];
  return Array.isArray(rows) ? rows : [];
}

/** Un arbitraje por id (para el `undo` y para responder el estado vigente). */
export async function fetchChallenge(id: string): Promise<JudgeCalibrationRow | null> {
  const url = `${SB_URL()}/rest/v1/judge_calibration?id=eq.${encodeURIComponent(id)}&select=${CAL_SELECT}&limit=1`;
  const res = await fetch(url, { headers: sbHeaders('intel') });
  if (!res.ok) return null;
  const rows = (await res.json().catch(() => [])) as JudgeCalibrationRow[];
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/**
 * `statement` de las reglas nombradas. Es lo que convierte un código en algo que un humano
 * puede arbitrar: sin el enunciado, "¿el juez tenía razón sobre HR-XXX-01?" no es una
 * pregunta contestable.
 *
 * Devuelve un Map vacío ante cualquier fallo: el enunciado ENRIQUECE la fila, no la
 * condiciona. Perder la bandeja entera porque no se pudo leer un texto sería peor.
 */
export async function fetchRuleStatements(codes: string[]): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(codes.filter(Boolean)));
  if (!uniq.length) return new Map();
  const list = uniq.map((c) => `"${c}"`).join(',');
  const url = `${SB_URL()}/rest/v1/watcher_rules?code=in.(${encodeURIComponent(list)})&select=code,statement&limit=1000`;
  try {
    const res = await fetch(url, { headers: sbHeaders('intel') });
    if (!res.ok) return new Map();
    const rows = (await res.json().catch(() => [])) as Array<{ code: string; statement: string | null }>;
    const m = new Map<string, string>();
    for (const r of Array.isArray(rows) ? rows : []) if (r?.code && r.statement) m.set(r.code, r.statement);
    return m;
  } catch {
    return new Map();
  }
}

/** Las columnas de pieza que la bandeja necesita. `assets` trae el texto y el título. */
const PIECE_SELECT = 'id,brand_id,domain,platform,status,created_at,assets,pass_type,challenged_at,edited_at,edited_by';

export interface RawPiece {
  id: string;
  brand_id: string;
  domain: string | null;
  platform: string | null;
  status: string | null;
  created_at: string | null;
  assets: { copy?: { title?: string | null; raw?: string | null; aife_filtered?: string | null } } | null;
  pass_type?: string | null;
  challenged_at?: string | null;
  edited_at?: string | null;
  edited_by?: string | null;
}

/**
 * El cuerpo EFECTIVO de la pieza: la cara que se publica. Es el mismo criterio que aplica
 * el endpoint de edición del otro lado (`aife_filtered ?? raw`); si acá se mostrara `raw` y
 * allá se escribiera la otra cara, Sam editaría un texto distinto del que ve.
 */
export function pieceBody(p: RawPiece | null | undefined): string | null {
  const c = p?.assets?.copy;
  if (!c) return null;
  if (typeof c.aife_filtered === 'string') return c.aife_filtered;
  if (typeof c.raw === 'string') return c.raw;
  return null;
}

export function pieceTitle(p: RawPiece | null | undefined): string | null {
  const t = p?.assets?.copy?.title;
  return typeof t === 'string' && t.trim() ? t : null;
}

export async function fetchPiecesByIds(ids: string[]): Promise<Map<string, RawPiece>> {
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  if (!uniq.length) return new Map();
  const list = uniq.map((i) => `"${i}"`).join(',');
  const url = `${SB_URL()}/rest/v1/content_pieces?id=in.(${encodeURIComponent(list)})&select=${PIECE_SELECT}&limit=1000`;
  const res = await fetch(url, { headers: sbHeaders('content') });
  if (!res.ok) throw new Error(`content_pieces read failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const rows = (await res.json().catch(() => [])) as RawPiece[];
  const m = new Map<string, RawPiece>();
  for (const r of Array.isArray(rows) ? rows : []) m.set(r.id, r);
  return m;
}

/** Arma la fila que viaja a la bandeja. PURA: la testea `_challengedShared.test.ts`. */
export function toChallengedRow(
  row: JudgeCalibrationRow,
  pieces: Map<string, RawPiece>,
  statements: Map<string, string>,
): ChallengedRow {
  const p = row.piece_id ? pieces.get(row.piece_id) ?? null : null;
  return {
    id: row.id,
    piece_id: row.piece_id,
    brand_id: row.brand_id,
    created_at: row.created_at,
    rule_code: row.rule_code,
    rule_statement: statements.get(row.rule_code) ?? null,
    verify_pattern: row.verify_pattern,
    pattern_found: row.pattern_found,
    reason: retentionReason(row.rule_code),
    piece: p
      ? {
          id: p.id,
          title: pieceTitle(p),
          body: pieceBody(p),
          platform: p.platform,
          domain: p.domain,
          status: p.status,
          pass_type: p.pass_type ?? null,
          challenged_at: p.challenged_at ?? null,
          edited_at: p.edited_at ?? null,
          edited_by: p.edited_by ?? null,
          created_at: p.created_at,
        }
      : null,
  };
}

// ── Delegación a las Edge Functions de CALIB-01 ──────────────────────────────────

/**
 * Llama a una EF de Supabase con service_role y devuelve su status y su cuerpo TAL CUAL.
 *
 * Se propaga el status sin traducir a propósito: la EF ya distingue 400 (entrada inválida),
 * 404 (no existe), 409 (ya decidido) y 500, y re-mapearlos acá haría que la UI tuviera que
 * adivinar qué pasó. Este proxy aporta el gate de rol, no una segunda opinión.
 *
 * `unavailable` (503) cuando la EF todavía no está desplegada — el estado esperado mientras
 * CALIB-01 no se haya deployado. La UI lo muestra como aviso, no como error de Sam.
 */
export async function callEdgeFunction(
  name: string, body: unknown,
): Promise<{ status: number; body: any }> {
  const url = `${SB_URL()}/functions/v1/${name}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: SB_KEY(),
        Authorization: `Bearer ${SB_KEY()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { status: 503, body: { error: 'edge_function_unreachable', function: name, cause: String(err) } };
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 404) {
    return { status: 503, body: { error: 'edge_function_not_deployed', function: name,
      message: `La Edge Function '${name}' todavía no está desplegada. Es el estado esperado hasta que CALIB-01 (cortes A–D) se despliegue.` } };
  }
  return { status: res.status, body: data };
}

/** Guarda común de los POST: método, body parseado, y CORS ya aplicado por el llamante. */
export function parseBody(req: VercelRequest): Record<string, any> {
  try {
    return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  } catch {
    return {};
  }
}

export function methodGuard(req: VercelRequest, res: VercelResponse, method: 'GET' | 'POST'): boolean {
  if (req.method === 'OPTIONS') { res.status(204).end(); return false; }
  if (req.method !== method) { res.status(405).json({ error: `${method} only` }); return false; }
  return true;
}
