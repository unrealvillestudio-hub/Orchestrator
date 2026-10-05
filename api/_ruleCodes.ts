/**
 * UNRLVL Orchestrator — api/_ruleCodes.ts  (CHIP DE REGLA · bloque PURO)
 *
 * Sam, 2026-10-05: en cualquier sitio de las bandejas donde aparece un código de regla —por
 * ejemplo «Auto-fix (1 intento): corrigió HR-XXX-05, HR-XXX-16»—, pasar el ratón por encima
 * muestra qué dice esa regla.
 *
 * Este módulo es PURO (sin red, sin DB, sin dependencias) y lo importan los dos lados: el server
 * (`_challengedShared.ts`, `calibration-queue.ts`, `challenged-queue.ts`) y la interfaz
 * (`src/modules/iid/RuleText.tsx`). Una sola regex para reconocer un código y un solo filtro de
 * marca: si cada lado tuviera el suyo, el chip y el dato podrían divergir.
 *
 * MULTIMARCA. El prefijo `HR`/`IMG` y la forma `-[A-Z]+-NN` son el contrato del CÓDIGO de regla
 * (`intel.watcher_rules.code`, las 66 filas lo cumplen [medido el 2026-10-05]). Qué marca es dueña de
 * cada regla es DATO (`watcher_rules.brand_id`) y se filtra aquí sin nombrar ninguna: una marca N+1
 * entra con sus filas y su segmento propio en el código, sin tocar este archivo.
 */

/** Forma de un código de regla dentro de un texto. Bordes explícitos: `XHR-A-01` o `HR-A-012` no son códigos. */
export const RULE_CODE_PATTERN = '(?<![A-Za-z0-9-])(?:HR|IMG)-[A-Z]+-[0-9]{2}(?![A-Za-z0-9-])';

/** Una regex nueva por llamada: con la bandera `g`, compartir la instancia comparte `lastIndex`. */
function ruleCodeRe(): RegExp {
  return new RegExp(RULE_CODE_PATTERN, 'g');
}

/** Un trozo de texto: literal, o un código de regla. */
export type RuleToken = { t: 'text'; v: string } | { t: 'code'; v: string };

/**
 * Parte un texto en literales y códigos, en orden. Unir los `v` devuelve el texto original, byte a
 * byte. `FIXABLE-PROPUESTA` y cualquier otro pseudo-código no tienen la forma y quedan como texto.
 */
export function tokenizeRuleText(text: string | null | undefined): RuleToken[] {
  const s = String(text ?? '');
  const out: RuleToken[] = [];
  let last = 0;
  for (const m of s.matchAll(ruleCodeRe())) {
    const i = m.index ?? 0;
    if (i > last) out.push({ t: 'text', v: s.slice(last, i) });
    out.push({ t: 'code', v: m[0] });
    last = i + m[0].length;
  }
  if (last < s.length) out.push({ t: 'text', v: s.slice(last) });
  return out;
}

/** Los códigos distintos que aparecen en un texto, en orden de aparición. */
export function codesIn(text: string | null | undefined): string[] {
  return Array.from(new Set(tokenizeRuleText(text).filter((k) => k.t === 'code').map((k) => k.v)));
}

/** Lo que el chip enseña de una regla. Sólo el enunciado: `instruction` no viaja (Sam, 2026-10-05). */
export interface RuleText {
  statement: string;
  severity: string | null;
}

/** Una fila de `intel.watcher_rules` en la forma que se lee. */
export interface RuleTextRow extends RuleText {
  code: string;
  brand_id: string | null;
}

/** Mapa código → enunciado. Lo que viaja en las respuestas de las bandejas como `rule_texts`. */
export type RuleTexts = Record<string, RuleText>;

/**
 * EL FILTRO DE MARCA. De las filas leídas, sólo las de la marca de la pieza y las generales
 * (`brand_id` nulo). Una regla de otra marca NUNCA llega a la pieza de una marca, aunque su código
 * aparezca en el texto. Si hubiera una regla de marca y una general con el mismo código, gana la de
 * la marca: es la más específica.
 */
export function ruleTextsForBrand(rows: readonly RuleTextRow[] | null | undefined, brandId: string | null | undefined): RuleTexts {
  const out: RuleTexts = {};
  const brand = typeof brandId === 'string' ? brandId : '';
  const propias: RuleTextRow[] = [];
  for (const r of rows ?? []) {
    if (!r || typeof r.code !== 'string' || typeof r.statement !== 'string' || !r.statement.trim()) continue;
    if (r.brand_id === null || r.brand_id === undefined) out[r.code] = { statement: r.statement, severity: r.severity ?? null };
    else if (brand && r.brand_id === brand) propias.push(r);
  }
  for (const r of propias) out[r.code] = { statement: r.statement, severity: r.severity ?? null };
  return out;
}

/** Los códigos que aparecen en un valor cualquiera (un objeto de respuesta entero). */
export function codesInValue(value: unknown): string[] {
  try {
    return codesIn(JSON.stringify(value ?? null));
  } catch {
    return [];
  }
}

/**
 * La primera frase del enunciado, para el aviso al pasar el ratón. Corta en el primer `.`, `?` o
 * `!` seguido de espacio; si no hay, o si la frase es muy larga, corta en `max` caracteres con `…`.
 */
export function firstSentence(statement: string | null | undefined, max = 180): string {
  const s = String(statement ?? '').replace(/\s+/g, ' ').trim();
  const m = /^(.+?[.?!])(?:\s|$)/.exec(s);
  const frase = m ? m[1] : s;
  return frase.length > max ? `${frase.slice(0, max - 1).trimEnd()}…` : frase;
}

/**
 * Lo que viaja con UNA pieza: el filtro de marca de `ruleTextsForBrand`, recortado a los códigos
 * que aparecen en ella. Un código sin enunciado para esa marca no viaja, y el chip lo deja como texto.
 */
export function ruleTextsFor(
  rows: readonly RuleTextRow[] | null | undefined,
  brandId: string | null | undefined,
  codes: readonly string[],
): RuleTexts {
  const deLaMarca = ruleTextsForBrand(rows, brandId);
  const out: RuleTexts = {};
  for (const c of codes) if (Object.prototype.hasOwnProperty.call(deLaMarca, c)) out[c] = deLaMarca[c];
  return out;
}
