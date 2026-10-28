import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  SlotLine, SlotsNotice, SearchNotice, PieceSummary, MobileDetails, FilterBar, CarouselToggle, DayPicker,
} from './pieceUi';
// U-5 — el ÚNICO componente de acciones del sistema, el mismo que monta calibración.
import { PieceActionsBar } from './pieceActions';
// Lectura en voz alta. El lector no sabe de artefactos: el adaptador le pasa el texto plano.
import { SpeechReader } from '../../ui/SpeechReader';
import { partirVista } from './vistaPartida';
import { ImagenSiHay, VistaPrevia } from './VistaPartida';
import { readableFromArtifactHtml } from './readablePiece';
import ManualPublishModule from './ManualPublishModule';

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
export type PublishSubTab = 'scheduled' | 'manual';

/** `subtabs`: las subpestañas que la sesión puede abrir (2026-10-23). Sin el prop, las dos: el camino
 *  de admin no cambia. Ocultar no es la seguridad: cada endpoint exige su vista. */
export default function PublishQueueModule({ session, subtabs = ['scheduled', 'manual'] }: { session: IidSession; subtabs?: PublishSubTab[] }) {
  // Pestaña «Manual» (Sam, 2026-10-01): lo que se publica a mano vive DENTRO de Publicación.
  // `?view=publish&tab=manual` abre directo en ella.
  const [tab, setTab] = useState<PublishSubTab>(() => {
    let pedida: PublishSubTab = 'scheduled';
    try { pedida = new URLSearchParams(window.location.search).get('tab') === 'manual' ? 'manual' : 'scheduled'; }
    catch { /* sin URL: la de siempre */ }
    return subtabs.includes(pedida) ? pedida : subtabs[0];
  });
  const visible = subtabs.includes(tab) ? tab : subtabs[0];
  return (
    <div className="max-w-3xl mx-auto px-3 md:px-6 py-2">
      {subtabs.length > 1 && (
        <div className="flex items-center gap-1 bg-zinc-900/80 border border-zinc-800 rounded-xl p-1 mb-3 w-fit">
          <SubTab label="Programadas" active={visible === 'scheduled'} onClick={() => setTab('scheduled')} />
          <SubTab label="Manual" active={visible === 'manual'} onClick={() => setTab('manual')} />
        </div>
      )}
      {visible === 'manual' ? <ManualPublishModule session={session} /> : <ScheduledQueue session={session} />}
    </div>
  );
}

function SubTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all font-body',
        active ? 'bg-accent text-black shadow' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
      )}
    >
      {label}
    </button>
  );
}

function ScheduledQueue({ session }: { session: IidSession }) {
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
  // 2026-10-06 — sólo carruseles, de cualquier canal; se combina con `channel`.
  const [carousel, setCarousel] = useState(false);
  // 2026-10-21 — día de salida: '' | 'today' | 'tomorrow' | 'AAAA-MM-DD'.
  const [day, setDay]         = useState('');
  const [offset, setOffset]   = useState(0);

  type Query = {
    offset: number; brand: string; channel: string; chStatus: ChannelStatusFilter;
    gen: GenerationFilter; status: string; q: string; carousel: boolean; day: string;
  };
  const current = (): Query => ({ offset, brand, channel, chStatus, gen, status, q, carousel, day });

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
        carousel: q.carousel,
        day: q.day || undefined,
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
    setStatus(q.status); setQ(q.q); setCarousel(q.carousel); setDay(q.day);
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
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-3 md:mb-5">
        <div className="min-w-0">
          <h3 className="font-display text-lg font-bold text-white">Bandeja de publicación</h3>
          <p className="hidden md:block text-sm text-zinc-500 mt-0.5">
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
        <div className="flex items-center gap-1 overflow-x-auto md:flex-wrap bg-zinc-900/80 border border-zinc-800 rounded-xl p-1 mb-2 [&>*]:shrink-0">
          <CountPill label="Todas" count={Object.values(byBrand).reduce((a, b) => a + b, 0)} active={brand === ''} onClick={() => apply({ brand: '' })} />
          {brands.map((b) => (
            <CountPill key={b} label={b} count={byBrand[b]} active={brand === b} onClick={() => apply({ brand: b })} />
          ))}
        </div>
      )}

      {/* Filtro por canal. 2026-10-06 — con «Carrusel» al final, combinable con el canal elegido. La
          fila se pinta también con el carrusel puesto y cero canales: si no, el interruptor que vació
          la lista desaparecería con ella y no habría forma de apagarlo. */}
      {(channels.length > 0 || carousel) && (
        <div className="flex items-center gap-1 overflow-x-auto md:flex-wrap bg-zinc-900/80 border border-zinc-800 rounded-xl p-1 mb-3 [&>*]:shrink-0">
          <CountPill label="Todos los canales" count={Object.values(byChannel).reduce((a, b) => a + b, 0)} active={channel === ''} onClick={() => apply({ channel: '' })} />
          {channels.map((c) => (
            <CountPill key={c} label={c} count={byChannel[c]} active={channel === c} onClick={() => apply({ channel: c })} />
          ))}
          <span className="mx-1 h-5 w-px bg-zinc-800" aria-hidden />
          <CarouselToggle active={carousel} count={data?.carousels} onToggle={(v) => apply({ carousel: v })} />
        </div>
      )}

      <FilterBar
        q={q} onSearch={(v) => apply({ q: v })}
        active={[chStatus !== 'all', gen !== 'all', status !== '', day !== ''].filter(Boolean).length}
        className="flex-col md:flex-row items-stretch md:items-center gap-3 md:gap-4 md:flex-wrap md:mb-5 text-[11px] font-mono text-zinc-600"
      >
        {/* 2026-10-21 — el día de salida, en el reloj de cada marca. */}
        <DayPicker value={day} onChange={(v) => apply({ day: v })} />
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
        {/* U-7 — EL ESTADO DE LA PIEZA, y va aquí y no en calibración: esa bandeja lista un
            solo estado por contrato, así que un filtro de estado allí no filtraría nada.
            Las opciones salen del LOTE, nunca de una lista escrita aquí: si el carril empieza
            a producir un estado nuevo, aparece solo. */}
        <Selector
          label="Estado"
          value={status}
          onChange={(v) => apply({ status: v })}
          options={[['', 'Todos'], ...(data?.statuses ?? []).map((s) => [s, s] as [string, string])]}
        />
      </FilterBar>

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
// El nombre del canal y su proveedor salen del dato. Aquí no hay lista de canales.
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
  const rehecha = useRef(false);
  const [artErr, setArtErr]   = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    rehecha.current = false;
    renderArtifact(token, piece.piece_id)
      // 2026-10-20 — si la pieza ya se corrigió mientras esta lectura viajaba, su HTML es el de ANTES: no pisa la vista.
      .then((r) => { if (alive && !rehecha.current) { setArtHtml(r.html); setArtUrl(r.artifact_url); } })
      .catch((err) => { if (alive) setArtErr(err instanceof CalibrationError ? err.message : 'No se pudo renderizar el artefacto.'); });
    return () => { alive = false; };
  }, [piece.piece_id, token]);

  // El texto de la pieza para el lector en voz alta, del MISMO `html` que ya se recibe de
  // `preview-render`. Mismo adaptador que en calibración: las dos bandejas leen igual.
  const readable = useMemo(() => (artHtml ? readableFromArtifactHtml(artHtml) : null), [artHtml]);

  const blocked = piece.channel.status !== 'operational';

  // 2026-10-28 — la vista previa partida en imagen y texto, y lo que la barra de acciones recibe (una sola vez).
  const vista = useMemo(() => partirVista(artHtml), [artHtml]);
  // La lectura en voz alta, una sola vez y fuera de «Detalles» (Sam, 2026-10-01): va justo después del texto.
  const lector = readable && <SpeechReader piece={readable} suggestedLang={piece.reading_language} />;
  const accionable = {
    piece_id: piece.piece_id,
    actions: piece.actions,
    body: piece.body,
    title: piece.title,
    slot: slotsRead ? piece.slot : null,
    // SIN-IMAGEN-01 — mismo dato en las tres bandejas: la acción no puede llamarse
    // distinto según desde dónde se abra.
    has_image: piece.has_image,
    image_overlay: piece.image_overlay ?? null,
    // INVESTIGAR — si la tarjeta pide el estado del caso de investigación.
    research_hint: piece.research_hint,
  };
  const alRecomponer = (r: { html: string | null; artifact_url: string | null }) => {
    if (r.html) { rehecha.current = true; setArtHtml(r.html); setArtErr(null); }
    if (r.artifact_url) setArtUrl(r.artifact_url);
  };
  // ESTADO DEL CANAL, y sólo eso.
  // U-5 — la coletilla que remitía a la otra bandeja para aprobar se retiró: estaba
  // escrita a mano en esta pantalla, no salía de ningún campo del contrato, y
  // con este corte dejó de ser cierta. Es el tercer texto caduco en dos días y todos
  // compartían la misma forma: una frase que afirma qué puede hacer OTRA pantalla.
  // La regla que deja escrita — si un texto afirma algo sobre disponibilidad, sale del
  // contrato o no se escribe. Lo que esta pieza puede hacer está en sus botones.
  const estadoCanal = (
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
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden"
      style={{ borderLeftWidth: 3, borderLeftColor: blocked ? '#f43f5e' : '#FFAB00' }}
    >
      <div className="p-3 md:p-4 space-y-3 md:space-y-4">
        {/* Móvil: marca, canal, formato y título arriba; lo técnico baja a «Detalles». */}
        <PieceSummary
          brand={piece.brand_id} platform={piece.platform} format={piece.format}
          title={piece.title} pieceId={piece.piece_id}
          badge={<span className="text-[11px] font-mono"><ChannelBadge channel={piece.channel} /></span>}
        />

        {/* Cabecera (la MISMA que la bandeja de calibración) + canal + watcher + generación.
            FIX-CARD-06: identidad y conteos salen de `PieceHeader`; el canal es lo propio
            de esta bandeja y por eso se queda aquí. */}
        <div className="hidden md:block space-y-1.5">
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

        <div className="hidden md:block"><Provenance piece={piece} /></div>

        {/* 2026-10-28 — LA TARJETA POR ZONAS (Sam), como en Calibración: la imagen con sus correcciones debajo, el texto,
            la lectura con las del texto debajo, el estado del canal y el veredicto, y la investigación plegada al final. */}
        <PieceActionsBar
          piece={accionable}
          token={token}
          onResolved={(id) => onResolved(id)}
          onRegenerated={alRecomponer}
          media={<ImagenSiHay vista={vista} pieceId={piece.piece_id} />}
          textView={<>
            <VistaPrevia artHtml={artHtml} artErr={artErr} vista={vista} pieceId={piece.piece_id} />
            {artUrl && (
              <a href={artUrl} target="_blank" rel="noopener noreferrer"
                 className="hidden md:block mt-2 text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors truncate">
                {artUrl}
              </a>
            )}
          </>}
          reader={lector}
          beforeVerdict={estadoCanal}
        />

        {/* Móvil: lo técnico, plegado. En escritorio ya se pintó arriba. */}
        <div className="md:hidden">
          <MobileDetails>
            <div className="space-y-1.5">
              <PieceHeader piece={piece} />
              <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono text-zinc-600">
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
            {artUrl && (
              <a href={artUrl} target="_blank" rel="noopener noreferrer"
                className="block text-[10px] font-mono text-zinc-500 underline truncate">
                Abrir la pieza en otra pestaña
              </a>
            )}
          </MobileDetails>
        </div>
      </div>
    </motion.div>
  );
}
