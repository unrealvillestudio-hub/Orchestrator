import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, ChevronRight, Inbox, RefreshCw, Zap, Eye, FileText } from 'lucide-react';
import { cn } from '../../ui/components';

// ── Supabase (same pattern as interpret-intent.ts) ─────────────────
const SB_URL = (import.meta as any).env.VITE_SUPABASE_URL as string;
const SB_KEY = (import.meta as any).env.VITE_SUPABASE_ANON_KEY as string;

async function fetchFindings(band: 'top' | 'watchlist' | 'discarded'): Promise<Finding[]> {
  const ranges: Record<string, string> = {
    top:       'ecosystem_score=gte.70&order=ecosystem_score.desc,finding_date.desc',
    watchlist: 'ecosystem_score=gte.50&ecosystem_score=lt.70&order=ecosystem_score.desc,finding_date.desc',
    discarded: 'ecosystem_score=lt.50&order=ecosystem_score.desc,finding_date.desc',
  };
  const res = await fetch(
    `${SB_URL}/rest/v1/iid_findings?${ranges[band]}&select=id,title,summary,ecosystem_score,content_score,ecosystem_status,content_eligible,finding_date,r_scores,c_scores,content_flag,source_urls,agent_id&limit=50`,
    {
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        'Accept-Profile': 'intel',
      },
    }
  );
  if (!res.ok) return [];
  return res.json();
}

async function fetchAgents(): Promise<Agent[]> {
  const res = await fetch(
    `${SB_URL}/rest/v1/iid_agents?select=id,name,tier&order=name`,
    {
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        'Accept-Profile': 'intel',
      },
    }
  );
  if (!res.ok) return [];
  return res.json();
}

// ── Types ──────────────────────────────────────────────────────────
interface Finding {
  id: string;
  title: string;
  summary: string;
  ecosystem_score: number;
  content_score: number;
  ecosystem_status: string;
  content_eligible: boolean;
  finding_date: string;
  r_scores: Record<string, number>;
  c_scores: Record<string, number>;
  content_flag: any;
  source_urls: string[];
  agent_id: string;
}

interface Agent {
  id: string;
  name: string;
  tier: string;
}

type Band = 'top' | 'watchlist' | 'discarded';

// ── Score bar ──────────────────────────────────────────────────────
function ScoreBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="h-1 bg-zinc-800 rounded-full overflow-hidden flex-1">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

// ── Finding card ───────────────────────────────────────────────────
function FindingCard({ finding, agentMap, bandColor }: {
  finding: Finding;
  agentMap: Record<string, Agent>;
  bandColor: string;
}) {
  const [open, setOpen] = useState(false);
  const agent = agentMap[finding.agent_id];
  const rScores = finding.r_scores ?? {};
  const cScores = finding.c_scores ?? {};
  const ecoTotal = Object.values(rScores).reduce((a, b) => a + b, 0);
  const cntTotal = Object.values(cScores).reduce((a, b) => a + b, 0);

  const rFields = [
    { key: 'r1_capability', label: 'Capability', max: 25 },
    { key: 'r2_quality',    label: 'Quality',    max: 20 },
    { key: 'r3_cost',       label: 'Cost',        max: 25 },
    { key: 'r4_implementation', label: 'Impl.',  max: 15 },
    { key: 'r5_time_to_value',  label: 'Time',   max: 10 },
    { key: 'r6_client',    label: 'Client',       max: 5  },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden hover:border-zinc-700 transition-colors"
      style={{ borderLeftWidth: 3, borderLeftColor: bandColor }}
    >
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-start gap-4 p-4 text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {agent && (
              <span className="text-[9px] font-mono uppercase tracking-widest bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">
                {agent.name}
              </span>
            )}
            {finding.content_eligible && (
              <span className="text-[9px] font-mono uppercase tracking-widest border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded flex items-center gap-1">
                <Zap size={8} /> Content ✓
              </span>
            )}
            <span className="text-[9px] font-mono text-zinc-700">
              {new Date(finding.finding_date).toLocaleDateString('es-ES')}
            </span>
          </div>
          <p className="text-sm text-white font-medium leading-snug">{finding.title}</p>
        </div>

        <div className="shrink-0 flex items-center gap-3">
          <div className="text-right">
            <div className="text-lg font-mono font-bold" style={{ color: bandColor }}>
              {Math.round(ecoTotal)}
            </div>
            <div className="text-[9px] font-mono text-zinc-700 uppercase">ECO</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-mono font-bold text-zinc-400">
              {Math.round(cntTotal)}
            </div>
            <div className="text-[9px] font-mono text-zinc-700 uppercase">CNT</div>
          </div>
          {open ? <ChevronDown size={14} className="text-zinc-600" /> : <ChevronRight size={14} className="text-zinc-600" />}
        </div>
      </button>

      {/* Expanded */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4 border-t border-zinc-800 pt-4">
              {/* Summary */}
              <p className="text-sm text-zinc-400 leading-relaxed">{finding.summary}</p>

              {/* R scores */}
              <div>
                <p className="text-[9px] font-mono uppercase tracking-widest text-zinc-600 mb-2">
                  R1–R6 Ecosystem Breakdown
                </p>
                <div className="space-y-1.5">
                  {rFields.map(f => (
                    <div key={f.key} className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-zinc-600 w-20 shrink-0">{f.label}</span>
                      <ScoreBar value={rScores[f.key] ?? 0} max={f.max} color={bandColor} />
                      <span className="text-[10px] font-mono text-zinc-500 w-8 text-right shrink-0">
                        {rScores[f.key] ?? 0}/{f.max}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sources */}
              {(finding.source_urls ?? []).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {finding.source_urls.slice(0, 3).map((url, i) => (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-mono text-zinc-600 hover:text-zinc-400 truncate max-w-xs transition-colors"
                    >
                      {url.replace(/^https?:\/\//, '').substring(0, 50)}…
                    </a>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Main module ────────────────────────────────────────────────────
export default function EcosystemIntelModule() {
  const [band, setBand]         = useState<Band>('top');
  const [findings, setFindings] = useState<Finding[]>([]);
  const [agents, setAgents]     = useState<Agent[]>([]);
  const [loading, setLoading]   = useState(true);
  const [counts, setCounts]     = useState({ top: 0, watchlist: 0, discarded: 0 });

  const agentMap = Object.fromEntries(agents.map(a => [a.id, a]));

  const load = async (b: Band) => {
    setLoading(true);
    const [data, agentData] = await Promise.all([fetchFindings(b), agents.length ? Promise.resolve(agents) : fetchAgents()]);
    setFindings(data);
    if (!agents.length) setAgents(agentData);
    setLoading(false);
  };

  const loadCounts = async () => {
    const [top, watch, disc] = await Promise.all([
      fetchFindings('top'),
      fetchFindings('watchlist'),
      fetchFindings('discarded'),
    ]);
    setCounts({ top: top.length, watchlist: watch.length, discarded: disc.length });
  };

  useEffect(() => {
    fetchAgents().then(setAgents);
    loadCounts();
    load('top');
  }, []);

  const handleBand = (b: Band) => {
    setBand(b);
    load(b);
  };

  const BANDS: { id: Band; label: string; color: string }[] = [
    { id: 'top',       label: 'Top',       color: '#00FFD1' },
    { id: 'watchlist', label: 'Watchlist', color: '#FFB020' },
    { id: 'discarded', label: 'Descartados', color: '#71717a' },
  ];

  const bandColor = BANDS.find(b => b.id === band)?.color ?? '#00FFD1';

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 pb-20">
      {/* Header */}
      <div className="mb-8">
        <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-600 mb-2">
          IID Network
        </p>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-white">Ecosystem Intel</h2>
            <p className="text-sm text-zinc-500 mt-1">
              Hallazgos del IID Network evaluados para mejora interna
            </p>
          </div>
          <button
            onClick={() => load(band)}
            className="p-2 hover:bg-zinc-800 rounded-xl transition-colors text-zinc-600 hover:text-zinc-400 shrink-0"
            title="Refrescar"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Band tabs */}
      <div className="flex items-center gap-1 bg-zinc-900/80 border border-zinc-800 rounded-xl p-1 mb-6">
        {BANDS.map(b => (
          <button
            key={b.id}
            onClick={() => handleBand(b.id)}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all font-body',
              band === b.id
                ? 'bg-zinc-800 text-white shadow'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
            )}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: band === b.id ? b.color : '#3f3f46' }}
            />
            {b.label}
            <span className={cn(
              'text-[9px] font-mono px-1.5 py-0.5 rounded-full',
              band === b.id ? 'bg-zinc-700 text-zinc-300' : 'bg-zinc-800 text-zinc-600'
            )}>
              {counts[b.id]}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-zinc-700">
          <RefreshCw size={24} strokeWidth={1} className="animate-spin" />
          <p className="text-sm font-mono">Cargando hallazgos…</p>
        </div>
      ) : findings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-zinc-700">
          <Inbox size={40} strokeWidth={1} />
          <p className="text-sm">Sin hallazgos en esta banda todavía.</p>
          <p className="text-xs text-zinc-800">Los agentes IID corren semanalmente.</p>
        </div>
      ) : (
        <motion.div className="space-y-3">
          {findings.map((f, i) => (
            <motion.div
              key={f.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <FindingCard finding={f} agentMap={agentMap} bandColor={bandColor} />
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
