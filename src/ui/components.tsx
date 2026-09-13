import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const Spinner = ({ size = 16, className }: { size?: number; className?: string }) => (
  <span
    className={cn("inline-block rounded-full border-2 border-current/20 border-t-current animate-spin", className)}
    style={{ width: size, height: size, minWidth: size }}
  />
);

export const GlowDot = ({ color = "#FFAB00", pulse = true }: { color?: string; pulse?: boolean }) => (
  <span
    className={cn("inline-block rounded-full", pulse && "animate-pulse")}
    style={{ width: 7, height: 7, backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
  />
);

/**
 * U-9 — LA PROCEDENCIA DEL CATÁLOGO DE MARCAS, A LA VISTA.
 *
 * El defecto que este corte cierra no fue tener una lista de respaldo: fue que el respaldo
 * y el camino bueno se veían exactamente igual, y por eso la lectura estuvo rota meses sin
 * que nadie lo notara.
 *
 * Por eso este aviso existe y por eso NO se pinta cuando las marcas vienen de la base: un
 * cartel permanente se vuelve parte del fondo y deja de avisar. Sólo habla cuando hay algo
 * que decir, y dice el motivo, no sólo que algo falló.
 */
export const BrandsFallbackNotice = ({ source, reason }: {
  source: 'loading' | 'db' | 'fallback';
  reason: string | null;
}) => {
  if (source !== 'fallback') return null;
  return (
    <div className="flex items-start gap-2 text-[11px] leading-snug rounded-xl px-3 py-2 border bg-amber-500/[0.08] border-amber-500/40 text-amber-200">
      <span aria-hidden>⚠</span>
      <span>
        <b>Lista de marcas de respaldo.</b> No se pudieron leer las marcas de la base, así que
        esta lista está incompleta y puede estar vieja: falta cualquier marca dada de alta
        después de la última versión desplegada.
        {reason && <span className="block font-mono text-amber-300/70 mt-0.5">{reason}</span>}
      </span>
    </div>
  );
};
