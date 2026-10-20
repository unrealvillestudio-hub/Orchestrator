import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, ChevronRight, Inbox, RefreshCw, AlertTriangle, Compass, Link2 } from 'lucide-react';
import { cn } from '../../ui/components';
import { listTopics, shortId, IidError, type IidSession, type TopicSeed } from '../../services/iidInbound';
import { StatusBadge, fmtDate } from '../iid/seedUi';

/**
 * InvestigacionesView — los resultados de los seeds de tema, cada uno con su ID.
 *
 * Sustituye a la vista «Hallazgos» (Top / Watchlist / Descartados), retirada por Sam el 2026-10-20.
 * Aquella leía `intel.iid_findings` con la clave anónima, que no tiene permiso sobre esa tabla por
 * decisión de Sam (es inteligencia de marca), y se tragaba el error: llevaba meses mostrando «Sin
 * hallazgos» con 409 hallazgos en la base. Esta lee por `iid-inbound` con la sesión, y un fallo se
 * muestra como fallo.
 *
 * Sólo lectura, a propósito: lo que se hace con cada resultado se decide y se ejecuta en sesión.
 */
const EN_CURSO = new Set(['captured', 'researching']);
const REFRESCO_MS = 30_000;

export default function InvestigacionesView({ session }: { session: IidSession }) {
  const [items, setItems]     = useState<TopicSeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await listTopics(session.session_token);
      setItems(data);
      setError(null);
    } catch (err) {
      setError(err instanceof IidError ? err.message : 'No se pudieron cargar las investigaciones.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); return () => { if (timer.current) clearTimeout(timer.current); }; }, []);

  // Mientras haya una investigación en curso, la vista se refresca sola.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (items.some((s) => EN_CURSO.has(s.status))) timer.current = setTimeout(load, REFRESCO_MS);
  }, [items]);

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 pb-20">
      <div className="mb-8">
        <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-600 mb-2">IID Network</p>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-display text-2xl font-bold text-white">Investigaciones</h2>
            <p className="text-sm text-zinc-500 mt-1">
              Los temas que propusiste en IID Seeds, investigados. Cada uno lleva su ID para revisarlo en sesión.
            </p>
          </div>
          <button
            onClick={load}
            className="p-2 hover:bg-zinc-800 rounded-xl transition-colors text-zinc-600 hover:text-zinc-400 shrink-0"
            title="Refrescar"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 bg-rose-500/[0.07] border border-rose-500/25 rounded-xl px-3.5 py-3 mb-6">
          <AlertTriangle size={14} className="text-rose-400 shrink-0 mt-0.5" />
          <p className="text-xs text-rose-300 font-mono leading-snug">{error}</p>
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-zinc-700">
          <RefreshCw size={24} strokeWidth={1} className="animate-spin" />
          <p className="text-sm font-mono">Cargando investigaciones…</p>
        </div>
      ) : items.length === 0 && !error ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-zinc-700">
          <Inbox size={40} strokeWidth={1} />
          <p className="text-sm">Todavía no hay temas investigados.</p>
          <p className="text-xs text-zinc-600">Propón uno en IID Seeds → Proponer tema.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((s) => <TopicCard key={s.id} seed={s} />)}
        </div>
      )}
    </div>
  );
}

function TopicCard({ seed }: { seed: TopicSeed }) {
  const [open, setOpen] = useState(false);
  const [memo, setMemo] = useState(false);
  const r = seed.research;
  const dom = r?.dominio ?? null;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden hover:border-zinc-700 transition-colors">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-start gap-4 p-4 text-left">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-[10px] font-mono text-accent bg-accent/10 border border-accent/20 px-2 py-0.5 rounded">
              ID {shortId(seed.id)}
            </span>
            <span className="text-[9px] font-mono uppercase tracking-widest bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">
              {seed.mapped_brand_id}
            </span>
            <span className="text-[9px] font-mono text-zinc-600">{fmtDate(seed.created_at)}</span>
          </div>
          <p className="text-sm text-white leading-snug line-clamp-3">{seed.raw_signal}</p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <StatusBadge status={seed.status} />
          {open ? <ChevronDown size={14} className="text-zinc-600" /> : <ChevronRight size={14} className="text-zinc-600" />}
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-4 space-y-4 border-t border-zinc-800">
              {seed.seeder_rationale && (
                <p className="text-xs text-zinc-500 leading-relaxed">
                  <span className="text-zinc-600">Contexto:</span> {seed.seeder_rationale}
                </p>
              )}

              {EN_CURSO.has(seed.status) && (
                <p className="text-sm text-sky-300/80">
                  {seed.status === 'researching'
                    ? 'Investigando. Tarda unos minutos; esta vista se actualiza sola.'
                    : 'En cola: empieza en cuanto el carril lo tome.'}
                  {seed.last_error && <span className="block text-xs text-zinc-500 mt-1 font-mono">{seed.last_error}</span>}
                </p>
              )}

              {seed.status === 'failed' && (
                <p className="text-sm text-rose-300/90">
                  La investigación no se pudo completar tras {seed.failures} intentos.
                  {seed.last_error && <span className="block text-xs text-zinc-500 mt-1 font-mono">{seed.last_error}</span>}
                </p>
              )}

              {r && (
                <>
                  {r.resumen_error && (
                    <p className="text-xs text-amber-300/90 leading-snug">
                      No se pudo generar el resumen ({r.resumen_error}). El memo completo está abajo.
                    </p>
                  )}
                  {r.resumen && <p className="text-sm text-zinc-300 leading-relaxed">{r.resumen}</p>}

                  {dom && (
                    <div className="bg-[#050508] border border-zinc-800 rounded-xl px-3.5 py-3">
                      <p className="text-[9px] font-mono uppercase tracking-widest text-zinc-600 mb-1.5 flex items-center gap-1.5">
                        <Compass size={10} /> Dominio
                      </p>
                      {dom.encaja_en ? (
                        <p className="text-sm text-zinc-300">
                          Cabe en el dominio <span className="font-mono text-white">{dom.encaja_en}</span>.
                        </p>
                      ) : dom.propuesto ? (
                        <p className="text-sm text-zinc-300">
                          Dominio nuevo propuesto: <span className="text-white">{dom.propuesto.nombre}</span>{' '}
                          <span className="font-mono text-zinc-500">({dom.propuesto.slug})</span>
                          {dom.propuesto.angulos.length > 0 && (
                            <span className="block text-xs text-zinc-500 mt-1 font-mono">
                              Ángulos: {dom.propuesto.angulos.join(', ')}
                            </span>
                          )}
                          <span className="block text-[11px] text-zinc-600 mt-1">Se activa sólo si lo decidimos en sesión.</span>
                        </p>
                      ) : (
                        <p className="text-sm text-zinc-500">Sin dominio propuesto.</p>
                      )}
                      {dom.por_que && <p className="text-xs text-zinc-500 mt-1.5 leading-snug">{dom.por_que}</p>}
                    </div>
                  )}

                  {r.hallazgos.length > 0 && (
                    <div>
                      <p className="text-[9px] font-mono uppercase tracking-widest text-zinc-600 mb-2">Hallazgos</p>
                      <ul className="space-y-2">
                        {r.hallazgos.map((h, i) => (
                          <li key={i} className="text-sm text-zinc-300 leading-snug">
                            {h.afirmacion}
                            <a
                              href={h.fuente}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block text-[10px] font-mono text-zinc-600 hover:text-zinc-400 truncate mt-0.5"
                            >
                              {h.fuente.replace(/^https?:\/\//, '')}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex items-center gap-3 text-[10px] font-mono text-zinc-600 flex-wrap">
                    <span className="flex items-center gap-1"><Link2 size={10} /> {r.fuentes.length} fuentes</span>
                    <span>agente {r.agente}</span>
                    {seed.researched_at && <span>lista {fmtDate(seed.researched_at)}</span>}
                    {r.truncado && <span className="text-amber-400">memo truncado</span>}
                  </div>

                  <div>
                    <button
                      onClick={() => setMemo((m) => !m)}
                      className={cn('text-xs font-mono flex items-center gap-1 transition-colors', memo ? 'text-zinc-300' : 'text-zinc-500 hover:text-zinc-300')}
                    >
                      {memo ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Memo completo
                    </button>
                    {memo && (
                      <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs text-zinc-400 bg-[#050508] border border-zinc-800 rounded-xl p-3 font-body leading-relaxed">
                        {r.memo}
                      </pre>
                    )}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
