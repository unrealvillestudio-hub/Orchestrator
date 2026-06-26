import React from 'react';
import { cn } from '../../ui/components';
import type { SeedStatus } from '../../services/iidInbound';

/** Metadatos visuales por estado de semilla (compartido captura ↔ approve). */
export const STATUS_META: Record<SeedStatus, { label: string; color: string; bg: string; border: string }> = {
  captured:          { label: 'Capturada',     color: 'text-zinc-400',    bg: 'bg-zinc-500/10',    border: 'border-zinc-500/30' },
  awaiting_approval: { label: 'En revisión',   color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30' },
  approved:          { label: 'Aprobada',      color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  dispatched:        { label: 'Despachada',    color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  failed:            { label: 'Fallida',       color: 'text-rose-400',    bg: 'bg-rose-500/10',    border: 'border-rose-500/30' },
  rejected:          { label: 'Rechazada',     color: 'text-zinc-500',    bg: 'bg-zinc-700/20',    border: 'border-zinc-700/40' },
};

export function StatusBadge({ status }: { status: SeedStatus }) {
  const m = STATUS_META[status] ?? STATUS_META.captured;
  return (
    <span className={cn(
      'text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 rounded border shrink-0',
      m.color, m.bg, m.border,
    )}>
      {m.label}
    </span>
  );
}

export function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

/** Banner honesto #45 — algunas marcas todavía no tienen brand_topics configurados. */
export function HonestBanner() {
  return (
    <div className="flex items-start gap-2.5 bg-amber-500/[0.07] border border-amber-500/20 rounded-xl px-3.5 py-3 text-amber-300/90">
      <span className="text-sm leading-none mt-0.5">⚠</span>
      <p className="text-[11px] leading-relaxed font-body">
        Algunas marcas todavía no tienen temas configurados. Tus capturas quedan guardadas
        igual y entran a la cola para revisión de Sam — no se pierde nada.
      </p>
    </div>
  );
}
