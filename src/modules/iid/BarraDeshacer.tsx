/**
 * DESCARTAR Y DESHACER, en «Texto en pantalla» y en «Sonido» (Sam, 2026-11-17: «deshacer (a)»).
 *
 *  · «Descartar cambios»: lo editado y todavía sin aplicar vuelve a lo guardado. Instantáneo; no toca la pieza.
 *  · «Deshacer lo aplicado»: UN PASO ATRÁS. Vuelve el video anterior con su texto y su sonido, sin render. Otra vez =
 *    vuelve el que estaba. Pide una confirmación en la misma ventana (el navegador no muestra `confirm()` aquí).
 */
import React from 'react';
import { Spinner } from '../../ui/components';
import type { UndoInfo } from '../../services/calibrationInbox';

export function BarraDeshacer({ sinAplicar, onDescartar, undo, confirmando, onPedir, onCancelar, onDeshacer, ocupado, bloqueado }: {
  sinAplicar: boolean; onDescartar: () => void;
  undo: UndoInfo | null | undefined; confirmando: boolean; onPedir: () => void; onCancelar: () => void; onDeshacer: () => void;
  ocupado: boolean; bloqueado: boolean;
}) {
  const puede = !!undo?.available && !bloqueado && !ocupado;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      {sinAplicar && (
        <button type="button" onClick={onDescartar} disabled={bloqueado}
          className="px-2.5 min-h-9 rounded-md border border-zinc-700 text-zinc-300 hover:text-white disabled:opacity-40"
          title="Vuelve a lo guardado lo que editaste y todavía no aplicaste. No toca la pieza.">
          Descartar cambios
        </button>
      )}
      {!confirmando ? (
        <button type="button" onClick={onPedir} disabled={!puede}
          title={undo?.available ? 'Vuelve el video anterior con su texto y su sonido, sin render.' : (undo?.reason ?? 'No hay versión anterior')}
          className="px-2.5 min-h-9 rounded-md border border-zinc-700 text-zinc-300 hover:text-white disabled:opacity-40 flex items-center gap-1.5">
          {ocupado && <Spinner size={11} />} ↶ Deshacer lo aplicado{undo?.to_version ? ` (vuelve la ${undo.to_version})` : ''}
        </button>
      ) : (
        <span className="flex flex-wrap items-center gap-2 rounded-md border border-amber-400/40 bg-amber-400/[0.06] px-2 py-1 text-amber-100">
          Vuelve la {undo?.to_version ?? 'versión anterior'} con su texto y su sonido{sinAplicar ? '; lo editado sin aplicar se descarta' : ''}.
          <button type="button" onClick={onDeshacer} className="px-2 min-h-8 rounded border border-amber-300/60 text-amber-50 font-semibold">Deshacer</button>
          <button type="button" onClick={onCancelar} className="px-2 min-h-8 rounded text-zinc-300">Cancelar</button>
        </span>
      )}
    </div>
  );
}
