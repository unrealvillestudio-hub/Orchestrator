/**
 * LA VISTA PREVIA, PARTIDA EN IMAGEN Y TEXTO (Sam, 2026-10-28).
 *
 * Sam: «las funciones de corrección de imagen y embedded text justamente abajo de la imagen, y las de corrección de
 * title y body justamente después de la franja del TTS». El artefacto pinta la imagen (o las láminas) y el texto en un
 * solo documento, dentro de un <iframe sandbox="">: entre los dos no se puede poner nada. Así que la tarjeta pinta la
 * imagen por su cuenta, con las MISMAS direcciones que el artefacto, y el iframe muestra el resto con el bloque de la
 * imagen oculto. El artefacto publicado no cambia.
 *
 * El bloque lo escribe `mediaBlockOf` (`api/_calibrationShared.ts`): `<div class="media">` con una imagen, o
 * `<div class="media carousel">` con la tira de láminas y su nota. Sin imagen (`media--none`) no se parte nada.
 * Bloque PURO; se prueba en `vistaPartida.test.ts`.
 */

export interface VistaPartida {
  /** Las imágenes en el orden en que se publican; vacío = no hay imagen que sacar del artefacto. */
  imagenes: string[];
  carrusel: boolean;
  /** El artefacto con el bloque de la imagen oculto; sin imágenes, el artefacto tal cual. */
  textoHtml: string;
}

const desescapar = (s: string) => s
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const OCULTAR_MEDIA = '<style>.media{display:none!important}</style>';

export function partirVista(html: string | null): VistaPartida | null {
  if (html == null) return null;
  const abre = html.search(/<div class="media(?:[ "])/);
  if (abre < 0) return { imagenes: [], carrusel: false, textoHtml: html };
  const etiqueta = html.slice(abre, html.indexOf('>', abre) + 1);
  if (/media--none/.test(etiqueta)) return { imagenes: [], carrusel: false, textoHtml: html };
  const carrusel = /\bcarousel\b/.test(etiqueta);
  const fin = carrusel ? html.indexOf('class="carousel-note"', abre) : html.indexOf('</div>', abre);
  const bloque = html.slice(abre, fin < 0 ? undefined : fin);
  const imagenes = [...bloque.matchAll(/<img\s[^>]*?src="([^"]+)"/g)].map((m) => desescapar(m[1]));
  if (!imagenes.length) return { imagenes: [], carrusel: false, textoHtml: html };
  const textoHtml = html.includes('</head>') ? html.replace('</head>', `${OCULTAR_MEDIA}</head>`) : OCULTAR_MEDIA + html;
  return { imagenes, carrusel, textoHtml };
}
