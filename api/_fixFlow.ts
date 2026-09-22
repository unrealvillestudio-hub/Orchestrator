/**
 * UNRLVL Orchestrator — api/_fixFlow.ts  (LO-CORREGIDO-01 · el circuito de arreglos)
 *
 * LO QUE ESTE MÓDULO RESUELVE, en las palabras del encargo (Sam, 2026-09-21):
 *
 *   «calibro > decido que va a fixable con mi comentario > lo corregimos en chat > lo devuelves
 *    corregido a la bandeja (asegurando el aprendizaje del flujo) > luego apruebo si está bien.
 *    Pues estas las quiero en otro tab.»
 *
 * Los cuatro primeros pasos ya existían y funcionaban. El que faltaba es el QUINTO: una pieza que
 * vuelve corregida vuelve a una bandeja de cien tarjetas donde no se distingue de ninguna otra, y
 * la propuesta contra la que hay que compararla —lo que Sam escribió al marcarla— no se ve por
 * ningún lado. Aprobar «si está bien» exige tener delante contra qué.
 *
 * ── LA VERSIÓN NO NECESITA UNA TABLA NUEVA, Y ESO NO ES UN ATAJO ─────────────────
 * La política que Sam eligió es «nueva versión, se conserva la anterior». `intel.piece_edits` ya la
 * implementa al pie de la letra: cada edición guarda `before_text` y `after_text` con su campo, su
 * motivo, quién y cuándo. Añadir una segunda tabla de versiones crearía una SEGUNDA FUENTE DE
 * VERDAD sobre el mismo hecho, que es el defecto contra el que este repositorio ya se plantó tres
 * veces (ver la cabecera de `_challengedShared.ts`). Lo que faltaba no era dónde guardar: era
 * NOMBRAR lo guardado y enseñarlo.
 *
 * ── EL RASTRO ENRIQUECE, NO CONDICIONA · y está MEDIDO por qué ───────────────────
 * Medido el 2026-09-22: **32 piezas tienen `edited_at` y CERO filas en `intel.piece_edits`**. Hay
 * caminos de corrección que no registran el diff. Por eso:
 *
 *   · que una pieza APAREZCA en el circuito lo decide `challenged_at`, un hecho de la pieza;
 *   · qué versión es y qué cambió lo dice el rastro, y cuando el rastro no está **se dice que no
 *     está** en vez de contar 1 versión — que sería afirmar «no se tocó», y es falso.
 *
 * `version: null` con `traced: false` es una ausencia declarada. Un `1` en su lugar sería una
 * afirmación sin medir, y de las peores: la que parece un dato.
 *
 * ── CERO MARCAS ─────────────────────────────────────────────────────────────────
 * Acá no hay una sola marca, ni un dominio, ni una plataforma. El eje es «pieza retada que volvió»,
 * que es del SISTEMA: la marca N+1 de otro rubro y otro país entra en este circuito sin que nadie
 * edite este archivo. Los campos editables (`field`) llegan como DATO desde la tabla y se muestran
 * tal cual; no hay lista cerrada acá — medido el 2026-09-22, la tabla ya trae diez valores
 * distintos, entre ellos rutas dentro de `assets`, y una lista escrita acá los escondería.
 */

import { SB_URL, SB_KEY } from './_calibrationShared.js';
import { fetchWithTimeout } from './_fetchWithTimeout.js';

/** Fila cruda de `intel.piece_edits`: una edición de un campo, con su antes y su después. */
export interface PieceEditRow {
  piece_id: string;
  field: string;
  before_text: string | null;
  after_text: string | null;
  edit_reason: string | null;
  edited_by: string | null;
  created_at: string;
}

/**
 * Un cambio, ya contado dentro del circuito. `before_text` viaja RECORTADO: la tarjeta enseña de
 * dónde venía, no el documento entero, y una respuesta de veinte piezas con sus textos completos
 * pesaría más que el resto de la bandeja junta.
 */
export interface FixChange {
  field: string;
  /** Lo que decía ANTES, recortado. `null` si el campo nació vacío. */
  before_excerpt: string | null;
  reason: string | null;
  by: string | null;
  at: string;
  /** Si ocurrió DESPUÉS del reto. Un cambio anterior es historia de la pieza, no de este arreglo. */
  after_challenge: boolean;
}

/**
 * EL ESTADO DE UNA PIEZA DENTRO DEL CIRCUITO DE ARREGLOS.
 *
 * Es lo que la tarjeta necesita para que Sam pueda decidir sin abrir nada más: qué pidió, cuándo,
 * qué se hizo desde entonces y por qué versión va.
 */
export interface FixFlow {
  /** Cuándo se marcó para arreglar. `null` = la pieza nunca pasó por el circuito. */
  challenged_at: string | null;
  /** LA PROPUESTA DE SAM, literal. Es el criterio contra el que se aprueba, y por eso va entera. */
  challenge_reason: string | null;
  /**
   * POR QUÉ VERSIÓN VA. v1 = como nació; cada cambio registrado suma una. `null` cuando la pieza
   * se tocó y el cambio no dejó rastro: no se sabe, y decirlo es lo único honesto.
   */
  version: number | null;
  /** `false` = la pieza se editó y el diff no está en `intel.piece_edits`. Ver la cabecera. */
  traced: boolean;
  /** Cambios registrados DESPUÉS del reto, del más reciente al más antiguo. */
  changes: FixChange[];
  /** Cuándo se la tocó por última vez, venga o no con rastro. Sale de la pieza. */
  edited_at: string | null;
  edited_by: string | null;
}

/** El recorte del texto anterior. 240 caracteres: lo bastante para reconocer, poco para pesar. */
export const BEFORE_EXCERPT_MAX = 240;

function excerpt(s: string | null | undefined): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (!t) return null;
  return t.length <= BEFORE_EXCERPT_MAX ? t : `${t.slice(0, BEFORE_EXCERPT_MAX)}…`;
}

function ms(iso: string | null | undefined): number {
  if (!iso) return NaN;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
}

/**
 * Lo que la pieza aporta al circuito. Se separa del resto para que `fixFlowOf` sea PURA y el test
 * la pueda ejecutar sin DB ni red — igual que `pendingStateOf`.
 */
export interface FixPieceInput {
  id: string;
  challenged_at?: string | null;
  challenged_reason?: string | null;
  edited_at?: string | null;
  edited_by?: string | null;
}

/**
 * Arma el estado del circuito para UNA pieza. PURA: la testea `_fixFlow.test.ts`.
 *
 * `edits` son las filas de esa pieza, en cualquier orden; acá se ordenan. Pasar un array vacío es
 * legítimo y significa «sin rastro», no «no se tocó»: esas dos cosas las separa `edited_at`.
 */
export function fixFlowOf(piece: FixPieceInput, edits: PieceEditRow[] = []): FixFlow {
  const challengedAt = piece.challenged_at ?? null;
  const retoMs = ms(challengedAt);

  const ordenados = edits
    .filter((e) => e && typeof e.created_at === 'string')
    .slice()
    .sort((a, b) => ms(b.created_at) - ms(a.created_at));

  const changes: FixChange[] = ordenados.map((e) => ({
    field: e.field,
    before_excerpt: excerpt(e.before_text),
    reason: e.edit_reason ?? null,
    by: e.edited_by ?? null,
    at: e.created_at,
    // Un reto sin fecha (o con fecha ilegible) NO convierte el historial en posterior: se dice que
    // no, que es lo que no inventa. Ante la duda, el cambio es historia vieja y no mérito de este
    // arreglo — al revés, la tarjeta atribuiría al arreglo cambios que nadie hizo por él.
    after_challenge: Number.isFinite(retoMs) && ms(e.created_at) >= retoMs,
  }));

  const conRastro = ordenados.length > 0;
  const tocada = Boolean(piece.edited_at);

  return {
    challenged_at: challengedAt,
    challenge_reason: piece.challenged_reason ?? null,
    // v1 = como nació. Cada cambio registrado suma. Si se la tocó y no hay rastro, no se sabe.
    version: conRastro ? ordenados.length + 1 : (tocada ? null : 1),
    traced: conRastro || !tocada,
    changes: changes.filter((c) => c.after_challenge),
    edited_at: piece.edited_at ?? null,
    edited_by: piece.edited_by ?? null,
  };
}

// ── Lectura ─────────────────────────────────────────────────────────────────────

/**
 * Cap defensivo. Mismo criterio que el resto del módulo: si se supera, lo que falta son CAMBIOS de
 * la página visible, así que el llamante lo declara en vez de callarlo.
 */
export const EDITS_CAP = 500;

const EDIT_SELECT = 'piece_id,field,before_text,after_text,edit_reason,edited_by,created_at';

/**
 * Las ediciones de las piezas dadas, indexadas por pieza.
 *
 * Devuelve un Map VACÍO ante cualquier fallo, y es deliberado: el rastro enriquece la tarjeta y no
 * la condiciona (ver la cabecera). Perder la bandeja entera porque no se pudo leer un historial
 * sería cambiar un dato ausente por una pantalla en blanco. Cuando el Map viene vacío, `fixFlowOf`
 * lo traduce a `traced:false` en toda pieza tocada, que es exactamente lo que ha pasado.
 */
export async function fetchPieceEdits(ids: string[]): Promise<Map<string, PieceEditRow[]>> {
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  const m = new Map<string, PieceEditRow[]>();
  if (!uniq.length) return m;
  const list = uniq.map((i) => `"${i}"`).join(',');
  const url = `${SB_URL()}/rest/v1/piece_edits?piece_id=in.(${encodeURIComponent(list)})`
    + `&select=${EDIT_SELECT}&order=created_at.desc&limit=${EDITS_CAP}`;
  try {
    const res = await fetchWithTimeout('db', url, {
      headers: {
        apikey: SB_KEY(),
        Authorization: `Bearer ${SB_KEY()}`,
        'Accept-Profile': 'intel',
      },
    });
    if (!res.ok) return m;
    const rows = (await res.json().catch(() => [])) as PieceEditRow[];
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r?.piece_id) continue;
      const arr = m.get(r.piece_id);
      if (arr) arr.push(r); else m.set(r.piece_id, [r]);
    }
  } catch {
    return m;
  }
  return m;
}
