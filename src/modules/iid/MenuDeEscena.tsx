import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../../ui/components';
import type { CastOption } from '../../../api/_sceneCast';

/**
 * EL MENÚ DE UN LUGAR DE LA ESCENA (2026-11-21). Sam: «no sé quién es quién en el dropdown window, no recuerdo quién es
 * Itzel ni ninguna otra, en esos displays ponme un thumbnail de su cara + nombre + si es host o si es administradora…».
 * Un `<select>` nativo no muestra imágenes: este menú sí. Cada persona con su cara, su nombre y su voz y cargo; la que no se
 * puede pintar, visible pero apagada y con el motivo. Los lugares, agrupados («Estudios de vPodcast», «Conversations»…).
 * Elegir llama a `onPick(value)`: el valor que el motor reconoce en la directriz.
 */
export function MenuDeEscena({ label, options, onPick, disabled }: {
  label: string; options: CastOption[]; onPick: (value: string) => void; disabled?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('mousedown', fuera); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc); };
  }, [abierto]);
  const grupos = options.reduce<Array<{ group: string | null; items: CastOption[] }>>((acc, o) => {
    const g = acc.find((x) => x.group === o.group);
    if (g) g.items.push(o); else acc.push({ group: o.group, items: [o] });
    return acc;
  }, []);
  return (
    <div ref={caja} className="relative flex items-center gap-1 text-[11px] text-zinc-400">
      <span className="font-mono">{label}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setAbierto((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-label={`Cambiar ${label}`}
        className="bg-zinc-900 border border-zinc-800 rounded-lg px-1.5 py-0.5 text-[11px] text-zinc-300 hover:border-zinc-700 disabled:opacity-50"
      >
        cambiar por… ▾
      </button>
      {abierto && (
        <div role="listbox" aria-label={`Opciones para ${label}`}
          className="absolute left-0 top-full z-30 mt-1 w-72 max-h-80 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 p-1 shadow-xl">
          {grupos.map(({ group, items }) => (
            <div key={group ?? '—'} className="py-0.5">
              {group && <p className="px-2 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-zinc-500">{group}</p>}
              {items.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={false}
                  disabled={!o.paintable}
                  title={o.paintable ? undefined : 'Sin fotos ni descripción en su ficha: el motor no la puede pintar todavía'}
                  onClick={() => { onPick(o.value); setAbierto(false); }}
                  className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left',
                    o.paintable ? 'hover:bg-zinc-900' : 'opacity-50 cursor-not-allowed')}
                >
                  {o.thumb
                    ? <img src={o.thumb} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" loading="lazy" />
                    : <span className="h-9 w-9 shrink-0 rounded-md bg-zinc-800" aria-hidden="true" />}
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] text-zinc-200">{o.name}</span>
                    {(o.subtitle || !o.paintable) && (
                      <span className="block truncate text-[10px] text-zinc-500">
                        {[o.subtitle, o.paintable ? null : 'sin fotos — no se puede pintar'].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
