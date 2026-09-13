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
  SlotLine, SlotsNotice, PieceSearchBox, SearchNotice,
} from './pieceUi';
// U-5 — el ÚNICO componente de acciones del sistema, el mismo que monta calibración.
import { PieceActionsBar } from './pieceActions';
// Lectura en voz alta. El lector no sabe de artefactos: el adaptador le pasa el texto plano.
import { SpeechReader } from '../../ui/SpeechReader';
import { readableFromArtifactHtml } from './readablePiece';

const PAGE = 20;

/**
 * PublishQueueModule — bandeja de publicación (PUBLISH-UI-01 · parcial de SOLO LECTURA).
 *
 * Lista las piezas candidatas a salir con su canal de destino, el estado operativo de ese
 * canal y —desde PR-C— CUÁNDO SALEN, reutilizando la capa de datos y la presentación de la
 * bandeja de calibración.
 *
 * U-5 — ESTA BANDEJA YA ACTÚA. Hasta este corte no aprobaba, y el motivo escrito decía que
 * era «por diseño»: aprobar sería del carril de calibración. Dejó de ser cierto por decisión
 * de Sam del 2026-09-13 — lo que se puede hacer con una pieza depende de SU ESTADO, no de la
 * bandeja donde se la mire.
 *
 * Las acciones las pinta `PieceActionsBar`, el mismo componente que monta calibración, y su
 * disponibilidad la declara el contrato en `pieces[].actions`. **Esta pantalla no evalúa
 * estado**: ni `status`, ni `discarded_at`, ni la presencia de una imagen.
 *
 * Lo propio de esta bandeja sigue siendo lo que era: a dónde va cada pieza, si su canal está
 * operativo, y CUÁNDO sale — su franja reservada, que es un compromiso y no una previsión.
 * Por eso es la única que entrega `slot` al componente de acciones: antes de sellar una
 * pieza, el diálogo repite esa fecha y avisa de que la franja se libera.
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
  // U-7 — el estado de la pieza y la búsqueda por id.
  const [status, setStatus]   = useState('');
  const [q, setQ]             = useState('');
  const [offset, setOffset]   = useState(0);

  type Query = {
    offset: number; brand: string; channel: string; chStatus: ChannelStatusFilter;
    gen: GenerationFilter; status: string; q: string;
  };
  const current = (): Query => ({ offset, brand, channel, chStatus, gen, status, q });

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
        status: q.status || undefined,
        q: q.q || undefined,
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
    setStatus(q.status); setQ(q.q);
    load(q);
  };
  const goPage = (o: number) => { setOffset(o); load({ ...current(), offset: o }); };

  /**
   * U-5 — una pieza que sale de circulación sale de la lista. Se quita en memoria en vez de
   * recargar la página entera: recargar perdería el scroll y volvería a pedir los artefactos
   * de todas las demás tarjetas, que es caro y no aporta nada.
   */
  const onResolved = (pieceId: string) => {
    setData((prev) => {
      if (!prev) return prev;
      return { ...prev, pieces: prev.pieces.filter((p) => p.piece_id !== pieceId), total: Math.max(0, prev.total - 1) };
    });
  };

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
            Piezas listas para salir: cuándo publica cada una, por qué canal y si ese canal está operativo.
            <span className="text-zinc-400"> Cada tarjeta dice qué se puede hacer con su pieza</span>, y por qué cuando no se puede.
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

      {/* U-5 — EL AVISO DE «ESTA BANDEJA NO APRUEBA» SE RETIRÓ, PORQUE YA APRUEBA.
          Decía lo que otra pantalla podía hacer, y un aviso así caduca en cuanto esa otra
          pantalla cambia — sin que nadie se entere hasta que un usuario lo lee. Lo que se
          puede hacer con cada pieza lo declara `actions`, por pieza y con su motivo: una
          pantalla no vuelve a afirmar dónde vive una acción. */}

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
        {/* U-7 — EL ESTADO DE LA PIEZA, y va acá y no en calibración: esa bandeja lista un
            solo estado por contrato, así que un filtro de estado allí no filtraría nada.
            Las opciones salen del LOTE, nunca de una lista escrita acá: si el carril empieza
            a producir un estado nuevo, aparece solo. */}
        <Selector
          label="Estado"
          value={status}
          onChange={(v) => apply({ status: v })}
          options={[['', 'Todos'], ...(data?.statuses ?? []).map((s) => [s, s] as [string, string])]}
        />
        {/* U-7 — el sitio donde pegar los 8 caracteres que pinta la tarjeta. */}
        <div className="ml-auto">
          <PieceSearchBox value={q} onSearch={(v) => apply({ q: v })} />
        </div>
      </div>

      {/* U-7 — «no hay» y «no lo pude mirar todo» son dos ceros distintos. */}
      <div className="mb-4">
        <SearchNotice search={data?.search ?? null} vacia={pieces.length === 0} />
      </div>

      {data && <SlotsNotice source={data.slots_source} />}
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
          {pieces.map((p) => (
            <PublishCard
              key={p.piece_id} piece={p} token={token} onResolved={onResolved}
              slotsRead={data?.slots_source !== 'unavailable'}
            />
          ))}
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
function PublishCard({ piece, token, onResolved, slotsRead }: {
  piece: PublishablePiece; token: string; slotsRead: boolean;
  /** La pieza salió de circulación: la bandeja la quita de la lista. */
  onResolved: (pieceId: string) => void;
}) {
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

        {/* CUÁNDO SALE. Va arriba del artefacto porque es lo que Sam viene a mirar: hasta
            PR-C la única forma de saberlo era una consulta SQL. Es el COMPROMISO de esta
            pieza —su franja reservada—, no una previsión; la previsión vive en la bandeja
            de calibración y se llama distinto a propósito. */}
        <SlotLine slot={piece.slot} approvedAt={piece.approved_at} slotsRead={slotsRead} />

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
        {readable && <SpeechReader piece={readable} suggestedLang={piece.reading_language} />}

        {/* ESTADO DEL CANAL, y sólo eso.
            U-5 — la coletilla que remitía a la otra bandeja para aprobar se retiró: estaba
            escrita a mano en esta pantalla, no salía de ningún campo del contrato, y
            con este corte dejó de ser cierta. Es el tercer texto caduco en dos días y todos
            compartían la misma forma: una frase que afirma qué puede hacer OTRA pantalla.
            La regla que deja escrita — si un texto afirma algo sobre disponibilidad, sale del
            contrato o no se escribe. Lo que esta pieza puede hacer está en sus botones. */}
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
              ? `${piece.channel.reason} — esta pieza no podría salir por su canal.`
              : 'Canal operativo.'}
          </span>
        </div>

        {/* U-5 — LAS ACCIONES. El MISMO componente que monta la bandeja de calibración.
            Aquí SÍ viaja `slot`: esta bandeja entrega el COMPROMISO de fecha, así que antes
            de sellar una pieza el diálogo repite esa fecha y avisa de que la franja se
            libera. Sam decide con el compromiso delante, no después de haberlo roto. */}
        <PieceActionsBar
          piece={{
            piece_id: piece.piece_id,
            actions: piece.actions,
            body: piece.body,
            title: piece.title,
            slot: slotsRead ? piece.slot : null,
          }}
          token={token}
          onResolved={(id) => onResolved(id)}
          onRegenerated={(r) => {
            if (r.html) { setArtHtml(r.html); setArtErr(null); }
            if (r.artifact_url) setArtUrl(r.artifact_url);
          }}
        />
      </div>
    </motion.div>
  );
}
