/**
 * «FIJAR» LA VISTA DE LA TARJETA (Sam, 2026-11-18: «fijada no se fija con respecto al editor de texto en pantalla ni
 * sonido»). La ventana de edición se desplaza por dentro: al fijar, la página se lleva hasta la vista y ésta queda
 * pegada bajo el encabezado; el mismo estado vale para «Texto en pantalla» y para «Sonido».
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { estiloVistaFija, VISTA_FIJA_TOP_PX } from '../src/modules/iid/vistaFija';

describe('el estilo de la vista fijada', () => {
  it('pegada bajo el encabezado (h-14 = 56 px) y con margen para el salto', () => {
    expect(VISTA_FIJA_TOP_PX).toBeGreaterThanOrEqual(56);
    expect(estiloVistaFija(true)).toEqual({ position: 'sticky', top: VISTA_FIJA_TOP_PX, zIndex: 20, scrollMarginTop: VISTA_FIJA_TOP_PX });
    expect(estiloVistaFija(false)).toBeUndefined();
  });
});

describe('el cableado en la tarjeta', () => {
  const tarjeta = readFileSync('src/modules/iid/pieceActions.tsx', 'utf8');
  const editor = readFileSync('src/modules/iid/OnScreenTextEditor.tsx', 'utf8');
  it('al fijar (o al abrir con la vista fijada) la página se lleva hasta la vista y la columna izquierda queda quieta', () => {
    expect(tarjeta).toMatch(/usePaginaQuieta\(vistaFija && vistaAbierta, marcoVista\);/);
    expect(tarjeta).toMatch(/const vistaAbierta = pantallaVideo \|\| sonidoVideo;/);
    const m = readFileSync('src/modules/iid/vistaFija.ts', 'utf8');
    expect(m).toMatch(/raiz\.style\.overflow = 'hidden'; document\.body\.style\.overflow = 'hidden';/);
    expect(m).toMatch(/return \(\) => \{ raiz\.style\.overflow = antes\.html; document\.body\.style\.overflow = antes\.body;/);
  });
  it('sólo se bloquea la página con la ventana al lado: en el teléfono el editor está debajo', async () => {
    const { debeBloquearPagina } = await import('../src/modules/iid/vistaFija');
    expect(debeBloquearPagina(true, true, true)).toBe(true);
    expect(debeBloquearPagina(true, true, false)).toBe(false);
    expect(debeBloquearPagina(false, true, true)).toBe(false);
    expect(debeBloquearPagina(true, false, true)).toBe(false);
  });
  it('vale para «Texto en pantalla» y para «Sonido», con un solo estado', () => {
    expect(tarjeta).toMatch(/style=\{estiloVistaFija\(!!\(textoVideo && vistaAbierta && media && vistaFija\)\)\}/);
    expect(tarjeta).toMatch(/\{textoVideo && sonidoVideo && media && \(\n\s*<button type="button" onClick=\{\(\) => cambiarVistaFija\(!vistaFija\)\}/);
    expect(editor).toMatch(/const \[tarjetaFija, cambiarTarjetaFija\] = useVistaFija\(\);/);
    expect(editor).not.toMatch(/st\.position = tarjetaFija/);
  });
});
