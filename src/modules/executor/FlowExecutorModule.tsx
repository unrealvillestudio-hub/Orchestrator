import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  CheckCircle2, XCircle, Clock, Shield, ChevronDown,
  ThumbsUp, ThumbsDown, RotateCcw, Trophy, Copy, Check,
  Download, Eye, EyeOff, Package
} from 'lucide-react';
import { useFlowStore } from '../../store/useFlowStore';
import { executeStage } from '../../services/orchestratorEngine';
import { getLabById } from '../../config/labs';
import { getBrandById } from '../../config/brands';
import { FlowStage, FlowStageStatus } from '../../core/types';
import { cn, Spinner, GlowDot } from '../../ui/components';

// ── STATUS META ───────────────────────────────────────────────────────────────

const STATUS_META: Record<FlowStageStatus, { label: string; color: string }> = {
  pending:           { label: "Pendiente",             color: "#52525b" },
  running:           { label: "Ejecutando...",          color: "#FFAB00" },
  awaiting_approval: { label: "Esperando aprobación",  color: "#f59e0b" },
  approved:          { label: "Aprobado",              color: "#22c55e" },
  rejected:          { label: "Rechazado",             color: "#ef4444" },
  completed:         { label: "Completado",            color: "#22c55e" },
  skipped:           { label: "Omitido",               color: "#71717a" },
  error:             { label: "Error",                 color: "#ef4444" },
};

// ── COPY BUTTON ───────────────────────────────────────────────────────────────

function CopyBtn({ text, size = 12 }: { text: string; size?: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="p-1.5 rounded-md hover:bg-white/10 text-zinc-600 hover:text-zinc-400 transition-colors"
    >
      {copied ? <Check size={size} className="text-emerald-400" /> : <Copy size={size} />}
    </button>
  );
}

// ── STAGE CARD ────────────────────────────────────────────────────────────────

function StageCard({ stage, isActive, onApprove, onReject }: {
  stage: FlowStage & { lab?: ReturnType<typeof getLabById> };
  isActive: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const [expanded, setExpanded] = useState(isActive);
  const sm = STATUS_META[stage.status];
  const isDone    = ['completed', 'approved'].includes(stage.status);
  const isWaiting = stage.status === 'awaiting_approval';
  const isRunning = stage.status === 'running';
  const isPending = stage.status === 'pending';

  // Auto-expand when stage becomes active
  useEffect(() => {
    if (isActive) setExpanded(true);
  }, [isActive]);

  return (
    <div className={cn(
      "relative border rounded-2xl overflow-hidden transition-all duration-300",
      isActive  ? "border-accent/40 shadow-lg shadow-accent/5" :
      isDone    ? "border-emerald-500/20" :
      isPending ? "border-zinc-800 opacity-60" :
                  "border-zinc-800"
    )}>
      {/* Running shimmer */}
      {isRunning && (
        <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-transparent via-accent to-transparent"
            animate={{ x: ["-100%", "200%"] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
          />
        </div>
      )}

      {/* Header */}
      <button
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-zinc-800/30 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border"
          style={{
            backgroundColor: `${stage.lab?.color ?? '#888'}15`,
            borderColor: `${stage.lab?.color ?? '#888'}25`,
          }}
        >
          {isRunning ? (
            <Spinner size={14} className="text-accent" />
          ) : isDone ? (
            <CheckCircle2 size={15} className="text-emerald-400" />
          ) : isWaiting ? (
            <Shield size={15} className="text-amber-400" />
          ) : (
            <span className="text-sm" style={{ color: stage.lab?.color }}>{stage.lab?.icon}</span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider" style={{ color: stage.lab?.color }}>
              {stage.lab?.label}
            </span>
            {stage.requiresApproval && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400">
                CHECKPOINT
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-white">{stage.label}</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-mono" style={{ color: sm.color }}>{sm.label}</span>
          <ChevronDown size={14} className={cn("text-zinc-600 transition-transform", expanded && "rotate-180")} />
        </div>
      </button>

      {/* Body */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 border-t border-zinc-800/60 pt-4 space-y-4">

              {/* Output */}
              {stage.output && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-mono uppercase tracking-widest text-zinc-600">Output generado</p>
                    <CopyBtn text={stage.output} />
                  </div>
                  <pre className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed font-body bg-zinc-950 rounded-xl p-4 border border-zinc-800">
                    {stage.output}
                  </pre>
                </div>
              )}

              {/* Running placeholder */}
              {isRunning && !stage.output && (
                <div className="flex items-center gap-2 text-sm text-zinc-600">
                  <Spinner size={13} className="text-accent" />
                  Ejecutando {stage.lab?.label}...
                </div>
              )}

              {/* Pending placeholder */}
              {isPending && (
                <p className="text-xs text-zinc-700">Este paso se ejecutará cuando llegue su turno.</p>
              )}

              {/* Checkpoint approval */}
              {isWaiting && stage.output && (
                <div className="flex items-center gap-3 pt-1">
                  <p className="text-sm text-zinc-400 flex-1">¿Aprobar este output y continuar?</p>
                  <button
                    onClick={onReject}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-zinc-700 hover:border-red-500/40 hover:bg-red-500/10 text-zinc-500 hover:text-red-400 text-sm font-medium transition-all"
                  >
                    <ThumbsDown size={13} /> Rechazar
                  </button>
                  <button
                    onClick={onApprove}
                    className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-sm font-bold transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
                  >
                    <ThumbsUp size={13} /> Aprobar
                  </button>
                </div>
              )}

              {/* Timing */}
              {(stage.startedAt || stage.completedAt) && (
                <div className="flex gap-4 text-[10px] font-mono text-zinc-700">
                  {stage.startedAt && <span>Inicio: {new Date(stage.startedAt).toLocaleTimeString('es-ES')}</span>}
                  {stage.completedAt && <span>Fin: {new Date(stage.completedAt).toLocaleTimeString('es-ES')}</span>}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── OUTPUT PREVIEW PANEL ──────────────────────────────────────────────────────

function OutputPreviewPanel({ stages }: { stages: (FlowStage & { lab?: ReturnType<typeof getLabById> })[] }) {
  const [visible, setVisible] = useState(true);
  const completedWithOutput = stages.filter(s =>
    ['completed', 'approved'].includes(s.status) && s.output
  );

  const exportAll = () => {
    const md = completedWithOutput
      .map(s => `## ${s.lab?.icon ?? ''} ${s.lab?.label ?? s.labId} — ${s.label}\n\n${s.output}`)
      .join('\n\n---\n\n');
    const blob = new Blob([md], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `orchestrator_outputs_${Date.now()}.md`;
    a.click();
  };

  const copyAll = () => {
    const text = completedWithOutput
      .map(s => `[${s.lab?.label ?? s.labId}] ${s.label}\n\n${s.output}`)
      .join('\n\n---\n\n');
    navigator.clipboard.writeText(text);
  };

  if (completedWithOutput.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-6 bg-zinc-900 border border-zinc-700 rounded-2xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-zinc-800">
        <Package size={14} className="text-accent shrink-0" />
        <span className="text-xs font-bold uppercase tracking-widest text-zinc-400 flex-1">
          Output Preview — {completedWithOutput.length} entregable{completedWithOutput.length !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={copyAll}
            title="Copiar todos los outputs"
            className="flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors font-medium"
          >
            <Copy size={10} /> Copiar todo
          </button>
          <button
            onClick={exportAll}
            title="Exportar como Markdown"
            className="flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors font-medium"
          >
            <Download size={10} /> Exportar MD
          </button>
          <button
            onClick={() => setVisible(v => !v)}
            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            {visible ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
      </div>

      {/* Output cards */}
      <AnimatePresence initial={false}>
        {visible && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="p-4 space-y-3">
              {completedWithOutput.map((stage, i) => (
                <motion.div
                  key={stage.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                  className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden"
                >
                  {/* Output card header */}
                  <div
                    className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-800/60"
                    style={{ borderLeftColor: stage.lab?.color, borderLeftWidth: 3 }}
                  >
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider" style={{ color: stage.lab?.color }}>
                      {stage.lab?.icon} {stage.lab?.label}
                    </span>
                    <span className="text-[10px] text-zinc-600">·</span>
                    <span className="text-[11px] text-zinc-400 font-medium flex-1 truncate">{stage.label}</span>
                    <CopyBtn text={stage.output!} size={11} />
                  </div>

                  {/* Output content */}
                  <pre className="px-4 py-3 text-xs text-zinc-400 whitespace-pre-wrap leading-relaxed font-sans max-h-48 overflow-y-auto">
                    {stage.output}
                  </pre>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── MAIN EXECUTOR ─────────────────────────────────────────────────────────────

interface ExecutorProps {
  onComplete: () => void;
  onReset: () => void;
}

export default function FlowExecutorModule({ onComplete, onReset }: ExecutorProps) {
  const { activePlan, updateStageStatus, approveStage, rejectStage, archiveFlow } = useFlowStore();
  const executingRef = useRef(false);
  const [flowDone, setFlowDone] = useState(false);

  const stages = activePlan?.stages ?? [];
  const stagesWithLab = stages.map(s => ({ ...s, lab: getLabById(s.labId) }));

  // brand.name — was brand.displayName (bug fix)
  const brand = getBrandById(activePlan?.brandId ?? '');

  useEffect(() => {
    if (!activePlan || executingRef.current) return;
    executingRef.current = true;
    runFlow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runFlow = async () => {
    if (!activePlan) return;

    for (const stage of activePlan.stages) {
      updateStageStatus(stage.id, 'running');

      try {
        const output = await executeStage(stage);

        if (stage.requiresApproval) {
          updateStageStatus(stage.id, 'awaiting_approval', output);
          await waitForApproval(stage.id);

          const currentState = useFlowStore.getState();
          const currentStage = currentState.activePlan?.stages.find(s => s.id === stage.id);
          if (currentStage?.status === 'rejected') {
            executingRef.current = false;
            return;
          }
        } else {
          updateStageStatus(stage.id, 'completed', output);
        }
      } catch (e: any) {
        updateStageStatus(stage.id, 'error', undefined, e.message);
        executingRef.current = false;
        return;
      }
    }

    setFlowDone(true);
    executingRef.current = false;
  };

  const waitForApproval = (stageId: string): Promise<void> => {
    return new Promise(resolve => {
      const interval = setInterval(() => {
        const state = useFlowStore.getState();
        const stage = state.activePlan?.stages.find(s => s.id === stageId);
        if (stage?.status === 'approved' || stage?.status === 'rejected') {
          clearInterval(interval);
          if (stage.status === 'approved') {
            updateStageStatus(stageId, 'completed', stage.output);
          }
          resolve();
        }
      }, 300);
    });
  };

  const completedCount = stages.filter(s => ['completed', 'approved'].includes(s.status)).length;
  const progress = stages.length > 0 ? (completedCount / stages.length) * 100 : 0;

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 pb-28">

      {/* Progress header */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <GlowDot color={flowDone ? "#22c55e" : "#FFAB00"} pulse={!flowDone} />
          <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-500">
            {flowDone ? "Flujo completado" : "Ejecutando flujo"}
          </span>
        </div>

        <div className="flex items-center justify-between mb-2">
          <p className="text-sm text-zinc-400">
            <span className="text-white font-semibold">{completedCount}</span> / {stages.length} etapas
            {brand && <> · <span style={{ color: brand.color }}>{brand.name}</span></>}
            {/* ↑ was brand.displayName */}
          </p>
          <span className="text-sm font-mono text-zinc-600">{Math.round(progress)}%</span>
        </div>

        <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ background: flowDone ? "#22c55e" : "#FFAB00" }}
            animate={{ width: `${progress}%` }}
            transition={{ type: "spring", damping: 25 }}
          />
        </div>
      </motion.div>

      {/* Stage cards */}
      <div className="space-y-3">
        {stagesWithLab.map(stage => (
          <motion.div
            key={stage.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: stage.order * 0.05 }}
          >
            <StageCard
              stage={stage}
              isActive={stage.status === 'running' || stage.status === 'awaiting_approval'}
              onApprove={() => approveStage(stage.id)}
              onReject={() => rejectStage(stage.id)}
            />
          </motion.div>
        ))}
      </div>

      {/* ── OUTPUT PREVIEW PANEL ── */}
      <OutputPreviewPanel stages={stagesWithLab} />

      {/* Completion card */}
      <AnimatePresence>
        {flowDone && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="mt-6 bg-emerald-500/5 border border-emerald-500/30 rounded-2xl p-6 flex flex-col items-center gap-4"
          >
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
              <Trophy size={24} className="text-emerald-400" />
            </div>
            <div className="text-center">
              <p className="font-display font-bold text-xl text-white mb-1">Flujo completado</p>
              <p className="text-sm text-zinc-500">Todo el contenido fue generado y aprobado.</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { archiveFlow(activePlan!); onComplete(); }}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-xl text-sm transition-all active:scale-95"
              >
                <CheckCircle2 size={14} /> Finalizar
              </button>
              <button
                onClick={onReset}
                className="flex items-center gap-2 px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-sm transition-all"
              >
                <RotateCcw size={13} /> Nuevo flujo
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}