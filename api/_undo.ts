/**
 * UNRLVL Orchestrator — api/_undo.ts  (DESHACER · 2026-10-21)
 *
 * QUÉ SE DESHACE CUANDO SAM PULSA «DESHACER». Lógica pura, sin red, para que el test la ejecute tal cual.
 *
 * Sam (2026-10-21), literal: «me agregar un botón de undo en todas las pestañas y que vuelva la versión
 * anterior». El caso que lo pidió: corrigió el texto embebido de 67cfd678 y «quedó peor»; volver atrás
 * exigió SQL a mano.
 *
 * ── LO ÚLTIMO QUE CAMBIÓ, Y NADA MÁS ──────────────────────────────────────────────────────────
 * Una pieza guarda dos historias, y Deshacer elige la MÁS RECIENTE de las dos:
 *   · la de la IMAGEN: `assets.image.history`, la más reciente primero, cada entrada con `replaced_at`
 *     (la escribe el motor en `withImageHistory` y `restoreFromHistory`). Volver es `restore_image`
 *     con índice 0, que además deja la imagen deshecha en el historial: deshacer también se deshace.
 *   · la del TEXTO: `intel.piece_edits` con `field` = `title` o `body`, las que escribe la EF
 *     `piece-edit`. Volver es otra edición con el `before_text` de la última, por la MISMA EF: así la
 *     guarda determinista, las dos caras del copy y el registro del diff siguen siendo de un solo sitio.
 *
 * El texto de la IMAGEN no es un caso aparte: cada cambio suyo recompone la imagen y deja su entrada en
 * `image.history`, así que lo cubre la primera historia.
 *
 * Sin ninguna de las dos no hay nada que deshacer, y se dice; no se adivina.
 */

/** Los campos de texto que deshace la EF `piece-edit`. Espejo de su `EDITABLE_FIELDS`. */
export const UNDO_TEXT_FIELDS = ['title', 'body'] as const;
export type UndoTextField = (typeof UNDO_TEXT_FIELDS)[number];

export interface TextEditRow {
  field?: string | null;
  before_text?: string | null;
  created_at?: string | null;
}

export type UndoPlan =
  | { kind: 'image'; at: string }
  | { kind: 'text'; at: string; field: UndoTextField; restore_to: string }
  | { kind: 'nothing'; reason: string };

const ms = (iso: unknown): number | null => {
  if (typeof iso !== 'string' || !iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** El último cambio de imagen: cuándo se reemplazó la imagen que hoy está al tope del historial. */
export function lastImageChangeAt(assets: unknown): string | null {
  const h = (assets as { image?: { history?: unknown } } | null | undefined)?.image?.history;
  if (!Array.isArray(h) || !h.length) return null;
  const at = (h[0] as { replaced_at?: unknown } | null)?.replaced_at;
  return ms(at) === null ? null : (at as string);
}

/** La última edición de texto deshacible, de una lista ordenada o no. */
export function lastTextEdit(rows: readonly TextEditRow[] | null | undefined): (TextEditRow & { field: UndoTextField; created_at: string }) | null {
  let best: (TextEditRow & { field: UndoTextField; created_at: string }) | null = null;
  for (const r of Array.isArray(rows) ? rows : []) {
    const f = typeof r?.field === 'string' ? r.field.trim() : '';
    if (!(UNDO_TEXT_FIELDS as readonly string[]).includes(f)) continue;
    if (typeof r.before_text !== 'string') continue;   // sin el texto anterior no hay a dónde volver
    const t = ms(r.created_at);
    if (t === null) continue;
    if (!best || t > (ms(best.created_at) ?? -Infinity)) best = { ...r, field: f as UndoTextField, created_at: r.created_at as string };
  }
  return best;
}

/** Qué se deshace. Gana el cambio más reciente; en un empate exacto, la imagen (es lo que más se ve). */
export function planUndo(assets: unknown, textEdits: readonly TextEditRow[] | null | undefined): UndoPlan {
  const img = lastImageChangeAt(assets);
  const txt = lastTextEdit(textEdits);
  if (!img && !txt) {
    return { kind: 'nothing', reason: 'No hay una versión anterior guardada: la pieza no se ha corregido ni regenerado.' };
  }
  if (img && (!txt || (ms(img) ?? 0) >= (ms(txt.created_at) ?? 0))) return { kind: 'image', at: img };
  return { kind: 'text', at: txt!.created_at, field: txt!.field, restore_to: txt!.before_text as string };
}
