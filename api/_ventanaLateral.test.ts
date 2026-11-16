import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ladoLibre, LADO_MIN_PX, LADO_MAX_PX, LADO_MARGEN_PX } from '../src/modules/iid/VentanaLateral';

/** VENTANA LATERAL (2026-11-16): en escritorio, la ventana «Texto en pantalla» va al lado de la pieza si hay sitio. */
describe('ladoLibre', () => {
  it('con sitio a la derecha y ratón, va al lado, pegada a la columna', () => {
    // Pantalla de 1280 px con la columna de la pieza terminando en 880 px: 368 px libres.
    expect(ladoLibre(1280, 880, true)).toEqual({ left: 880 + LADO_MARGEN_PX, width: 1280 - 880 - 2 * LADO_MARGEN_PX });
  });
  it('el ancho tiene tope', () => {
    expect(ladoLibre(2560, 900, true)?.width).toBe(LADO_MAX_PX);
  });
  it('sin sitio suficiente, se queda en la columna', () => {
    expect(ladoLibre(1100, 880, true)).toBeNull();
    expect(ladoLibre(880 + LADO_MIN_PX + 2 * LADO_MARGEN_PX - 1, 880, true)).toBeNull();
  });
  it('en pantalla táctil (móvil, tableta), se queda en la columna', () => {
    expect(ladoLibre(2560, 900, false)).toBeNull();
  });
});

describe('las secciones de la ventana', () => {
  const UI = readFileSync(new URL('../src/modules/iid/OnScreenTextEditor.tsx', import.meta.url), 'utf8');
  it('abren plegadas: ningún <details> nace abierto', () => {
    expect(UI).not.toMatch(/<details[^>]*\sopen\b/);
  });
  it('se pliegan y despliegan todas de una vez, y el pliegue se ve', () => {
    expect(UI).toContain('Desplegar todo');
    expect(UI).toContain('Plegar todo');
    expect(UI).toContain('group-open:rotate-90');
  });
});
