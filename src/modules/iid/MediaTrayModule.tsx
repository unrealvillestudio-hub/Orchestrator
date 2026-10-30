/**
 * MediaTrayModule.tsx — Orchestrator · LA BANDEJA DE MEDIOS
 *
 * Lo que un agente subió al bucket y espera una decisión. Es la ÚNICA puerta de salida de la zona de
 * entrada, y es humana a propósito: si hubiera un endpoint que un agente pudiera llamar, subiría y
 * promovería en el mismo gesto.
 *
 * LA TARJETA MUESTRA EL ARTEFACTO, NO SU DESCRIPCIÓN. Se ve la imagen, a tamaño suficiente para
 * decidir. Lo que la acompaña es lo único que el agente no escribe: qué principal pidió el permiso,
 * cuándo llegó y cuántos días lleva esperando. Un texto escrito por quien subió el archivo
 * convertiría esto en aprobar sus palabras.
 *
 * NO HAY BOTÓN DE «LUEGO». Dejarlo para luego es cerrar la pestaña; el objeto sigue aquí con un día
 * más a la vista. Y el motivo es obligatorio en las dos salidas: dentro de tres meses es lo único
 * que responde por qué una imagen está donde está.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image as ImageIcon, ArrowUpCircle, Trash2, AlertTriangle, RefreshCw } from 'lucide-react';
import { Spinner, cn } from '../../ui/components';
import type { IidSession } from '../../services/iidInbound';
import { fetchMediaTray, decideMedia, CalibrationError, type MediaItem, type MediaTray } from '../../services/mediaTray';

const MOTIVO_MINIMO = 10;

const pesoLegible = (bytes: number | null): string => {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const esperaLegible = (dias: number | null): string => {
  if (dias == null) return 'sin fecha';
  if (dias === 0) return 'hoy';
  return dias === 1 ? 'hace 1 día' : `hace ${dias} días`;
};

function Tarjeta({ item, bloqueada: bloqueadaPorRegistro, onDecidir }: {
  item: MediaItem;
  bloqueada: boolean;
  onDecidir: (decision: 'promote' | 'discard', motive: string) => Promise<void>;
}) {
  const [motivo, setMotivo] = useState('');
  const [enCurso, setEnCurso] = useState<'promote' | 'discard' | null>(null);
  const corto = motivo.trim().length < MOTIVO_MINIMO;
  /**
   * SIN ARTEFACTO NO HAY DECISIÓN. El bucket de entrada es privado desde el 2026-10-30 y la imagen
   * llega por URL firmada; si la firma no se pudo emitir, aprobar sería aprobar una ruta y un
   * tamaño, no lo que alguien subió — que es exactamente lo que esta bandeja existe para no hacer.
   */
  const sinArtefacto = !item.url;
  const bloqueada = bloqueadaPorRegistro || sinArtefacto;

  const decidir = async (decision: 'promote' | 'discard') => {
    if (corto || bloqueada) return;
    setEnCurso(decision);
    try { await onDecidir(decision, motivo.trim()); } finally { setEnCurso(null); }
  };

  return (
    <div className="border border-zinc-800/70 rounded-xl overflow-hidden bg-zinc-950/40">
      {/* EL ARTEFACTO. Fondo a cuadros para que una imagen con transparencia no se lea como blanca. */}
      {sinArtefacto ? (
        <div className="bg-zinc-900 px-4 py-8 text-center space-y-1">
          <p className="text-xs text-amber-300">No se pudo firmar la URL de esta imagen.</p>
          <p className="text-[10px] text-zinc-500">
            El bucket de entrada es privado y la tarjeta necesita una URL firmada para mostrar el
            artefacto. Sin verlo no se decide: recarga la bandeja.
          </p>
        </div>
      ) : (
        <a href={item.url!} target="_blank" rel="noreferrer" className="block bg-zinc-900">
          <img
            src={item.url!}
            alt={`Objeto en espera de decisión · ${item.brand_id}`}
            loading="lazy"
            className="w-full max-h-72 object-contain bg-[conic-gradient(#18181b_90deg,#09090b_0_180deg,#18181b_0_270deg,#09090b_0)] bg-[length:16px_16px]"
          />
        </a>
      )}

      <div className="p-3 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-zinc-200 truncate">{item.brand_id}</p>
            <p className="text-[10px] font-mono text-zinc-500 truncate" title={item.object_path}>
              {item.object_path}
            </p>
          </div>
          <span className={cn('text-[10px] font-mono whitespace-nowrap px-1.5 py-0.5 rounded',
            (item.dias_esperando ?? 0) >= 7 ? 'bg-amber-500/15 text-amber-300' : 'text-zinc-500')}>
            {esperaLegible(item.dias_esperando)}
          </span>
        </div>

        {/* LO QUE EL AGENTE NO ESCRIBE. Si esto lo redactara quien subió el archivo, no serviría. */}
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] font-mono text-zinc-500">
          <div><dt className="inline text-zinc-600">lo pidió </dt><dd className="inline text-zinc-400">{item.subido_por ?? 'no consta'}</dd></div>
          <div><dt className="inline text-zinc-600">peso </dt><dd className="inline text-zinc-400">{pesoLegible(item.bytes)}</dd></div>
          <div><dt className="inline text-zinc-600">tipo </dt><dd className="inline text-zinc-400">{item.mime ?? '—'}</dd></div>
          <div><dt className="inline text-zinc-600">llegó </dt><dd className="inline text-zinc-400">{item.subido_en?.slice(0, 16).replace('T', ' ') ?? '—'}</dd></div>
        </dl>

        {item.decidido && (
          <p className="text-[10px] font-mono text-amber-300/80 flex items-start gap-1">
            <AlertTriangle size={11} className="mt-px shrink-0" />
            Hubo un intento anterior ({item.decidido.decision}) que quedó en «{item.decidido.outcome}».
            Sigue aquí, así que no se consumó.
          </p>
        )}

        <div>
          <label className="block text-[10px] font-mono uppercase tracking-widest text-zinc-600 mb-1">
            Motivo — obligatorio
          </label>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={2}
            maxLength={500}
            disabled={bloqueada || !!enCurso}
            placeholder="Por qué esta imagen se promueve, o por qué se descarta."
            className="w-full text-xs bg-zinc-900/70 border border-zinc-800 rounded-lg px-2 py-1.5 text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-accent/60 disabled:opacity-50"
          />
          {corto && motivo.length > 0 && (
            <p className="text-[10px] font-mono text-zinc-600 mt-1">
              Faltan {MOTIVO_MINIMO - motivo.trim().length} caracteres.
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => decidir('promote')}
            disabled={corto || bloqueada || !!enCurso}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-2 bg-accent text-black disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {enCurso === 'promote' ? <Spinner size={13} /> : <ArrowUpCircle size={13} />} Promover
          </button>
          <button
            type="button"
            onClick={() => decidir('discard')}
            disabled={corto || bloqueada || !!enCurso}
            className="flex items-center justify-center gap-1.5 text-xs rounded-lg px-3 py-2 border border-zinc-800 text-zinc-400 hover:text-red-300 hover:border-red-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {enCurso === 'discard' ? <Spinner size={13} /> : <Trash2 size={13} />} Descartar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MediaTrayModule({ session }: { session: IidSession }) {
  const [bandeja, setBandeja] = useState<MediaTray | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setBandeja(await fetchMediaTray(session.session_token));
    } catch (err) {
      setError(err instanceof CalibrationError ? err.message : String(err));
    } finally {
      setCargando(false);
    }
  }, [session.session_token]);

  useEffect(() => { void cargar(); }, [cargar]);

  const marcas = useMemo(() => Object.entries(bandeja?.by_brand ?? {}).sort((a, b) => b[1] - a[1]), [bandeja]);

  const decidir = async (item: MediaItem, decision: 'promote' | 'discard', motive: string) => {
    setAviso(null);
    try {
      const r = await decideMedia(session.session_token, item.object_path, decision, motive);
      setAviso(
        r.decision === 'promote'
          ? `Promovida: ${r.destination_path ?? '(sin destino)'}`
          : `Descartada: ${r.object_path}`,
      );
      // Si el desenlace no se pudo sellar, el bucket cambió y la fila no lo refleja: se dice.
      if (!r.desenlace_registrado) {
        setAviso(`Hecho, pero el registro no quedó sellado. Hay que mirar la fila de ${r.object_path} a mano.`);
      }
      await cargar();
    } catch (err) {
      setError(err instanceof CalibrationError ? err.message : String(err));
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
            <ImageIcon size={17} className="text-accent" /> Medios en espera
          </h2>
          <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
            Lo que un agente subió al bucket. Nada de esto forma parte de ninguna publicación hasta
            que lo promuevas, y nada se borra solo: la decisión es tuya en los dos sentidos.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void cargar()}
          disabled={cargando}
          className="shrink-0 flex items-center gap-1.5 text-[11px] font-mono text-zinc-400 border border-zinc-800 rounded-lg px-2.5 py-1.5 hover:text-zinc-200 disabled:opacity-40"
        >
          {cargando ? <Spinner size={12} /> : <RefreshCw size={12} />} Recargar
        </button>
      </header>

      {bandeja && (bandeja.sin_url ?? 0) > 0 && (
        <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          {bandeja.aviso_firmas
            ?? `${bandeja.sin_url} objetos llegan sin URL firmada: su tarjeta no muestra la imagen y no se puede decidir.`}
        </p>
      )}

      {bandeja && !bandeja.decisiones_legibles && (
        <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-px shrink-0" />
          {bandeja.aviso ?? 'El registro de decisiones todavía no existe: se puede leer, no decidir.'}
        </p>
      )}

      {error && (
        <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
      )}
      {aviso && (
        <p className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">{aviso}</p>
      )}

      {bandeja && (
        <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono">
          <span className="text-zinc-500">{bandeja.total} en espera</span>
          {bandeja.esperando > 0 && (
            <span className="text-amber-300">{bandeja.esperando} llevan una semana o más</span>
          )}
          {marcas.map(([marca, n]) => (
            <span key={marca} className="text-zinc-600">· {marca} {n}</span>
          ))}
        </div>
      )}

      {cargando && !bandeja && (
        <div className="flex items-center gap-2 text-xs text-zinc-500"><Spinner size={14} /> Leyendo la zona de entrada…</div>
      )}

      {bandeja && bandeja.items.length === 0 && !cargando && (
        <p className="text-xs text-zinc-500 border border-zinc-800/60 rounded-lg px-3 py-6 text-center">
          Nada en espera. Es el estado normal: aquí sólo aparece lo que un agente sube.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(bandeja?.items ?? []).map((item) => (
          <Tarjeta
            key={item.object_path}
            item={item}
            bloqueada={!bandeja?.decisiones_legibles}
            onDecidir={(decision, motive) => decidir(item, decision, motive)}
          />
        ))}
      </div>
    </div>
  );
}
