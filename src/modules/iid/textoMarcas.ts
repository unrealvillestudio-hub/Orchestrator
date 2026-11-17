/**
 * textoMarcas.ts — LAS MARCAS POR PALABRA DEL TEXTO EN PANTALLA (2026-11-17). Lógica pura, sin React.
 *
 * Quien edita toca palabras y les pone una marca: resaltado (`emphasis`), cursiva (`italic_spans`), negrita
 * (`bold_spans`) o color (`color_spans`). El contrato de VideoLab (v1.4.0 §4 ter.5, el mismo vocabulario que ImageLab)
 * recibe TRAMOS LITERALES: coincidencia exacta, primera aparición, hasta 3 por campo de hasta 60 caracteres. Aquí se
 * traduce entre las dos formas: palabras marcadas ⇄ tramos. La pantalla enseña lo que VideoLab hará de verdad (primera
 * aparición), no lo que se tocó.
 *
 * Ni una marca, ni un color, ni un estilo con nombre propio en este archivo.
 */

export type MarkKind = 'emphasis' | 'italic_spans' | 'bold_spans' | 'color_spans';
export const MARK_KINDS: readonly MarkKind[] = ['emphasis', 'italic_spans', 'bold_spans', 'color_spans'];
/** Cómo se escribe cada marca en el marcado del editor de imagen (`api/_textStyle.ts`), para enseñarlo igual aquí. */
export const MARK_SYMBOL: Record<MarkKind, [string, string]> = {
  emphasis: ['^', '^'], italic_spans: ['_', '_'], bold_spans: ['+', '+'], color_spans: ['*', '*'],
};
export const MARK_LABEL: Record<MarkKind, string> = {
  emphasis: 'Resaltado', italic_spans: 'Cursiva', bold_spans: 'Negrita', color_spans: 'Color',
};
export const SPANS_MAX = 3;
export const SPAN_CHARS_MAX = 60;

export type BlockMarks = Partial<Record<MarkKind, string[]>>;

/** Las palabras del texto con su posición: lo que se separa por espacios. PURO. */
export function wordRanges(text: string): Array<{ word: string; start: number; end: number }> {
  const out: Array<{ word: string; start: number; end: number }> = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ word: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

/** Qué marcas lleva cada palabra según los tramos, con la regla de VideoLab: cada tramo marca su PRIMERA aparición. PURO. */
export function marksByWord(text: string, marks: BlockMarks): Array<Set<MarkKind>> {
  const ws = wordRanges(text);
  const out = ws.map(() => new Set<MarkKind>());
  for (const k of MARK_KINDS) {
    for (const span of marks[k] ?? []) {
      const at = span ? text.indexOf(span) : -1;
      if (at < 0) continue;
      const fin = at + span.length;
      ws.forEach((w, i) => { if (w.start < fin && w.end > at) out[i].add(k); });
    }
  }
  return out;
}

/** Los tramos de una marca a partir de las palabras que la llevan: cada racha seguida de palabras, un tramo. PURO. */
export function spansFromWords(text: string, marked: boolean[]): string[] {
  const ws = wordRanges(text);
  const out: string[] = [];
  let i = 0;
  while (i < ws.length) {
    if (!marked[i]) { i++; continue; }
    let j = i;
    while (j + 1 < ws.length && marked[j + 1]) j++;
    out.push(text.slice(ws[i].start, ws[j].end));
    i = j + 1;
  }
  return out;
}

/**
 * Pone o quita una marca en las palabras elegidas. Si TODAS las elegidas ya la llevan, se quita; si no, se pone en todas.
 * Devuelve las marcas nuevas, o el motivo por el que no se puede (más de 3 tramos, o un tramo de más de 60 caracteres):
 * se dice antes de mandar, en vez de que VideoLab lo rechace. PURO.
 */
export function toggleMark(text: string, marks: BlockMarks, kind: MarkKind, selected: number[]):
  { ok: true; marks: BlockMarks } | { ok: false; reason: string } {
  const actuales = marksByWord(text, marks).map((s) => s.has(kind));
  if (!selected.length) return { ok: true, marks };
  const todas = selected.every((i) => actuales[i]);
  const nuevas = actuales.slice();
  for (const i of selected) if (i >= 0 && i < nuevas.length) nuevas[i] = !todas;
  const spans = spansFromWords(text, nuevas);
  if (spans.length > SPANS_MAX) return { ok: false, reason: `${MARK_LABEL[kind]}: como mucho ${SPANS_MAX} tramos por bloque. Une palabras seguidas o quita una marca.` };
  const largo = spans.find((s) => s.length > SPAN_CHARS_MAX);
  if (largo) return { ok: false, reason: `${MARK_LABEL[kind]}: un tramo pasa de ${SPAN_CHARS_MAX} caracteres. Marca menos palabras seguidas.` };
  const out: BlockMarks = { ...marks };
  if (spans.length) out[kind] = spans; else delete out[kind];
  return { ok: true, marks: out };
}

/** El texto con el marcado del editor de imagen (`^resaltado^ _cursiva_ +negrita+ *color*`), para enseñar cómo queda. PURO. */
export function markupOf(text: string, marks: BlockMarks): string {
  const ws = wordRanges(text);
  const porPalabra = marksByWord(text, marks);
  return ws.map((w, i) => {
    let s = w.word;
    for (const k of MARK_KINDS) if (porPalabra[i].has(k)) s = MARK_SYMBOL[k][0] + s + MARK_SYMBOL[k][1];
    return s;
  }).join(' ');
}

/** Quita los tramos que ya no están en el texto (quien edita cambió el texto después de marcar). PURO. */
export function pruneMarks(text: string, marks: BlockMarks): BlockMarks {
  const out: BlockMarks = {};
  for (const k of MARK_KINDS) {
    const vivos = (marks[k] ?? []).filter((s) => s && text.includes(s));
    if (vivos.length) out[k] = vivos;
  }
  return out;
}

/** Contraste WCAG de un color sobre un video oscuro (luminancia de referencia 0,03). Bajo 3 se lee mal como texto. PURO. */
export function contrastOnDark(hex: string): number {
  const n = parseInt(String(hex).replace('#', ''), 16);
  if (!Number.isFinite(n)) return 0;
  const c = [16, 8, 0].map((s) => { const v = ((n >> s) & 255) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return (l + 0.05) / (0.03 + 0.05);
}

/** Qué porcentaje de las palabras dichas va marcado como palabra clave (lo recomendado: 5–15 %). PURO. */
export function keywordShare(words: string[], keywords: string[]): number {
  if (!words.length) return 0;
  const set = new Set(keywords.map((k) => k.toLocaleLowerCase()));
  const limpia = (w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLocaleLowerCase();
  return Math.round((words.filter((w) => set.has(limpia(w))).length / words.length) * 100);
}

/**
 * El marcado escrito a mano en el texto (`^resaltado^ _cursiva_ +negrita+ *color*`, el mismo del editor de imagen)
 * pasa a marcas: quita los símbolos de cada par COMPLETO y deja el texto limpio. Un símbolo sin su pareja se queda
 * tal cual (quien escribe todavía no cerró el tramo). Los tramos vacíos no cuentan. PURO.
 */
export function parseMarkup(text: string): { text: string; marks: BlockMarks } {
  let limpio = text;
  const marks: BlockMarks = {};
  for (const k of MARK_KINDS) {
    const [a] = MARK_SYMBOL[k];
    const esc = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${esc}([^${esc.replace(/\\/g, '\\\\')}\\n]+?)${esc}`, 'g');
    const tramos: string[] = [];
    limpio = limpio.replace(re, (_m, dentro: string) => { const t = dentro.trim(); if (t) tramos.push(t); return dentro; });
    if (tramos.length) marks[k] = tramos;
  }
  return { text: limpio, marks };
}

/** Une marcas nuevas a las que ya había (sin repetir tramos). PURO. */
export function mergeMarks(base: BlockMarks, extra: BlockMarks): BlockMarks {
  const out: BlockMarks = { ...base };
  for (const k of MARK_KINDS) {
    if (!extra[k]?.length) continue;
    out[k] = [...new Set([...(base[k] ?? []), ...extra[k]!])];
  }
  return out;
}
