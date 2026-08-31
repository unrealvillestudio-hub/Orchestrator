import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readableFromArtifactHtml, readableFromChallengedPiece } from './readablePiece';

/**
 * Lo que el lector en voz alta necesita que siga siendo cierto.
 *
 * Las dos propiedades que este archivo fija no son de cálculo:
 *
 *   1. El lector NO sabe de dónde viene el texto. Si alguna vez nombra una bandeja, un
 *      canal, una marca o un endpoint, deja de servir a la superficie siguiente sin
 *      editarlo — que es exactamente lo que el componente existe para evitar.
 *   2. El adaptador del artefacto depende de dos clases del HTML que escribe
 *      `api/_calibrationShared.ts → buildHtml()`. El día que se renombren, el lector se
 *      queda mudo en dos de las tres bandejas y nada más falla: el acoplamiento es real y
 *      va fijado aquí, no confiado a la memoria.
 *
 * `readableFromArtifactHtml` no se prueba contra un HTML real porque el entorno de estas
 * pruebas es Node y no trae `DOMParser`; lo que sí se prueba es que en ese caso DEVUELVA
 * los campos en `null` en vez de lanzar — un lector que revienta rompe la tarjeta entera.
 */

const READER = readFileSync(new URL('../../ui/SpeechReader.tsx', import.meta.url), 'utf8');
/** Sin comentarios: se mide el código, no la documentación que lo explica. */
const READER_CODE = READER.split('\n')
  .filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*'); })
  .join('\n');

const ARTIFACT_BUILDER = readFileSync(new URL('../../../api/_calibrationShared.ts', import.meta.url), 'utf8');

// ── 1 · El lector sólo sabe de texto y de voces ──────────────────────────────────
describe('el lector no conoce la superficie que lo monta', () => {
  it('no nombra ninguna marca ni ningún canal del ecosistema', () => {
    for (const name of [
      'NeuroneSCF', 'ForumPHs', 'LucienSael', 'UnrealvilleStudio',
      'meta_ig', 'meta_fb', 'tiktok',
    ]) expect(READER_CODE).not.toContain(name);
  });

  it('no nombra ninguna bandeja ni ningún endpoint', () => {
    for (const term of [
      'preview-render', 'calibration', 'Calibration', 'publish', 'Publish',
      'challenged', 'Challenged', '/api/',
    ]) expect(READER_CODE).not.toContain(term);
  });

  it('recibe la pieza en texto plano y nada más', () => {
    expect(READER).toContain('export interface ReadablePiece');
    expect(READER).toMatch(/title: string \| null;\s*\n\s*body: string \| null;/);
  });

  it('se suscribe a `voiceschanged`: sin eso el selector aparece vacío en Chrome', () => {
    expect(READER_CODE).toContain("addEventListener('voiceschanged'");
    expect(READER_CODE).toContain("removeEventListener('voiceschanged'");
  });

  it('no enumera idiomas: la lista es la del sistema del operador', () => {
    // Un `Intl.DisplayNames` resuelve los nombres; una tabla aquí sería una segunda fuente.
    expect(READER_CODE).toContain('Intl.DisplayNames');
    for (const hardcoded of ["'es-ES'", "'en-US'", "['es'", "['en'"])
      expect(READER_CODE).not.toContain(hardcoded);
  });

  it('cancela la síntesis al desmontar y al cambiar de pieza', () => {
    expect(READER_CODE).toContain('speechSynthesis.cancel()');
  });
});

// ── 2 · El acoplamiento con el artefacto, declarado ──────────────────────────────
describe('el adaptador del artefacto y el HTML que lo produce', () => {
  it('`buildHtml()` sigue escribiendo las clases que el adaptador busca', () => {
    expect(ARTIFACT_BUILDER).toContain('class="title"');
    expect(ARTIFACT_BUILDER).toContain('class="text"');
  });
});

// ── 3 · Ninguna entrada lanza ────────────────────────────────────────────────────
describe('readableFromArtifactHtml', () => {
  it('devuelve los dos campos en null ante un HTML vacío, sin lanzar', () => {
    expect(readableFromArtifactHtml('')).toEqual({ title: null, body: null });
    expect(readableFromArtifactHtml('   ')).toEqual({ title: null, body: null });
  });

  it('sin `DOMParser` en el entorno degrada a null en vez de romper la tarjeta', () => {
    // El entorno de estas pruebas es Node: `DOMParser` no existe, y ese es el caso.
    expect(typeof DOMParser).toBe('undefined');
    expect(readableFromArtifactHtml('<div class="title">x</div>')).toEqual({ title: null, body: null });
  });
});

describe('readableFromChallengedPiece', () => {
  it('pasa el título y el cuerpo tal como llegan', () => {
    expect(readableFromChallengedPiece({ title: 'Un título', body: 'Un cuerpo' }))
      .toEqual({ title: 'Un título', body: 'Un cuerpo' });
  });

  it('una fila sin pieza no es un error: el arbitraje se decide igual sobre la regla', () => {
    expect(readableFromChallengedPiece(null)).toEqual({ title: null, body: null });
  });

  it('una pieza sin título es válida y el cuerpo se lee igual', () => {
    expect(readableFromChallengedPiece({ title: null, body: 'Sólo cuerpo' }))
      .toEqual({ title: null, body: 'Sólo cuerpo' });
  });

  it('el texto en blanco cuenta como ausente: no se lee un espacio en voz alta', () => {
    expect(readableFromChallengedPiece({ title: '   ', body: '\n\n' }))
      .toEqual({ title: null, body: null });
  });
});
