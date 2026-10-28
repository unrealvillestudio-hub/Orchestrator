/**
 * EL BOTÓN «CURSIVA» (Sam, 2026-10-28): pone o quita la marca de cursiva en lo seleccionado de un campo. La regla vive en
 * `cursiva.ts`; aquí sólo se lee la selección del campo y se devuelve el texto nuevo.
 */
import type { RefObject } from 'react';
import { alternarCursiva, type MarcaCursiva } from './cursiva';

export function BotonCursiva({ campo, valor, onCambio, marca = '*', titulo }: {
  campo: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  valor: string;
  onCambio: (v: string) => void;
  marca?: MarcaCursiva;
  titulo: string;
}) {
  return (
    <button
      type="button"
      // Que el toque no le quite el foco al campo: la selección se perdería antes de leerla.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        const el = campo.current;
        if (!el) return;
        const r = alternarCursiva({ text: valor, start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 }, marca);
        if (r.text === valor) return;
        onCambio(r.text);
        requestAnimationFrame(() => { el.focus(); el.setSelectionRange(r.start, r.end); });
      }}
      title={titulo}
      aria-label="Cursiva"
      className="px-2.5 py-0.5 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 text-[12px] italic font-serif shrink-0"
    >
      Cursiva
    </button>
  );
}
