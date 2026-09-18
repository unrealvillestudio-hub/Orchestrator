import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw, Inbox, CheckCircle2, XCircle, AlertTriangle, Archive, Wrench } from 'lucide-react';
import { cn, Spinner } from '../../ui/components';
import type { IidSession } from '../../services/iidInbound';
import {
  fetchQueue, renderArtifact, CalibrationError,
  type CalibrationPiece, type QueueResult, type QueueOrder, type VerdictFilter,
  type GenerationFilter,
} from '../../services/calibrationInbox';
// U-5 — el ÚNICO componente de acciones del sistema. Las llamadas, los paneles de texto y
// los motivos de rechazo viven ahí, no acá: dos implementaciones divergen en el primer cambio.
import { PieceActionsBar, type ActionOutcome } from './pieceActions';
// Presentación compartida con la bandeja de publicación: la procedencia se cuenta igual
// en las dos vistas o no sirve para compararlas.
import {
  CountPill, Selector, Pager, CutoffsNotice, GenerationBadge, WatcherBadge, Provenance, PieceHeader, shortId,
  ForecastLine, SlotsNotice, PieceSearchBox, SearchNotice, PendingStateBadge, PENDING_STATE_UI,
  DeferralNotice,
} from './pieceUi';
// Lectura en voz alta. El lector no sabe de artefactos: el adaptador le pasa el texto plano.
import { SpeechReader } from '../../ui/SpeechReader';
import { readableFromArtifactHtml } from './readablePiece';

const PAGE = 20;

/**
 * ApprovalCalibrationModule — bandeja de calibración (B4 · Fase 1 · CALIB-UI-01).
 *
 * Una tarjeta por PIEZA (no por intento): la consulta lista `content_pieces` sin
 * descartar, sin fila en el corpus, quedándose con la última versión de cada `queue_id`.
 *
 * El reparto de trabajo que gobierna el diseño: acá se VE y se DECIDE (un clic); el
 * criterio se dicta en el chat con Claude, que lo escribe en `approval_calibration`. Por
 * eso ningún campo de texto es obligatorio — obligar a escribir empuja a poner cualquier
 * cosa para avanzar, y eso envenena el corpus con ruido que parece señal.
 *
 * Cuatro salidas, tres de ellas veredicto:
 *   Aprobar   → corpus `approved`   · habilita la pieza
 *   Rechazar  → corpus `rejected`   · sella y saca de la bandeja (criterio OPCIONAL)
 *   Fixable   → corpus `fixable`    · MISMO sellado que rechazar, con la PROPUESTA de qué
 *               hacer con la pieza. Obligatoria: sin ella sería un rechazo con otro nombre.
 *   Descartar → NO entra al corpus; sella discarded_at y sale de la bandeja
 *
 * Fixable sella igual que Rechazar y no es un olvido: la bandeja lista `awaiting_approval`
 * con `discarded_at IS NULL`, así que un veredicto que no sella deja la pieza viva y
 * reaparece mañana. La diferencia entre los dos vive ENTERA en el corpus.
 *
 * NO publica nada.
 */
export default function ApprovalCalibrationModule({ session }: { session: IidSession }) {
  const token = session.session_token;

  const [data, setData]       = useState<QueueResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [brand, setBrand]     = useState<string>(''); // '' = todas
  const [order, setOrder]     = useState<QueueOrder>('recent');
  const [verdict, setVerdict] = useState<VerdictFilter>('all');
  const [gen, setGen]         = useState<GenerationFilter>('all');
  // U-7 — la plataforma de la pieza y la búsqueda por id.
  const [platform, setPlatform] = useState('');
  const [q, setQ]               = useState('');
  const [offset, setOffset]   = useState(0);

  type Query = {
    offset: number; brand: string; order: QueueOrder; verdict: VerdictFilter; gen: GenerationFilter;
    platform: string; q: string;
  };
  const current = (): Query => ({ offset, brand, order, verdict, gen, platform, q });

  const load = async (q: Query) => {
    setLoading(true); setError(null);
    try {
      const r = await fetchQueue(token, {
        limit: PAGE,
        offset: q.offset,
        brand: q.brand || undefined,
        order: q.order,
        verdict: q.verdict,
        generation: q.gen,
        platform: q.platform || undefined,
        q: q.q || undefined,
      });
      setData(r);
    } catch (err) {
      setError(err instanceof CalibrationError ? err.message : 'No se pudo cargar la cola.');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(current()); /* eslint-disable-next-line */ }, []);

  // Todo cambio de filtro/orden vuelve a la primera página: el offset viejo no significa
  // lo mismo sobre un conjunto distinto.
  const apply = (patch: Partial<Query>) => {
    const q = { ...current(), offset: 0, ...patch };
    setOffset(q.offset); setBrand(q.brand); setOrder(q.order); setVerdict(q.verdict); setGen(q.gen);
    setPlatform(q.platform); setQ(q.q);
    load(q);
  };
  const goPage = (o: number) => { setOffset(o); load({ ...current(), offset: o }); };

  // Cuando una pieza se resuelve (veredicto o descarte), la sacamos de la lista.
  const onResolved = (pieceId: string) => {
    setData((prev) => {
      if (!prev) return prev;
      const pieces = prev.pieces.filter((p) => p.piece_id !== pieceId);
      return { ...prev, pieces, total_pending: Math.max(0, prev.total_pending - 1) };
    });
  };

  const total    = data?.total_pending ?? 0;
  const byBrand  = data?.by_brand ?? {};
  const pieces   = data?.pieces ?? [];
  const brands   = useMemo(() => Object.keys(byBrand).sort(), [byBrand]);

  return (
    <div className="max-w-3xl mx-auto px-6 py-2">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h3 className="font-display text-lg font-bold text-white">Bandeja de calibración</h3>
          <p className="text-sm text-zinc-500 mt-0.5">
            Una tarjeta por pieza. Aprobar, rechazar, marcar como fixable o descartar — un clic.
            El criterio se dicta en el chat, no acá; <span className="text-zinc-400">nada se publica</span>.
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

      {/* Filtro por marca — las marcas se descubren del dato, nunca se enumeran acá. */}
      {brands.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap bg-zinc-900/80 border border-zinc-800 rounded-xl p-1 mb-3">
          <CountPill label="Todas" count={Object.values(byBrand).reduce((a, b) => a + b, 0)} active={brand === ''} onClick={() => apply({ brand: '' })} />
          {brands.map((b) => (
            <CountPill key={b} label={b} count={byBrand[b]} active={brand === b} onClick={() => apply({ brand: b })} />
          ))}
        </div>
      )}

      {/* Orden + filtros transversales */}
      <div className="flex items-center gap-4 flex-wrap mb-5 text-[11px] font-mono text-zinc-600">
        <Selector
          label="Orden"
          value={order}
          onChange={(v) => apply({ order: v as QueueOrder })}
          options={[
            ['recent', 'Más reciente'],
            ['oldest', 'Más antigua'],
            ['brand', 'Por marca'],
            ['verdict', 'Por veredicto'],
          ]}
        />
        <Selector
          label="Veredicto"
          value={verdict}
          onChange={(v) => apply({ verdict: v as VerdictFilter })}
          options={[['all', 'Todas'], ['PASS', 'PASS'], ['REJECT', 'REJECT']]}
        />
        <Selector
          label="Flujo"
          value={gen}
          onChange={(v) => apply({ gen: v as GenerationFilter })}
          options={[['all', 'Todas'], ['current', 'Solo corregido']]}
        />
        {/* U-7 — LA PLATAFORMA DE LA PIEZA. Sus opciones salen del LOTE (`data.platforms`),
            nunca de una lista escrita acá: una marca nueva con una plataforma nueva aparece
            sola. Ojo con el nombre: la bandeja de publicación llama `channel` a lo suyo y
            filtra el CANAL OPERATIVO de la marca — son dos ejes distintos. */}
        <Selector
          label="Plataforma"
          value={platform}
          onChange={(v) => apply({ platform: v })}
          options={[['', 'Todas'], ...(data?.platforms ?? []).map((p) => [p, p] as [string, string])]}
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

      {/* Por qué la generación puede venir sin dato — se dice, no se disimula. */}
      {data && <SlotsNotice source={data.slots_source} />}
      {data && <CutoffsNotice source={data.cutoffs_source} />}

      {error && (
        <div className="flex items-start gap-2 text-[12px] text-rose-400/90 bg-rose-500/[0.06] border border-rose-500/20 rounded-xl px-3 py-2 mb-4">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span className="leading-snug">{error}</span>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-zinc-700"><Spinner size={22} /></div>
      ) : pieces.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-2 text-zinc-700">
          <Inbox size={36} strokeWidth={1} />
          <p className="text-sm">{total === 0 ? 'Nada pendiente de calibrar.' : 'Sin piezas en esta página.'}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pieces.map((p) => (
            <CalibrationCard
              key={p.piece_id} piece={p} token={token} onResolved={onResolved}
              slotsRead={data?.slots_source !== 'unavailable'}
            />
          ))}
        </div>
      )}

      {/* Paginación — SIEMPRE visible, con "N de M". */}
      <Pager offset={offset} pageSize={PAGE} total={total} loading={loading} onGo={goPage} />
    </div>
  );
}

// ── Card de calibración ──────────────────────────────────────────────────────────
/**
 * U-5 — LOS BOTONES YA NO VIVEN AQUÍ. Las cinco acciones de esta bandeja, sus paneles de
 * texto y sus llamadas se fueron a `pieceActions.tsx`, que es el ÚNICO componente de
 * acciones del sistema. Lo que esta tarjeta conserva es lo suyo: el artefacto, la lectura
 * en voz alta, la procedencia y la previsión de fecha.
 *
 * Y una acción más que antes no tenía: `edit_text`. No se añadió aquí — llegó sola, porque
 * el componente pinta lo que el contrato declara y el contrato la declara disponible.
 * Ésa es exactamente la propiedad por la que U-4 y U-5 existen.
 */

function CalibrationCard({ piece, token, onResolved, slotsRead }: {
  piece: CalibrationPiece; token: string; onResolved: (id: string) => void;
  /** ¿Se pudieron leer las franjas? Cuando no, la previsión calla y avisa `SlotsNotice`. */
  slotsRead: boolean;
}) {
  // Render lazy del artefacto. Guardamos el HTML crudo (para <iframe srcdoc>) y la URL
  // del CDN (link durable). NO se usa src={cdn_url}: Supabase sirve el objeto como
  // text/plain + nosniff, así que embeber por src mostraría el código, no la pieza.
  const [artHtml, setArtHtml] = useState<string | null>(null);
  const [artUrl, setArtUrl]   = useState<string | null>(null);
  const [artErr, setArtErr]   = useState<string | null>(null);
  const [done, setDone]       = useState<null | ActionOutcome>(null);

  useEffect(() => {
    let alive = true;
    renderArtifact(token, piece.piece_id)
      .then((r) => { if (alive) { setArtHtml(r.html); setArtUrl(r.artifact_url); } })
      .catch((err) => { if (alive) setArtErr(err instanceof CalibrationError ? err.message : 'No se pudo renderizar el artefacto.'); });
    return () => { alive = false; };
  }, [piece.piece_id, token]);

  // El texto de la pieza para el lector en voz alta. Sale del MISMO `html` que ya se recibe
  // de `preview-render`, así que no hay una segunda lectura ni una segunda fuente de texto.
  const readable = useMemo(() => (artHtml ? readableFromArtifactHtml(artHtml) : null), [artHtml]);

  // U-5 (corrección del 2026-09-13) — LA TARJETA DE CONFIRMACIÓN PROPIA SE RETIRÓ.
  // El acuse lo da ahora `PieceActionsBar`, igual en las dos bandejas. Tenerlo aquí también
  // era la última divergencia que quedaba: calibración decía qué había pasado y publicación
  // quitaba la pieza en seco, así que aprobar desde ahí no acusaba nada — y un acuse ausente
  // no se distingue de una acción que no ocurrió. Un solo acuse, en el sitio de la acción.

  // EL BORDE PINTA EL ESTADO DE PENDIENTE, NO EL VEREDICTO. (Regla de Sam, 2026-09-18.)
  //
  // Antes era `rejected ? '#f43f5e' : '#FFAB00'`, dos colores para un eje que el `WatcherBadge` de
  // abajo ya nombra con su texto y su icono. Duplicaba una señal y dejaba sin ninguna a la que Sam
  // necesita a distancia: QUÉ LE TOCA HACER con esta pieza. Con la bandeja mostrando ya cuatro
  // situaciones —esperando, para recalibrar, aplazada, retenida—, un solo color para todas las
  // volvería a hacer indistinguibles, que es el defecto que SIGN-01 corte D quiso resolver
  // escondiéndolas.
  const estado = PENDING_STATE_UI[piece.pending_state];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden"
      style={{ borderLeftWidth: 3, borderLeftColor: estado.color }}
    >
      <div className="p-4 space-y-4">
        {/* Cabecera (compartida con la bandeja de publicación) + veredicto + generación. */}
        <div className="space-y-1.5">
          <PieceHeader piece={piece} />
          <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono text-zinc-600">
            {/* Primero el estado: es lo que decide qué hacer con la pieza. */}
            <PendingStateBadge state={piece.pending_state} />
            {piece.psycho_preset && <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{piece.psycho_preset}</span>}
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

        {/* APARTADA POR EL SISTEMA: hasta cuándo y por qué. Va ANTES de la previsión porque
            cambia cómo se lee la previsión — la fecha prevista de una aplazada sólo ocurre si
            Sam decide ahora. Sin esta línea la tarjeta la contaría como una pendiente normal. */}
        <DeferralNotice state={piece.pending_state} until={piece.deferred_until} reason={piece.deferred_reason} />

        {/* DÓNDE CAERÍA SI SE APROBARA AHORA. PREVISIÓN, no compromiso. */}
        <ForecastLine forecast={piece.forecast_slot} slotsRead={slotsRead} />

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

        {/* Lectura en voz alta. */}
        {readable && <SpeechReader piece={readable} suggestedLang={piece.reading_language} />}

        {/* U-5 — LAS ACCIONES. El MISMO componente que monta la bandeja de publicación: si
            dos pantallas pueden divergir, divergirán, y acá no pueden. Esta bandeja no
            entrega `slot` porque lo suyo es una PREVISIÓN, no un compromiso — y una
            previsión no se puede prometer liberar. */}
        <PieceActionsBar
          piece={{
            piece_id: piece.piece_id,
            actions: piece.actions,
            body: piece.body,
            title: piece.title,
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
