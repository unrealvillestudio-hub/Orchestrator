/**
 * UNRLVL Orchestrator — api/_pieceSearch.ts  (U-7 · y desde el 2026-10-06, VARIAS piezas a la vez)
 *
 * QUÉ SE BUSCA Y CÓMO, cuando Sam pega ids de pieza en una bandeja. Módulo PURO: no lee la red, no
 * lee `process.env` y no sabe de qué bandeja viene. Por eso lo importan las cuatro bandejas del
 * server Y la caja de búsqueda del front: un solo parser, y lo que la caja acepta es exactamente lo
 * que el server acepta.
 *
 * ── LA PETICIÓN (Sam, 2026-10-06) ─────────────────────────────────────────────────
 * «En todas sus tabs de evaluación incluyendo Historial quiero poder filtrar por número de pieza por
 * varias piezas a la vez separadas por coma o como quieras, por ejemplo 4f13cc52, 6bb3ebc0, …»
 *
 * ── QUÉ ACEPTA ────────────────────────────────────────────────────────────────────
 * Uno o varios ids, separados por coma, punto y coma, espacio o salto de línea (o cualquier mezcla).
 * Cada uno puede ser:
 *   · un uuid completo → coincidencia EXACTA;
 *   · un prefijo de al menos `SEARCH_MIN_PREFIX` caracteres hexadecimales (los guiones no cuentan)
 *     → coincidencia por PREFIJO.
 * Mayúsculas y minúsculas dan igual. Los repetidos se quitan.
 *
 * ── EL MÍNIMO SUBE DE 4 A 8, Y POR QUÉ ────────────────────────────────────────────
 * Con un solo id, un prefijo de 4 era tolerable. Con varios a la vez, cada término corto suma
 * coincidencias ajenas, y en una lista de diez ids nadie ve que uno de ellos trajo tres piezas.
 * 8 es lo que pinta la tarjeta (`pieceUi.shortId`) y lo que Sam copia: el mínimo coincide con lo que
 * ya circula, así que nadie pierde nada que hoy pegue.
 *
 * ── LO QUE UN TÉRMINO INVÁLIDO HACE ───────────────────────────────────────────────
 * Lanza, y el error NOMBRA los términos que fallan. Nunca se descarta en silencio: si de tres ids uno
 * está mal escrito y se ignorara, la lista enseñaría dos piezas y se leería como «la tercera no
 * existe», que es la mentira que este módulo existe para no decir.
 */

export type SearchMode = 'uuid' | 'prefix';

/** Un id de los que se pegaron, ya normalizado. */
export interface PieceSearchTerm {
  /** El término normalizado (minúsculas, sin espacios). Es lo que la pantalla repite. */
  q: string;
  mode: SearchMode;
  /** uuid completo: coincidencia exacta. */
  exact: string | null;
  /** Prefijo en minúsculas, para comparar contra el id también en minúsculas. */
  prefix: string | null;
}

export interface PieceSearch {
  /** Los términos unidos por `, `. Viaja a la respuesta para que la UI lo pueda repetir. */
  q: string;
  /**
   * `uuid` sólo si TODOS los términos son uuid completos; basta un prefijo para que sea `prefix`.
   * Es lo que decide si el aviso de lote cortado aplica: un uuid completo no depende del lote.
   */
  mode: SearchMode;
  terms: PieceSearchTerm[];
}

/** Mínimo de caracteres hexadecimales de un prefijo. Es el largo que pinta la tarjeta. */
export const SEARCH_MIN_PREFIX = 8;

/**
 * Tope de términos por búsqueda. No es un límite de rendimiento —filtrar en memoria es barato—: es
 * que una lista más larga deja de ser «estas piezas» y pasa a ser una exportación, y la URL de un GET
 * tiene techo. Superarlo es un 400 que lo dice, no un recorte silencioso.
 */
export const SEARCH_MAX_TERMS = 50;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Un prefijo puede traer guiones si Sam pegó parte de un uuid con formato. */
const PREFIX_RE = /^[0-9a-f-]+$/;
/** Separadores aceptados entre ids: coma, punto y coma y cualquier espacio (salto de línea incluido). */
const SEPARATORS = /[\s,;]+/;

/** Error tipado para «uno o más prefijos son demasiado cortos». El endpoint lo traduce a 400. */
export class SearchTooShort extends Error {
  /** `q` = los términos que fallan, unidos por `, `. */
  constructor(public q: string, public terms: string[] = [q]) {
    super(`search prefix too short: need at least ${SEARCH_MIN_PREFIX} characters (${q})`);
    this.name = 'SearchTooShort';
  }
}

/** Error tipado para «esto no se parece a un id». También 400: buscar texto libre no existe. */
export class SearchNotAnId extends Error {
  constructor(public q: string, public terms: string[] = [q]) {
    super(`search must be piece ids or prefixes of them (${q})`);
    this.name = 'SearchNotAnId';
  }
}

/** Error tipado para «demasiados ids a la vez». 400. */
export class SearchTooMany extends Error {
  constructor(public count: number) {
    super(`too many ids in one search: ${count} (max ${SEARCH_MAX_TERMS})`);
    this.name = 'SearchTooMany';
  }
}

/** Parte la entrada en términos normalizados, sin repetidos y en el orden en que llegaron. */
export function splitSearchTerms(raw: unknown): string[] {
  const text = typeof raw === 'string' ? raw : Array.isArray(raw) && typeof raw[0] === 'string' ? raw[0] : '';
  const out: string[] = [];
  for (const t of text.toLowerCase().split(SEPARATORS)) {
    const v = t.trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * QUÉ SE BUSCA Y CÓMO.
 *
 * `null` = no se buscó nada (parámetro ausente o vacío), que NO es lo mismo que buscar y no
 * encontrar. Lanza cuando algún término no se puede resolver, en vez de devolver una lista vacía
 * que se leería como «no existe», y el error lleva los términos que fallan.
 */
export function parsePieceSearch(raw: unknown): PieceSearch | null {
  const words = splitSearchTerms(raw);
  if (!words.length) return null;
  if (words.length > SEARCH_MAX_TERMS) throw new SearchTooMany(words.length);

  const noId = words.filter((w) => !UUID_RE.test(w) && !PREFIX_RE.test(w));
  if (noId.length) throw new SearchNotAnId(noId.join(', '), noId);
  // Los guiones no cuentan como longitud: `5b14-caa` son 7 caracteres de id, no 8.
  const cortos = words.filter((w) => !UUID_RE.test(w) && w.replace(/-/g, '').length < SEARCH_MIN_PREFIX);
  if (cortos.length) throw new SearchTooShort(cortos.join(', '), cortos);

  const terms: PieceSearchTerm[] = words.map((w) => UUID_RE.test(w)
    ? { q: w, mode: 'uuid', exact: w, prefix: null }
    : { q: w, mode: 'prefix', exact: null, prefix: w });
  return {
    q: terms.map((t) => t.q).join(', '),
    mode: terms.every((t) => t.mode === 'uuid') ? 'uuid' : 'prefix',
    terms,
  };
}

/** ¿Este id cae en ESTE término? En minúsculas los dos lados. */
export function idMatchesTerm(id: string | null | undefined, term: PieceSearchTerm): boolean {
  const v = (id ?? '').toLowerCase();
  if (!v) return false;
  if (term.exact) return v === term.exact;
  return !!term.prefix && v.startsWith(term.prefix);
}

/**
 * ¿Este id cae en la búsqueda? Basta con que coincida con UNO de los términos. En minúsculas los dos
 * lados: un uuid de Postgres llega en minúsculas, pero lo que Sam pega puede venir de cualquier sitio.
 */
export function idMatchesSearch(id: string | null | undefined, search: PieceSearch | null): boolean {
  if (!search) return true; // sin búsqueda, no se filtra nada.
  return search.terms.some((t) => idMatchesTerm(id, t));
}

/**
 * LOS TÉRMINOS QUE NO ENCONTRARON NADA en el conjunto que la bandeja enseña. Es la otra mitad de
 * buscar varias piezas: sin esto, pegar diez ids y ver ocho tarjetas obliga a cotejar a mano cuáles
 * faltan. Se calcula sobre el resultado FINAL, con todos los filtros puestos, porque es lo que la
 * pantalla enseña.
 */
export function unmatchedTerms(ids: Iterable<string | null | undefined>, search: PieceSearch | null): string[] {
  if (!search) return [];
  const lista = [...ids];
  return search.terms.filter((t) => !lista.some((id) => idMatchesTerm(id, t))).map((t) => t.q);
}

/**
 * Lo que la respuesta de una bandeja dice de la búsqueda. Una sola forma para las cuatro, para que la
 * pantalla lo pinte con un solo componente.
 *   · `terms`    — los ids buscados, normalizados;
 *   · `matched`  — cuántas filas devolvió la búsqueda con los filtros puestos (antes de paginar);
 *   · `missing`  — los ids que no encontraron nada;
 *   · `truncated`— el lote se cortó y algún término es un prefijo: entonces `missing` NO es «no existe».
 */
export interface SearchSummary {
  q: string;
  mode: SearchMode;
  truncated: boolean;
  terms: string[];
  matched: number;
  missing: string[];
}

export function searchSummary(
  search: PieceSearch,
  resultIds: Array<string | null | undefined>,
  truncated: boolean,
): SearchSummary {
  return {
    q: search.q,
    mode: search.mode,
    truncated,
    terms: search.terms.map((t) => t.q),
    matched: resultIds.length,
    missing: unmatchedTerms(resultIds, search),
  };
}

/**
 * La respuesta 400 de una búsqueda inválida, o `null` si el error no es de búsqueda. Una sola
 * redacción para las cuatro bandejas: antes cada endpoint copiaba el mismo bloque.
 */
export function searchErrorBody(err: unknown): { error: string; detail: string; terms?: string[] } | null {
  if (err instanceof SearchTooShort) {
    return {
      error: 'search_too_short',
      detail: `Cada id tiene que tener al menos ${SEARCH_MIN_PREFIX} caracteres (lo que pinta la tarjeta) `
        + `o ser el id completo. Demasiado cortos: ${err.q}.`,
      terms: err.terms,
    };
  }
  if (err instanceof SearchNotAnId) {
    return {
      error: 'search_not_an_id',
      detail: `La búsqueda es por id de pieza (o por su prefijo), no por texto libre. No son ids: ${err.q}.`,
      terms: err.terms,
    };
  }
  if (err instanceof SearchTooMany) {
    return {
      error: 'search_too_many',
      detail: `Se pueden buscar hasta ${SEARCH_MAX_TERMS} ids a la vez; llegaron ${err.count}.`,
    };
  }
  return null;
}

/**
 * LO QUE LA CAJA DE BÚSQUEDA DICE ANTES DE ENVIAR. Es el mismo parser que usa el server, así que lo
 * que la caja acepta es lo que el server acepta y el error es el mismo texto.
 *   · `q`     — lo que se envía: los términos normalizados unidos por coma (vacío = limpiar);
 *   · `count` — cuántos ids distintos hay;
 *   · `error` — por qué no se puede buscar, nombrando los ids que fallan; `null` si se puede.
 */
export function checkSearchDraft(draft: string): { q: string; count: number; error: string | null } {
  const words = splitSearchTerms(draft);
  try {
    parsePieceSearch(draft);
    return { q: words.join(','), count: words.length, error: null };
  } catch (err) {
    const body = searchErrorBody(err);
    if (!body) throw err;
    return { q: words.join(','), count: words.length, error: body.detail };
  }
}
