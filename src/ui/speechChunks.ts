/**
 * speechChunks — parte un texto en tramos cortos para la síntesis de voz del navegador.
 *
 * EL DEFECTO QUE CIERRA: el lector mandaba la pieza entera en UNA sola `SpeechSynthesisUtterance`.
 * Con una pieza social (~1.200 caracteres) funcionaba; con un artículo de blog (~6.000) la lectura
 * se cortaba o no arrancaba. Los navegadores basados en Chromium tienen dos límites conocidos sobre
 * una utterance larga: la síntesis se detiene sola a los ~15 s, y las voces de red (las «Google …»)
 * fallan en silencio con textos largos. Ninguno de los dos se ve en una pieza corta.
 *
 * La salida es la de siempre en estos casos: leer por tramos, uno detrás de otro. Cada tramo corta
 * por el límite natural más cercano —párrafo, luego oración, luego pausa (coma, punto y coma, dos
 * puntos) y, en último caso, espacio— para que la voz no parta una frase donde no hay pausa.
 *
 * Función pura: sin DOM, sin voces, sin estado. Lo que se lee es exactamente el texto de entrada,
 * repartido: ningún carácter visible se pierde ni se inventa.
 */

/** Tamaño máximo de un tramo. Unos 12–15 s de lectura a velocidad normal: debajo del corte de Chromium. */
export const SPEECH_CHUNK_MAX = 180;

/** Corta `text` en el último límite natural antes de `max`. Devuelve [cabeza, resto]. */
function cutAt(text: string, max: number): [string, string] {
  const window = text.slice(0, max + 1);
  // Por orden de preferencia: fin de oración, pausa, espacio.
  for (const re of [/[.!?…](?=\s)/g, /[,;:—](?=\s)/g, /\s/g]) {
    let last = -1;
    for (const m of window.matchAll(re)) last = (m.index ?? -1) + m[0].length;
    if (last > 0) return [text.slice(0, last).trim(), text.slice(last).trim()];
  }
  // Una sola «palabra» más larga que el máximo (una URL, por ejemplo): se corta en seco.
  return [text.slice(0, max).trim(), text.slice(max).trim()];
}

/**
 * Tramos listos para hablar, en orden. Un texto vacío devuelve `[]`.
 * Los párrafos nunca se funden: un salto de línea es una pausa que la voz tiene que respetar.
 */
export function splitForSpeech(text: string, max: number = SPEECH_CHUNK_MAX): string[] {
  const out: string[] = [];
  for (const paragraph of (text ?? '').split(/\n+/)) {
    let rest = paragraph.replace(/\s+/g, ' ').trim();
    while (rest.length > max) {
      const [head, tail] = cutAt(rest, max);
      if (head) out.push(head);
      rest = tail;
    }
    if (rest) out.push(rest);
  }
  return out;
}
