import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  CheckCircle2, Clock, Shield, Database, ChevronRight,
  AlertTriangle, Play, ArrowLeft, Zap
} from 'lucide-react';
import { useFlowStore } from '../../store/useFlowStore';
import { getBrandById, BRANDS } from '../../config/brands';
import { getLabById } from '../../config/labs';
import { cn, GlowDot } from '../../ui/components';
import { FlowStage } from '../../core/types';

const PLATFORM_ICONS: Record<string, string> = {
  INSTAGRAM: "📸", FACEBOOK: "👥", TIKTOK: "🎵",
  YOUTUBE: "▶️", LINKEDIN: "💼", THREADS: "🧵",
};

interface PlannerProps {
  onApprove: () => void;
  onBack: () => void;
}

export default function FlowPlannerModule({ onApprove, onBack }: PlannerProps) {
  const { activePlan, setActivePlan } = useFlowStore();
  const [editingBrand, setEditingBrand] = useState(false);

  if (!activePlan) return null;

  const brand = getBrandById(activePlan.brandId);
  const totalEstimate = activePlan.estimatedTotalSeconds;
  const checkpointCount = activePlan.stages.filter(s => s.requiresApproval).length;

  const handleBrandChange = (brandId: string) => {
    setActivePlan({ ...activePlan, brandId });
    setEditingBrand(false);
  };

  const stagesWithLab = activePlan.stages.map(s => ({
    ...s,
    lab: getLabById(s.labId),
  }));

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 pb-24">

      {/* Back */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-400 transition-colors mb-8 font-mono"
      >
        <ArrowLeft size={12} /> nuevo prompt
      </button>

      {/* Plan header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <div className="flex items-center gap-2 mb-3">
          <GlowDot color="#FFAB00" />
          <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-500">Plan generado</span>
        </div>
        <h2 className="font-display text-3xl font-bold text-white mb-3 leading-tight">
          {activePlan.interpretedIntent}
        </h2>

        {/* Meta chips */}
        <div className="flex flex-wrap gap-2 mt-4">

          {/* Brand chip — editable */}
          <div className="relative">
            <button
              onClick={() => setEditingBrand(!editingBrand)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all text-xs font-medium"
              style={{
                borderColor: `${brand?.color}44`,
                backgroundColor: `${brand?.color}11`,
                color: brand?.color,
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: brand?.color }} />
              {brand?.name}   {/* ← was displayName */}
              <ChevronRight size={10} className={cn("transition-transform", editingBrand && "rotate-90")} />
            </button>

            {editingBrand && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute top-full mt-1 left-0 z-20 bg-zinc-900 border border-zinc-700 rounded-xl p-1.5 min-w-[200px] shadow-2xl"
              >
                {BRANDS.map(b => (
                  <button
                    key={b.id}
                    onClick={() => handleBrandChange(b.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-zinc-800 text-xs text-left transition-colors"
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: b.color }} />
                    <span className="text-zinc-300">{b.name}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </div>

          {activePlan.platforms.map(p => (
            <span key={p} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-400">
              {PLATFORM_ICONS[p]} {p}
            </span>
          ))}

          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-500">
            <Clock size={11} /> ~{Math.ceil(totalEstimate / 60)} min
          </span>

          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-500">
            <Shield size={11} /> {checkpointCount} checkpoint{checkpointCount !== 1 ? "s" : ""}
          </span>
        </div>
      </motion.div>

      {/* Pipeline */}
      <div className="mb-8">
        <p className="text-[11px] font-mono uppercase tracking-widest text-zinc-600 mb-4">Pipeline de ejecución</p>
        <div className="space-y-0">
          {stagesWithLab.map((stage, i) => (
            <motion.div
              key={stage.id}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08 }}
              className="relative flex gap-4"
            >
              {/* Connector line */}
              {i < stagesWithLab.length - 1 && (
                <div className="absolute left-[19px] top-10 bottom-0 w-px bg-gradient-to-b from-zinc-700 to-transparent" />
              )}

              {/* Stage number */}
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-display font-bold text-sm border"
                style={{
                  backgroundColor: `${stage.lab?.color ?? '#888'}15`,
                  borderColor: `${stage.lab?.color ?? '#888'}30`,
                  color: stage.lab?.color ?? '#888',
                }}
              >
                {i + 1}
              </div>

              {/* Stage content */}
              <div className="flex-1 pb-6">
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-zinc-700 transition-colors">
                  <div className="flex items-start justify-between gap-3 mb-1.5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="text-[10px] font-mono font-bold uppercase tracking-wider" style={{ color: stage.lab?.color }}>
                          {stage.lab?.icon} {stage.lab?.label}
                        </span>
                        {stage.requiresApproval && (
                          <span className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400">
                            <Shield size={8} /> CHECKPOINT
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-white">{stage.label}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">{stage.description}</p>
                    </div>
                    <span className="text-[10px] font-mono text-zinc-700 shrink-0 mt-1">~{stage.estimatedSeconds}s</span>
                  </div>

                  {/* Output preview */}
                  {stage.mockOutput && (
                    <div className="mt-2.5 px-3 py-2 bg-zinc-950 rounded-lg border border-zinc-800">
                      <p className="text-[10px] font-mono text-zinc-700 mb-1">preview output</p>
                      <p className="text-[11px] text-zinc-500 leading-relaxed line-clamp-2">{stage.mockOutput}</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* DB_VARIABLES + Compliance */}
      <div className="grid grid-cols-2 gap-3 mb-8">
        {activePlan.dbVariablesKeys.length > 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <Database size={12} className="text-accent" />
              <p className="text-[10px] font-mono uppercase tracking-widest text-zinc-600">DB_VARIABLES</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {activePlan.dbVariablesKeys.map(k => (
                <span key={k} className="text-[10px] font-mono px-2 py-0.5 rounded bg-accent/10 text-accent/70 border border-accent/20">
                  {k}
                </span>
              ))}
            </div>
          </div>
        )}

        {activePlan.complianceFlags.length > 0 && (
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <AlertTriangle size={12} className="text-amber-400" />
              <p className="text-[10px] font-mono uppercase tracking-widest text-amber-600">Compliance</p>
            </div>
            <div className="space-y-1">
              {activePlan.complianceFlags.map((f, i) => (
                <p key={i} className="text-[11px] text-amber-400/70 leading-relaxed">• {f}</p>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Approve CTA — fixed bottom bar */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="fixed bottom-0 left-0 right-0 px-6 py-4 bg-zinc-950/90 backdrop-blur-xl border-t border-zinc-800 flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <Zap size={14} className="text-accent" />
          <span className="text-sm text-zinc-400">
            <span className="text-white font-semibold">{activePlan.stages.length} etapas</span>
            {" · "}
            <span className="text-white font-semibold">{checkpointCount} checkpoints</span>
            {" · "}
            ~{Math.ceil(totalEstimate / 60)} min estimado
          </span>
        </div>
        <button
          onClick={onApprove}
          className="flex items-center gap-2.5 px-6 py-3 bg-accent hover:bg-accent/90 text-black font-bold rounded-xl text-sm transition-all shadow-lg shadow-accent/20 active:scale-95"
        >
          <Play size={14} />
          Aprobar y ejecutar
        </button>
      </motion.div>
    </div>
  );
}