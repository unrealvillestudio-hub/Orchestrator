/**
 * «VERIFICAR FORMATO» (Sam, 2026-10-28) — en lugar del botón «Cursiva».
 *
 * Sam, sobre la pieza 23698205: «yo lo escribo bien y se cambia solo y pierde el formato, entonces para qué es el botón
 * de cursiva; en vez de eso, pon un botón que verifica el text format para que salga correctamente». El botón lee lo
 * escrito con las mismas reglas que el envío, lo deja escrito de una sola manera y enseña cómo va a salir antes de
 * mandarlo: cada tramo resaltado, en cursiva o con la sombra al revés, o el error exacto si algo no cierra.
 *
 * Lo que deja igual que se publica (y por eso lo hace también el envío, se toque o no el botón):
 *   · las marcas pegadas al texto que marcan (`* así*` → `*así*`), anidadas y nunca cruzadas;
 *   · sin espacio antes de un signo de cierre (`sí .` → `sí.`), que es como quedó guardada esa bajada.
 *
 * Este módulo es PURO. MULTIMARCA: cero marcas; el color del resaltado lo pone quien lo pinta.
 */

import { overlayMarkupOf, parseOverlayMarkup } from './_overlayText.js';
import { parseSubMarkup } from './_textStyle.js';
import { hasInlineMarks, inlineMarksToHtml, stripInlineMarks } from './_marcasEnLinea.js';

/** Un trozo del texto con lo que lleva. */
export interface TramoVisto { text: string; resaltado: boolean; cursiva: boolean; sombra: boolean;
  /** 2026-10-30 — `*así*`: sólo el color del resaltado, sin su letra. */
  color: boolean }

export type VerificacionImagen =
  | { ok: true; markup: string; text: string; emphasis: string[]; shadow_spans: string[]; italic_spans: string[]; color_spans: string[];
      tramos: TramoVisto[]; cambios: string[] }
  | { ok: false; error: string };

const ANTES_DE_CIERRE = /[ \t]+([.,;:!?»)\]…])/g;

/** Los rangos de cada tramo, con la misma regla que el compositor: la primera aparición que no se pisa. PURO. */
function rangosDe(texto: string, terms: readonly string[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const t of [...terms].sort((a, b) => b.length - a.length)) {
    let from = 0;
    for (;;) {
      const i = t ? texto.indexOf(t, from) : -1;
      if (i < 0) break;
      if (!out.some(([a, b]) => i < b && i + t.length > a)) { out.push([i, i + t.length]); break; }
      from = i + 1;
    }
  }
  return out;
}

/** El texto partido en trozos con lo que lleva cada uno: lo que la vista previa pinta. PURO. */
export function tramosDe(texto: string, emphasis: readonly string[], shadow: readonly string[], italic: readonly string[],
  color: readonly string[] = []): TramoVisto[] {
  const en = (r: Array<[number, number]>, i: number) => r.some(([a, b]) => i >= a && i < b);
  const re = rangosDe(texto, emphasis), so = rangosDe(texto, shadow), cu = rangosDe(texto, italic), co = rangosDe(texto, color);
  const out: TramoVisto[] = [];
  for (let i = 0; i < texto.length; i++) {
    const f = { resaltado: en(re, i), cursiva: en(cu, i), sombra: en(so, i), color: en(co, i) };
    const last = out[out.length - 1];
    if (last && last.resaltado === f.resaltado && last.cursiva === f.cursiva && last.sombra === f.sombra && last.color === f.color) last.text += texto[i];
    else out.push({ text: texto[i], ...f });
  }
  return out;
}

/**
 * El texto de la imagen (titular o bajada) tal como va a salir. Con un error, el error exacto; si no, el marcado
 * limpio y los trozos para la vista previa. La bajada vacía es válida (no lleva bajada). PURO.
 */
export function verificarTextoImagen(markup: string, bloque: 'titular' | 'bajada'): VerificacionImagen {
  const p = bloque === 'titular' ? parseOverlayMarkup(markup) : parseSubMarkup(markup);
  if (!p.ok) return { ok: false, error: p.error };
  const crudo = 'headline' in p ? p.headline : (p.sub ?? '');
  const text = crudo.replace(ANTES_DE_CIERRE, '$1');
  const cambios: string[] = [];
  if (text !== crudo) cambios.push('Se quitó el espacio antes de un signo de cierre.');
  const keep = (xs: string[]) => xs.filter((t) => text.includes(t));
  const emphasis = keep(p.emphasis), shadow_spans = keep(p.shadow_spans), italic_spans = keep(p.italic_spans), color_spans = keep(p.color_spans);
  const limpio = overlayMarkupOf(text, emphasis, shadow_spans, italic_spans, color_spans);
  const escrito = String(markup ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  if (limpio !== escrito && !cambios.length) cambios.push('Las marcas quedaron pegadas al texto que marcan.');
  return { ok: true, markup: limpio, text, emphasis, shadow_spans, italic_spans, color_spans,
    tramos: tramosDe(text, emphasis, shadow_spans, italic_spans, color_spans), cambios };
}

/** El cuerpo de la pieza tal como lo pintan el blog y el artículo: negrita y cursiva, y lo que no va a salir. PURO. */
export function verificarCuerpo(texto: string): { html: string; avisos: string[] } {
  const t = String(texto ?? '');
  const esc = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const avisos: string[] = [];
  const sueltos = stripInlineMarks(t).split('\n').filter((l) => /\*/.test(l)).map((l) => l.trim()).slice(0, 3);
  if (sueltos.length) {
    avisos.push(`Hay asteriscos que no forman negrita ni cursiva y saldrán tal cual: ${sueltos.map((l) => `«${l.length > 60 ? `${l.slice(0, 60)}…` : l}»`).join(', ')}. `
      + 'La marca va pegada al texto: *así* o **así**.');
  }
  if (hasInlineMarks(t)) {
    avisos.push('La negrita y la cursiva se ven en los artículos del blog y en el de LinkedIn; en las redes saldrían con los asteriscos.');
  }
  return { html: inlineMarksToHtml(esc), avisos };
}

/**
 * LA SOMBRA QUE DE VERDAD LLEVA CADA TROZO (Sam, 2026-10-28, pieza 23698205: «la sombra solo se aplica a la primera
 * línea en la bajada»). `~así~` no pone sombra: la INVIERTE respecto del bloque. Con «Con sombra», lo marcado sale sin
 * ella; con «Sin sombra», sale con ella. Medido en `intel.piece_edits` de esa pieza: la bajada tenía «Sin sombra» con
 * `~El contrato sí~` (sólo ese tramo con sombra); al pasarla a «Con sombra», el tramo quedó como el único sin sombra.
 * `null` = la de la marca: depende del fondo, y la vista previa no lo puede saber. PURO.
 */
export type ModoSombra = 'on' | 'off' | null;

export function sombraEfectiva(t: Pick<TramoVisto, 'sombra'>, modo: ModoSombra): boolean | null {
  if (modo === 'on') return !t.sombra;
  if (modo === 'off') return t.sombra;
  return null;
}

/** Lo que conviene saber de los tramos con `~` según la sombra del bloque; nada si no hay tramos o no se sabe. PURO. */
export function avisoSombra(modo: ModoSombra, shadow_spans: readonly string[]): string | null {
  if (!shadow_spans.length || modo === null) return null;
  const lista = shadow_spans.map((t) => `«${t}»`).join(', ');
  return modo === 'on'
    ? `Con «Con sombra», lo marcado con ~ sale SIN sombra: ${lista}. Si lo quiere con sombra, quite las ~.`
    : `Con «Sin sombra», lo marcado con ~ es lo único que sale CON sombra: ${lista}.`;
}
