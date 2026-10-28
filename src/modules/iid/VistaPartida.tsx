/**
 * LA IMAGEN DE LA PIEZA, FUERA DEL ARTEFACTO (Sam, 2026-10-28) — para poner sus correcciones justo debajo. Las
 * direcciones salen del mismo artefacto (`vistaPartida.ts`); el texto sigue en su iframe, sin el bloque de la imagen.
 */
import { AlertTriangle } from 'lucide-react';
import { Spinner } from '../../ui/components';
import type { VistaPartida } from './vistaPartida';

export function ImagenesDeLaPieza({ vista, pieceId }: { vista: VistaPartida; pieceId: string }) {
  if (!vista.carrusel || vista.imagenes.length < 2) {
    return (
      <div className="rounded-xl overflow-hidden border border-zinc-800 bg-[#050508] flex justify-center">
        <img src={vista.imagenes[0]} alt={`imagen de la pieza ${pieceId}`} className="block max-w-full h-auto max-h-[75vh] object-contain" />
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-zinc-800 bg-[#050508] p-2 space-y-1.5" aria-label={`Carrusel de ${vista.imagenes.length} láminas`}>
      <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory pb-1">
        {vista.imagenes.map((u, i) => (
          <figure key={`${i}-${u}`} className="snap-start shrink-0 space-y-1">
            <img src={u} alt={`lámina ${i + 1}`} className="block h-[55vh] md:h-[65vh] w-auto max-w-[85vw] object-contain rounded-lg" />
            <figcaption className="text-[10px] font-mono text-zinc-500 text-center">{i + 1} / {vista.imagenes.length}</figcaption>
          </figure>
        ))}
      </div>
      <p className="text-[10px] font-mono text-zinc-600">Carrusel · {vista.imagenes.length} láminas — desliza para verlas todas</p>
    </div>
  );
}

export function TextoDeLaPieza({ html, pieceId }: { html: string; pieceId: string }) {
  return (
    <div className="rounded-xl overflow-hidden border border-zinc-800 bg-[#050508]">
      <iframe srcDoc={html} title={`preview-${pieceId}`} sandbox="" className="w-full h-[55vh] md:h-[65vh]"
        style={{ border: 'none', background: '#050508' }} />
    </div>
  );
}

/** El texto de la pieza con sus tres estados: el error del artefacto, la espera y el iframe (sin la imagen si se partió). */
export function VistaPrevia({ artHtml, artErr, vista, pieceId }: {
  artHtml: string | null; artErr: string | null; vista: VistaPartida | null; pieceId: string;
}) {
  if (artErr) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-[#050508] p-4 text-[11px] text-rose-400/90 font-mono flex items-center gap-2">
        <AlertTriangle size={13} /> {artErr}
      </div>
    );
  }
  if (artHtml === null) {
    return <div className="rounded-xl border border-zinc-800 bg-[#050508] flex items-center justify-center py-16 text-zinc-700"><Spinner size={18} /></div>;
  }
  return <TextoDeLaPieza html={vista?.textoHtml ?? artHtml} pieceId={pieceId} />;
}

/** La imagen de la pieza, si el artefacto la tiene; si no (canal solo texto, o todavía no llegó), nada. */
export function ImagenSiHay({ vista, pieceId }: { vista: VistaPartida | null; pieceId: string }) {
  return vista && vista.imagenes.length > 0 ? <ImagenesDeLaPieza vista={vista} pieceId={pieceId} /> : null;
}
