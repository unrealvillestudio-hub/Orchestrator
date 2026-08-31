import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { RefreshCw, Inbox, AlertTriangle, Send, Radio, RadioTower, Lock } from 'lucide-react';
import { cn, Spinner } from '../../ui/components';
import type { IidSession } from '../../services/iidInbound';
import { renderArtifact, CalibrationError } from '../../services/calibrationInbox';
import {
  fetchPublishQueue,
  type PublishablePiece, type PublishQueueResult,
  type ChannelInfo, type ChannelStatusFilter, type GenerationFilter,
} from '../../services/publishInbox';
import {
  CountPill, Selector, Pager, CutoffsNotice, GenerationBadge, WatcherBadge, Provenance, PieceHeader,
} from './pieceUi';
// Lectura en voz alta. El lector no sabe de artefactos: el adaptador le pasa el texto plano.
import { SpeechReader } from '../../ui/SpeechReader';
import { readableFromArtifactHtml } from './readablePiece';

const PAGE = 20;

/**
 * PublishQueueModule — bandeja de publicación (PUBLISH-UI-01 · parcial de SOLO LECTURA).
 *
 * Lista las piezas candidatas a salir con su canal de destino y el estado operativo de ese
 * canal, reutilizando la capa de datos y la presentación de la bandeja de calibración.
 *
 * NO APRUEBA, y eso es deliberado, no una omisión: el eje de "colocación de una pieza ya
 * producida en la franja de su canal" no existe todavía en el ecosistema. `content-scheduler`
 * programa filas de cola ANTES de producirlas (`orchestrator_status='pending'`) y
 * `scheduled_posts` es una tabla sin endpoint, sin vínculo con la pieza y sin consumidor.
 * Un botón "Aprobar" acá prometería una fecha que nadie honra — que es exactamente lo que la
 * bandeja debe evitar. El motivo viaja en el contrato del endpoint (`approval.reason`), así
 * que cuando el eje exista se habilita del lado del server.
 *
 * Calibrar y publicar son ejes independientes: esta bandeja no mira el corpus, y la de
 * calibración no mira el canal.
 */
export default function PublishQueueModule({ session }: { session: IidSession }) {
  const token = session.session_token;

  const [data, setData]       = useState<PublishQueueResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [brand, setBrand]     = useState('');
  const [channel, setChannel] = useState('');
  const [chStatus, setChStatus] = useState<ChannelStatusFilter>('all');
  const [gen, setGen]         = useState<GenerationFilter>('all');
  const [offset, setOffset]   = useState(0);

  type Query = { offset: number; brand: string; channel: string; chStatus: ChannelStatusFilter; gen: GenerationFilter };
  const current = (): Query => ({ offset, brand, channel, chStatus, gen });

  const load = async (q: Query) => {
    setLoading(true); setError(null);
    try {
      const r = await fetchPublishQueue(token, {
        limit: PAGE,
        offset: q.offset,
        brand: q.brand || undefined,
        channel: q.channel || undefined,
        channelStatus: q.chStatus,
        generation: q.gen,
      });
      setData(r);
    } catch (err) {
      setError(err instanceof CalibrationError ? err.message : 'No se pudo cargar la bandeja.');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(current()); /* eslint-disable-next-line */ }, []);

  // Todo cambio de filtro vuelve a la primera página: el offset viejo no significa lo mismo
  // sobre un conjunto distinto.
  const apply = (patch: Partial<Query>) => {
    const q = { ...current(), offset: 0, ...patch };
    setOffset(q.offset); setBrand(q.brand); setChannel(q.channel); setChStatus(q.chStatus); setGen(q.gen);
    load(q);
  };
  const goPage = (o: number) => { setOffset(o); load({ ...current(), offset: o }); };

  const total     = data?.total ?? 0;
  const byBrand   = data?.by_brand ?? {};
  const byChannel = data?.by_channel ?? {};
  const pieces    = data?.pieces ?? [];
  // Marcas y canales se DESCUBREN del dato; ninguna lista vive en este archivo.
  const brands   = useMemo(() => Object.keys(byBrand).sort(), [byBrand]);
  const channels = useMemo(() => Object.keys(byChannel).sort(), [byChannel]);

  return (
    <div className="max-w-3xl mx-auto px-6 py-2">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h3 className="font-display text-lg font-bold text-white">Bandeja de publicación</h3>
          <p className="text-sm text-zinc-500 mt-0.5">
            Piezas listas para salir, con su canal de destino y si ese canal está operativo.
            <span className="text-zinc-400"> Solo lectura por ahora</span> — ver el aviso.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[11px] font-mono px-2 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400">
            {total} pieza{total === 1 ? '' : 's'}
          </span>
          <button
            onClick={() => load(current())}
            className="p-2 hover:bg-zinc-800 rounded-xl transition-colors text-zinc-600 hover:text-zinc-400"
            title="Refrescar"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Por qué no hay botón de aprobar. El motivo lo da el server, no esta pantalla. */}
      {data && !data.approval.available && (
        <div className="flex items-start gap-2.5 text-[12px] text-amber-300/90 bg-amber-500/[0.06] border border-amber-500/25 rounded-xl px-3.5 py-3 mb-5 leading-relaxed">
          <Lock size={15} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-200">Esta bandeja todavía no aprueba.</p>
            <p className="mt-1 text-amber-300/75">{data.approval.reason}</p>
          </div>
        </div>
      )}

      {/* Filtro por marca */}
      {brands.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap bg-zinc-900/80 border border-zinc-800 rounded-xl p-1 mb-2">
          <CountPill label="Todas" count={Object.values(byBrand).reduce((a, b) => a + b, 0)} active={brand === ''} onClick={() => apply({ brand: '' })} />
          {brands.map((b) => (
            <CountPill key={b} label={b} count={byBrand[b]} active={brand === b} onClick={() => apply({ brand: b })} />
          ))}
        </div>
      )}

      {/* Filtro por canal */}
      {channels.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap bg-zinc-900/80 border border-zinc-800 rounded-xl p-1 mb-3">
          <CountPill label="Todos los canales" count={Object.values(byChannel).reduce((a, b) => a + b, 0)} active={channel === ''} onClick={() => apply({ channel: '' })} />
          {channels.map((c) => (
            <CountPill key={c} label={c} count={byChannel[c]} active={channel === c} onClick={() => apply({ channel: c })} />
          ))}
        </div>
      )}

      {/* Filtros transversales */}
      <div className="flex items-center gap-4 flex-wrap mb-5 text-[11px] font-mono text-zinc-600">
        <Selector
          label="Estado del canal"
          value={chStatus}
          onChange={(v) => apply({ chStatus: v as ChannelStatusFilter })}
          options={[['all', 'Todos'], ['operational', 'Operativo'], ['blocked', 'Bloqueado']]}
        />
        <Selector
          label="Flujo"
          value={gen}
          onChange={(v) => apply({ gen: v as GenerationFilter })}
          options={[['all', 'Todas'], ['current', 'Solo corregido']]}
        />
      </div>

      {data && <CutoffsNotice source={data.cutoffs_source} />}

      {error && (
        <div className="flex items-start gap-2 text-[12px] text-rose-400/90 bg-rose-500/[0.06] border border-rose-500/20 rounded-xl px-3 py-2 mb-4">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span className="leading-snug">{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-zinc-700"><Spinner size={22} /></div>
      ) : pieces.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-2 text-zinc-700">
          <Inbox size={36} strokeWidth={1} />
          <p className="text-sm">{total === 0 ? 'Nada esperando salir.' : 'Sin piezas en esta página.'}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pieces.map((p) => <PublishCard key={p.piece_id} piece={p} token={token} />)}
        </div>
      )}

      <Pager offset={offset} pageSize={PAGE} total={total} loading={loading} onGo={goPage} />
    </div>
  );
}

// ── Canal de destino ─────────────────────────────────────────────────────────────
// El nombre del canal y su proveedor salen del dato. Acá no hay lista de canales.
function ChannelBadge({ channel }: { channel: ChannelInfo }) {
  const operational = channel.status === 'operational';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border',
        operational
          ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300/85'
          : 'bg-rose-500/10 border-rose-500/35 text-rose-300'
      )}
      title={operational
        ? `Canal operativo${channel.provider ? ` · proveedor ${channel.provider}` : ''}`
        : (channel.reason ?? 'Canal no operativo')}
    >
      {operational ? <RadioTower size={10} /> : <Radio size={10} />}
      {channel.platform_key ?? 'sin canal'}
      {operational && channel.provider && <span className="text-emerald-300/45">· {channel.provider}</span>}
    </span>
  );
}

// ── Tarjeta ──────────────────────────────────────────────────────────────────────
function PublishCard({ piece, token }: { piece: PublishablePiece; token: string }) {
  // Artefacto renderizado (texto tal como saldría + imagen compuesta si la hay). Mismo
  // mecanismo que la bandeja de calibración: srcdoc, porque el CDN sirve text/plain.
  const [artHtml, setArtHtml] = useState<string | null>(null);
  const [artUrl, setArtUrl]   = useState<string | null>(null);
  const [artErr, setArtErr]   = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    renderArtifact(token, piece.piece_id)
      .then((r) => { if (alive) { setArtHtml(r.html); setArtUrl(r.artifact_url); } })
      .catch((err) => { if (alive) setArtErr(err instanceof CalibrationError ? err.message : 'No se pudo renderizar el artefacto.'); });
    return () => { alive = false; };
  }, [piece.piece_id, token]);

  // El texto de la pieza para el lector en voz alta, del MISMO `html` que ya se recibe de
  // `preview-render`. Mismo adaptador que en calibración: las dos bandejas leen igual.
  const readable = useMemo(() => (artHtml ? readableFromArtifactHtml(artHtml) : null), [artHtml]);

  const blocked = piece.channel.status !== 'operational';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden"
      style={{ borderLeftWidth: 3, borderLeftColor: blocked ? '#f43f5e' : '#FFAB00' }}
    >
      <div className="p-4 space-y-4">
        {/* Cabecera (la MISMA que la bandeja de calibración) + canal + watcher + generación.
            FIX-CARD-06: identidad y conteos salen de `PieceHeader`; el canal es lo propio
            de esta bandeja y por eso se queda acá. */}
        <div className="space-y-1.5">
          <PieceHeader piece={piece} />
          <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono text-zinc-600">
            <ChannelBadge channel={piece.channel} />
            <WatcherBadge
              verdict={piece.watcher_verdict}
              reason={piece.watcher_reason}
              failedRules={piece.watcher_failed_rules}
              rulesEvaluated={piece.watcher_rules_evaluated}
              passType={piece.pass_type}
            />
            <GenerationBadge generation={piece.generation} label={piece.cutoff_label} at={piece.cutoff_at} />
          </div>
        </div>

        <Provenance piece={piece} />

        {/* Artefacto embebido */}
        <div className="rounded-xl overflow-hidden border border-zinc-800 bg-[#050508]">
          {artErr ? (
            <div className="p-4 text-[11px] text-rose-400/90 font-mono flex items-center gap-2">
              <AlertTriangle size={13} /> {artErr}
            </div>
          ) : artHtml === null ? (
            <div className="flex items-center justify-center py-16 text-zinc-700"><Spinner size={18} /></div>
          ) : (
            <iframe
              srcDoc={artHtml}
              title={`preview-${piece.piece_id}`}
              sandbox=""
              className="w-full"
              style={{ height: 480, border: 'none', background: '#050508' }}
            />
          )}
        </div>
        {artUrl && (
          <a href={artUrl} target="_blank" rel="noopener noreferrer"
             className="block text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors truncate">
            {artUrl}
          </a>
        )}

        {/* Lectura en voz alta. Va debajo de la vista previa porque se lee lo mismo que se
            ve, y su propio bloque de texto es donde ocurre la selección: dentro del
            `<iframe sandbox="">` de arriba, `getSelection()` no alcanza. */}
        {readable && <SpeechReader piece={readable} />}

        {/* Estado de salida. Cuando el canal bloquea, el motivo se lee sin abrir nada; cuando
            no bloquea, tampoco hay acción todavía y se dice por qué. */}
        <div
          className={cn(
            'flex items-start gap-2 rounded-lg px-3 py-2 text-[11px] font-mono leading-snug border',
            blocked
              ? 'bg-rose-500/[0.06] border-rose-500/25 text-rose-300/90'
              : 'bg-zinc-800/40 border-zinc-700/60 text-zinc-400'
          )}
        >
          {blocked ? <Lock size={13} className="shrink-0 mt-0.5" /> : <Send size={13} className="shrink-0 mt-0.5" />}
          <span>
            {blocked
              ? `${piece.channel.reason} — esta pieza no podría salir aunque la bandeja aprobara.`
              : 'Canal operativo. La aprobación se hace en la bandeja de calibración.'}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
