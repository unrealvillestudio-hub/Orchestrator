/**
 * EL AVISO DE PRODUCCIÓN. Sam, 2026-11-09: «El día 5 de dicha semana me preguntas si activas la
 * producción de los siguientes 7 días». Sam, 2026-11-17: ventanas de 3 días y sólo para las marcas
 * que elija («activa el carril para esas 3 marcas para los próximos 3 días»).
 *
 * Sale en todas las pestañas cuando alguna marca está en la víspera del fin de su ventana
 * (`preguntar`), la tiene vencida o nunca la activó. Si no, no se pinta: un recuadro que está siempre
 * se aprende a no leer. Las casillas y el botón sólo los ve admin. La base decide qué marca se puede
 * activar (`se_puede_activar`) y cuántos días abre (`siguiente_hasta`). La misma pregunta llega por
 * Telegram, marca por marca (`PRODUCTION_WINDOW_ASK`), así que no depende de abrir esta pantalla.
 *
 * Sin la vista por marca (migración sin aplicar) el aviso pinta sólo la ventana global, sin botón.
 */
import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import type { IidSession } from '../../services/iidInbound';
import {
  fetchProductionWindow, activateNextProductionWindow,
  type ProductionWindowState, type BrandProductionWindow,
} from '../../services/calibrationInbox';

const fecha = (iso: string) =>
  new Date(iso).toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/** Los días que abriría la siguiente ventana, leídos de la base (siguiente_hasta − su inicio). */
function diasDeLaSiguiente(b: BrandProductionWindow): number {
  const inicio = Math.max(Date.now(), b.hasta ? new Date(b.hasta).getTime() : 0);
  return Math.max(1, Math.round((new Date(b.siguiente_hasta).getTime() - inicio) / 86_400_000));
}

function estado(b: BrandProductionWindow): string {
  if (!b.hasta) return 'nunca activada · no produce';
  if (b.vencida) return `detenida desde el ${fecha(b.hasta)}`;
  return `produce hasta el ${fecha(b.hasta)}`;
}

export default function ProductionWindowNotice({ session }: { session: IidSession }) {
  const [st, setSt] = useState<ProductionWindowState | null>(null);
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetchProductionWindow(session.session_token).then((s) => { if (vivo) setSt(s); }).catch(() => { /* sin aviso */ });
    return () => { vivo = false; };
  }, [session.session_token]);

  if (!st) return null;
  const admin = session.role === 'admin';
  const marcas = st.brands;

  // Sin vista por marca: sólo se informa de la global, como antes.
  if (!marcas) {
    const win = st.window;
    if (!win || (!win.preguntar && !win.vencida)) return null;
    return (
      <div className="mb-4 rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-[12px] text-zinc-300">
        <div className="flex items-start gap-2">
          <CalendarClock size={14} className="shrink-0 mt-0.5 text-sky-400" />
          <div className="flex-1">
            <div className="font-mono text-[11px] text-sky-400/90 mb-0.5">PRODUCCIÓN · VENTANA GLOBAL</div>
            <p>{win.vencida
              ? `La ventana venció el ${fecha(win.hasta)}. El carril no produce hasta que actives la siguiente.`
              : `El carril produce hasta el ${fecha(win.hasta)}.`}</p>
          </div>
        </div>
      </div>
    );
  }

  const aviso = marcas.some((b) => b.preguntar || b.vencida || !b.hasta);
  if (!aviso && !msg) return null;
  const activables = marcas.filter((b) => b.se_puede_activar);
  const dias = activables.length ? diasDeLaSiguiente(activables[0]) : null;

  const alternar = (id: string) => setElegidas((prev) => {
    const s = new Set(prev);
    if (s.has(id)) s.delete(id); else s.add(id);
    return s;
  });

  const activar = async () => {
    if (elegidas.size === 0) return;
    setBusy(true); setMsg(null);
    try {
      const res = await activateNextProductionWindow(session.session_token, [...elegidas]);
      setMsg(res.map((r) => r.ok && r.window
        ? `${r.brand_id}: produce hasta el ${fecha(r.window.ends_at)}.`
        : `${r.brand_id}: ${r.error === 'ventana_ya_activa'
          ? 'su ventana sigue vigente; la siguiente se activa desde la víspera del fin'
          : (r.detail || 'no se pudo activar')}.`,
      ).join(' '));
      setElegidas(new Set());
      // El estado vuelve a leerse de la base: es ella la que decide si ya no hay que preguntar.
      setSt(await fetchProductionWindow(session.session_token).catch(() => st));
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
          <div className="font-mono text-[11px] text-sky-400/90 mb-1">
            PRODUCCIÓN · VENTANA POR MARCA{dias ? ` · ${dias} DÍAS` : ''}
          </div>
          <ul className="space-y-0.5">
            {marcas.map((b) => (
              <li key={b.brand_id} className="flex items-center gap-2">
                {admin && (
                  <input
                    type="checkbox"
                    aria-label={`Activar ${b.brand_id}`}
                    checked={elegidas.has(b.brand_id)}
                    disabled={!b.se_puede_activar || busy}
                    onChange={() => alternar(b.brand_id)}
                    className="accent-sky-400 disabled:opacity-30"
                  />
                )}
                <span className="font-medium text-zinc-200">{b.brand_id}</span>
                <span className={b.vencida || !b.hasta ? 'text-zinc-500' : b.preguntar ? 'text-amber-300/90' : 'text-zinc-400'}>
                  {estado(b)}{b.preguntar ? ' · ¿activo la siguiente?' : ''}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-zinc-500">Lo ya producido sigue publicándose. La siguiente ventana se llena a la velocidad del carril.</p>
          {msg && <p className="mt-1 text-zinc-400">{msg}</p>}
        </div>
        {admin && activables.length > 0 && (
          <button
            onClick={activar}
            disabled={busy || elegidas.size === 0}
            className="shrink-0 rounded-md bg-sky-500/20 px-2.5 py-1 text-sky-200 hover:bg-sky-500/30 disabled:opacity-50"
          >
            {busy ? 'Activando…' : dias ? `Activar los siguientes ${dias} días` : 'Activar la siguiente ventana'}
          </button>
        )}
      </div>
    </div>
  );
}
