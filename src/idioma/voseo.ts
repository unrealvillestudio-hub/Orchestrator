/**
 * VOSEO — DETECTOR MORFOLÓGICO PARA EL TEXTO DE ESTE REPO.
 *
 * LA REGLA. El ecosistema escribe en ES o EN neutro internacional, sin regionalismos y SIN VOSEO
 * (`unrlvl-context/protocols/DELIVERY_AND_VERIFICATION_RULE.md` §2-BIS). El motivo es operativo: el
 * imperativo voseante y el pretérito son homógrafos, y en una interfaz que da instrucciones el lector
 * no sabe si le piden algo o le informan de algo ya hecho.
 *
 * POR QUÉ MORFOLÓGICO Y NO UNA LISTA. Hasta el 2026-10-20 la UI se vigilaba con dos listas cerradas
 * de formas, y las dos fallaban de dos maneras [medido el 2026-10-20]:
 *   1 · cubrían sólo las formas que alguien había visto, y la UI tenía otras treinta;
 *   2 · usaban `\b`, que en JavaScript sólo conoce letras ASCII: una forma que termina en vocal
 *       acentuada nunca casaba, así que la mitad de cada lista no vigilaba nada.
 * Este detector caza la CLASE: toda palabra terminada en -á, -é, -í, -ás, -és o -ís (la marca
 * morfológica del voseo verbal), menos una lista blanca de palabras que no son voseo y menos los
 * futuros. Una lista blanca se completa sola con el uso; una lista de prohibidas, nunca.
 *
 * LO QUE NO CAZA, declarado (`ICR_CONTRACT.md` V-12: un patrón léxico por definición está
 * incompleto):
 *   · el imperativo voseante con pronombre pegado (no lleva tilde): sólo lo caza para los radicales
 *     de `RADICALES_CON_PRONOMBRE`;
 *   · algunas formas de verbos cuyo radical termina en -ar, -er o -ir, que se confunden con un
 *     futuro. Las más comunes se cubren con `RADICALES_AMBIGUOS`.
 *
 * Es la vigilancia del TEXTO DEL REPO. La del texto que se PUBLICA es otra y vive en la base
 * (`intel.watcher_rules`, HR-GEN-05, con barrera de publicación).
 */

/**
 * Palabras con la terminación del voseo que no son voseo. Se añaden aquí cuando una palabra legítima
 * dispara el test, con la condición de que no sea homógrafa de una orden voseante.
 */
export const PALABRAS_PERMITIDAS: ReadonlySet<string> = new Set([
  // adverbios, pronombres e interrogativos
  'qué', 'más', 'así', 'sí', 'aquí', 'ahí', 'allí', 'allá', 'después', 'además', 'demás', 'detrás',
  'atrás', 'jamás', 'quizás', 'través', 'revés', 'porqué', 'mí', 'sé', 'dé', 'té', 'ojalá',
  // formas de tuteo o de tercera persona que coinciden en terminación
  'está', 'estás', 'esté', 'estés',
  // pretérito de primera persona de verbos en -er, que no es homógrafo del imperativo voseante (-é)
  'entendí',
  // sustantivos y gentilicios
  'país', 'inglés', 'francés', 'portugués', 'japonés', 'interés', 'estrés', 'café', 'bebé', 'mamá',
  'papá', 'sofá', 'maní', 'açaí',
  // nombres propios usados en ejemplos y pruebas
  'tomás',
  // palabras de otro idioma en pruebas (francés)
  'adapté',
]);

/**
 * Radicales de verbos en -ar/-er cuyo imperativo voseante se confunde con un futuro (mir-á frente a
 * un futuro de «mir»). No son formas voseantes: son raíces, y el detector les pega la terminación.
 */
const RADICALES_AMBIGUOS = [
  'mir', 'esper', 'declar', 'gener', 'consider', 'oper', 'prepar', 'separ', 'compar',
  'aclar', 'admir', 'retir', 'tir', 'gir', 'super', 'recuper', 'toler', 'moder', 'aceler', 'liber',
  'exager', 'numer', 'enumer', 'alter', 'quer',
];
const FORMAS_DE_RADICAL_AMBIGUO = new Set(
  RADICALES_AMBIGUOS.flatMap((r) => [`${r}á`, `${r}ás`, `${r}é`, `${r}és`]),
);

/**
 * Imperativo voseante con pronombre pegado. No lleva tilde, así que no tiene marca morfológica: en
 * neutro la misma orden sí la lleva (la forma de tú acentúa la sílaba del radical). Se arma con
 * radical + vocal temática + pronombre, sólo para radicales de verbos que la interfaz usa al dar
 * instrucciones; un radical genérico daría falsos positivos con sustantivos comunes.
 */
const RADICALES_CON_PRONOMBRE: Array<[string, string]> = [
  ['aprob', 'a'], ['rechaz', 'a'], ['fij', 'a'], ['remat', 'a'], ['oper', 'a'], ['avis', 'a'],
  ['dej', 'a'], ['mir', 'a'], ['revis', 'a'], ['us', 'a'], ['carg', 'a'], ['guard', 'a'],
  ['cop', 'ia'], ['peg', 'a'], ['toc', 'a'], ['sum', 'a'], ['pregunt', 'a'], ['solicit', 'a'],
  ['llev', 'a'], ['qued', 'a'], ['acord', 'a'], ['cont', 'a'], ['prob', 'a'], ['pon', 'e'],
  ['hac', 'e'], ['dec', 'i'], ['ped', 'i'], ['sub', 'i'], ['abr', 'i'], ['eleg', 'i'],
];
const PRONOMBRES = ['lo', 'la', 'los', 'las', 'le', 'les', 'me', 'te', 'nos'];
const FORMAS_CON_PRONOMBRE = new Set(
  RADICALES_CON_PRONOMBRE.flatMap(([r, v]) => PRONOMBRES.map((pr) => r + v + pr)),
);

/** Futuro: infinitivo + -á / -ás / -é, o raíz irregular (podr-, querr-, sabr-, har-, dir-…). */
function esFuturo(p: string): boolean {
  const m = p.match(/^(.*)(á|ás|é)$/u);
  if (m && /(ar|er|ir)$/u.test(m[1]) && m[1].length >= 4) return true;
  if (/(dr|rr|br)(á|ás|é)$/u.test(p)) return true;
  return /^(ser|ir|dar|ver|har|dir)(á|ás|é)$/u.test(p);
}

// Las dos formas se escriben por partes para que este archivo pase su propio barrido.
const PRONOMBRE_VOSEANTE = 'v' + 'os';
/** Léxico regional con equivalente neutro (V-12). */
const REGIONALISMOS = new Set(['ac' + 'á']);

/**
 * Devuelve las formas voseantes o regionales encontradas en el texto, en el orden en que aparecen.
 * Una lista vacía quiere decir que el texto está limpio.
 */
export function formasVoseantes(texto: string): string[] {
  // `\n` escrito dentro de una cadena pegaría la «n» a la palabra siguiente.
  const limpio = texto.replace(/\\[nrt]/g, ' ');
  const hallazgos: string[] = [];
  for (const m of limpio.matchAll(/\p{L}+/gu)) {
    const palabra = m[0];
    const p = palabra.toLowerCase();
    if (p === PRONOMBRE_VOSEANTE || REGIONALISMOS.has(p) || FORMAS_DE_RADICAL_AMBIGUO.has(p) || FORMAS_CON_PRONOMBRE.has(p)) {
      hallazgos.push(palabra);
      continue;
    }
    if (!/\p{L}(á|é|í|ás|és|ís)$/u.test(p)) continue;
    if (PALABRAS_PERMITIDAS.has(p) || esFuturo(p)) continue;
    hallazgos.push(palabra);
  }
  return hallazgos;
}
