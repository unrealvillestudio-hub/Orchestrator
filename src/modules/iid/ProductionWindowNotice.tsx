/**
 * EL AVISO DE PRODUCCIÓN (Sam, 2026-11-09: «El día 5 de dicha semana me preguntas si activas la
 * producción de los siguientes 7 días»).
 *
 * Sale en todas las pestañas desde el día 5 de la ventana (`preguntar`) y cuando ya venció. Antes no
 * se pinta: un recuadro que está siempre se aprende a no leer. El botón sólo lo ve admin; la base
 * decide si se puede activar (antes del día 5 responde VENTANA_YA_ACTIVA). La misma pregunta llega
 * por Telegram (`PRODUCTION_WINDOW_ASK`), así que no depende de abrir esta pantalla.
 */
import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import type { IidSession } from '../../services/iidInbound';
import { fetchProductionWindow, activateNextProductionWindow, type ProductionWindow } from '../../services/calibrationInbox';

const fecha = (iso: string) =>
  new Date(iso).toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export default function ProductionWindowNotice({ session }: { session: IidSession }) {
  const [win, setWin] = useState<ProductionWindow | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetchProductionWindow(session.session_token).then((w) => { if (vivo) setWin(w); }).catch(() => { /* sin aviso */ });
    return () => { vivo = false; };
  }, [session.session_token]);

  if (!win || (!win.preguntar && !win.vencida)) return null;
  const admin = session.role === 'admin';

  const activar = async () => {
    setBusy(true); setMsg(null);
    try {
      const w = await activateNextProductionWindow(session.session_token);
      setMsg(`Activada: el carril produce hasta el ${fecha(w.ends_at)}.`);
      // El estado vuelve a leerse de la base: es ella la que decide si ya no hay que preguntar.
      setWin(await fetchProductionWindow(session.session_token).catch(() => null) ?? { ...win, hasta: w.ends_at, preguntar: false, vencida: false });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'No se pudo activar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-[12px] text-zinc-300">
      <div className="flex items-start gap-2">
        <CalendarClock size={14} className="shrink-0 mt-0.5 text-sky-400" />
        <div className="flex-1">
          <div className="font-mono text-[11px] text-sky-400/90 mb-0.5">PRODUCCIÓN · VENTANA DE 7 DÍAS</div>
          {win.vencida
            ? <p>La ventana venció el {fecha(win.hasta)}. El carril no produce hasta que actives la siguiente; lo ya producido sigue publicándose.</p>
            : <p>El carril produce hasta el {fecha(win.hasta)}. ¿Activo la producción de los siguientes 7 días? Se irá llenando a la velocidad del carril.</p>}
          {msg && <p className="mt-1 text-zinc-400">{msg}</p>}
        </div>
        {admin && (
          <button
            onClick={activar}
            disabled={busy}
            className="shrink-0 rounded-md bg-sky-500/20 px-2.5 py-1 text-sky-200 hover:bg-sky-500/30 disabled:opacity-50"
          >
            {busy ? 'Activando…' : 'Activar los siguientes 7 días'}
          </button>
        )}
      </div>
    </div>
  );
}
