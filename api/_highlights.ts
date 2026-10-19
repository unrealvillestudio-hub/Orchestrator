/**
 * LA CALIFICACIÓN «DESTACADA» AL APROBAR (PR 6, 2026-10-19).
 *
 * Sam, 2026-10-18: «una manito de "like" y tal vez un "comentario" cuando no es tan buena. NO pondría una
 * manito de "no like" porque eso sería un fixable. Las que no reciben nada estarían dentro de lo que llamaría
 * "pasable", separando imagen de copy … tendría que hacerlo antes de aprobar». Aprobado el 2026-10-19: un
 * panel al aprobar con una sección de copy y otra de imagen.
 *
 * Las columnas (`highlight_copy`, `highlight_image`, `copy_note`, `image_note` de `intel.approval_calibration`)
 * llegan con la migración 20261019240000 de unrlvl-iid-functions. VIAJAN SÓLO SI SE MARCÓ ALGO: un aprobado
 * sin calificar no depende de esa migración (la lección del #75). PURO: sin red, sin DB.
 *
 * MULTIMARCA: cero marcas; la calificación es de la pieza, no de quién la publica.
 */

export const HIGHLIGHT_NOTE_MAX = 1000;

export interface HighlightInput {
  copy: boolean;
  image: boolean;
  copyNote: string;
  imageNote: string;
}

export type HighlightFields = Partial<{
  highlight_copy: true; highlight_image: true; copy_note: string; image_note: string;
}>;

/**
 * Lo que la pantalla manda con un aprobado. Sólo las claves que tienen valor: sin marca ni comentario, `{}`.
 * Una pieza sin imagen no lleva calificación de imagen.
 */
export function highlightPayload(h: HighlightInput, hasImage: boolean | undefined): HighlightFields {
  const out: HighlightFields = {};
  if (h.copy) out.highlight_copy = true;
  const cn = (h.copyNote ?? '').trim();
  if (cn) out.copy_note = cn;
  if (hasImage !== false) {
    if (h.image) out.highlight_image = true;
    const inote = (h.imageNote ?? '').trim();
    if (inote) out.image_note = inote;
  }
  return out;
}

/**
 * Lo que el server acepta. `true` marca; cualquier otro valor del pulgar no cuenta (no hay pulgar negativo).
 * Un comentario que no es texto, o que pasa del máximo, es 400 con el motivo, antes de tocar nada.
 */
export function resolveHighlights(body: Record<string, unknown>):
  { ok: true; fields: HighlightFields } | { ok: false; error: string; detail: string } {
  const fields: HighlightFields = {};
  if (body.highlight_copy === true) fields.highlight_copy = true;
  if (body.highlight_image === true) fields.highlight_image = true;
  for (const k of ['copy_note', 'image_note'] as const) {
    const v = body[k];
    if (v == null) continue;
    if (typeof v !== 'string') return { ok: false, error: `${k} must be a string`, detail: typeof v };
    const t = v.trim();
    if (!t) continue;
    if (t.length > HIGHLIGHT_NOTE_MAX)
      return { ok: false, error: `${k} too long`, detail: `${t.length} caracteres; el máximo es ${HIGHLIGHT_NOTE_MAX}` };
    fields[k] = t;
  }
  return { ok: true, fields };
}
