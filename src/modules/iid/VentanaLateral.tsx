import React, { useLayoutEffect, useRef, useState } from 'react';

/**
 * VENTANA LATERAL (2026-11-16, pedido de Sam). En la app de escritorio, la ventana «Texto en pantalla» se pone AL LADO
 * de la imagen o del video, en el espacio libre a la derecha de la columna de la pieza, para editar viendo la pieza. Si
 * no hay sitio (ventana estrecha, móvil o pantalla táctil), se queda debajo, en la columna, como antes.
 */

/** Ancho mínimo libre a la derecha de la columna para poner la ventana al lado (px). */
export const LADO_MIN_PX = 360;
/** Ancho máximo de la ventana lateral (px). */
export const LADO_MAX_PX = 560;
/** Separación entre la columna y la ventana, y con el borde de la pantalla (px). */
export const LADO_MARGEN_PX = 16;

/**
 * ¿Va al lado? y ¿dónde? `null` = se queda en la columna. PURO: recibe el ancho de la pantalla, el borde derecho de la
 * columna y si el puntero es fino (ratón), y no lee el DOM.
 */
export function ladoLibre(anchoPantalla: number, bordeColumna: number, punteroFino: boolean): { left: number; width: number } | null {
  if (!punteroFino) return null;
  const libre = anchoPantalla - bordeColumna - 2 * LADO_MARGEN_PX;
  if (!(libre >= LADO_MIN_PX)) return null;
  return { left: Math.round(bordeColumna + LADO_MARGEN_PX), width: Math.round(Math.min(libre, LADO_MAX_PX)) };
}

export function VentanaLateral({ children, arriba = 64, abajo = 40 }: { children: React.ReactNode; arriba?: number; abajo?: number }) {
  const ancla = useRef<HTMLDivElement>(null);
  const [lado, setLado] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const medir = () => {
      const col = ancla.current?.parentElement?.getBoundingClientRect();
      if (!col) return;
      const fino = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
      const nuevo = ladoLibre(window.innerWidth, col.right, fino);
      setLado((v) => (v?.left === nuevo?.left && v?.width === nuevo?.width ? v : nuevo));
    };
    medir();
    window.addEventListener('resize', medir);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(medir) : null;
    if (ro && ancla.current?.parentElement) ro.observe(ancla.current.parentElement);
    return () => { window.removeEventListener('resize', medir); ro?.disconnect(); };
  }, []);
  return (
    <>
      <div ref={ancla} aria-hidden className="h-0" />
      {lado ? (
        <div style={{ position: 'fixed', top: arriba, bottom: abajo, left: lado.left, width: lado.width }}
          className="z-40 overflow-y-auto rounded-xl shadow-2xl shadow-black/60 bg-zinc-950" data-ventana-lateral>
          {children}
        </div>
      ) : children}
    </>
  );
}
