import { describe, it, expect } from 'vitest';
import { alternarCursiva } from './cursiva';

describe('el botón «Cursiva» del editor (Sam, 2026-10-28)', () => {
  it('pone la cursiva a lo seleccionado y deja la selección sobre el mismo texto', () => {
    const r = alternarCursiva({ text: 'Una idea clave aquí', start: 4, end: 14 });
    expect(r.text).toBe('Una *idea clave* aquí');
    expect(r.text.slice(r.start, r.end)).toBe('idea clave');
  });

  it('deja los espacios de los bordes fuera de la marca', () => {
    expect(alternarCursiva({ text: 'Una idea aquí', start: 3, end: 9 }).text).toBe('Una *idea* aquí');
  });

  it('la quita si ya estaba en cursiva, se seleccione con o sin los asteriscos', () => {
    expect(alternarCursiva({ text: 'Una *idea* aquí', start: 5, end: 9 }).text).toBe('Una idea aquí');
    expect(alternarCursiva({ text: 'Una *idea* aquí', start: 4, end: 10 }).text).toBe('Una idea aquí');
  });

  it('no confunde una negrita con una cursiva', () => {
    expect(alternarCursiva({ text: 'Una **idea** aquí', start: 6, end: 10 }).text).toBe('Una ***idea*** aquí');
  });

  it('sin nada seleccionado no cambia nada', () => {
    const s = { text: 'Una idea', start: 3, end: 3 };
    expect(alternarCursiva(s)).toBe(s);
    const espacios = { text: 'Una   idea', start: 3, end: 6 };
    expect(alternarCursiva(espacios)).toBe(espacios);
  });
});
