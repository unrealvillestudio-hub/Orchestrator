import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { indexBrandLanguages, readingLanguageOf } from './_brandLanguage.js';

/**
 * EN QUÉ IDIOMA SE LEE UNA PIEZA — y por qué eso no puede vivir en el código.
 *
 * El defecto que cierra el módulo: el lector caía en la voz `default` del sistema y leía una
 * pieza en español con voz inglesa. El idioma existía en `public.brands` desde antes; nadie lo
 * bajaba al contrato de la pieza.
 *
 * Los identificadores de las fixtures son FICTICIOS a propósito: si la resolución dependiera de
 * una marca real, estas pruebas fallarían.
 */

const SRC = readFileSync(new URL('./_brandLanguage.ts', import.meta.url), 'utf8');
/** Sin comentarios: se mide el código, no la documentación que lo explica. */
const CODE = SRC.split('\n')
  .filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*'); })
  .join('\n');

describe('el idioma sale del dato, nunca del código', () => {
  it('no hay ningún idioma escrito en el módulo', () => {
    // Ni códigos sueltos ni una tabla de equivalencias: la lista es la del catálogo.
    for (const tag of ["'es'", '"es"', "'en'", '"en"', "'es-ES'", "'en-US'", "'es_ES'"])
      expect(CODE).not.toContain(tag);
  });

  it('no hay ningún nombre de marca del ecosistema, ni el id centinela DEFAULT', () => {
    // Usar la fila `DEFAULT` como respaldo sería enumerar una instancia dentro de una capa
    // que sirve a N marcas: una marca sin idioma se arregla sembrando su fila.
    for (const nombre of ['NeuroneSCF', 'ForumPHs', 'LucienSael', 'UnrealvilleStudio', "'DEFAULT'"])
      expect(CODE).not.toContain(nombre);
  });
});

describe('indexBrandLanguages', () => {
  it('la forma completa gana al prefijo: una voz regional acierta más', () => {
    const cat = indexBrandLanguages([{ id: 'BrandAlpha', language_primary: 'xx', voicelab_language: 'xx-YY' }]);
    expect(readingLanguageOf('BrandAlpha', cat)).toBe('xx-YY');
  });

  it('sin forma completa cae al prefijo, que siempre está poblado', () => {
    const cat = indexBrandLanguages([{ id: 'BrandBeta', language_primary: 'zz', voicelab_language: null }]);
    expect(readingLanguageOf('BrandBeta', cat)).toBe('zz');
  });

  it('una marca sin ningún idioma declarado no entra al catálogo', () => {
    const cat = indexBrandLanguages([{ id: 'BrandGamma', language_primary: '  ', voicelab_language: null }]);
    expect(readingLanguageOf('BrandGamma', cat)).toBeNull();
  });

  it('una fila sin id se ignora en vez de romper el catálogo entero', () => {
    const cat = indexBrandLanguages([{ id: null, language_primary: 'zz' }, { id: 'BrandDelta', language_primary: 'zz' }]);
    expect(readingLanguageOf('BrandDelta', cat)).toBe('zz');
  });
});

describe('readingLanguageOf degrada, nunca inventa', () => {
  it('una marca nunca vista se resuelve por dato: sin fila, sin sugerencia', () => {
    // El test de la marca N+1, ejecutable: para que una marca nueva tenga idioma se siembra
    // una fila, no se edita un archivo. Mientras no la tenga, el lector usa la voz del sistema.
    const cat = indexBrandLanguages([{ id: 'BrandAlpha', language_primary: 'xx' }]);
    expect(readingLanguageOf('MarcaQueNadieVioJamas', cat)).toBeNull();
  });

  it('sin catálogo (la lectura falló) no se sugiere nada', () => {
    expect(readingLanguageOf('BrandAlpha', null)).toBeNull();
  });

  it('sin marca tampoco', () => {
    const cat = indexBrandLanguages([{ id: 'BrandAlpha', language_primary: 'xx' }]);
    expect(readingLanguageOf(null, cat)).toBeNull();
    expect(readingLanguageOf('   ', cat)).toBeNull();
  });
});
