/**
 * EL ZOOM DE LAS BANDEJAS (Sam, 2026-10-28) — un control pequeño y fijo, abajo a la derecha, que agranda o
 * achica el contenido de las bandejas donde se corrige. Personal: se guarda en este navegador. La regla y los
 * límites viven en `zoom.ts`.
 */
import { useEffect, useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, ZOOM_DEFAULT, clampZoom, loadZoom, saveZoom, zoomIn, zoomLabel, zoomOut } from './zoom';

const almacen = (): Storage | null => {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
};

/** El zoom de quien mira, recordado en este navegador. */
export function useZoom(): [number, (v: number) => void] {
  const [zoom, setZoom] = useState<number>(() => loadZoom(almacen()));
  useEffect(() => { saveZoom(almacen(), zoom); }, [zoom]);
  return [zoom, (v: number) => setZoom(clampZoom(v))];
}

export function ZoomControl({ zoom, onChange }: { zoom: number; onChange: (v: number) => void }) {
  const boton = 'p-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent';
  return (
    <div
      role="group"
      aria-label="Zoom de la bandeja"
      className="fixed right-3 z-40 flex items-center gap-1 rounded-xl border border-zinc-800 bg-[#050508]/90 backdrop-blur px-1.5 py-1 shadow-lg"
      style={{ bottom: 'calc(var(--hueco-inferior) + 0.75rem)' }}
    >
      <button type="button" className={boton} onClick={() => onChange(zoomOut(zoom))} disabled={zoom <= ZOOM_MIN}
        aria-label="Achicar" title="Achicar">
        <ZoomOut size={14} />
      </button>
      <input
        type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={ZOOM_STEP} value={zoom}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Zoom" aria-valuetext={zoomLabel(zoom)}
        className="w-20 md:w-28 accent-accent cursor-pointer"
      />
      <button type="button" className={boton} onClick={() => onChange(zoomIn(zoom))} disabled={zoom >= ZOOM_MAX}
        aria-label="Agrandar" title="Agrandar">
        <ZoomIn size={14} />
      </button>
      <button type="button" onClick={() => onChange(ZOOM_DEFAULT)} title="Volver al 100 %"
        className="min-w-[3.25rem] text-[10px] font-mono text-zinc-400 hover:text-zinc-100 px-1">
        {zoomLabel(zoom)}
      </button>
    </div>
  );
}
