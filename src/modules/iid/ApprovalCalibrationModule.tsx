import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  RefreshCw, Inbox, CheckCircle2, XCircle, AlertTriangle, ChevronLeft, ChevronRight, ShieldCheck, ShieldAlert,
} from 'lucide-react';
import { cn, Spinner } from '../../ui/components';
import type { IidSession } from '../../services/iidInbound';
import {
  fetchQueue, saveVerdict, renderArtifact, CalibrationError,
  type CalibrationPiece, type QueueResult,
} from '../../services/calibrationInbox';

const PAGE = 50;

/**
 * ApprovalCalibrationModule — bandeja de calibración (B4 · Fase 1).
 *
 * Cola persistente de piezas awaiting_approval sin fila en el corpus. Sam juzga el
 * artefacto (imagen/mockup + texto tal como saldría) y da un veredicto (SÍ opcionalmente
 * comentado / NO con párrafo obligatorio). El veredicto va al corpus atado al piece_id.
 * NO publica nada. La verdad de "ya evaluada" es la fila en intel.approval_calibration.
 */
export default function ApprovalCalibrationModule({ session }: { session: IidSession }) {
  const token = session.session_token;

  const [data, setData]       = useState<QueueResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [brand, setBrand]     = useState<string>(''); // '' = todas
  const [offset, setOffset]   = useState(0);

  const load = async (o = offset, b = brand) => {
    setLoading(true); setError(null);
    try {
      const r = await fetchQueue(token, { limit: PAGE, offset: o, brand: b || undefined });
      setData(r);
    } catch (err) {
      setError(err instanceof CalibrationError ? err.message : 'No se pudo cargar la cola.');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(0, brand); /* eslint-disable-next-line */ }, []);

  const changeBrand = (b: string) => { setBrand(b); setOffset(0); load(0, b); };
  const goPage = (o: number) => { setOffset(o); load(o, brand); };

  // Cuando una pieza se resuelve, la sacamos de la lista y reajustamos el total.
  const onResolved = (pieceId: string) => {
    setData((prev) => {
      if (!prev) return prev;
      const pieces = prev.pieces.filter((p) => p.piece_id !== pieceId);
      return { ...prev, pieces, total_pending: Math.max(0, prev.total_pending - 1) };
    });
  };

  const total   = data?.total_pending ?? 0;
  const byBrand  = data?.by_brand ?? {};
  const pieces   = data?.pieces ?? [];
  const brands   = useMemo(() => Object.keys(byBrand).sort(), [byBrand]);
  const from     = total === 0 ? 0 : offset + 1;
  const to       = offset + pieces.length;
  const hasPrev  = offset > 0;
  const hasNext  = offset + PAGE < total;

  return (
    <div className="max-w-3xl mx-auto px-6 py-2">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h3 className="font-display text-lg font-bold text-white">Bandeja de calibración</h3>
          <p className="text-sm text-zinc-500 mt-0.5">
            Juzgás la pieza tal como saldría. Aprobás (comentario opcional) o rechazás (criterio obligatorio).
            El veredicto entra al corpus — <span className="text-zinc-400">no publica nada</span>.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[11px] font-mono px-2 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400">
            {total} pendiente{total === 1 ? '' : 's'}
          </span>
          <button
            onClick={() => load(offset, brand)}
            className="p-2 hover:bg-zinc-800 rounded-xl transition-colors text-zinc-600 hover:text-zinc-400"
            title="Refrescar"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Filtro por marca */}
      {brands.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap bg-zinc-900/80 border border-zinc-800 rounded-xl p-1 mb-6">
          <BrandPill label="Todas" count={Object.values(byBrand).reduce((a, b) => a + b, 0)} active={brand === ''} onClick={() => changeBrand('')} />
          {brands.map((b) => (
            <BrandPill key={b} label={b} count={byBrand[b]} active={brand === b} onClick={() => changeBrand(b)} />
          ))}
        </div>
      )}

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

      {/* Paginación */}
      {(hasPrev || hasNext) && (
        <div className="flex items-center justify-between mt-6 text-[11px] font-mono text-zinc-500">
          <button
            onClick={() => goPage(Math.max(0, offset - PAGE))}
            disabled={!hasPrev || loading}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-zinc-800 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={13} /> Anterior
          </button>
          <span>{from}–{to} de {total}</span>
          <button
            onClick={() => goPage(offset + PAGE)}
            disabled={!hasNext || loading}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-zinc-800 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Siguiente <ChevronRight size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Pill de marca ──────────────────────────────────────────────────────────────
function BrandPill({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all font-body',
        active ? 'bg-accent text-black shadow' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
      )}
    >
      {label}
      <span className={cn(
        'text-[9px] font-mono px-1.5 py-0.5 rounded-full',
        active ? 'bg-black/20 text-black' : 'bg-zinc-800 text-zinc-600'
      )}>{count}</span>
    </button>
  );
}

// ── Etiqueta de la primera opinión del watcher ───────────────────────────────────
// Informativa: NO condiciona los botones. Sam puede aprobar lo que el watcher rechazó
// (el dato valioso: "watcher se equivocó") o rechazar lo que el watcher aprobó.
function WatcherBadge({ result, gate }: { result: 'PASS' | 'REJECT' | null; gate: string | null }) {
  if (result === 'REJECT') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-300"
            title="El watcher rechazó esta pieza. Si creés que se equivocó, aprobala igual — ese es el dato valioso.">
        <ShieldAlert size={10} /> Watcher: RECHAZÓ{gate ? ` · ${gate}` : ''}
      </span>
    );
  }
  if (result === 'PASS') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400/80"
            title="El watcher aprobó esta pieza.">
        <ShieldCheck size={10} /> Watcher: OK
      </span>
    );
  }
  return null;
}

// ── Card de calibración ──────────────────────────────────────────────────────────
function CalibrationCard({ piece, token, onResolved }: {
  piece: CalibrationPiece; token: string; onResolved: (id: string) => void;
}) {
  // Render lazy del artefacto. Guardamos el HTML crudo (para <iframe srcdoc>) y la URL
  // del CDN (link durable). NO se usa src={cdn_url}: Supabase sirve el objeto como
  // text/plain + nosniff, así que embeber por src mostraría el código, no la pieza.
  const [artHtml, setArtHtml] = useState<string | null>(null);
  const [artUrl, setArtUrl]   = useState<string | null>(null);
  const [artErr, setArtErr]   = useState<string | null>(null);

  const [rejecting, setRejecting] = useState(false);
  const [criterion, setCriterion] = useState('');
  const [busy, setBusy]           = useState<null | 'approve' | 'reject'>(null);
  const [error, setError]         = useState<string | null>(null);
  const [done, setDone]           = useState<null | 'approved' | 'rejected'>(null);

  useEffect(() => {
    let alive = true;
    renderArtifact(token, piece.piece_id)
      .then((r) => { if (alive) { setArtHtml(r.html); setArtUrl(r.artifact_url); } })
      .catch((err) => { if (alive) setArtErr(err instanceof CalibrationError ? err.message : 'No se pudo renderizar el artefacto.'); });
    return () => { alive = false; };
  }, [piece.piece_id, token]);

  const submit = async (verdict: 'approved' | 'rejected') => {
    if (verdict === 'rejected' && !criterion.trim()) { setError('El criterio es obligatorio para rechazar.'); return; }
    setBusy(verdict === 'approved' ? 'approve' : 'reject'); setError(null);
    try {
      await saveVerdict(token, {
        piece_id: piece.piece_id,
        verdict,
        criterion: criterion.trim() || null,
      });
      setDone(verdict);
      setTimeout(() => onResolved(piece.piece_id), 1500);
    } catch (err) {
      setError(err instanceof CalibrationError ? err.message : 'No se pudo guardar el veredicto.');
      setBusy(null);
    }
  };

  // Estado resuelto → tarjeta de confirmación.
  if (done) {
    const approved = done === 'approved';
    return (
      <motion.div
        initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className={cn(
          'rounded-2xl p-4 border',
          approved ? 'bg-emerald-500/[0.07] border-emerald-500/30' : 'bg-rose-500/[0.07] border-rose-500/30'
        )}
      >
        <div className={cn('flex items-center gap-2', approved ? 'text-emerald-300' : 'text-rose-300')}>
          {approved ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
          <p className="text-sm font-medium">{approved ? 'Aprobada' : 'Rechazada'} — guardado en el corpus</p>
        </div>
        <p className="mt-1 text-[10px] font-mono text-zinc-600">piece_id: {piece.piece_id}</p>
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
        {/* Contexto + primera opinión del watcher */}
        <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono text-zinc-600">
          <span className="text-accent/80 font-semibold">{piece.brand_id}</span>
          {piece.platform && <span>· {piece.platform}</span>}
          {piece.format && <span>· {piece.format}</span>}
          {piece.voice && <span>· voice:{piece.voice}</span>}
          {piece.domain && <span>· {piece.domain}</span>}
          {piece.psycho_preset && <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{piece.psycho_preset}</span>}
          <WatcherBadge result={piece.watcher_result} gate={piece.watcher_gate} />
        </div>

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

        {/* Acciones */}
        <AnimatePresence mode="wait">
          {rejecting ? (
            <motion.div key="reject" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
              <textarea
                value={criterion}
                onChange={(e) => { setCriterion(e.target.value); setError(null); }}
                rows={3}
                autoFocus
                placeholder="Criterio del rechazo (párrafo libre, obligatorio)… ¿Qué falló? ¿Qué regla se rompió?"
                className="w-full bg-[#050508] border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-700 outline-none focus:border-rose-500/60 transition-colors resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => submit('rejected')}
                  disabled={busy === 'reject' || !criterion.trim()}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold bg-rose-500/90 text-white hover:bg-rose-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {busy === 'reject' ? <Spinner size={14} /> : <><XCircle size={14} /> Confirmar rechazo</>}
                </button>
                <button
                  onClick={() => { setRejecting(false); setError(null); }}
                  disabled={busy === 'reject'}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:bg-zinc-800 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
              {/* Comentario opcional para aprobar */}
              <textarea
                value={criterion}
                onChange={(e) => setCriterion(e.target.value)}
                rows={2}
                placeholder="Criterio (opcional para aprobar)…"
                className="w-full bg-[#050508] border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-700 outline-none focus:border-accent/60 transition-colors resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => submit('approved')}
                  disabled={!!busy}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold bg-accent text-black hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-accent/20 transition-all"
                >
                  {busy === 'approve' ? <Spinner size={14} /> : <><CheckCircle2 size={14} /> Aprobar</>}
                </button>
                <button
                  onClick={() => { setRejecting(true); setError(null); }}
                  disabled={!!busy}
                  className="px-4 py-2.5 rounded-lg text-sm font-medium border border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors disabled:opacity-50"
                >
                  <XCircle size={14} className="inline mr-1" /> Rechazar
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
