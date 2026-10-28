/**
 * LAS MARCAS EN LÍNEA DEL CUERPO DE UNA PIEZA — negrita `**así**` y cursiva `*así*` (2026-10-28).
 *
 * Sam (2026-10-28): «quiero poder aplicar italic al texto cuando lo requiera», en los artículos del blog. La misma
 * regla vive en las tres puntas que pintan un cuerpo: los `api/_inline.js` de cada sitio (`vercel_html`), el
 * publicador de Shopify (`blog-promoter`, función `negritas`) y aquí, la vista del revisor y el artículo de la
 * pestaña Manual. Si cambia en una, cambia en las tres: la bandeja tiene que mostrar exactamente lo que se publica.
 *
 * Un asterisco suelto es TEXTO: sólo un par bien formado es una marca. La cursiva es UN asterisco que abre y
 * cierra pegado al texto por dentro, sin letra ni número pegados por fuera — `4*`, `5 * 3` o `a*b*c` se
 * publican tal cual. Bloque PURO; se prueba en `_marcasEnLinea.test.ts`.
 */

const BOLD = /\*\*(?!\s)([^*]+?)(?<!\s)\*\*/g;
const ITALIC = /(?<![\p{L}\p{N}*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\p{L}\p{N}*])/gu;

/** La cursiva se traduce antes Y después de la negrita, para que se aniden en los dos sentidos. */
const marcas = (s: string, negrita: string, cursiva: string) =>
  String(s).replace(ITALIC, cursiva).replace(BOLD, negrita).replace(ITALIC, cursiva);

/** `**texto**` → `<strong>` y `*texto*` → `<em>`. Recibe texto YA escapado. */
export function inlineMarksToHtml(escaped: string): string {
  return marcas(escaped, '<strong>$1</strong>', '<em>$1</em>');
}

/** El texto sin negrita ni cursiva: para un subtítulo o para el texto plano. */
export function stripInlineMarks(text: string): string {
  return marcas(text, '$1', '$1');
}

/** ¿Trae el texto al menos una negrita o una cursiva bien formadas? */
export function hasInlineMarks(text: string): boolean {
  const t = String(text ?? '');
  return new RegExp(BOLD.source).test(t) || new RegExp(ITALIC.source, 'u').test(t);
}
