/**
 * EL ZOOM DE LAS BANDEJAS (Sam, 2026-10-28): «un slider que permita zoom +/- como un toque mínimo y personal
 * cuando haga falta, en todas las tabs donde se puedan hacer correcciones, incluso en publish».
 *
 * Es de quien mira, no de la pieza ni de la marca: vive en el navegador (`localStorage`) y no viaja a ningún
 * sitio. Sin almacenamiento (ventana privada, bloqueado), funciona igual y vuelve al 100 % al recargar.
 * Bloque PURO: se prueba en `zoom.test.ts`.
 */

export const ZOOM_MIN = 0.8;
export const ZOOM_MAX = 1.5;
export const ZOOM_STEP = 0.05;
export const ZOOM_DEFAULT = 1;
export const ZOOM_STORAGE_KEY = 'orchestrator.zoom';

/** Dentro del rango y en pasos de 5 %: un valor raro guardado a mano no deja la pantalla ilegible. */
export function clampZoom(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return ZOOM_DEFAULT;
  const enPaso = Math.round(n / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(enPaso.toFixed(2))));
}

/** Un paso más o menos. */
export const zoomIn = (v: number) => clampZoom(v + ZOOM_STEP);
export const zoomOut = (v: number) => clampZoom(v - ZOOM_STEP);

/** Cómo se lee en pantalla: «110 %». */
export const zoomLabel = (v: number) => `${Math.round(clampZoom(v) * 100)} %`;

type Almacen = Pick<Storage, 'getItem' | 'setItem'>;

/** El zoom guardado; sin almacenamiento o con un valor raro, el 100 %. */
export function loadZoom(storage: Almacen | null | undefined): number {
  try {
    const raw = storage?.getItem(ZOOM_STORAGE_KEY);
    return raw == null ? ZOOM_DEFAULT : clampZoom(raw);
  } catch {
    return ZOOM_DEFAULT;
  }
}

/** Guarda el zoom; si el navegador no deja, no pasa nada: sólo no se recuerda. */
export function saveZoom(storage: Almacen | null | undefined, v: number): void {
  try { storage?.setItem(ZOOM_STORAGE_KEY, String(clampZoom(v))); } catch { /* sin almacenamiento */ }
}

/** Las bandejas donde se corrige algo: ahí, y sólo ahí, se ofrece el zoom. */
export const ZOOM_VIEWS: ReadonlySet<string> = new Set(['calibration', 'fixes', 'challenged', 'publish', 'media']);
