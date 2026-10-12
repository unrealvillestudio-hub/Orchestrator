import { describe, it, expect } from 'vitest';
import { splitSearchTerms, checkSearchDraft, parsePieceSearch, SearchNotAnId } from './_pieceSearch.js';

/**
 * LO INVISIBLE NO ES PARTE DE UN ID (Sam, 2026-10-12).
 *
 * «Cuando reviso piezas en bulk el filtro no reconoce los espacios en blanco después de varias comas.»
 *
 * Medido ese día con el parser de entonces: la coma seguida de un espacio normal, de un espacio duro
 * (U+00A0) o de uno estrecho (U+202F) ya separaba. Lo que fallaba era un carácter de formato de ancho
 * cero —U+200B, U+2060— que se cuela al copiar una lista desde el chat: se pegaba al id siguiente y el
 * error decía «no son ids: ​85517171», que en pantalla se ve como un espacio que el filtro no entiende.
 * También fallaban los ids envueltos en acentos graves, comillas o con el punto final de la frase.
 *
 * Lo que fijan estas pruebas: el divisor es la coma (y lo que ya se aceptaba: punto y coma, espacio,
 * salto de línea); todo lo invisible y todo lo que sólo envuelve al id se ignora; y un término que de
 * verdad no es un id SIGUE siendo un error que lo nombra.
 *
 * Los ids son ficticios.
 */

const IDS = ['a1b2c3d4', 'e5f6a7b8', 'c9d0e1f2'];

describe('lo invisible después de la coma no rompe la lista', () => {
  const casos: Array<[string, string]> = [
    ['espacio normal', ', '],
    ['espacio duro U+00A0', ', '],
    ['espacio estrecho U+202F', ', '],
    ['espacio de ancho cero U+200B', ',​'],
    ['espacio y ancho cero', ', ​'],
    ['unión de palabras U+2060', ',⁠'],
    ['BOM U+FEFF', ',﻿'],
    ['guion blando U+00AD', ',­'],
    ['varios espacios y ancho cero', ',  ​  '],
    ['coma de ancho completo', '，'],
    ['punto y coma de ancho completo', '； '],
  ];
  for (const [nombre, sep] of casos) {
    it(nombre, () => {
      const r = checkSearchDraft(IDS.join(sep));
      expect(r.error).toBeNull();
      expect(splitSearchTerms(IDS.join(sep))).toEqual(IDS);
    });
  }

  it('un carácter de ancho cero DENTRO de un id también se quita', () => {
    expect(splitSearchTerms('a1b2​c3d4')).toEqual(['a1b2c3d4']);
  });
});

describe('lo que sólo envuelve al id se recorta', () => {
  it('acentos graves del markdown', () => {
    expect(splitSearchTerms(IDS.map((i) => `\`${i}\``).join(', '))).toEqual(IDS);
  });
  it('comillas de cualquier tipo', () => {
    expect(splitSearchTerms(`«${IDS[0]}», "${IDS[1]}", “${IDS[2]}”`)).toEqual(IDS);
  });
  it('el punto o los dos puntos del final de la frase', () => {
    expect(splitSearchTerms(`${IDS.join(', ')}.`)).toEqual(IDS);
    expect(splitSearchTerms(`${IDS[0]}:`)).toEqual([IDS[0]]);
  });
  it('paréntesis y corchetes', () => {
    expect(splitSearchTerms(`(${IDS[0]}), [${IDS[1]}]`)).toEqual([IDS[0], IDS[1]]);
  });
  it('un uuid completo con guiones sigue entero', () => {
    const uuid = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
    expect(parsePieceSearch(`\`${uuid}\`.`)?.terms[0]).toMatchObject({ mode: 'uuid', exact: uuid });
  });
});

describe('lo que no es un id sigue siendo un error que lo nombra', () => {
  it('texto libre', () => {
    expect(() => parsePieceSearch(`${IDS[0]}, hola`)).toThrow(SearchNotAnId);
    expect(checkSearchDraft(`${IDS[0]}, hola`).error).toContain('hola');
  });
  it('un carácter ajeno en medio del id no se recorta', () => {
    expect(() => parsePieceSearch('a1b2"c3d4')).toThrow(SearchNotAnId);
  });
});
