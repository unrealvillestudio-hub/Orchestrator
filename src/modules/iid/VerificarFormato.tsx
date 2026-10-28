/**
 * «VERIFICAR FORMATO» (Sam, 2026-10-28) — reemplaza al botón «Cursiva». Lee el campo con las mismas reglas que el
 * envío, lo deja escrito de una sola manera y enseña cómo va a salir. La regla vive en `api/_verificarFormato.ts`.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { verificarCuerpo, verificarTextoImagen, type TramoVisto } from '../../../api/_verificarFormato';

const BOTON = 'px-2.5 py-0.5 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 text-[11px] shrink-0';

/** Un campo del texto de la imagen (titular o bajada) con su botón y la vista previa debajo. */
export function CampoConVerificacion({ children, valor, bloque, onCambio, colorResaltado }: {
  children: ReactNode; valor: string; bloque: 'titular' | 'bajada'; onCambio: (v: string) => void; colorResaltado?: string | null;
}) {
  const [visto, setVisto] = useState<{ tramos: TramoVisto[]; cambios: string[]; vacio: boolean } | { error: string } | null>(null);
  const [verificado, setVerificado] = useState<string | null>(null);
  // Lo que se ve tiene que ser lo que hay escrito: si el campo cambia después de verificar, la vista previa se va.
  useEffect(() => { if (verificado !== null && valor !== verificado) { setVisto(null); setVerificado(null); } }, [valor, verificado]);
  const verificar = () => {
    const r = verificarTextoImagen(valor, bloque);
    if (!r.ok) { setVisto({ error: r.error }); setVerificado(valor); return; }
    if (r.markup !== valor) onCambio(r.markup);
    setVisto({ tramos: r.tramos, cambios: r.cambios, vacio: !r.text });
    setVerificado(r.markup);
  };
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-1.5">
        {children}
        <button type="button" onClick={verificar} className={BOTON}
          title="Revisa las marcas (*resaltado*, _cursiva_, ~sombra~), las deja bien escritas y enseña cómo va a salir.">
          Verificar formato
        </button>
      </div>
      {visto && 'error' in visto && <p role="alert" className="text-[11px] text-red-300 leading-snug">{visto.error}</p>}
      {visto && 'tramos' in visto && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-1.5 space-y-0.5">
          <p className="text-[10px] text-zinc-500">{visto.vacio ? 'Sin bajada.' : 'Así va a salir:'}</p>
          {!visto.vacio && (
            <p className="text-sm text-zinc-100 whitespace-pre-wrap leading-snug">
              {visto.tramos.map((t, i) => (
                <span key={i}
                  title={[t.resaltado && 'resaltado', t.cursiva && 'cursiva', t.sombra && 'sombra al revés'].filter(Boolean).join(' · ') || undefined}
                  className={t.resaltado ? 'font-semibold' : undefined}
                  style={{
                    ...(t.resaltado ? { color: colorResaltado || '#c4b5fd' } : {}),
                    ...(t.cursiva ? { fontStyle: 'italic' } : {}),
                    ...(t.sombra ? { textDecoration: 'underline dotted', textUnderlineOffset: '3px' } : {}),
                  }}>
                  {t.text}
                </span>
              ))}
            </p>
          )}
          {visto.cambios.map((c) => <p key={c} className="text-[10px] text-amber-300/90">{c}</p>)}
        </div>
      )}
    </div>
  );
}

/** El cuerpo de la pieza: el botón y, al tocarlo, cómo lo pintan el blog y el artículo. */
export function VerificarCuerpo({ valor }: { valor: string }) {
  const [visto, setVisto] = useState<{ html: string; avisos: string[]; de: string } | null>(null);
  const vigente = visto && visto.de === valor ? visto : null;
  return (
    <div className="space-y-1">
      <button type="button" onClick={() => setVisto({ ...verificarCuerpo(valor), de: valor })} className={BOTON}
        title="Enseña cómo salen la negrita (**así**) y la cursiva (*así*) en el artículo, y avisa de lo que no va a salir.">
        Verificar formato
      </button>
      {vigente && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-2 space-y-1">
          <p className="text-[10px] text-zinc-500">Así sale en el artículo:</p>
          {/* El texto llega escapado y sólo se le agregan <strong> y <em> (`verificarCuerpo`). */}
          <div className="text-sm text-zinc-100 whitespace-pre-wrap leading-snug max-h-64 overflow-y-auto"
            dangerouslySetInnerHTML={{ __html: vigente.html }} />
          {vigente.avisos.map((a) => <p key={a} className="text-[10px] text-amber-300/90 leading-snug">{a}</p>)}
        </div>
      )}
    </div>
  );
}
