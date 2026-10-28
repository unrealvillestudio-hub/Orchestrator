/**
 * EL BOTÓN «CURSIVA» (Sam, 2026-10-28). Pone la marca de cursiva alrededor de lo seleccionado, o la quita si ya estaba,
 * para no tener que recordarla. En el cuerpo de la pieza la marca es `*…*`; en el texto de la imagen es `_…_`, porque
 * ahí `*…*` ya es el resaltado. La del cuerpo la pintan los blogs, el artículo de LinkedIn y la vista previa
 * (`api/_marcasEnLinea.ts`); en las redes saldría con los asteriscos, y la vista previa lo avisa. La de la imagen la
 * pinta el compositor (ImageLab ≥ 1.18.0). Bloque PURO: se prueba en `cursiva.test.ts`.
 */

export type Seleccion = { text: string; start: number; end: number };

export type MarcaCursiva = '*' | '_';

/** ¿Lo que rodea la selección es una cursiva (una marca a cada lado, que no forma parte de una doble)? */
function rodeadaDeCursiva(t: string, a: number, b: number, m: MarcaCursiva): boolean {
  return t[a - 1] === m && t[b] === m && t[a - 2] !== m && t[b + 1] !== m;
}

/**
 * Alterna la cursiva de la selección. Los espacios de los bordes quedan FUERA de la marca, porque `* así*` no es
 * cursiva. Sin nada seleccionado no hace nada: no hay a qué ponerla.
 */
export function alternarCursiva(s: Seleccion, m: MarcaCursiva = '*'): Seleccion {
  let { start, end } = s;
  const t = s.text;
  if (start > end) [start, end] = [end, start];
  while (start < end && /\s/.test(t[start])) start++;
  while (end > start && /\s/.test(t[end - 1])) end--;
  if (start === end) return s;
  if (rodeadaDeCursiva(t, start, end, m)) {
    return { text: t.slice(0, start - 1) + t.slice(start, end) + t.slice(end + 1), start: start - 1, end: end - 1 };
  }
  const sel = t.slice(start, end);
  if (sel.length > 1 && sel.startsWith(m) && sel.endsWith(m) && !sel.startsWith(m + m) && !sel.endsWith(m + m)) {
    return { text: t.slice(0, start) + sel.slice(1, -1) + t.slice(end), start, end: end - 2 };
  }
  return { text: `${t.slice(0, start)}${m}${sel}${m}${t.slice(end)}`, start: start + 1, end: end + 1 };
}

export const CURSIVA_AYUDA =
  'Cursiva: selecciona el texto y toca el botón (o escribe *así*). Se ve en cursiva en los artículos del blog y en '
  + 'el artículo de LinkedIn; en las redes saldría con los asteriscos, y la vista previa lo avisa.';
