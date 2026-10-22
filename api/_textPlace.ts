/**
 * LA UBICACIÓN DEL TEXTO DE LA IMAGEN, DESDE LA BANDEJA (2026-10-22).
 *
 * Sam (2026-10-22), mirando piezas en Arreglos: «de las 5 piezas hay algunas cuyo texto está mal ubicado. En el
 * Orchestrator quiero poder solicitar en los 3 tabs (calibración, arreglos y publish) que se cambie la ubicación del
 * texto arriba, abajo o recomponer para que no tape el objetivo o el producto».
 *
 * Qué hace cada opción (ImageLab ≥ 1.12.0, campo `text_place`):
 *   · 'top' / 'bottom' — el texto va en esa fila, en la columna que declara la marca. Si la marca pide no tapar caras
 *     ni productos, se mueve de columna dentro de esa fila; si toda la fila tapa algo, se compone igual y se avisa.
 *   · 'auto' — la elección de siempre: el lugar que no tapa cara ni producto (si la marca declara esa política).
 * El motor la guarda en la pieza (`assets.image.text_place`) o en la lámina (`carousel.slides[n].text_place`), así que
 * una recomposición posterior la conserva. Ninguna opción genera escena: se recompone sobre la foto (0 USD).
 *
 * Este módulo es PURO: qué ve el selector y qué viaja al motor. MULTIMARCA: cero marcas. Dónde cae cada fila lo
 * decide el dato de cada marca en el compositor; aquí sólo vive el eje (arriba, abajo, que no tape).
 */

export const TEXT_PLACES = ['top', 'bottom', 'auto'] as const;
export type TextPlace = (typeof TEXT_PLACES)[number];

/** Las tres opciones del selector, en el orden en que se pintan. */
export const TEXT_PLACE_CHOICES: ReadonlyArray<{ value: TextPlace; label: string; hint: string }> = [
  { value: 'top', label: 'Arriba', hint: 'El texto va en la parte de arriba de la imagen. Si tapa algo, se compone igual y se avisa.' },
  { value: 'bottom', label: 'Abajo', hint: 'El texto va en la parte de abajo de la imagen. Si tapa algo, se compone igual y se avisa.' },
  { value: 'auto', label: 'Que no tape cara ni producto', hint: 'El compositor elige el lugar que no tapa una cara ni el producto.' },
];

export const TEXT_PLACE_HELP =
  'Ubicación del texto: arriba, abajo o donde no tape una cara ni el producto. Se puede pedir sola, sin cambiar el texto, ' +
  'con «Recomponer»: se recompone sobre la misma foto, sin generar (0 USD).';

/** Lo guardado en la pieza o en la lámina. Un valor que no es de la lista no cuenta. PURO. */
export function storedTextPlace(v: unknown): TextPlace | null {
  return typeof v === 'string' && (TEXT_PLACES as readonly string[]).includes(v) ? (v as TextPlace) : null;
}

/** La fila guardada de la imagen de la pieza (rige también la portada de un carrusel). PURO. */
export function textPlaceOfImage(assets: any): TextPlace | null {
  return storedTextPlace(assets?.image?.text_place);
}

/**
 * Lo que la ruta acepta en `text_place` antes de llamar al motor. PURO. `null` o vacío = volver a lo que declara la
 * marca; un valor de la lista = ese; cualquier otro, error claro antes del viaje.
 */
export function readTextPlaceRequest(raw: unknown): { ok: true; value: TextPlace | null } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: true, value: null };
  const v = storedTextPlace(raw);
  if (v) return { ok: true, value: v };
  return { ok: false, error: `text_place debe ser ${TEXT_PLACES.map((x) => `'${x}'`).join(', ')} o null` };
}

/** La etiqueta de una fila guardada, para decir cuál rige hoy. PURO. */
export function textPlaceLabel(v: TextPlace | null): string {
  return v ? TEXT_PLACE_CHOICES.find((c) => c.value === v)!.label : 'como la marca';
}

/** Lo que la tarjeta dice después de recomponer sólo la ubicación. PURO. */
export function textPlaceNoteOf(place: TextPlace, slideN: number | null): string {
  const donde = slideN && slideN > 1 ? `La lámina ${slideN}` : 'La imagen';
  const que = place === 'auto' ? 'con el texto donde no tapa cara ni producto' : `con el texto ${place === 'top' ? 'arriba' : 'abajo'}`;
  return `${donde} se recompuso ${que}, sobre su misma foto (0 USD).`;
}

/**
 * Junto con «Aplicar texto»: la ubicación viaja sólo si se eligió una y es distinta de la guardada (lo no tocado no se
 * reescribe ni se atribuye a nadie en `piece_edits`). PURO. `null` = no viaja.
 */
export function textPlaceToSend(selected: TextPlace | null, current: TextPlace | null): TextPlace | null {
  return selected && selected !== current ? selected : null;
}
