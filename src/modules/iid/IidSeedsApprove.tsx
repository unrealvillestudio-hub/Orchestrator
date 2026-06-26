import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  RefreshCw, Inbox, CheckCircle2, XCircle, AlertTriangle, Send, User, Sparkles,
} from 'lucide-react';
import { cn, Spinner } from '../../ui/components';
import {
  list, listOptions, approve, reject, IidError,
  type IidSession, type Seed, type ListOptions, type ApproveResult,
} from '../../services/iidInbound';
import { StatusBadge, fmtDate } from './seedUi';

type QueueTab = 'awaiting_approval' | 'failed';

/**
 * IidSeedsApprove — cola de revisión (solo admin).
 * El gate real vive server-side (seeder → 403); esto es la UI del admin.
 */
export default function IidSeedsApprove({ session }: { session: IidSession }) {
  const [tab, setTab]         = useState<QueueTab>('awaiting_approval');
  const [seeds, setSeeds]     = useState<Seed[]>([]);
  const [opts, setOpts]       = useState<ListOptions>({ domains: [], brands: [] });
  const [loading, setLoading] = useState(true);
  const [counts, setCounts]   = useState({ awaiting_approval: 0, failed: 0 });

  const loadOpts = async () => {
    try { setOpts(await listOptions(session.session_token)); } catch { /* best-effort */ }
  };

  const load = async (t: QueueTab) => {
    setLoading(true);
    try { setSeeds(await list(session.session_token, t)); }
    catch { setSeeds([]); }
    finally { setLoading(false); }
  };

  const loadCounts = async () => {
    try {
      const [aw, fa] = await Promise.all([
        list(session.session_token, 'awaiting_approval'),
        list(session.session_token, 'failed'),
      ]);
      setCounts({ awaiting_approval: aw.length, failed: fa.length });
    } catch { /* best-effort */ }
  };

  useEffect(() => { loadOpts(); loadCounts(); load('awaiting_approval'); }, []);

  const switchTab = (t: QueueTab) => { setTab(t); load(t); };

  // Cuando una semilla se resuelve, la sacamos de la lista y refrescamos contadores.
  const onResolved = (seedId: string) => {
    setSeeds((prev) => prev.filter((s) => s.id !== seedId));
    loadCounts();
  };

  const TABS: { id: QueueTab; label: string }[] = [
    { id: 'awaiting_approval', label: 'En revisión' },
    { id: 'failed',            label: 'Fallidas' },
  ];

  return (
    <div className="max-w-3xl mx-auto px-6 py-2">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h3 className="font-display text-lg font-bold text-white">Cola de revisión</h3>
          <p className="text-sm text-zinc-500 mt-0.5">
            Aprobás → el IID investiga el tema desde cero. Rechazás → no se despacha.
          </p>
        </div>
        <button
          onClick={() => { load(tab); loadCounts(); }}
          className="p-2 hover:bg-zinc-800 rounded-xl transition-colors text-zinc-600 hover:text-zinc-400 shrink-0"
          title="Refrescar"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-zinc-900/80 border border-zinc-800 rounded-xl p-1 mb-6">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => switchTab(t.id)}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all font-body',
              tab === t.id ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
            )}
          >
            {t.label}
            <span className={cn(
              'text-[9px] font-mono px-1.5 py-0.5 rounded-full',
              tab === t.id ? 'bg-zinc-700 text-zinc-300' : 'bg-zinc-800 text-zinc-600'
            )}>
              {counts[t.id]}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-zinc-700"><Spinner size={22} /></div>
      ) : seeds.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-2 text-zinc-700">
          <Inbox size={36} strokeWidth={1} />
          <p className="text-sm">{tab === 'awaiting_approval' ? 'Nada pendiente de revisión.' : 'Sin semillas fallidas.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {seeds.map((s) => (
            <SeedReviewCard key={s.id} seed={s} session={session} opts={opts} onResolved={onResolved} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Card de revisión ──────────────────────────────────────────────────────────
function SeedReviewCard({ seed, session, opts, onResolved }: {
  seed: Seed; session: IidSession; opts: ListOptions; onResolved: (id: string) => void;
}) {
  const [topic, setTopic]   = useState(seed.neutral_topic ?? '');
  const [domain, setDomain] = useState(seed.mapped_domain ?? '');
  const [brand, setBrand]   = useState(seed.mapped_brand_id ?? '');

  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason]       = useState('');

  const [busy, setBusy]     = useState<null | 'approve' | 'reject'>(null);
  const [error, setError]   = useState<string | null>(null);
  const [result, setResult] = useState<ApproveResult | null>(null);

  const isAwaiting = seed.status === 'awaiting_approval';
  const dn = seed.distill_notes;

  // domains: las activas + la mapeada si por algún motivo no está en la lista.
  const domainOpts = Array.from(new Set([...(opts.domains ?? []), ...(seed.mapped_domain ? [seed.mapped_domain] : [])]));

  const doApprove = async () => {
    if (!domain) { setError('Asigná un domain antes de aprobar.'); return; }
    if (!topic.trim()) { setError('El tema neutro no puede quedar vacío.'); return; }
    setBusy('approve'); setError(null);
    try {
      const r = await approve(session.session_token, {
        seed_id: seed.id,
        mapped_domain: domain,
        mapped_brand_id: brand || null,
        neutral_topic: topic.trim(),
      });
      setResult(r);
      // se muestra el resultado un instante y luego se retira de la cola
      setTimeout(() => onResolved(seed.id), 2200);
    } catch (err) {
      setError(err instanceof IidError ? err.message : 'No se pudo aprobar.');
      setBusy(null);
    }
  };

  const doReject = async () => {
    if (!reason.trim()) { setError('El motivo es obligatorio para rechazar.'); return; }
    setBusy('reject'); setError(null);
    try {
      await reject(session.session_token, seed.id, reason.trim());
      onResolved(seed.id);
    } catch (err) {
      setError(err instanceof IidError ? err.message : 'No se pudo rechazar.');
      setBusy(null);
    }
  };

  // Aviso de scope: la marca mapeada está fuera del scope del capturador.
  const capturerOutOfScope = !!brand && !!seed.mapped_brand_id; // señal definitiva la da la EF; acá solo preparamos UI

  // Estado resuelto (aprobado) → tarjeta de éxito.
  if (result) {
    return (
      <motion.div
        initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="bg-emerald-500/[0.07] border border-emerald-500/30 rounded-2xl p-4"
      >
        <div className="flex items-center gap-2 text-emerald-300">
          <CheckCircle2 size={18} />
          <p className="text-sm font-medium">Despachada al IID</p>
        </div>
        <div className="mt-2 text-[11px] font-mono text-emerald-400/80 space-y-0.5">
          <p>finding_id: {result.finding_id}</p>
          <p>queue_entries: {result.queue_entries}</p>
          {result.out_of_scope && (
            <p className="text-amber-400">⚠ marca fuera del scope del capturador (aprobada igual por admin)</p>
          )}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden"
      style={{ borderLeftWidth: 3, borderLeftColor: isAwaiting ? '#FFAB00' : '#f43f5e' }}
    >
      <div className="p-4 space-y-4">
        {/* Top row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono text-zinc-600">
            <span className="flex items-center gap-1 text-zinc-500"><User size={10} /> {seed.captured_by}</span>
            <span>· {fmtDate(seed.created_at)}</span>
            {seed.lane && seed.lane !== 'standard' && (
              <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{seed.lane}</span>
            )}
          </div>
          <StatusBadge status={seed.status} />
        </div>

        {/* Señal humana + criterio */}
        <div className="space-y-2">
          <Block label="Por qué importa (capturador)">{seed.raw_signal}</Block>
          {seed.seeder_rationale && <Block label="Criterio">{seed.seeder_rationale}</Block>}
        </div>

        {/* Destilado */}
        {dn && (
          <div className="bg-[#050508] border border-zinc-800/80 rounded-xl p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-600 flex items-center gap-1">
                <Sparkles size={10} className="text-accent" /> Destilado IID
              </span>
              {typeof dn.confidence === 'number' && (
                <span className="text-[9px] font-mono text-zinc-500">
                  confianza {Math.round(dn.confidence * 100)}%
                </span>
              )}
            </div>
            {dn.summary && <p className="text-xs text-zinc-400 leading-relaxed">{dn.summary}</p>}
            {(dn.alternatives ?? []).length > 0 && (
              <p className="text-[10px] text-zinc-600 font-mono">
                alt: {dn.alternatives.map((a) => `${a.domain ?? '?'}→${a.brand_id ?? '?'}`).join(' · ')}
              </p>
            )}
          </div>
        )}

        {/* Si falló, mostrar el motivo */}
        {seed.status === 'failed' && seed.rejected_reason && (
          <div className="flex items-start gap-2 text-[11px] text-rose-400/90 bg-rose-500/[0.06] border border-rose-500/20 rounded-xl px-3 py-2">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <span className="leading-snug">{seed.rejected_reason}</span>
          </div>
        )}

        {/* Corrección inline */}
        <div className="space-y-3 pt-1">
          <label className="block">
            <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-600">Tema neutro</span>
            <input
              value={topic}
              onChange={(e) => { setTopic(e.target.value); setError(null); }}
              disabled={!isAwaiting}
              className="w-full mt-1 bg-[#050508] border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/60 transition-colors disabled:opacity-50"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-600">Domain *</span>
              <select
                value={domain}
                onChange={(e) => { setDomain(e.target.value); setError(null); }}
                disabled={!isAwaiting}
                className={cn(
                  'w-full mt-1 bg-[#050508] border rounded-lg px-2.5 py-2 text-sm text-white outline-none focus:border-accent/60 transition-colors disabled:opacity-50',
                  domain ? 'border-zinc-800' : 'border-amber-500/40'
                )}
              >
                <option value="">— sin asignar —</option>
                {domainOpts.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-600">Marca</span>
              <select
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                disabled={!isAwaiting}
                className="w-full mt-1 bg-[#050508] border border-zinc-800 rounded-lg px-2.5 py-2 text-sm text-white outline-none focus:border-accent/60 transition-colors disabled:opacity-50"
              >
                <option value="">— sin marca —</option>
                {(opts.brands ?? []).map((b) => <option key={b.id} value={b.id}>{b.name || b.id}</option>)}
              </select>
            </label>
          </div>

          {capturerOutOfScope && seed.mapped_brand_id && brand !== seed.mapped_brand_id && (
            <p className="text-[10px] text-amber-400/80 font-mono flex items-center gap-1">
              <AlertTriangle size={11} /> cambiaste la marca sugerida
            </p>
          )}
        </div>

        {/* Source */}
        <a
          href={seed.source_url} target="_blank" rel="noopener noreferrer"
          className="block text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors truncate"
        >
          {seed.source_url}
        </a>

        {error && <p className="text-xs text-rose-400 font-mono leading-snug">{error}</p>}

        {/* Acciones */}
        <AnimatePresence mode="wait">
          {rejecting ? (
            <motion.div key="reject" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
              <textarea
                value={reason}
                onChange={(e) => { setReason(e.target.value); setError(null); }}
                rows={2}
                autoFocus
                placeholder="Motivo del rechazo (obligatorio)…"
                className="w-full bg-[#050508] border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-700 outline-none focus:border-rose-500/60 transition-colors resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={doReject}
                  disabled={busy === 'reject' || !reason.trim()}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold bg-rose-500/90 text-white hover:bg-rose-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {busy === 'reject' ? <Spinner size={14} /> : <><XCircle size={14} /> Confirmar rechazo</>}
                </button>
                <button
                  onClick={() => { setRejecting(false); setReason(''); setError(null); }}
                  disabled={busy === 'reject'}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:bg-zinc-800 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex gap-2">
              {isAwaiting && (
                <button
                  onClick={doApprove}
                  disabled={busy === 'approve'}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold bg-accent text-black hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-accent/20 transition-all"
                >
                  {busy === 'approve' ? <Spinner size={14} /> : <><Send size={14} /> Aprobar y despachar</>}
                </button>
              )}
              <button
                onClick={() => setRejecting(true)}
                disabled={!!busy}
                className={cn(
                  'flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium border border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors disabled:opacity-50',
                  isAwaiting ? 'px-4' : 'flex-1'
                )}
              >
                <XCircle size={14} /> Rechazar
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9px] font-mono uppercase tracking-widest text-zinc-600 mb-0.5">{label}</p>
      <p className="text-sm text-zinc-300 leading-relaxed">{children}</p>
    </div>
  );
}
