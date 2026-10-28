/**
 * EL TAMAÑO DEL TEXTO DE LA IMAGEN, DESDE LA BANDEJA (2026-10-28).
 *
 * Sam (2026-10-28): «el slider de zoom es para el texto, no para la UI», «el zoom es para el embedded text», «un toque
 * mínimo y personal». El zoom de la pantalla que entró en #104 se retira; en su lugar, el editor del texto de la imagen
 * lleva un deslizador que agranda o achica el texto compuesto sobre la foto.
 *
 * Qué hace (ImageLab ≥ 1.19.0, campo `text_scale`): un factor sobre el tamaño que la marca declara para el titular y la
 * bajada, de 70 % a 130 %. La regla del área (el texto no ocupa más del 20 % de la imagen) sigue mandando: si se pide
 * más de lo que cabe, el compositor lo recorta y lo dice. El motor lo guarda en la pieza (`assets.image.text_scale`),
 * así que una recomposición posterior lo conserva; rige también la portada de un carrusel. No genera escena: se
 * recompone sobre la foto (0 USD).
 *
 * Este módulo es PURO: qué ve el deslizador y qué viaja al motor. MULTIMARCA: cero marcas.
 */

export const TEXT_SCALE_MIN = 0.7;
export const TEXT_SCALE_MAX = 1.3;
export const TEXT_SCALE_STEP = 0.05;

export const TEXT_SCALE_HELP =
  'Tamaño del texto de la imagen: 100 % es el de la marca. Si el texto no cabe sin pasar del 20 % de la imagen, el '
  + 'compositor lo deja en lo que cabe. Se puede pedir solo con «Recomponer», sin cambiar el texto (0 USD).';

/** Al paso del deslizador y dentro del rango; 1 = el de la marca. PURO. */
export function clampTextScale(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  const enPaso = Math.round(n / TEXT_SCALE_STEP) * TEXT_SCALE_STEP;
  return Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, Number(enPaso.toFixed(2))));
}

/** Lo guardado en la pieza. Fuera de rango o 1 no cuenta: rige el de la marca (`null`). PURO. */
export function storedTextScale(v: unknown): number | null {
  const n = typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n) || n < TEXT_SCALE_MIN || n > TEXT_SCALE_MAX) return null;
  const r = Math.round(n * 100) / 100;
  return r === 1 ? null : r;
}

/** El tamaño guardado de la imagen de la pieza (rige también la portada de un carrusel). PURO. */
export function textScaleOfImage(assets: any): number | null {
  return storedTextScale(assets?.image?.text_scale);
}

/** Lo que la ruta acepta en `text_scale` antes de llamar al motor. `null`, vacío o 1 = el de la marca. PURO. */
export function readTextScaleRequest(raw: unknown): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: true, value: null };
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= TEXT_SCALE_MIN && raw <= TEXT_SCALE_MAX) {
    return { ok: true, value: storedTextScale(raw) };
  }
  return { ok: false, error: `text_scale debe ser un número entre ${TEXT_SCALE_MIN} y ${TEXT_SCALE_MAX} o null` };
}

/** «100 %», «85 %». PURO. */
export function textScaleLabel(v: number | null): string {
  return `${Math.round((v ?? 1) * 100)} %`;
}

/**
 * Junto con «Aplicar texto» o «Recomponer»: viaja sólo si el deslizador se movió a un valor distinto del guardado.
 * `undefined` = no viaja; `null` = volver al de la marca. PURO.
 */
export function textScaleToSend(selected: number | null, current: number | null): number | null | undefined {
  if (selected == null) return undefined;
  const sel = storedTextScale(clampTextScale(selected));
  return sel === (current ?? null) ? undefined : sel;
}
