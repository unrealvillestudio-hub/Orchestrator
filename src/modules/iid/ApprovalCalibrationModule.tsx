import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw, Inbox, CheckCircle2, XCircle, AlertTriangle, Archive } from 'lucide-react';
import { cn, Spinner } from '../../ui/components';
import type { IidSession } from '../../services/iidInbound';
import {
  fetchQueue, saveVerdict, discardPiece, renderArtifact, CalibrationError,
  type CalibrationPiece, type QueueResult, type QueueOrder, type VerdictFilter,
  type GenerationFilter,
} from '../../services/calibrationInbox';
// Presentación compartida con la bandeja de publicación: la procedencia se cuenta igual
// en las dos vistas o no sirve para compararlas.
import {
  CountPill, Selector, Pager, CutoffsNotice, GenerationBadge, WatcherBadge, Provenance, shortId,
} from './pieceUi';

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
 * Tres salidas, no dos:
 *   Aprobar   → corpus `approved`
 *   Rechazar  → corpus `rejected`  (criterio OPCIONAL)
 *   Descartar → NO entra al corpus; sella discarded_at y sale de la bandeja
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
  const [offset, setOffset]   = useState(0);

  type Query = { offset: number; brand: string; order: QueueOrder; verdict: VerdictFilter; gen: GenerationFilter };
  const current = (): Query => ({ offset, brand, order, verdict, gen });

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
            Una tarjeta por pieza. Aprobás, rechazás o descartás — un clic.
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
      </div>

      {/* Por qué la generación puede venir sin dato — se dice, no se disimula. */}
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
            <CalibrationCard key={p.piece_id} piece={p} token={token} onResolved={onResolved} />
          ))}
        </div>
      )}

      {/* Paginación — SIEMPRE visible, con "N de M". */}
      <Pager offset={offset} pageSize={PAGE} total={total} loading={loading} onGo={goPage} />
    </div>
  );
}

// ── Card de calibración ──────────────────────────────────────────────────────────
type Action = 'approve' | 'reject' | 'discard';
type Outcome = 'approved' | 'rejected' | 'discarded';

function CalibrationCard({ piece, token, onResolved }: {
  piece: CalibrationPiece; token: string; onResolved: (id: string) => void;
}) {
  // Render lazy del artefacto. Guardamos el HTML crudo (para <iframe srcdoc>) y la URL
  // del CDN (link durable). NO se usa src={cdn_url}: Supabase sirve el objeto como
  // text/plain + nosniff, así que embeber por src mostraría el código, no la pieza.
  const [artHtml, setArtHtml] = useState<string | null>(null);
  const [artUrl, setArtUrl]   = useState<string | null>(null);
  const [artErr, setArtErr]   = useState<string | null>(null);

  // Panel abierto para escribir una nota. Ninguna de las dos es obligatoria.
  const [panel, setPanel]     = useState<null | 'reject' | 'discard'>(null);
  const [note, setNote]       = useState('');
  const [busy, setBusy]       = useState<null | Action>(null);
  const [error, setError]     = useState<string | null>(null);
  const [done, setDone]       = useState<null | Outcome>(null);

  useEffect(() => {
    let alive = true;
    renderArtifact(token, piece.piece_id)
      .then((r) => { if (alive) { setArtHtml(r.html); setArtUrl(r.artifact_url); } })
      .catch((err) => { if (alive) setArtErr(err instanceof CalibrationError ? err.message : 'No se pudo renderizar el artefacto.'); });
    return () => { alive = false; };
  }, [piece.piece_id, token]);

  const finish = (outcome: Outcome) => {
    setDone(outcome);
    setTimeout(() => onResolved(piece.piece_id), 1500);
  };

  const submitVerdict = async (verdict: 'approved' | 'rejected') => {
    setBusy(verdict === 'approved' ? 'approve' : 'reject'); setError(null);
    try {
      // Criterio OPCIONAL en los dos casos: vacío viaja como null, nunca como relleno.
      await saveVerdict(token, { piece_id: piece.piece_id, verdict, criterion: note.trim() || null });
      finish(verdict);
    } catch (err) {
      setError(err instanceof CalibrationError ? err.message : 'No se pudo guardar el veredicto.');
      setBusy(null);
    }
  };

  const submitDiscard = async () => {
    setBusy('discard'); setError(null);
    try {
      await discardPiece(token, { piece_id: piece.piece_id, reason: note.trim() || null });
      finish('discarded');
    } catch (err) {
      setError(err instanceof CalibrationError ? err.message : 'No se pudo descartar la pieza.');
      setBusy(null);
    }
  };

  // Estado resuelto → tarjeta de confirmación.
  if (done) {
    const style = done === 'approved'
      ? { box: 'bg-emerald-500/[0.07] border-emerald-500/30', text: 'text-emerald-300', icon: <CheckCircle2 size={18} />, label: 'Aprobada — guardada en el corpus' }
      : done === 'rejected'
        ? { box: 'bg-rose-500/[0.07] border-rose-500/30', text: 'text-rose-300', icon: <XCircle size={18} />, label: 'Rechazada — guardada en el corpus' }
        : { box: 'bg-zinc-800/40 border-zinc-700/60', text: 'text-zinc-300', icon: <Archive size={18} />, label: 'Descartada — fuera de la bandeja, NO entra al corpus' };
    return (
      <motion.div
        initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className={cn('rounded-2xl p-4 border', style.box)}
      >
        <div className={cn('flex items-center gap-2', style.text)}>
          {style.icon}
          <p className="text-sm font-medium">{style.label}</p>
        </div>
        <p className="mt-1 text-[10px] font-mono text-zinc-600">pieza: {shortId(piece.piece_id)}</p>
      </motion.div>
    );
  }

  const rejected = piece.watcher_result === 'REJECT';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden"
      style={{ borderLeftWidth: 3, borderLeftColor: rejected ? '#f43f5e' : '#FFAB00' }}
    >
      <div className="p-4 space-y-4">
        {/* Contexto + primera opinión del watcher + generación del flujo */}
        <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono text-zinc-600">
          <span className="text-accent/80 font-semibold">{piece.brand_id}</span>
          {piece.platform && <span>· {piece.platform}</span>}
          {piece.format && <span>· {piece.format}</span>}
          {piece.voice && <span>· voice:{piece.voice}</span>}
          {piece.domain && <span>· {piece.domain}</span>}
          {piece.psycho_preset && <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{piece.psycho_preset}</span>}
          <WatcherBadge
            result={piece.watcher_result}
            gate={piece.watcher_gate}
            failedRules={piece.watcher_failed_rules}
            rulesEvaluated={piece.watcher_rules_evaluated}
          />
          <GenerationBadge generation={piece.generation} label={piece.cutoff_label} at={piece.cutoff_at} />
        </div>

        {/* Procedencia */}
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
            // srcdoc (no src): renderiza el HTML directo. El CDN sirve text/plain, así que
            // embeber por src mostraría el código en vez de la pieza.
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

        {error && <p className="text-xs text-rose-400 font-mono leading-snug">{error}</p>}

        {/* Acciones — tres salidas */}
        <AnimatePresence mode="wait">
          {panel ? (
            <motion.div key={panel} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
              <textarea
                value={note}
                onChange={(e) => { setNote(e.target.value); setError(null); }}
                rows={3}
                autoFocus
                placeholder={panel === 'reject'
                  ? 'Criterio del rechazo (opcional — normalmente lo escribe Claude desde el chat)…'
                  : 'Motivo del descarte (opcional)…'}
                className={cn(
                  'w-full bg-[#050508] border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-700 outline-none transition-colors resize-none',
                  panel === 'reject' ? 'focus:border-rose-500/60' : 'focus:border-zinc-500/60'
                )}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => (panel === 'reject' ? submitVerdict('rejected') : submitDiscard())}
                  disabled={!!busy}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors',
                    panel === 'reject' ? 'bg-rose-500/90 hover:bg-rose-500' : 'bg-zinc-700 hover:bg-zinc-600'
                  )}
                >
                  {busy ? <Spinner size={14} /> : panel === 'reject'
                    ? <><XCircle size={14} /> Confirmar rechazo</>
                    : <><Archive size={14} /> Confirmar descarte</>}
                </button>
                <button
                  onClick={() => { setPanel(null); setError(null); }}
                  disabled={!!busy}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:bg-zinc-800 transition-colors"
                >
                  Cancelar
                </button>
              </div>
              <p className="text-[10px] font-mono text-zinc-600 leading-snug">
                {panel === 'reject'
                  ? 'El rechazo entra al corpus con o sin criterio. Mejor vacío que de relleno.'
                  : 'Descartar no es rechazar: sale de la bandeja y NO entra al corpus.'}
              </p>
            </motion.div>
          ) : (
            <motion.div key="actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex gap-2">
              <button
                onClick={() => submitVerdict('approved')}
                disabled={!!busy}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold bg-accent text-black hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-accent/20 transition-all"
              >
                {busy === 'approve' ? <Spinner size={14} /> : <><CheckCircle2 size={14} /> Aprobar</>}
              </button>
              <button
                onClick={() => { setPanel('reject'); setError(null); }}
                disabled={!!busy}
                className="px-4 py-2.5 rounded-lg text-sm font-medium border border-rose-500/30 text-rose-300/90 hover:bg-rose-500/10 transition-colors disabled:opacity-50"
              >
                <XCircle size={14} className="inline mr-1" /> Rechazar
              </button>
              <button
                onClick={() => { setPanel('discard'); setError(null); }}
                disabled={!!busy}
                title="No voy a juzgar esta pieza: sale de la bandeja y no entra al corpus."
                className="px-4 py-2.5 rounded-lg text-sm font-medium border border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors disabled:opacity-50"
              >
                <Archive size={14} className="inline mr-1" /> Descartar
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
