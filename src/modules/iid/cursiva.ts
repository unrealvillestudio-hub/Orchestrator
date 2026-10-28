/**
 * EL BOTÓN «CURSIVA» DEL EDITOR DEL CUERPO (Sam, 2026-10-28). Pone `*…*` alrededor de lo seleccionado, o lo
 * quita si ya estaba en cursiva, para no tener que recordar la marca. La marca la pintan los blogs, el artículo
 * de LinkedIn y la vista previa (`api/_marcasEnLinea.ts`); en las redes saldría con los asteriscos, y la vista
 * previa lo avisa. Bloque PURO: se prueba en `cursiva.test.ts`.
 */

export type Seleccion = { text: string; start: number; end: number };

/** ¿Lo que rodea la selección es una cursiva (un `*` a cada lado, que no forma parte de una negrita)? */
function rodeadaDeCursiva(t: string, a: number, b: number): boolean {
  return t[a - 1] === '*' && t[b] === '*' && t[a - 2] !== '*' && t[b + 1] !== '*';
}

/**
 * Alterna la cursiva de la selección. Los espacios de los bordes quedan FUERA de la marca, porque `* así*` no es
 * cursiva. Sin nada seleccionado no hace nada: no hay a qué ponerla.
 */
export function alternarCursiva(s: Seleccion): Seleccion {
  let { start, end } = s;
  const t = s.text;
  if (start > end) [start, end] = [end, start];
  while (start < end && /\s/.test(t[start])) start++;
  while (end > start && /\s/.test(t[end - 1])) end--;
  if (start === end) return s;
  if (rodeadaDeCursiva(t, start, end)) {
    return { text: t.slice(0, start - 1) + t.slice(start, end) + t.slice(end + 1), start: start - 1, end: end - 1 };
  }
  const sel = t.slice(start, end);
  if (sel.length > 1 && sel.startsWith('*') && sel.endsWith('*') && !sel.startsWith('**') && !sel.endsWith('**')) {
    return { text: t.slice(0, start) + sel.slice(1, -1) + t.slice(end), start, end: end - 2 };
  }
  return { text: `${t.slice(0, start)}*${sel}*${t.slice(end)}`, start: start + 1, end: end + 1 };
}

export const CURSIVA_AYUDA =
  'Cursiva: selecciona el texto y toca el botón (o escribe *así*). Se ve en cursiva en los artículos del blog y en '
  + 'el artículo de LinkedIn; en las redes saldría con los asteriscos, y la vista previa lo avisa.';
