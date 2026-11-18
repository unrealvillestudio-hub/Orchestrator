import type React from 'react';
/**
 * «FIJAR» LA VISTA DE LA TARJETA (Sam, 2026-11-18: «fijada no se fija con respecto al editor de texto en pantalla ni
 * sonido»).
 *
 * La ventana de edición está fija a la derecha y se desplaza POR DENTRO: al recorrerla, la página no se mueve y una vista
 * `sticky` se queda donde estaba, a medias fuera de la pantalla. Por eso, al fijarla (o al abrir una ventana con la
 * vista ya fijada), la página se lleva hasta la vista y la deja justo debajo del encabezado; `sticky` la mantiene ahí si
 * después se desplaza la página. Un solo estado para «Texto en pantalla» y para «Sonido», recordado en este navegador.
 */
import { useEffect, useState } from 'react';

const CLAVE = 'orchestrator.vista.tarjeta.fija';
const EVENTO = 'orchestrator:vista-fija';
/** Alto del encabezado pegajoso de la app (`h-14`) más un respiro: donde se queda la vista fijada. */
export const VISTA_FIJA_TOP_PX = 64;

function leer(): boolean {
  try { return window.localStorage.getItem(CLAVE) === 'si'; } catch { return false; }
}

/** El estado compartido de «Fijar»: cualquier componente que lo cambie avisa a los demás. */
export function useVistaFija(): [boolean, (v: boolean) => void] {
  const [fija, setFija] = useState<boolean>(() => (typeof window === 'undefined' ? false : leer()));
  useEffect(() => {
    const u = () => setFija(leer());
    window.addEventListener(EVENTO, u);
    return () => window.removeEventListener(EVENTO, u);
  }, []);
  const cambiar = (v: boolean) => {
    try { window.localStorage.setItem(CLAVE, v ? 'si' : 'no'); } catch { /* sin almacenamiento: sólo no se recuerda */ }
    setFija(v);
    window.dispatchEvent(new Event(EVENTO));
  };
  return [fija, cambiar];
}

/** El estilo del contenedor de la vista: pegado bajo el encabezado si está fijada. PURO. */
export function estiloVistaFija(activa: boolean): React.CSSProperties | undefined {
  return activa ? { position: 'sticky', top: VISTA_FIJA_TOP_PX, zIndex: 20, scrollMarginTop: VISTA_FIJA_TOP_PX } : undefined;
}
