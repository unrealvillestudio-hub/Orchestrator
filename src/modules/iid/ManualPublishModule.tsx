import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Inbox, AlertTriangle, Copy, Check, Download } from 'lucide-react';
import { cn, Spinner } from '../../ui/components';
import type { IidSession } from '../../services/iidInbound';
import {
  fetchManualQueue, CalibrationError,
  type ManualItem, type ManualQueueResult,
} from '../../services/publishInbox';
import { CountPill, fmtInZone } from './pieceUi';

/**
 * ManualPublishModule — pestaña «Manual» dentro de Publicación (Sam, 2026-10-01).
 *
 * Lo que hay que publicar a mano, con todo lo necesario para hacerlo y nada más: las fotos con su
 * URL y UN bloque de texto —título, cuerpo, hashtags y firma juntos— listo para copiar y pegar.
 * Filtrable por marca y por canal; los dos filtros salen del dato, ninguna lista vive acá.
 *
 * Solo lectura: esta pestaña no marca nada como publicado.
 */
export default function ManualPublishModule({ session }: { session: IidSession }) {
  const token = session.session_token;
  const [data, setData] = useState<ManualQueueResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [brand, setBrand] = useState('');
  const [channel, setChannel] = useState('');

  const load = async (b: string, c: string) => {
    setLoading(true); setError(null);
    try {
      setData(await fetchManualQueue(token, { brand: b || undefined, channel: c || undefined }));
    } catch (err) {
      setError(err instanceof CalibrationError ? err.message : 'No se pudo cargar la lista.');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(brand, channel); /* eslint-disable-next-line */ }, []);

  const apply = (b: string, c: string) => { setBrand(b); setChannel(c); load(b, c); };

  const byBrand = data?.by_brand ?? {};
  const byChannel = data?.by_channel ?? {};
  const brands = useMemo(() => Object.keys(byBrand).sort(), [byBrand]);
  const channels = useMemo(() => Object.keys(byChannel).sort(), [byChannel]);
  const items = data?.items ?? [];
  const sum = (m: Record<string, number>) => Object.values(m).reduce((a, n) => a + n, 0);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm text-zinc-500">Piezas de canales que se publican a mano. Copiar, pegar, publicar.</p>
        <button
          onClick={() => load(brand, channel)}
          className="p-2 hover:bg-zinc-800 rounded-xl transition-colors text-zinc-600 hover:text-zinc-400 shrink-0"
          title="Refrescar"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {brands.length > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto md:flex-wrap bg-zinc-900/80 border border-zinc-800 rounded-xl p-1 mb-2 [&>*]:shrink-0">
          <CountPill label="Todas" count={sum(byBrand)} active={brand === ''} onClick={() => apply('', channel)} />
          {brands.map((b) => (
            <CountPill key={b} label={b} count={byBrand[b]} active={brand === b} onClick={() => apply(b, channel)} />
          ))}
        </div>
      )}
      {channels.length > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto md:flex-wrap bg-zinc-900/80 border border-zinc-800 rounded-xl p-1 mb-4 [&>*]:shrink-0">
          <CountPill label="Todos los canales" count={sum(byChannel)} active={channel === ''} onClick={() => apply(brand, '')} />
          {channels.map((c) => (
            <CountPill key={c} label={c} count={byChannel[c]} active={channel === c} onClick={() => apply(brand, c)} />
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-[12px] text-rose-400/90 bg-rose-500/[0.06] border border-rose-500/20 rounded-xl px-3 py-2 mb-4">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span className="leading-snug">{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-zinc-700"><Spinner size={22} /></div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-2 text-zinc-700">
          <Inbox size={36} strokeWidth={1} />
          <p className="text-sm">Nada para publicar a mano.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((it) => <ManualCard key={it.slot_id} item={it} />)}
        </div>
      )}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }).catch(() => {});
      }}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
        ok ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700'
      )}
    >
      {ok ? <Check size={13} /> : <Copy size={13} />}
      {ok ? 'Copiado' : label}
    </button>
  );
}

function ManualCard({ item }: { item: ManualItem }) {
  const z = fmtInZone(item.slot_at, item.timezone);
  return (
    <div
      className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3 md:p-4 space-y-3"
      style={{ borderLeftWidth: 3, borderLeftColor: item.due ? '#f59e0b' : '#3f3f46' }}
    >
      <div className="flex items-center gap-x-2 gap-y-1 flex-wrap text-[11px] font-mono text-zinc-500">
        <span className="text-accent font-semibold">{item.brand_id}</span>
        <span>·</span>
        <span className="text-zinc-300">{item.platform_key}</span>
        {item.format && <><span>·</span><span>{item.format}</span></>}
        <span>·</span>
        <span className={item.due ? 'text-amber-300' : 'text-zinc-400'} title={z?.title ?? item.slot_at}>
          {item.due ? 'Toca ya — ' : 'Sale '}{z ? `${z.when} (${z.zone})` : `${item.slot_at} UTC`}
        </span>
      </div>

      {item.images.length > 0 ? (
        <div className="space-y-2">
          <div className="flex gap-2 overflow-x-auto">
            {item.images.map((u, i) => (
              <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="relative shrink-0" title={`Foto ${i + 1}: abrir para descargar`}>
                <img src={u} alt={`Foto ${i + 1}`} loading="lazy" className="h-32 w-32 object-cover rounded-lg border border-zinc-800" />
                {item.images.length > 1 && (
                  <span className="absolute top-1 left-1 text-[10px] font-mono bg-black/70 text-white px-1.5 rounded">{i + 1}</span>
                )}
                <Download size={12} className="absolute bottom-1 right-1 text-white/80" />
              </a>
            ))}
          </div>
          <div className="space-y-1">
            {item.images.map((u, i) => (
              <div key={u} className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-zinc-600 shrink-0">{item.images.length > 1 ? `${i + 1}.` : 'URL'}</span>
                <a href={u} target="_blank" rel="noopener noreferrer" className="text-[11px] font-mono text-zinc-400 hover:text-zinc-200 truncate">{u}</a>
              </div>
            ))}
          </div>
          <CopyButton text={item.images.join('\n')} label={item.images.length > 1 ? 'Copiar URLs' : 'Copiar URL'} />
        </div>
      ) : (
        <p className="text-[11px] font-mono text-amber-300/80">Esta pieza no tiene imagen.</p>
      )}

      <pre className="whitespace-pre-wrap break-words font-body text-[13px] leading-relaxed text-zinc-200 bg-[#050508] border border-zinc-800 rounded-xl p-3 max-h-[60vh] overflow-y-auto">
        {item.text || '—'}
      </pre>
      <CopyButton text={item.text} label="Copiar texto" />
    </div>
  );
}
