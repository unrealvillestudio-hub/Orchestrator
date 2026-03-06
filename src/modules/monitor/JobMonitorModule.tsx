import React from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, XCircle, Clock, ChevronRight, Inbox } from 'lucide-react';
import { useFlowStore } from '../../store/useFlowStore';
import { getBrandById } from '../../config/brands';
import { getLabById } from '../../config/labs';
import { cn } from '../../ui/components';

export default function JobMonitorModule() {
  const { completedFlows } = useFlowStore();

  if (completedFlows.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="mb-8">
          <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-600 mb-2">Historial</p>
          <h2 className="font-display text-2xl font-bold text-white">Job Monitor</h2>
        </div>
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-zinc-700">
          <Inbox size={40} strokeWidth={1} />
          <p className="text-sm">Sin flujos completados todavía.</p>
          <p className="text-xs text-zinc-800">Los flujos aparecerán aquí una vez finalizados.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="mb-8">
        <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-600 mb-2">Historial</p>
        <h2 className="font-display text-2xl font-bold text-white">Job Monitor</h2>
        <p className="text-sm text-zinc-500 mt-1">{completedFlows.length} flujo{completedFlows.length !== 1 ? "s" : ""} completado{completedFlows.length !== 1 ? "s" : ""}</p>
      </div>

      <div className="space-y-3">
        {completedFlows.map((flow, i) => {
          const brand = getBrandById(flow.brandId);
          const completedStages = flow.stages.filter(s => ['completed', 'approved'].includes(s.status)).length;
          const failedStages = flow.stages.filter(s => s.status === 'error').length;

          return (
            <motion.div
              key={flow.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 hover:border-zinc-700 transition-colors"
            >
              <div className="flex items-start gap-4">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border"
                  style={{ backgroundColor: `${brand?.color}15`, borderColor: `${brand?.color}25` }}
                >
                  <CheckCircle2 size={16} className="text-emerald-400" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: brand?.color }}
                        />
                        <span className="text-xs font-bold" style={{ color: brand?.color }}>
                          {brand?.name}
                        </span>
                      </div>
                      <p className="text-sm text-white leading-snug">{flow.interpretedIntent}</p>
                    </div>
                    <span className="text-[10px] font-mono text-zinc-700 shrink-0">
                      {flow.completedAt ? new Date(flow.completedAt).toLocaleDateString('es-ES') : '—'}
                    </span>
                  </div>

                  {/* Stage pills */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {flow.stages.map(s => {
                      const lab = getLabById(s.labId);
                      return (
                        <span
                          key={s.id}
                          className={cn(
                            "text-[9px] font-mono px-2 py-0.5 rounded border",
                            ['completed','approved'].includes(s.status)
                              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-500"
                              : "border-zinc-800 text-zinc-700"
                          )}
                        >
                          {lab?.icon} {lab?.label}
                        </span>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-4 text-[10px] font-mono text-zinc-700">
                    <span className="text-emerald-500">{completedStages} completadas</span>
                    {failedStages > 0 && <span className="text-red-500">{failedStages} errores</span>}
                    <span>{flow.platforms.join(" · ")}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
