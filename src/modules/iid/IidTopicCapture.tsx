import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Lightbulb, CheckCircle2, Store, MessageSquareQuote, Telescope } from 'lucide-react';
import { cn, Spinner } from '../../ui/components';
import {
  captureTopic, listOptions, shortId, IidError,
  type IidSession, type ListOptions,
} from '../../services/iidInbound';

/**
 * IidTopicCapture — seed de tema (admin, dentro de IID Intel → IID Seeds).
 *
 * Sam, 2026-10-20: escribe un tema y elige la marca; el carril lo investiga sin cupo y el resultado
 * vuelve a «Investigaciones» con su ID. Lo que se hace con él (publicar, subirlo al carril, activar el
 * dominio propuesto, subir la cadencia) se decide y se ejecuta en sesión: esta pantalla no tiene botones
 * para eso, a propósito.
 */
export default function IidTopicCapture({ session, onVerInvestigaciones }: {
  session: IidSession;
  onVerInvestigaciones?: () => void;
}) {
  const [brands, setBrands]   = useState<ListOptions['brands']>([]);
  const [brandId, setBrandId] = useState('');
  const [topic, setTopic]     = useState('');
  const [context, setContext] = useState('');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [done, setDone]       = useState<{ id: string; started: boolean } | null>(null);

  useEffect(() => {
    listOptions(session.session_token)
      .then((o) => setBrands(o.brands ?? []))
      .catch(() => setBrands([]));
  }, []);

  const canSubmit = !!brandId && topic.trim().length > 0 && !saving;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    setDone(null);
    try {
      const r = await captureTopic(session.session_token, {
        brand_id: brandId,
        topic: topic.trim(),
        context: context.trim() || null,
      });
      setDone({ id: r.seed_id, started: r.research_started });
      setTopic('');
      setContext('');
    } catch (err) {
      setError(err instanceof IidError ? err.message : 'No se pudo guardar el tema.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-display text-lg font-bold text-white flex items-center gap-2">
          <Lightbulb size={18} className="text-accent" /> Proponer un tema para investigar
        </h3>
        <p className="text-sm text-zinc-500 mt-1 leading-relaxed">
          Escribe el tema con tus palabras y elige la marca. Un agente de esa marca lo investiga en la web
          y el resultado aparece en «Investigaciones» con su ID. Nada se publica ni entra al carril hasta
          que lo decidamos en sesión.
        </p>
      </div>

      <form onSubmit={submit} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-5">
        <Field label="Marca" required>
          <div className="relative">
            <Store size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
            <select
              value={brandId}
              onChange={(e) => setBrandId(e.target.value)}
              className={cn(
                'w-full bg-[#050508] border rounded-xl pl-9 pr-3 py-2.5 text-sm text-white outline-none focus:border-accent/60 transition-colors',
                brandId ? 'border-zinc-800' : 'border-amber-500/40'
              )}
            >
              <option value="">— elige una marca —</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name || b.id}</option>)}
            </select>
          </div>
        </Field>

        <Field label="Tema" required hint="Lo que quieres que la marca empiece a tratar. Se investiga tal como lo escribes.">
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="Por ejemplo: las barreras de la mente humana que entorpecen un juicio que la mente sintética no tiene…"
            className="w-full bg-[#050508] border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-zinc-700 outline-none focus:border-accent/60 transition-colors resize-y leading-relaxed"
          />
        </Field>

        <Field label="Contexto (opcional)" hint="Para qué lo quieres, qué ángulo te interesa o qué debe evitar la investigación.">
          <div className="relative">
            <MessageSquareQuote size={14} className="absolute left-3 top-3 text-zinc-600" />
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={2}
              placeholder="Opcional"
              className="w-full bg-[#050508] border border-zinc-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-zinc-700 outline-none focus:border-accent/60 transition-colors resize-none leading-relaxed"
            />
          </div>
        </Field>

        {error && <p className="text-xs text-rose-400 font-mono leading-snug">{error}</p>}

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
          {saving ? <><Spinner size={15} /> Enviando…</> : <><Telescope size={15} /> Investigar este tema</>}
        </button>
      </form>

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
              <p className="text-emerald-300 font-medium">
                Tema guardado · ID <span className="font-mono">{shortId(done.id)}</span>
              </p>
              <p className="text-emerald-400/70 text-xs mt-0.5">
                {done.started
                  ? 'La investigación ya empezó. Tarda unos minutos; el resultado aparece en «Investigaciones».'
                  : 'La investigación empieza en la próxima pasada del barrido (como mucho, 15 minutos).'}
              </p>
              {onVerInvestigaciones && (
                <button
                  onClick={onVerInvestigaciones}
                  className="text-xs text-emerald-300 underline underline-offset-2 mt-1.5 hover:text-emerald-200"
                >
                  Ir a «Investigaciones»
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

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
