import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Link2, Sprout, RefreshCw, CheckCircle2, Inbox, MessageSquareQuote } from 'lucide-react';
import { cn, Spinner } from '../../ui/components';
import {
  capture, list, IidError,
  type IidSession, type Seed, type SeedStatus,
} from '../../services/iidInbound';
import { StatusBadge, fmtDate, HonestBanner } from './seedUi';

// Estados que componen la vista "mis semillas" (read-only).
const MINE_STATUSES: SeedStatus[] = ['awaiting_approval', 'dispatched', 'rejected', 'failed', 'approved', 'captured'];

interface FormState {
  source_url: string;
  raw_signal: string;
  seeder_rationale: string;
  handle: string;
}

const EMPTY: FormState = { source_url: '', raw_signal: '', seeder_rationale: '', handle: '' };

/**
 * IidSeedsCapture — captura de semillas (seeder + admin).
 * Para el seeder es la pantalla completa; para el admin vive dentro de IID Intel.
 */
export default function IidSeedsCapture({ session }: { session: IidSession }) {
  const [form, setForm]       = useState<FormState>(EMPTY);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [done, setDone]       = useState<string | null>(null); // neutral_topic confirmado

  const [seeds, setSeeds]     = useState<Seed[]>([]);
  const [loading, setLoading] = useState(true);

  const loadMine = async () => {
    setLoading(true);
    try {
      const batches = await Promise.all(MINE_STATUSES.map((s) => list(session.session_token, s)));
      const merged = batches.flat();
      merged.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      setSeeds(merged);
    } catch {
      // lista best-effort: si falla, dejamos vacío sin romper la captura
      setSeeds([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadMine(); }, []);

  const canSubmit = form.source_url.trim() && form.raw_signal.trim() && !saving;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    setDone(null);
    try {
      const r = await capture(session.session_token, {
        source_url: form.source_url.trim(),
        raw_signal: form.raw_signal.trim(),
        seeder_rationale: form.seeder_rationale.trim() || null,
        handle: form.handle.trim() || null,
      });
      setDone(r.neutral_topic ?? 'Semilla registrada');
      setForm(EMPTY);
      loadMine();
    } catch (err) {
      setError(err instanceof IidError ? err.message : 'No se pudo guardar la semilla.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 pb-24 space-y-8">
      {/* Header */}
      <div>
        <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-600 mb-2">Sembrador IID</p>
        <h2 className="font-display text-2xl font-bold text-white flex items-center gap-2">
          <Sprout size={22} className="text-accent" /> Capturar semilla
        </h2>
        <p className="text-sm text-zinc-500 mt-1">
          Marcá un post relevante y por qué importa. El IID investiga el tema desde cero —
          nunca copia el contenido original.
        </p>
      </div>

      <HonestBanner />

      {/* Form */}
      <form onSubmit={submit} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-5">
        <Field label="Link del post" required>
          <div className="relative">
            <Link2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
            <input
              type="url"
              value={form.source_url}
              onChange={(e) => setForm({ ...form, source_url: e.target.value })}
              placeholder="https://…"
              className="w-full bg-[#050508] border border-zinc-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-zinc-700 outline-none focus:border-accent/60 transition-colors font-mono"
            />
          </div>
        </Field>

        <Field label="Por qué importa" required hint="Tu frase humana — el disparador, no el resumen del post.">
          <textarea
            value={form.raw_signal}
            onChange={(e) => setForm({ ...form, raw_signal: e.target.value })}
            rows={3}
            placeholder="Lo que viste y por qué te llamó la atención…"
            className="w-full bg-[#050508] border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-zinc-700 outline-none focus:border-accent/60 transition-colors resize-none leading-relaxed"
          />
        </Field>

        <Field label="Tu criterio (opcional)" hint="Contexto de mercado / por qué encaja con una marca. No material original.">
          <div className="relative">
            <MessageSquareQuote size={14} className="absolute left-3 top-3 text-zinc-600" />
            <textarea
              value={form.seeder_rationale}
              onChange={(e) => setForm({ ...form, seeder_rationale: e.target.value })}
              rows={2}
              placeholder="Tu lectura como capturador…"
              className="w-full bg-[#050508] border border-zinc-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-zinc-700 outline-none focus:border-accent/60 transition-colors resize-none leading-relaxed"
            />
          </div>
        </Field>

        <Field label="Cuenta / handle (opcional)">
          <input
            type="text"
            value={form.handle}
            onChange={(e) => setForm({ ...form, handle: e.target.value })}
            placeholder="@cuenta"
            className="w-full bg-[#050508] border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-zinc-700 outline-none focus:border-accent/60 transition-colors font-mono"
          />
        </Field>

        {error && (
          <p className="text-xs text-rose-400 font-mono leading-snug">{error}</p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold font-body transition-all',
            !canSubmit
              ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
              : 'bg-accent text-black hover:bg-accent/90 shadow-md shadow-accent/20'
          )}
        >
          {saving ? <><Spinner size={15} /> Destilando…</> : <><Sprout size={15} /> Capturar</>}
        </button>
      </form>

      {/* Confirmación */}
      <AnimatePresence>
        {done && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-start gap-3 bg-emerald-500/[0.07] border border-emerald-500/25 rounded-xl px-4 py-3.5"
          >
            <CheckCircle2 size={18} className="text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="text-emerald-300 font-medium">Semilla guardada — pendiente de revisión de Sam.</p>
              <p className="text-emerald-400/70 text-xs mt-0.5 font-mono">Tema detectado: {done}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mis semillas */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-600">Mis semillas</h3>
          <button
            onClick={loadMine}
            className="p-1.5 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-600 hover:text-zinc-400"
            title="Refrescar"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-zinc-700">
            <Spinner size={20} />
          </div>
        ) : seeds.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-zinc-700">
            <Inbox size={32} strokeWidth={1} />
            <p className="text-sm">Todavía no capturaste ninguna semilla.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {seeds.map((s) => (
              <div key={s.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm text-white leading-snug min-w-0">
                    {s.neutral_topic || <span className="text-zinc-500 italic">{s.raw_signal}</span>}
                  </p>
                  <StatusBadge status={s.status} />
                </div>
                <div className="flex items-center gap-3 mt-2 text-[10px] font-mono text-zinc-600">
                  <span>{fmtDate(s.created_at)}</span>
                  {s.mapped_domain && <span className="text-zinc-500">· {s.mapped_domain}</span>}
                  <a
                    href={s.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-zinc-600 hover:text-zinc-400 transition-colors truncate"
                  >
                    {s.source_url.replace(/^https?:\/\//, '').slice(0, 40)}…
                  </a>
                </div>
                {s.status === 'rejected' && s.rejected_reason && (
                  <p className="text-[11px] text-zinc-500 mt-2 leading-snug">
                    <span className="text-zinc-600">Motivo:</span> {s.rejected_reason}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Field helper ──────────────────────────────────────────────────────────────
function Field({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
        {label}{required && <span className="text-accent ml-1">*</span>}
      </span>
      {hint && <span className="block text-[10px] text-zinc-600 mt-0.5 mb-1.5 font-body normal-case tracking-normal">{hint}</span>}
      <div className={hint ? '' : 'mt-2'}>{children}</div>
    </label>
  );
}
