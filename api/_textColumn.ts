/**
 * LA COLUMNA DEL TEXTO DE LA IMAGEN, DESDE LA BANDEJA (2026-10-24).
 *
 * Sam (2026-10-24), en el editor del texto de la imagen: «incluir la opción de alinear a la izquierda o derecha
 * también, me parece útil», y después: «incluye centro».
 *
 * Qué hace cada opción (ImageLab ≥ 1.17.0, campo `text_column`), junto con la fila de `_textPlace.ts`:
 *   · en la imagen de la pieza (y la portada de un carrusel), el texto va en esa columna y sus líneas se alinean con
 *     ella: a la izquierda, centradas o a la derecha. Si la marca pide no tapar caras ni productos, se mueve de fila
 *     dentro de esa columna (salvo que también se haya pedido la fila); si tapa algo, se compone igual y se avisa;
 *   · en una lámina 2..N, el bloque va del lado pedido (o a todo el ancho con «Centro»); la lámina se sigue leyendo
 *     alineada a la izquierda, por sus pasos y su cifra.
 * El motor la guarda en la pieza (`assets.image.text_column`) o en la lámina (`carousel.slides[n].text_column`), así
 * que una recomposición posterior la conserva. Ninguna opción genera escena: se recompone sobre la foto (0 USD).
 *
 * Este módulo es PURO: qué ve el selector y qué viaja al motor. MULTIMARCA: cero marcas.
 */

export const TEXT_COLUMNS = ['left', 'center', 'right'] as const;
export type TextColumn = (typeof TEXT_COLUMNS)[number];

/** Las tres opciones del selector, en el orden en que se pintan. */
export const TEXT_COLUMN_CHOICES: ReadonlyArray<{ value: TextColumn; label: string; hint: string }> = [
  { value: 'left', label: 'Izquierda', hint: 'El texto va a la izquierda y sus líneas se alinean a la izquierda. Si tapa algo, se compone igual y se avisa.' },
  { value: 'center', label: 'Centro', hint: 'El texto va al centro y sus líneas se centran. En una lámina, el bloque ocupa todo el ancho.' },
  { value: 'right', label: 'Derecha', hint: 'El texto va a la derecha y sus líneas se alinean a la derecha. Si tapa algo, se compone igual y se avisa.' },
];

export const TEXT_COLUMN_HELP =
  'Columna del texto: izquierda, centro o derecha, junto con la ubicación. Se puede pedir sola con «Recomponer», ' +
  'sin cambiar el texto: se recompone sobre la misma foto, sin generar (0 USD).';

/** Lo guardado en la pieza o en la lámina. Un valor que no es de la lista no cuenta. PURO. */
export function storedTextColumn(v: unknown): TextColumn | null {
  return typeof v === 'string' && (TEXT_COLUMNS as readonly string[]).includes(v) ? (v as TextColumn) : null;
}

/** La columna guardada de la imagen de la pieza (rige también la portada de un carrusel). PURO. */
export function textColumnOfImage(assets: any): TextColumn | null {
  return storedTextColumn(assets?.image?.text_column);
}

/** Lo que la ruta acepta en `text_column` antes de llamar al motor. PURO. `null` o vacío = la de la marca. */
export function readTextColumnRequest(raw: unknown): { ok: true; value: TextColumn | null } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: true, value: null };
  const v = storedTextColumn(raw);
  if (v) return { ok: true, value: v };
  return { ok: false, error: `text_column debe ser ${TEXT_COLUMNS.map((x) => `'${x}'`).join(', ')} o null` };
}

/** La etiqueta de una columna guardada, para decir cuál rige hoy. PURO. */
export function textColumnLabel(v: TextColumn | null): string {
  return v ? TEXT_COLUMN_CHOICES.find((c) => c.value === v)!.label.toLowerCase() : 'como la marca';
}

/** Junto con «Aplicar texto»: viaja sólo si se eligió una y es distinta de la guardada. PURO. `null` = no viaja. */
export function textColumnToSend(selected: TextColumn | null, current: TextColumn | null): TextColumn | null {
  return selected && selected !== current ? selected : null;
}

/** Lo que la tarjeta dice después de recomponer sólo la colocación (fila, columna o las dos). PURO. */
export function textLayoutNoteOf(place: 'top' | 'bottom' | 'auto' | null, column: TextColumn | null, slideN: number | null): string {
  const donde = slideN && slideN > 1 ? `La lámina ${slideN}` : 'La imagen';
  const fila = place === 'auto' ? 'donde no tapa cara ni producto' : place === 'top' ? 'arriba' : place === 'bottom' ? 'abajo' : null;
  const col = column === 'left' ? 'a la izquierda' : column === 'center' ? 'al centro' : column === 'right' ? 'a la derecha' : null;
  const que = [fila, col].filter(Boolean).join(' y ');
  return `${donde} se recompuso con el texto ${que || 'como la marca'}, sobre su misma foto (0 USD).`;
}
