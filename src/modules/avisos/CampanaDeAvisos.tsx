/**
 * LA CAMPANITA — avisos push propios en este dispositivo (Sam, 2026-11-12).
 *
 * Antes era sólo un icono, y además oculto en el móvil. Ahora se ve en todas las pantallas y dice su estado:
 *   · gris        → apagado en este dispositivo: un toque pide permiso y suscribe;
 *   · ámbar       → activo: un toque ofrece apagarlo;
 *   · tachada     → el permiso está bloqueado: se reactiva en los ajustes del sistema, no desde aquí;
 *   · sin soporte → el navegador no admite push (en iPhone hace falta añadir la app a la pantalla de inicio).
 */
import { useEffect, useState } from 'react';
import { Bell, BellOff, BellRing } from 'lucide-react';
import { activarAvisos, desactivarAvisos, estadoDeAvisos, type EstadoDeAvisos } from '../../services/avisosPush';

const TEXTO: Record<EstadoDeAvisos, string> = {
  sin_soporte: 'Este navegador no admite avisos push. En iPhone, añade el Orchestrator a la pantalla de inicio.',
  bloqueado: 'Los avisos están bloqueados para el Orchestrator. Se activan en los ajustes de notificaciones del sistema.',
  apagado: 'Activar los avisos de las sesiones en este dispositivo',
  activo: 'Avisos activos en este dispositivo. Toca para apagarlos.',
};

export default function CampanaDeAvisos({ token }: { token: string }) {
  const [estado, setEstado] = useState<EstadoDeAvisos | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    estadoDeAvisos().then((e) => { if (vivo) setEstado(e); }).catch(() => { if (vivo) setEstado('sin_soporte'); });
    return () => { vivo = false; };
  }, []);

  async function alTocar() {
    if (!estado || ocupado) return;
    setError(null);
    if (estado === 'sin_soporte' || estado === 'bloqueado') { setError(TEXTO[estado]); return; }
    if (estado === 'activo' && !window.confirm('¿Apagar los avisos de las sesiones en este dispositivo?')) return;
    setOcupado(true);
    try {
      setEstado(estado === 'activo' ? await desactivarAvisos(token) : await activarAvisos(token));
    } catch (e) {
      setError(`No se pudieron ${estado === 'activo' ? 'apagar' : 'activar'} los avisos: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setOcupado(false);
    }
  }

  const Icono = estado === 'activo' ? BellRing : estado === 'bloqueado' || estado === 'sin_soporte' ? BellOff : Bell;
  const color = estado === 'activo' ? 'text-accent' : 'text-zinc-500';
  return (
    <div className="relative">
      <button
        type="button"
        onClick={alTocar}
        disabled={ocupado || !estado}
        title={estado ? TEXTO[estado] : 'Comprobando los avisos…'}
        aria-label={estado ? TEXTO[estado] : 'Comprobando los avisos'}
        className="p-2 hover:bg-zinc-800 rounded-xl transition-colors disabled:opacity-50"
      >
        <Icono size={15} className={`${color} ${ocupado ? 'animate-pulse' : ''}`} />
      </button>
      {error && (
        <div
          role="alert"
          onClick={() => setError(null)}
          className="absolute right-0 top-full mt-2 w-64 z-50 text-[11px] leading-snug text-zinc-200 bg-zinc-900 border border-zinc-700 rounded-xl p-3 shadow-xl"
        >
          {error}
        </div>
      )}
    </div>
  );
}
