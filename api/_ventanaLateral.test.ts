import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { anchoVentana, anchoPorArrastre, VENTANA_MIN_PX, COLUMNA_MIN_PX, MARGEN_PX, VENTANA_INICIAL_PX } from '../src/modules/iid/VentanaLateral';

/** VENTANA LATERAL (2026-11-16): al lado de la pieza en escritorio, con ancho que se arrastra y se recalcula con el zoom. */
describe('anchoVentana', () => {
  it('con ratón y sitio, respeta el ancho elegido', () => {
    expect(anchoVentana(1280, 500, true)).toBe(500);
  });
  it('acota el ancho para que la pieza conserve su columna legible', () => {
    const max = 1280 - COLUMNA_MIN_PX - 3 * MARGEN_PX;
    expect(anchoVentana(1280, 5000, true)).toBe(max);
    expect(anchoVentana(1280, 10, true)).toBe(VENTANA_MIN_PX);
  });
  it('con zoom (pantalla más angosta en px CSS) se reduce y, si no cabe, vuelve debajo de la pieza', () => {
    const angosta = COLUMNA_MIN_PX + VENTANA_MIN_PX + 3 * MARGEN_PX;
    expect(anchoVentana(angosta, 500, true)).toBe(VENTANA_MIN_PX);
    expect(anchoVentana(angosta - 1, 500, true)).toBeNull();
  });
  it('en pantalla táctil se queda debajo de la pieza', () => {
    expect(anchoVentana(2560, 500, false)).toBeNull();
  });
  it('sin ancho elegido válido, parte del inicial', () => {
    expect(anchoVentana(1600, Number.NaN, true)).toBe(VENTANA_INICIAL_PX);
  });
});

describe('anchoPorArrastre', () => {
  it('el ancho va del puntero al borde derecho, menos el margen', () => {
    expect(anchoPorArrastre(1280, 800)).toBe(1280 - MARGEN_PX - 800);
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

describe('el contenido se corre a la izquierda mientras la ventana está al lado', () => {
  it('la regla CSS y la clase del contenedor existen', () => {
    const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(css).toMatch(/body\.con-ventana-lateral \.contenido-principal \{ padding-right: var\(--ventana-lateral/);
    expect(app).toContain('className="contenido-principal"');
  });
});
