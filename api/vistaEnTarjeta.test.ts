/**
 * LA VISTA EN LA TARJETA (Sam, 2026-11-18): «no hay necesidad de 2 previews, vamos a utilizar el de la tarjeta»; el
 * esquema de zonas seguras va sobre ese video con un check activo por defecto, en rojo relleno cuando el texto se sale;
 * el play y las notas van en la franja inferior, al lado de «Sonido», sólo mientras se edita «Texto en pantalla».
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { seSale } from '../src/modules/iid/TextoVisual';
import { anchoEnTarjeta, VISTA_ANCHO_MIN } from '../src/modules/iid/OnScreenTextEditor';

const SAFE = { x: 65, y: 269, w: 777, h: 940 };

describe('cuándo un bloque va en rojo', () => {
  it('dentro de la zona segura y cabiendo: no', () => {
    expect(seSale({ x: 142, y: 1063, w: 624, h: 146 }, SAFE, true)).toBe(false);
    expect(seSale({ x: 65, y: 269, w: 777, h: 940 }, SAFE, null)).toBe(false);
  });
  it('si pasa del borde de la zona segura, sí (con 1 px de tolerancia)', () => {
    expect(seSale({ x: 142, y: 1180, w: 624, h: 146 }, SAFE, true)).toBe(true);
    expect(seSale({ x: 64.5, y: 269, w: 100, h: 100 }, SAFE, null)).toBe(false);
    expect(seSale({ x: 60, y: 269, w: 100, h: 100 }, SAFE, null)).toBe(true);
  });
  it('si VideoLab dice que no cabe, sí, aunque la caja esté dentro', () => {
    expect(seSale({ x: 142, y: 400, w: 100, h: 100 }, SAFE, false)).toBe(true);
  });
  it('sin datos no inventa un rojo', () => {
    expect(seSale(null, SAFE, null)).toBe(false);
    expect(seSale({ x: 0, y: 0, w: 10, h: 10 }, null, null)).toBe(false);
  });
});

describe('el ancho de la vista en la tarjeta', () => {
  it('el del sitio, sin pasar del alto que tenía el video de la tarjeta (75 % de la pantalla, 9:16)', () => {
    expect(anchoEnTarjeta(353, 2000)).toBe(353);
    expect(anchoEnTarjeta(800, 760)).toBe(Math.floor((760 * 0.75 * 9) / 16));
    expect(anchoEnTarjeta(50, 900)).toBe(VISTA_ANCHO_MIN);
  });
});

describe('el cableado', () => {
  const tarjeta = readFileSync('src/modules/iid/pieceActions.tsx', 'utf8');
  const editor = readFileSync('src/modules/iid/OnScreenTextEditor.tsx', 'utf8');
  const visual = readFileSync('src/modules/iid/TextoVisual.tsx', 'utf8');
  it('mientras se edita, el sitio del reproductor de la tarjeta lo ocupa la vista; si no, el video de siempre', () => {
    expect(tarjeta).toMatch(/\{vistaEditando \? <div ref=\{setSlotVista\} className="w-full" data-sitio-vista \/> : media\}/);
    expect(tarjeta).toMatch(/const vistaEditando = textoVideo && pantallaVideo && media;/);
  });
  it('la franja de los controles está al lado de «Sonido» y sólo mientras se edita', () => {
    expect(tarjeta).toMatch(/\{botonSonido\}\n\s*\{vistaEditando && <div ref=\{setSlotBarra\}/);
  });
  it('el editor pinta en la tarjeta (portal) y no repite la vista en la ventana', () => {
    expect(editor).toMatch(/\{prop\.clean_video_url && slotVista && createPortal\(/);
    expect(editor).toMatch(/\{prop\.clean_video_url && !slotVista && \(/);
    expect(editor).toMatch(/notasEn=\{slotBarra \?\? null\}/);
  });
  it('el esquema va encima del video, con su check activo por defecto, y no recibe el puntero', () => {
    expect(editor).toMatch(/leerPreferencia\('orchestrator\.vista\.esquema', 'si'\) === 'si'/);
    expect(editor).toMatch(/<EsquemaSobreVideo scene=\{vista\.result\.scene\} fits=\{vista\.result\.fits \?\? \[\]\} \/>/);
    expect(visual).toMatch(/\{encima && <div className="absolute inset-0 pointer-events-none">\{encima\}<\/div>\}/);
  });
});
