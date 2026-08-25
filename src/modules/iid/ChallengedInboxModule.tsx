import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  RefreshCw, Inbox, ShieldQuestion, Gavel, Undo2, Pencil, X, Check,
  AlertTriangle, Database,
} from 'lucide-react';
import { cn, Spinner } from '../../ui/components';
import type { IidSession } from '../../services/iidInbound';
import { CalibrationError } from '../../services/calibrationInbox';
import {
  fetchChallengedQueue, saveChallengeVerdict, savePieceEdit, EDIT_REASONS,
  type ChallengedResult, type ChallengedRow, type ChallengeVerdict, type GuardHit,
} from '../../services/challengedInbox';
import { CountPill, Pager, CopyableId, fmtDate } from './pieceUi';

const PAGE = 20;

/**
 * ChallengedInboxModule — bandeja de RETENIDAS (CALIB-01-E · cortes 2 y 3).
 *
 * ── LO QUE DECIDE SI ESTE MÓDULO SIRVE ───────────────────────────────────────
 * Los DOS BOTONES son la acción primaria. Editar es la salida secundaria.
 *
 * El challenger no le pide a Sam que edite: le pregunta si el juez acertó. Si la interfaz
 * presentara la edición como camino por defecto, el arbitraje dejaría de tomar segundos y
 * el mecanismo no escalaría al volumen que llega con las marcas nuevas. Por eso:
 *   · los botones ocupan la fila de acción, con peso visual y color propio;
 *   · «Editar» es un enlace terciario, en gris, al costado;
 *   · UN TOQUE = UNA DECISIÓN: sin diálogo de confirmación, sin segundo paso.
 *
 * El `undo` es lo que hace seguro no confirmar. La fila se marca decidida en el acto y
 * queda en pantalla con «Deshacer» mientras dura la sesión de trabajo; sólo desaparece al
 * refrescar. Es barato porque el endpoint es IDEMPOTENTE por id: reenviarlo no duplica ni
 * pisa nada.
 *
 * ── LA BANDEJA LISTA ARBITRAJES, NO PIEZAS ───────────────────────────────────
 * El grano es (pieza, regla): una pieza con desacuerdo en dos reglas presenta dos
 * decisiones. Agruparlas obligaría a decidir en bloque sobre reglas distintas.
 *
 * ── MULTIMARCA ───────────────────────────────────────────────────────────────
 * Ninguna marca, plataforma ni código de regla aparece en este archivo. Las pastillas se
 * DESCUBREN de `by_brand` / `by_rule`; el enunciado de la regla y la razón de la retención
 * los redacta el server.
 */
export default function ChallengedInboxModule({ session }: { session: IidSession }) {
  const token = session.session_token;

  const [data, setData]       = useState<ChallengedResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [brand, setBrand]     = useState('');
  const [rule, setRule]       = useState('');
  const [offset, setOffset]   = useState(0);

  /** Decisiones tomadas en esta sesión de pantalla: la fila se queda, marcada, con undo. */
  const [decided, setDecided] = useState<Record<string, ChallengeVerdict>>({});
  const [busy, setBusy]       = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});

  type Query = { offset: number; brand: string; rule: string };
  const current = (): Query => ({ offset, brand, rule });

  const load = async (q: Query) => {
    setLoading(true); setError(null);
    try {
      setData(await fetchChallengedQueue(token, {
        limit: PAGE, offset: q.offset, brand: q.brand || undefined, rule: q.rule || undefined,
      }));
    } catch (err) {
      setError(err instanceof CalibrationError ? err.message : 'No se pudo cargar la bandeja.');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(current()); /* eslint-disable-next-line */ }, []);

  // Todo cambio de filtro vuelve a la primera página: el offset viejo no significa lo mismo
  // sobre un conjunto distinto. Y se limpian las decisiones locales — pertenecen a la lista
  // que se está mirando, no a la siguiente.
  const apply = (patch: Partial<Query>) => {
    const q = { ...current(), offset: 0, ...patch };
    setOffset(q.offset); setBrand(q.brand); setRule(q.rule);
    setDecided({}); setRowError({});
    load(q);
  };
  const goPage = (o: number) => { setOffset(o); setDecided({}); setRowError({}); load({ ...current(), offset: o }); };

  const byBrand = data?.by_brand ?? {};
  const byRule  = data?.by_rule ?? {};
  const rows    = data?.rows ?? [];
  // Marcas y reglas se DESCUBREN del dato; ninguna lista vive en este archivo.
  const brands  = useMemo(() => Object.keys(byBrand).sort(), [byBrand]);
  const rules   = useMemo(() => Object.keys(byRule).sort(), [byRule]);
  const total   = data?.total ?? 0;
  const available = data?.contract.available !== false;

  /** UN TOQUE. Optimista y sin confirmación; el undo cubre el error de dedo. */
  const decide = async (row: ChallengedRow, verdict: ChallengeVerdict) => {
    setBusy((b) => ({ ...b, [row.id]: true }));
    setRowError((e) => ({ ...e, [row.id]: '' }));
    const prev = decided[row.id];
    setDecided((d) => ({ ...d, [row.id]: verdict }));
    try {
      await saveChallengeVerdict(token, { id: row.id, verdict });
    } catch (err) {
      // Se REVIERTE la marca visual: dejar la fila como decidida cuando el server la
      // rechazó sería mentirle a quien arbitra sobre el estado real.
      setDecided((d) => { const n = { ...d }; if (prev) n[row.id] = prev; else delete n[row.id]; return n; });
      setRowError((e) => ({ ...e, [row.id]: err instanceof CalibrationError ? err.message : 'No se pudo guardar el arbitraje.' }));
    } finally {
      setBusy((b) => ({ ...b, [row.id]: false }));
    }
  };

  /**
   * DESHACER. Sólo limpia la marca LOCAL y lo dice sin adornos: el arbitraje ya quedó
   * escrito, y el endpoint es idempotente —no se pisa— justamente para que la serie de
   * decisiones no se pueda reescribir. Prometer un borrado que no ocurre sería peor que no
   * ofrecer undo.
   */
  const undo = (row: ChallengedRow) => {
    setDecided((d) => { const n = { ...d }; delete n[row.id]; return n; });
    setRowError((e) => ({ ...e, [row.id]: 'El arbitraje ya quedó registrado: deshacer sólo lo saca de la vista. Para cambiarlo, decidí de nuevo desde el chat con Claude.' }));
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-2">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h3 className="font-display text-lg font-bold text-white">Retenidas</h3>
          <p className="text-sm text-zinc-500 mt-0.5">
            Piezas que el juez marcó y cuya verificación determinista lo contradice.
            <span className="text-zinc-400"> No se destruyeron</span> — esperan tu arbitraje.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[11px] font-mono px-2 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400">
            {total} retenida{total === 1 ? '' : 's'}
          </span>
          <button
            onClick={() => load(current())}
            className="p-2 hover:bg-zinc-800 rounded-xl transition-colors text-zinc-600 hover:text-zinc-400"
            title="Refrescar"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* El contrato todavía no existe. NO es un fallo de esta pantalla, y decirlo evita
          que alguien depure durante una hora un vacío que es correcto. */}
      {data && !available && (
        <div className="flex items-start gap-2.5 text-[12px] text-sky-300/90 bg-sky-500/[0.06] border border-sky-500/25 rounded-xl px-3.5 py-3 mb-5 leading-relaxed">
          <Database size={15} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-sky-200">La bandeja está esperando su tabla.</p>
            <p className="mt-1 text-sky-300/75">{data.contract.reason}</p>
          </div>
        </div>
      )}

      {/* Filtros — se descubren del dato */}
      {(brands.length > 1 || rules.length > 1) && (
        <div className="space-y-2 mb-5">
          {brands.length > 1 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <CountPill label="Todas" count={total} active={!brand} onClick={() => apply({ brand: '' })} />
              {brands.map((b) => (
                <CountPill key={b} label={b} count={byBrand[b]} active={brand === b} onClick={() => apply({ brand: b })} />
              ))}
            </div>
          )}
          {rules.length > 1 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <CountPill label="Toda regla" count={total} active={!rule} onClick={() => apply({ rule: '' })} />
              {rules.map((r) => (
                <CountPill key={r} label={r} count={byRule[r]} active={rule === r} onClick={() => apply({ rule: r })} />
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-[12px] text-red-300 bg-red-500/[0.07] border border-red-500/25 rounded-xl px-3.5 py-3 mb-5">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {loading && !data && (
        <div className="flex justify-center py-16"><Spinner /></div>
      )}

      {/* Vacío EXPLÍCITO. Nunca un spinner infinito: una bandeja sin retenidas es una buena
          noticia y tiene que leerse como tal. */}
      {!loading && available && rows.length === 0 && !error && (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Inbox size={28} className="text-zinc-700" />
          <p className="text-sm text-zinc-500">Sin retenidas.</p>
          <p className="text-[12px] text-zinc-600 max-w-sm">
            Ninguna pieza quedó en disputa entre el juez y la verificación determinista.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {rows.map((row) => (
          <ChallengeCard
            key={row.id}
            row={row}
            token={token}
            decided={decided[row.id] ?? null}
            busy={!!busy[row.id]}
            error={rowError[row.id] || null}
            onDecide={(v) => decide(row, v)}
            onUndo={() => undo(row)}
          />
        ))}
      </div>

      {rows.length > 0 && (
        <Pager offset={offset} pageSize={PAGE} total={total} loading={loading} onGo={goPage} noun="retenida" />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * La tarjeta: la regla en disputa arriba, los dos botones abajo, editar al costado.
 * ══════════════════════════════════════════════════════════════════════════ */

const VERDICT_LABEL: Record<ChallengeVerdict, string> = {
  judge_was_right: 'El juez tenía razón',
  rule_failed: 'La regla falló',
};

function ChallengeCard({ row, token, decided, busy, error, onDecide, onUndo }: {
  row: ChallengedRow; token: string; decided: ChallengeVerdict | null; busy: boolean;
  error: string | null; onDecide: (v: ChallengeVerdict) => void; onUndo: () => void;
}) {
  const [editing, setEditing] = useState<null | 'title' | 'body'>(null);
  const [local, setLocal] = useState<{ title: string | null; body: string | null }>({
    title: row.piece?.title ?? null, body: row.piece?.body ?? null,
  });

  const piece = row.piece;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'rounded-2xl border p-4 transition-colors',
        decided ? 'border-zinc-800/60 bg-zinc-900/30' : 'border-zinc-800 bg-zinc-900/60',
      )}
    >
      {/* La regla en disputa — es la pregunta que hay que contestar, así que va primero. */}
      <div className="flex items-start gap-2.5 mb-3">
        <ShieldQuestion size={16} className="shrink-0 mt-0.5 text-amber-400" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300">
              {row.rule_code}
            </span>
            <span className="text-[11px] font-mono text-zinc-600">{row.brand_id}</span>
            {piece?.platform && <span className="text-[11px] font-mono text-zinc-600">{piece.platform}</span>}
            <span className="text-[11px] font-mono text-zinc-700">{fmtDate(row.created_at)}</span>
          </div>
          {row.rule_statement && (
            <p className="text-[13px] text-zinc-300 mt-1.5 leading-relaxed">{row.rule_statement}</p>
          )}
          {/* La razón, redactada por el server: una sola fuente para la explicación. */}
          <p className="text-[12px] text-amber-300/80 mt-1.5 leading-relaxed">{row.reason}</p>
          {row.verify_pattern && (
            <p className="text-[11px] font-mono text-zinc-600 mt-1 break-all">patrón: {row.verify_pattern}</p>
          )}
        </div>
      </div>

      {/* La pieza */}
      {piece ? (
        <div className="rounded-xl border border-zinc-800/70 bg-black/30 p-3.5 mb-3">
          <FieldBlock
            label="Título"
            value={local.title}
            editing={editing === 'title'}
            onEdit={() => setEditing('title')}
            onClose={() => setEditing(null)}
            onSaved={(v) => { setLocal((l) => ({ ...l, title: v })); setEditing(null); }}
            pieceId={piece.id}
            field="title"
            token={token}
          />
          <div className="h-3" />
          <FieldBlock
            label="Cuerpo"
            value={local.body}
            multiline
            editing={editing === 'body'}
            onEdit={() => setEditing('body')}
            onClose={() => setEditing(null)}
            onSaved={(v) => { setLocal((l) => ({ ...l, body: v })); setEditing(null); }}
            pieceId={piece.id}
            field="body"
            token={token}
          />
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-zinc-800/60 text-[10px] font-mono text-zinc-600">
            <CopyableId id={piece.id} title="id de la pieza" />
            {piece.pass_type && <span>pass_type: {piece.pass_type}</span>}
            {piece.edited_at && <span className="text-zinc-500">editada {fmtDate(piece.edited_at)}{piece.edited_by ? ` · ${piece.edited_by}` : ''}</span>}
          </div>
        </div>
      ) : (
        <p className="text-[12px] text-zinc-600 italic mb-3">
          El arbitraje no apunta a ninguna pieza: se puede decidir igual, sobre la regla.
        </p>
      )}

      {/* ── LA ACCIÓN PRIMARIA ── */}
      {decided ? (
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-[12px] text-emerald-300">
            <Check size={14} /> {VERDICT_LABEL[decided]}
          </span>
          <button
            onClick={onUndo}
            className="flex items-center gap-1.5 text-[12px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <Undo2 size={13} /> Deshacer
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <VerdictButton
            onClick={() => onDecide('judge_was_right')}
            disabled={busy}
            icon={<Gavel size={14} />}
            label={VERDICT_LABEL.judge_was_right}
            hint="el patrón es incompleto · la pieza se descarta"
            tone="amber"
          />
          <VerdictButton
            onClick={() => onDecide('rule_failed')}
            disabled={busy}
            icon={<ShieldQuestion size={14} />}
            label={VERDICT_LABEL.rule_failed}
            hint="falso positivo · la pieza sigue a aprobación"
            tone="emerald"
          />
          {/* Terciario a propósito: editar es la SALIDA, no el camino. */}
          {piece && editing === null && (
            <button
              onClick={() => setEditing('title')}
              className="ml-auto flex items-center gap-1.5 text-[12px] text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              <Pencil size={12} /> Editar
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="text-[11px] text-amber-300/80 mt-2.5 leading-relaxed">{error}</p>
      )}
    </motion.div>
  );
}

function VerdictButton({ onClick, disabled, icon, label, hint, tone }: {
  onClick: () => void; disabled: boolean; icon: React.ReactNode;
  label: string; hint: string; tone: 'amber' | 'emerald';
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={cn(
        'flex flex-col items-start gap-0.5 px-3.5 py-2 rounded-xl border font-semibold text-[13px] transition-all disabled:opacity-50 disabled:cursor-not-allowed',
        tone === 'amber'
          ? 'border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
          : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20',
      )}
    >
      <span className="flex items-center gap-2">{icon}{label}</span>
      <span className="text-[10px] font-normal font-mono opacity-70">{hint}</span>
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * Edición in-line de un campo. Guarda, muestra los avisos de la guarda, y NO bloquea.
 * ══════════════════════════════════════════════════════════════════════════ */

function FieldBlock({ label, value, multiline, editing, onEdit, onClose, onSaved, pieceId, field, token }: {
  label: string; value: string | null; multiline?: boolean; editing: boolean;
  onEdit: () => void; onClose: () => void; onSaved: (v: string) => void;
  pieceId: string; field: 'title' | 'body'; token: string;
}) {
  const [draft, setDraft]   = useState(value ?? '');
  const [reason, setReason] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [hits, setHits]     = useState<GuardHit[] | null>(null);
  const [err, setErr]       = useState<string | null>(null);
  // El texto que produjo los avisos: si Sam sigue escribiendo, el aviso deja de aplicar y
  // se limpia. Un aviso que sobrevive al texto que lo causó desinforma.
  const warnedFor = useRef<string | null>(null);

  useEffect(() => { if (editing) { setDraft(value ?? ''); setHits(null); setErr(null); warnedFor.current = null; } }, [editing, value]);

  const save = async (acknowledge: boolean) => {
    setSaving(true); setErr(null);
    try {
      const r = await savePieceEdit(token, {
        piece_id: pieceId, field, after_text: draft,
        edit_reason: reason || null, acknowledge_warnings: acknowledge,
      });
      // La guarda AVISA y no bloquea: la edición YA se guardó cuando llega el aviso. Se
      // muestra para que Sam decida si vuelve sobre el texto, no para pedirle permiso.
      if (r.guard?.hits?.length && !acknowledge) {
        setHits(r.guard.hits);
        warnedFor.current = draft;
        setSaving(false);
        return;
      }
      onSaved(draft);
    } catch (e) {
      setErr(e instanceof CalibrationError ? e.message : 'No se pudo guardar la edición.');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="group">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-600">{label}</span>
          <button onClick={onEdit} className="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-600 hover:text-zinc-300" title={`Editar ${label.toLowerCase()}`}>
            <Pencil size={11} />
          </button>
        </div>
        <p className={cn('text-[13px] whitespace-pre-wrap leading-relaxed', value ? 'text-zinc-200' : 'text-zinc-600 italic')}>
          {value || '—'}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">{label}</span>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300" title="Cancelar"><X size={13} /></button>
      </div>
      {multiline ? (
        <textarea
          value={draft}
          onChange={(e) => { setDraft(e.target.value); if (warnedFor.current !== null && e.target.value !== warnedFor.current) setHits(null); }}
          rows={8}
          className="w-full bg-black/40 border border-zinc-700 rounded-lg px-3 py-2 text-[13px] text-zinc-200 outline-none focus:border-accent/50 transition-colors leading-relaxed"
        />
      ) : (
        <input
          value={draft}
          onChange={(e) => { setDraft(e.target.value); if (warnedFor.current !== null && e.target.value !== warnedFor.current) setHits(null); }}
          className="w-full bg-black/40 border border-zinc-700 rounded-lg px-3 py-2 text-[13px] text-zinc-200 outline-none focus:border-accent/50 transition-colors"
        />
      )}

      {/* Motivo de un toque. OPCIONAL: obligarlo empuja a elegir cualquier clase para
          avanzar, y eso envenena la serie igual que un criterio de relleno. */}
      <div className="flex items-center gap-1.5 flex-wrap mt-2">
        {EDIT_REASONS.map((r) => (
          <button
            key={r.value}
            onClick={() => setReason(reason === r.value ? '' : r.value)}
            className={cn(
              'text-[11px] px-2 py-1 rounded-lg border transition-colors',
              reason === r.value
                ? 'border-accent/50 bg-accent/15 text-accent'
                : 'border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700',
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* La guarda: aviso, nunca bloqueo. Ya está guardado cuando esto aparece. */}
      {hits && hits.length > 0 && (
        <div className="flex items-start gap-2.5 text-[12px] text-amber-300/90 bg-amber-500/[0.07] border border-amber-500/30 rounded-xl px-3 py-2.5 mt-2.5 leading-relaxed">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-semibold text-amber-200">Guardado, con aviso.</p>
            <ul className="mt-1 space-y-0.5">
              {hits.map((h, i) => (
                <li key={i} className="font-mono text-[11px] break-all">
                  {h.code} en {h.field}: “{h.fragment}”
                </li>
              ))}
            </ul>
            <button
              onClick={() => save(true)}
              className="mt-2 text-[11px] underline text-amber-200/80 hover:text-amber-100"
            >
              Dejarlo así de todos modos
            </button>
          </div>
        </div>
      )}

      {err && <p className="text-[11px] text-red-300 mt-2">{err}</p>}

      <div className="flex items-center gap-2 mt-2.5">
        <button
          onClick={() => save(false)}
          disabled={saving}
          className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-accent text-black hover:bg-accent/90 transition-colors disabled:opacity-50"
        >
          <Check size={13} /> Guardar
        </button>
        <button onClick={onClose} className="text-[12px] text-zinc-500 hover:text-zinc-300 transition-colors">
          Cancelar
        </button>
        <span className="text-[10px] font-mono text-zinc-700 ml-auto">no se re-juzga</span>
      </div>
    </div>
  );
}
