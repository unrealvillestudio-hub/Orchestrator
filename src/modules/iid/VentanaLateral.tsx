import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * VENTANA LATERAL (2026-11-16, pedidos de Sam).
 * - En la app de escritorio, la ventana «Texto en pantalla» se pone AL LADO de la imagen o del video, pegada al borde
 *   derecho, y el contenido de la página se corre a la izquierda para dejarle sitio (no se tapan).
 * - El borde izquierdo de la ventana es una BARRA QUE SE ARRASTRA: el operador reparte el ancho entre la pieza y la
 *   ventana. El ancho elegido se recuerda en este navegador.
 * - Con zoom del navegador o al cambiar el tamaño de la ventana, todo se recalcula: si ya no caben las dos columnas
 *   legibles, la ventana vuelve debajo de la pieza, como en el teléfono.
 */

/** Ancho mínimo de la ventana lateral (px CSS). */
export const VENTANA_MIN_PX = 320;
/** Ancho mínimo que le queda a la columna de la pieza para seguir legible (px CSS). */
export const COLUMNA_MIN_PX = 440;
/** Margen con el borde de la pantalla y entre columnas (px CSS). */
export const MARGEN_PX = 16;
/** Ancho de partida si el operador nunca lo cambió (px CSS). */
export const VENTANA_INICIAL_PX = 480;

const CLAVE_ANCHO = 'orchestrator.ventanaLateral.ancho';

/**
 * El ancho final de la ventana lateral, o `null` si no cabe al lado (se queda debajo de la pieza). PURO.
 * `deseado` es lo que eligió el operador; se acota para que la columna de la pieza conserve `COLUMNA_MIN_PX`.
 */
export function anchoVentana(anchoPantalla: number, deseado: number, punteroFino: boolean): number | null {
  if (!punteroFino) return null;
  const max = anchoPantalla - COLUMNA_MIN_PX - 3 * MARGEN_PX;
  if (!(max >= VENTANA_MIN_PX)) return null;
  const d = Number.isFinite(deseado) ? deseado : VENTANA_INICIAL_PX;
  return Math.round(Math.min(Math.max(d, VENTANA_MIN_PX), max));
}

/** El ancho que pide el arrastre: desde el puntero hasta el borde derecho, menos el margen. PURO. */
export function anchoPorArrastre(anchoPantalla: number, punteroX: number): number {
  return Math.round(anchoPantalla - MARGEN_PX - punteroX);
}

function leerAncho(): number {
  try { const v = Number(window.localStorage.getItem(CLAVE_ANCHO)); return v > 0 ? v : VENTANA_INICIAL_PX; } catch { return VENTANA_INICIAL_PX; }
}
function guardarAncho(v: number) {
  try { window.localStorage.setItem(CLAVE_ANCHO, String(Math.round(v))); } catch { /* sin almacenamiento: sólo no se recuerda */ }
}

export function VentanaLateral({ children, arriba = 64, abajo = 40 }: { children: React.ReactNode; arriba?: number; abajo?: number }) {
  const [deseado, setDeseado] = useState<number>(() => (typeof window === 'undefined' ? VENTANA_INICIAL_PX : leerAncho()));
  const [ancho, setAncho] = useState<number | null>(null);
  const arrastre = useRef(false);

  const medir = useCallback(() => {
    const fino = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
    setAncho(anchoVentana(window.innerWidth, deseado, fino));
  }, [deseado]);

  useLayoutEffect(() => {
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, [medir]);

  // El contenido de la página se corre a la izquierda mientras la ventana está al lado (`.contenido-principal`).
  useEffect(() => {
    const b = document.body;
    if (ancho == null) return;
    b.classList.add('con-ventana-lateral');
    b.style.setProperty('--ventana-lateral', `${ancho + 2 * MARGEN_PX}px`);
    return () => { b.classList.remove('con-ventana-lateral'); b.style.removeProperty('--ventana-lateral'); };
  }, [ancho]);

  const empezar = (e: React.PointerEvent<HTMLDivElement>) => {
    arrastre.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const mover = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!arrastre.current) return;
    setDeseado(anchoPorArrastre(window.innerWidth, e.clientX));
  };
  const soltar = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!arrastre.current) return;
    arrastre.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const final = anchoVentana(window.innerWidth, anchoPorArrastre(window.innerWidth, e.clientX), true);
    if (final != null) guardarAncho(final);
  };
  const teclas = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const paso = e.shiftKey ? 64 : 16;
    if (e.key === 'ArrowLeft') { e.preventDefault(); setDeseado((ancho ?? deseado) + paso); }
    if (e.key === 'ArrowRight') { e.preventDefault(); setDeseado((ancho ?? deseado) - paso); }
  };
  useEffect(() => { if (ancho != null && !arrastre.current) guardarAncho(ancho); }, [ancho]);

  if (ancho == null) return <>{children}</>;
  return (
    <div style={{ position: 'fixed', top: arriba, bottom: abajo, right: MARGEN_PX, width: ancho }}
      className="z-40 flex rounded-xl shadow-2xl shadow-black/60 bg-zinc-950" data-ventana-lateral>
      <div role="separator" aria-orientation="vertical" aria-label="Ancho de la ventana: arrastre para repartir el espacio"
        aria-valuenow={ancho} tabIndex={0}
        onPointerDown={empezar} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar} onKeyDown={teclas}
        title="Arrastre para repartir el espacio entre la pieza y esta ventana"
        className="w-2 shrink-0 cursor-col-resize rounded-l-xl bg-zinc-800/60 hover:bg-violet-500/40 focus:bg-violet-500/40 focus:outline-none touch-none" />
      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
