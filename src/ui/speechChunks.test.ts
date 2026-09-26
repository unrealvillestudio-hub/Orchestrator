import { describe, it, expect } from 'vitest';
import { splitForSpeech, SPEECH_CHUNK_MAX } from './speechChunks';

const norm = (s: string) => s.replace(/\s+/g, '');

describe('splitForSpeech — la lectura en voz alta va por tramos', () => {
  it('un texto vacío no produce tramos', () => {
    expect(splitForSpeech('')).toEqual([]);
    expect(splitForSpeech('   \n  ')).toEqual([]);
  });

  it('un texto corto sale entero, en un solo tramo', () => {
    expect(splitForSpeech('Hola. ¿Qué tal?')).toEqual(['Hola. ¿Qué tal?']);
  });

  it('un artículo largo (el caso del blog) sale en tramos que no pasan del máximo', () => {
    const sentence = 'La fricción diaria desgasta la cutícula más de lo que parece, y cada lavado suma. ';
    const blog = Array.from({ length: 80 }, () => sentence).join('');
    const chunks = splitForSpeech(blog);
    expect(chunks.length).toBeGreaterThan(20);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(SPEECH_CHUNK_MAX);
  });

  it('no pierde ni inventa texto: los tramos unidos son el texto de entrada', () => {
    const text = 'Primer párrafo con una oración. Y otra más, con una coma.\n\nSegundo párrafo: '
      + 'una frase muy larga sin puntos que obliga a cortar por comas, por pausas y al final por espacios '
      + 'porque no hay otro límite natural antes de llegar al máximo permitido por tramo de lectura';
    expect(norm(splitForSpeech(text, 60).join(''))).toBe(norm(text));
  });

  it('corta por fin de oración antes que por coma o espacio', () => {
    const chunks = splitForSpeech('Uno dos tres. Cuatro, cinco seis siete ocho nueve', 30);
    expect(chunks[0]).toBe('Uno dos tres.');
  });

  it('no funde párrafos: cada salto de línea abre tramo', () => {
    expect(splitForSpeech('Título\nCuerpo')).toEqual(['Título', 'Cuerpo']);
  });

  it('una palabra más larga que el máximo se corta en seco sin colgarse', () => {
    const chunks = splitForSpeech('x'.repeat(50), 20);
    expect(chunks).toEqual(['x'.repeat(20), 'x'.repeat(20), 'x'.repeat(10)]);
  });
});
