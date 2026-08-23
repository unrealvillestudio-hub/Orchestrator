import React, { useState } from 'react';
import {
  ChevronLeft, ChevronRight, ShieldCheck, ShieldAlert, Copy, Check, Clock, GitBranch, History,
} from 'lucide-react';
import { cn } from '../../ui/components';
import type { FlowGeneration } from '../../services/calibrationInbox';

/* ════════════════════════════════════════════════════════════════════════════
 * pieceUi — piezas de interfaz compartidas por las bandejas de PIEZAS
 * (calibración y publicación).
 *
 * Salieron de `ApprovalCalibrationModule` cuando apareció la segunda bandeja: dos copias
 * del bloque de procedencia habrían divergido en el primer cambio, y la procedencia es
 * justamente el dato que las dos vistas tienen que contar igual.
 *
 * Acá vive lo PRESENTACIONAL y transversal. Lo específico de cada bandeja (qué acciones
 * hay, qué se lista) se queda en su módulo.
 * ════════════════════════════════════════════════════════════════════════════ */

// ── Fechas: hora local del operador, con la hora visible (no sólo el día) ────────
const DT = new Intl.DateTimeFormat(undefined, {
  year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : DT.format(d);
}

/** Id corto: lo que Sam le pasa a Claude en el chat para referirse a una pieza. */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : '—';
}

// ── Pill de marca / canal ────────────────────────────────────────────────────────
export function CountPill({ label, count, active, onClick }: {
  label: string; count: number; active: boolean; onClick: () => void;
}) {
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

// ── Selector de orden / filtro ───────────────────────────────────────────────────
export function Selector({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]>;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-zinc-600">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-zinc-300 outline-none focus:border-accent/50 transition-colors"
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

// ── Paginación: los botones se ven SIEMPRE, deshabilitados incluido ──────────────
// Un botón invisible cuando no aplica deja al operador sin saber dónde está parado.
function PageButton({ onClick, disabled, label, icon, iconRight }: {
  onClick: () => void; disabled: boolean; label: string; icon: React.ReactNode; iconRight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-1 px-3 py-1.5 rounded-lg border transition-colors',
        disabled
          ? 'border-zinc-800/70 bg-zinc-900/40 text-zinc-600 cursor-not-allowed'
          : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-white'
      )}
    >
      {!iconRight && icon}{label}{iconRight && icon}
    </button>
  );
}

export function Pager({ offset, pageSize, total, loading, onGo, noun = 'pieza' }: {
  offset: number; pageSize: number; total: number; loading: boolean;
  onGo: (offset: number) => void; noun?: string;
}) {
  const pages  = Math.max(1, Math.ceil(total / pageSize));
  const pageNo = Math.min(pages, Math.floor(offset / pageSize) + 1);
  return (
    <div className="flex items-center justify-between gap-3 mt-6 text-[11px] font-mono">
      <PageButton
        onClick={() => onGo(Math.max(0, offset - pageSize))}
        disabled={offset <= 0 || loading}
        label="Anterior"
        icon={<ChevronLeft size={13} />}
      />
      <span className="text-zinc-400">
        Página <span className="text-zinc-200">{pageNo}</span> de <span className="text-zinc-200">{pages}</span>
        <span className="text-zinc-600"> · {total} {noun}{total === 1 ? '' : 's'}</span>
      </span>
      <PageButton
        onClick={() => onGo(offset + pageSize)}
        disabled={offset + pageSize >= total || loading}
        label="Siguiente"
        icon={<ChevronRight size={13} />}
        iconRight
      />
    </div>
  );
}

// ── Id copiable ──────────────────────────────────────────────────────────────────
export function CopyableId({ id, title }: { id: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Sin permiso de portapapeles: el id sigue visible y seleccionable a mano.
      setCopied(false);
    }
  };
  return (
    <button
      onClick={copy}
      title={`${title}: ${id} — clic para copiar`}
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono transition-colors',
        copied ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
      )}
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {shortId(id)}
    </button>
  );
}

// ── Generación del flujo ─────────────────────────────────────────────────────────
export function GenerationBadge({ generation, label, at }: {
  generation: FlowGeneration; label: string | null; at: string | null;
}) {
  if (generation === 'previous') {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/40 text-amber-300"
        title={label ? `Anterior al corte «${label}» (${fmtDate(at)}). La juzgó un flujo que ya se arregló.` : 'Anterior al último corte del flujo.'}
      >
        <History size={10} /> Flujo anterior
      </span>
    );
  }
  if (generation === 'current') {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-500/25 text-sky-300/85"
        title={label ? `Posterior al corte «${label}» (${fmtDate(at)}).` : 'Posterior al último corte del flujo.'}
      >
        <GitBranch size={10} /> Flujo corregido
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-800/70 border border-zinc-700/60 text-zinc-500"
          title="No hay ningún corte de flujo aplicable a esta pieza: no se puede afirmar de qué generación es.">
      <GitBranch size={10} /> Flujo: sin corte
    </span>
  );
}

// ── Aviso sobre el origen de los cortes ──────────────────────────────────────────
export function CutoffsNotice({ source }: { source: 'unavailable' | 'empty' | 'seeded' }) {
  if (source === 'seeded') return null;
  return (
    <div className="flex items-start gap-2 text-[11px] text-amber-400/80 bg-amber-500/[0.05] border border-amber-500/20 rounded-xl px-3 py-2 mb-4 font-mono leading-snug">
      <History size={13} className="shrink-0 mt-0.5" />
      <span>
        {source === 'unavailable'
          ? 'intel.pipeline_cutoffs no está disponible todavía — la generación del flujo se muestra como «sin corte».'
          : 'intel.pipeline_cutoffs está vacía — sembrá los cortes para que la generación del flujo se calcule.'}
      </span>
    </div>
  );
}

// ── Etiqueta de la primera opinión del watcher ───────────────────────────────────
// Informativa: NO condiciona ninguna acción. Sam puede aprobar lo que el watcher rechazó
// (el dato valioso: "watcher se equivocó") o rechazar lo que el watcher aprobó.
export function WatcherBadge({ result, gate, failedRules, rulesEvaluated }: {
  result: 'PASS' | 'REJECT' | null;
  gate: string | null;
  failedRules?: string[] | null;
  rulesEvaluated?: number | null;
}) {
  if (result === 'REJECT') {
    // Detalle primario: los CÓDIGOS de regla incumplidos (content-run-stage v56+). Si
    // vienen vacíos/ausentes (piezas anteriores al deploy), caemos al nombre del gate —
    // nunca a `undefined` ni a pantalla en blanco.
    const codes = (Array.isArray(failedRules) ? failedRules : []).filter(Boolean);
    const detail = codes.length ? codes.join(', ') : (gate ?? null);
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-300"
            title="El watcher rechazó esta pieza. Si creés que se equivocó, aprobala igual — ese es el dato valioso.">
        <ShieldAlert size={10} /> Watcher: RECHAZÓ{detail ? ` · ${detail}` : ''}
        {typeof rulesEvaluated === 'number' && (
          <span className="text-rose-300/45"
                title="Contra cuántas reglas enumeradas se juzgó esta pieza.">
            · {rulesEvaluated} regla{rulesEvaluated === 1 ? '' : 's'}
          </span>
        )}
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

// ── Procedencia: de dónde salió esta pieza y contra qué se la juzgó ──────────────
/** Lo mínimo que una pieza necesita exponer para que su procedencia se pueda dibujar. */
export interface PieceProvenance {
  piece_id: string;
  job_id: string | null;
  finding_id: string | null;
  status: string | null;
  created_at: string | null;
  watcher_verdict_at: string | null;
  attempts: number | null;
  gate_rules_evaluated: number | null;
  gate_evaluated_codes: string[];
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={hint}>
      <span className="text-zinc-700">{label}</span>
      {children}
    </span>
  );
}

export function Provenance({ piece }: { piece: PieceProvenance }) {
  const codes = piece.gate_evaluated_codes ?? [];
  return (
    <div className="rounded-xl border border-zinc-800/80 bg-[#08080c] px-3 py-2.5 text-[10px] font-mono text-zinc-500 space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <Field label="pieza"><CopyableId id={piece.piece_id} title="piece_id" /></Field>
        {piece.job_id && <Field label="job"><CopyableId id={piece.job_id} title="orchestrator_job_id" /></Field>}
        {piece.finding_id && (
          <Field label="hallazgo" hint="intel.iid_findings.id — el hallazgo del que salió esta pieza.">
            <CopyableId id={piece.finding_id} title="finding_id" />
          </Field>
        )}
        {typeof piece.attempts === 'number' && (
          <Field label="intentos" hint="Jobs corridos sobre la misma fila de cola. Los reintentos no son piezas.">
            <span className={cn('text-zinc-300', piece.attempts > 1 && 'text-amber-300/90')}>{piece.attempts}</span>
          </Field>
        )}
        {piece.status && <Field label="estado"><span className="text-zinc-400">{piece.status}</span></Field>}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <Field label="creada" hint="content_pieces.created_at, en tu hora local.">
          <span className="inline-flex items-center gap-1 text-zinc-400"><Clock size={9} /> {fmtDate(piece.created_at)}</span>
        </Field>
        <Field label="veredicto" hint="watcher_log.created_at, en tu hora local.">
          <span className="inline-flex items-center gap-1 text-zinc-400"><Clock size={9} /> {fmtDate(piece.watcher_verdict_at)}</span>
        </Field>
        {typeof piece.gate_rules_evaluated === 'number' && (
          <Field label="reglas evaluadas"><span className="text-zinc-300">{piece.gate_rules_evaluated}</span></Field>
        )}
      </div>

      {codes.length > 0 && (
        <div className="flex flex-wrap items-start gap-1.5 pt-0.5">
          <span className="text-zinc-700 pt-0.5">códigos</span>
          {codes.map((c) => (
            <span key={c} className="px-1 py-0.5 rounded bg-zinc-800/80 text-zinc-400">{c}</span>
          ))}
        </div>
      )}
    </div>
  );
}
