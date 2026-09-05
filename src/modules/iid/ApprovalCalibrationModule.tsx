import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw, Inbox, CheckCircle2, XCircle, AlertTriangle, Archive, Wrench } from 'lucide-react';
import { cn, Spinner } from '../../ui/components';
import type { IidSession } from '../../services/iidInbound';
import {
  fetchQueue, saveVerdict, discardPiece, renderArtifact, CalibrationError,
  REJECT_REASONS, buildCriterion,
  type CalibrationPiece, type QueueResult, type QueueOrder, type VerdictFilter,
  type GenerationFilter, type Verdict,
} from '../../services/calibrationInbox';
// Presentación compartida con la bandeja de publicación: la procedencia se cuenta igual
// en las dos vistas o no sirve para compararlas.
import {
  CountPill, Selector, Pager, CutoffsNotice, GenerationBadge, WatcherBadge, Provenance, PieceHeader, shortId,
  ForecastLine, SlotsNotice,
} from './pieceUi';
// Lectura en voz alta. El lector no sabe de artefactos: el adaptador le pasa el texto plano.
import { SpeechReader } from '../../ui/SpeechReader';
import { readableFromArtifactHtml } from './readablePiece';

const PAGE = 20;

/**
 * ApprovalCalibrationModule — bandeja de calibración (B4 · Fase 1 · CALIB-UI-01).
 *
 * Una tarjeta por PIEZA (no por intento): la consulta lista `content_pieces` sin
 * descartar, sin fila en el corpus, quedándose con la última versión de cada `queue_id`.
 *
 * El reparto de trabajo que gobierna el diseño: acá se VE y se DECIDE (un clic); el
 * criterio se dicta en el chat con Claude, que lo escribe en `approval_calibration`. Por
 * eso ningún campo de texto es obligatorio — obligar a escribir empuja a poner cualquier
 * cosa para avanzar, y eso envenena el corpus con ruido que parece señal.
 *
 * Cuatro salidas, tres de ellas veredicto:
 *   Aprobar   → corpus `approved`   · habilita la pieza
 *   Rechazar  → corpus `rejected`   · sella y saca de la bandeja (criterio OPCIONAL)
 *   Fixable   → corpus `fixable`    · MISMO sellado que rechazar, con la PROPUESTA de qué
 *               hacer con la pieza. Obligatoria: sin ella sería un rechazo con otro nombre.
 *   Descartar → NO entra al corpus; sella discarded_at y sale de la bandeja
 *
 * Fixable sella igual que Rechazar y no es un olvido: la bandeja lista `awaiting_approval`
 * con `discarded_at IS NULL`, así que un veredicto que no sella deja la pieza viva y
 * reaparece mañana. La diferencia entre los dos vive ENTERA en el corpus.
 *
 * NO publica nada.
 */
export default function ApprovalCalibrationModule({ session }: { session: IidSession }) {
  const token = session.session_token;

  const [data, setData]       = useState<QueueResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [brand, setBrand]     = useState<string>(''); // '' = todas
  const [order, setOrder]     = useState<QueueOrder>('recent');
  const [verdict, setVerdict] = useState<VerdictFilter>('all');
  const [gen, setGen]         = useState<GenerationFilter>('all');
  const [offset, setOffset]   = useState(0);

  type Query = { offset: number; brand: string; order: QueueOrder; verdict: VerdictFilter; gen: GenerationFilter };
  const current = (): Query => ({ offset, brand, order, verdict, gen });

  const load = async (q: Query) => {
    setLoading(true); setError(null);
    try {
      const r = await fetchQueue(token, {
        limit: PAGE,
        offset: q.offset,
        brand: q.brand || undefined,
        order: q.order,
        verdict: q.verdict,
        generation: q.gen,
      });
      setData(r);
    } catch (err) {
      setError(err instanceof CalibrationError ? err.message : 'No se pudo cargar la cola.');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(current()); /* eslint-disable-next-line */ }, []);

  // Todo cambio de filtro/orden vuelve a la primera página: el offset viejo no significa
  // lo mismo sobre un conjunto distinto.
  const apply = (patch: Partial<Query>) => {
    const q = { ...current(), offset: 0, ...patch };
    setOffset(q.offset); setBrand(q.brand); setOrder(q.order); setVerdict(q.verdict); setGen(q.gen);
    load(q);
  };
  const goPage = (o: number) => { setOffset(o); load({ ...current(), offset: o }); };

  // Cuando una pieza se resuelve (veredicto o descarte), la sacamos de la lista.
  const onResolved = (pieceId: string) => {
    setData((prev) => {
      if (!prev) return prev;
      const pieces = prev.pieces.filter((p) => p.piece_id !== pieceId);
      return { ...prev, pieces, total_pending: Math.max(0, prev.total_pending - 1) };
    });
  };

  const total    = data?.total_pending ?? 0;
  const byBrand  = data?.by_brand ?? {};
  const pieces   = data?.pieces ?? [];
  const brands   = useMemo(() => Object.keys(byBrand).sort(), [byBrand]);

  return (
    <div className="max-w-3xl mx-auto px-6 py-2">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h3 className="font-display text-lg font-bold text-white">Bandeja de calibración</h3>
          <p className="text-sm text-zinc-500 mt-0.5">
            Una tarjeta por pieza. Aprobar, rechazar, marcar como fixable o descartar — un clic.
            El criterio se dicta en el chat, no acá; <span className="text-zinc-400">nada se publica</span>.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[11px] font-mono px-2 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400">
            {total} pieza{total === 1 ? '' : 's'}
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

      {/* Filtro por marca — las marcas se descubren del dato, nunca se enumeran acá. */}
      {brands.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap bg-zinc-900/80 border border-zinc-800 rounded-xl p-1 mb-3">
          <CountPill label="Todas" count={Object.values(byBrand).reduce((a, b) => a + b, 0)} active={brand === ''} onClick={() => apply({ brand: '' })} />
          {brands.map((b) => (
            <CountPill key={b} label={b} count={byBrand[b]} active={brand === b} onClick={() => apply({ brand: b })} />
          ))}
        </div>
      )}

      {/* Orden + filtros transversales */}
      <div className="flex items-center gap-4 flex-wrap mb-5 text-[11px] font-mono text-zinc-600">
        <Selector
          label="Orden"
          value={order}
          onChange={(v) => apply({ order: v as QueueOrder })}
          options={[
            ['recent', 'Más reciente'],
            ['oldest', 'Más antigua'],
            ['brand', 'Por marca'],
            ['verdict', 'Por veredicto'],
          ]}
        />
        <Selector
          label="Veredicto"
          value={verdict}
          onChange={(v) => apply({ verdict: v as VerdictFilter })}
          options={[['all', 'Todas'], ['PASS', 'PASS'], ['REJECT', 'REJECT']]}
        />
        <Selector
          label="Flujo"
          value={gen}
          onChange={(v) => apply({ gen: v as GenerationFilter })}
          options={[['all', 'Todas'], ['current', 'Solo corregido']]}
        />
      </div>

      {/* Por qué la generación puede venir sin dato — se dice, no se disimula. */}
      {data && <SlotsNotice source={data.slots_source} />}
      {data && <CutoffsNotice source={data.cutoffs_source} />}

      {error && (
        <div className="flex items-start gap-2 text-[12px] text-rose-400/90 bg-rose-500/[0.06] border border-rose-500/20 rounded-xl px-3 py-2 mb-4">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span className="leading-snug">{error}</span>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-zinc-700"><Spinner size={22} /></div>
      ) : pieces.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-2 text-zinc-700">
          <Inbox size={36} strokeWidth={1} />
          <p className="text-sm">{total === 0 ? 'Nada pendiente de calibrar.' : 'Sin piezas en esta página.'}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pieces.map((p) => (
            <CalibrationCard
              key={p.piece_id} piece={p} token={token} onResolved={onResolved}
              slotsRead={data?.slots_source !== 'unavailable'}
            />
          ))}
        </div>
      )}

      {/* Paginación — SIEMPRE visible, con "N de M". */}
      <Pager offset={offset} pageSize={PAGE} total={total} loading={loading} onGo={goPage} />
    </div>
  );
}

// ── Card de calibración ──────────────────────────────────────────────────────────
type Action = 'approve' | 'reject' | 'fix' | 'discard';
type Outcome = 'approved' | 'rejected' | 'fixable' | 'discarded';
/** Qué panel de texto está abierto. `fix` es el tercer veredicto; `discard` no es veredicto. */
type Panel = 'reject' | 'fix' | 'discard';

function CalibrationCard({ piece, token, onResolved, slotsRead }: {
  piece: CalibrationPiece; token: string; onResolved: (id: string) => void;
  /** ¿Se pudieron leer las franjas? Cuando no, la previsión calla y avisa `SlotsNotice`. */
  slotsRead: boolean;
}) {
  // Render lazy del artefacto. Guardamos el HTML crudo (para <iframe srcdoc>) y la URL
  // del CDN (link durable). NO se usa src={cdn_url}: Supabase sirve el objeto como
  // text/plain + nosniff, así que embeber por src mostraría el código, no la pieza.
  const [artHtml, setArtHtml] = useState<string | null>(null);
  const [artUrl, setArtUrl]   = useState<string | null>(null);
  const [artErr, setArtErr]   = useState<string | null>(null);

  // Panel abierto para escribir una nota. Ninguna de las dos es obligatoria.
  const [panel, setPanel]     = useState<null | Panel>(null);
  const [note, setNote]       = useState('');
  // SIGN-01 corte E — el motivo de un toque. OPCIONAL, como el criterio: obligarlo empuja a elegir
  // cualquier clase para avanzar, y eso envenena la serie igual que un criterio de relleno.
  const [reason, setReason]   = useState('');
  const [busy, setBusy]       = useState<null | Action>(null);
  /**
   * El error de la tarjeta conserva DOS cosas. La frase redactada es la que se lee; el texto
   * crudo del server es la mitigación de que esa frase se apoya en una heurística sobre el
   * cuerpo del error de PostgREST. Guardar sólo `err.message` —como hacía antes— tiraba el
   * objeto entero: el detalle viajaba hasta el navegador y no era alcanzable ni por consola,
   * así que la mitigación existía sobre el papel y no en la pantalla.
   */
  const [error, setError]     = useState<null | { message: string; detail: string | null }>(null);
  const [done, setDone]       = useState<null | Outcome>(null);

  useEffect(() => {
    let alive = true;
    renderArtifact(token, piece.piece_id)
      .then((r) => { if (alive) { setArtHtml(r.html); setArtUrl(r.artifact_url); } })
      .catch((err) => { if (alive) setArtErr(err instanceof CalibrationError ? err.message : 'No se pudo renderizar el artefacto.'); });
    return () => { alive = false; };
  }, [piece.piece_id, token]);

  /** Lo que la tarjeta muestra de un error: la frase, y el crudo del server si lo hay. */
  const cardError = (err: unknown, caida: string) => {
    if (!(err instanceof CalibrationError)) return { message: caida, detail: null };
    const body = err.body as { server_detail?: unknown } | null | undefined;
    const detail = typeof body?.server_detail === 'string' ? body.server_detail : null;
    return { message: err.message, detail };
  };

  // El texto de la pieza para el lector en voz alta. Sale del MISMO `html` que ya se recibe
  // de `preview-render`, así que no hay una segunda lectura ni una segunda fuente de texto.
  const readable = useMemo(() => (artHtml ? readableFromArtifactHtml(artHtml) : null), [artHtml]);

  const finish = (outcome: Outcome) => {
    setDone(outcome);
    setTimeout(() => onResolved(piece.piece_id), 1500);
  };

  const submitVerdict = async (verdict: Verdict) => {
    setBusy(verdict === 'approved' ? 'approve' : verdict === 'fixable' ? 'fix' : 'reject');
    setError(null);
    try {
      // Criterio OPCIONAL en los tres casos: vacío viaja como null, nunca como relleno.
      // El motivo estructurado + la prosa. `buildCriterion` los une con un prefijo estable para que
      // una consulta pueda agrupar por motivo sin dejar de aceptar la prosa que ya hay en el corpus.
      //
      // En el panel de `fixable` el textarea ES LA PROPUESTA, no el criterio. La clase de defecto la
      // sigue aportando el chip, que viaja en `criterion` con su prefijo: son dos campos distintos
      // porque responden dos preguntas distintas — qué falla, y qué hacer con lo que hay.
      const esFixable = verdict === 'fixable';
      await saveVerdict(token, {
        piece_id: piece.piece_id,
        verdict,
        criterion: esFixable ? buildCriterion(reason, null) : buildCriterion(reason, note),
        fix_proposal: esFixable ? note.trim() : null,
      });
      finish(verdict);
    } catch (err) {
      // El error del server se muestra TAL CUAL. Nunca se degrada un `fixable` a `rejected` en
      // silencio: guardaría un rechazo donde Sam pidió otra cosa y el corpus quedaría mintiendo
      // sin que nadie se entere. Mientras la migración del corpus no esté aplicada, un `fixable`
      // falla acá y se ve — eso es lo correcto, no un fallo de la interfaz.
      setError(cardError(err, 'No se pudo guardar el veredicto.'));
      setBusy(null);
    }
  };

  const submitDiscard = async () => {
    setBusy('discard'); setError(null);
    try {
      await discardPiece(token, { piece_id: piece.piece_id, reason: buildCriterion(reason, note) });
      finish('discarded');
    } catch (err) {
      setError(cardError(err, 'No se pudo descartar la pieza.'));
      setBusy(null);
    }
  };

  // Estado resuelto → tarjeta de confirmación.
  if (done) {
    const style = done === 'approved'
      ? { box: 'bg-emerald-500/[0.07] border-emerald-500/30', text: 'text-emerald-300', icon: <CheckCircle2 size={18} />, label: 'Aprobada — guardada en el corpus' }
      : done === 'rejected'
        ? { box: 'bg-rose-500/[0.07] border-rose-500/30', text: 'text-rose-300', icon: <XCircle size={18} />, label: 'Rechazada — guardada en el corpus' }
        : done === 'fixable'
          ? { box: 'bg-sky-500/[0.07] border-sky-500/30', text: 'text-sky-300', icon: <Wrench size={18} />, label: 'Fixable — la propuesta quedó en el corpus' }
          : { box: 'bg-zinc-800/40 border-zinc-700/60', text: 'text-zinc-300', icon: <Archive size={18} />, label: 'Descartada — fuera de la bandeja, NO entra al corpus' };
    return (
      <motion.div
        initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className={cn('rounded-2xl p-4 border', style.box)}
      >
        <div className={cn('flex items-center gap-2', style.text)}>
          {style.icon}
          <p className="text-sm font-medium">{style.label}</p>
        </div>
        <p className="mt-1 text-[10px] font-mono text-zinc-600">pieza: {shortId(piece.piece_id)}</p>
      </motion.div>
    );
  }

  const rejected = piece.watcher_result === 'REJECT';

  /**
   * El copy de cada panel, en un solo sitio. El mismo textarea significa una cosa distinta en
   * cada uno —criterio, motivo, propuesta— y esa diferencia tiene que LEERSE en pantalla, no
   * deducirse del contexto. `fix` es el único con etiqueta visible y el único obligatorio.
   */
  const PANEL_COPY = {
    reject: {
      label: null,
      placeholder: 'Criterio del rechazo (opcional — normalmente lo escribe Claude desde el chat)…',
      confirm: 'Confirmar rechazo',
      foot: 'El rechazo entra al corpus con o sin criterio. Mejor vacío que de relleno.',
      focus: 'focus:border-rose-500/60',
      button: 'bg-rose-500/90 hover:bg-rose-500',
      icon: <XCircle size={14} />,
    },
    fix: {
      label: 'Qué propongo para aprovecharla',
      placeholder: 'Qué se rescata de esta pieza y cómo — con esto se corrige después en el chat…',
      confirm: 'Confirmar fixable',
      foot: 'Fixable SELLA la pieza igual que un rechazo: sale de la bandeja. Lo que cambia es la '
        + 'etiqueta del corpus y la propuesta, que queda guardada. La propuesta es obligatoria.',
      focus: 'focus:border-sky-500/60',
      button: 'bg-sky-500/90 hover:bg-sky-500',
      icon: <Wrench size={14} />,
    },
    discard: {
      label: null,
      placeholder: 'Motivo del descarte (opcional)…',
      confirm: 'Confirmar descarte',
      foot: 'Descartar no es rechazar: sale de la bandeja y NO entra al corpus.',
      focus: 'focus:border-zinc-500/60',
      button: 'bg-zinc-700 hover:bg-zinc-600',
      icon: <Archive size={14} />,
    },
  } as const;
  const copy = panel ? PANEL_COPY[panel] : null;
  /** La propuesta es el único texto obligatorio de la tarjeta. Sin ella el botón no se puede pulsar. */
  const faltaPropuesta = panel === 'fix' && !note.trim();

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden"
      style={{ borderLeftWidth: 3, borderLeftColor: rejected ? '#f43f5e' : '#FFAB00' }}
    >
      <div className="p-4 space-y-4">
        {/* Cabecera (compartida con la bandeja de publicación) + veredicto + generación.
            FIX-CARD-06: la identidad y los conteos salen de `PieceHeader`, así las dos
            bandejas no pueden contar distinto la misma pieza. */}
        <div className="space-y-1.5">
          <PieceHeader piece={piece} />
          <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono text-zinc-600">
            {piece.psycho_preset && <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{piece.psycho_preset}</span>}
            <WatcherBadge
              verdict={piece.watcher_verdict}
              reason={piece.watcher_reason}
              failedRules={piece.watcher_failed_rules}
              rulesEvaluated={piece.watcher_rules_evaluated}
              passType={piece.pass_type}
            />
            <GenerationBadge generation={piece.generation} label={piece.cutoff_label} at={piece.cutoff_at} />
          </div>
        </div>

        {/* DÓNDE CAERÍA SI SE APROBARA AHORA. PREVISIÓN, no compromiso: esta pieza todavía
            no está aprobada, así que no tiene franja. Se llama «fecha prevista» y no «fecha
            de publicación» porque otra pieza aprobada antes puede llevarse esa franja — y
            dos cosas distintas con el mismo nombre ya costaron dos PR correctivos. */}
        <ForecastLine forecast={piece.forecast_slot} slotsRead={slotsRead} />

        {/* Procedencia */}
        <Provenance piece={piece} />

        {/* Artefacto embebido */}
        <div className="rounded-xl overflow-hidden border border-zinc-800 bg-[#050508]">
          {artErr ? (
            <div className="p-4 text-[11px] text-rose-400/90 font-mono flex items-center gap-2">
              <AlertTriangle size={13} /> {artErr}
            </div>
          ) : artHtml === null ? (
            <div className="flex items-center justify-center py-16 text-zinc-700"><Spinner size={18} /></div>
          ) : (
            // srcdoc (no src): renderiza el HTML directo. El CDN sirve text/plain, así que
            // embeber por src mostraría el código en vez de la pieza.
            <iframe
              srcDoc={artHtml}
              title={`preview-${piece.piece_id}`}
              sandbox=""
              className="w-full"
              style={{ height: 480, border: 'none', background: '#050508' }}
            />
          )}
        </div>
        {artUrl && (
          <a href={artUrl} target="_blank" rel="noopener noreferrer"
             className="block text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors truncate">
            {artUrl}
          </a>
        )}

        {/* Lectura en voz alta. Va debajo de la vista previa porque se lee lo mismo que se
            ve, y su propio bloque de texto es donde ocurre la selección: dentro del
            `<iframe sandbox="">` de arriba, `getSelection()` no alcanza. */}
        {readable && <SpeechReader piece={readable} suggestedLang={piece.reading_language} />}

        {error && (
          <div className="text-xs text-rose-400 font-mono leading-snug space-y-1">
            <p>{error.message}</p>
            {/* Plegado, pero ALCANZABLE. La frase de arriba la redacta el endpoint sobre una
                heurística; esto es lo que respondió la base, sin interpretar. */}
            {error.detail && (
              <details className="text-[10px] text-rose-300/70">
                <summary className="cursor-pointer hover:text-rose-300">Respuesta del servidor</summary>
                <pre className="mt-1 whitespace-pre-wrap break-all">{error.detail}</pre>
              </details>
            )}
          </div>
        )}

        {/* Acciones — tres salidas */}
        <AnimatePresence mode="wait">
          {panel ? (
            <motion.div key={panel} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
              {/* SIGN-01 corte E — MOTIVO DE UN TOQUE, lista cerrada. Hoy Sam escribe a mano y esos
                  motivos no son agregables: para saber que el 40% de los rechazos son "falta la
                  firma" hay que leerlos uno por uno — que es exactamente lo que pasó. Son clases de
                  defecto, nunca marcas. */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {REJECT_REASONS.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => { setReason(reason === r.value ? '' : r.value); setError(null); }}
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
              {copy?.label && (
                <label className="block text-[11px] font-medium text-sky-300/90">{copy.label}</label>
              )}
              <textarea
                value={note}
                onChange={(e) => { setNote(e.target.value); setError(null); }}
                rows={3}
                autoFocus
                placeholder={copy?.placeholder}
                className={cn(
                  'w-full bg-[#050508] border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-700 outline-none transition-colors resize-none',
                  copy?.focus,
                )}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (panel === 'reject') return submitVerdict('rejected');
                    if (panel === 'fix') return submitVerdict('fixable');
                    return submitDiscard();
                  }}
                  disabled={!!busy || faltaPropuesta}
                  title={faltaPropuesta ? 'Escribir la propuesta antes de confirmar' : undefined}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors',
                    copy?.button,
                  )}
                >
                  {busy ? <Spinner size={14} /> : <>{copy?.icon} {copy?.confirm}</>}
                </button>
                <button
                  onClick={() => { setPanel(null); setError(null); }}
                  disabled={!!busy}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:bg-zinc-800 transition-colors"
                >
                  Cancelar
                </button>
              </div>
              <p className={cn(
                'text-[10px] font-mono leading-snug',
                panel === 'fix' ? 'text-sky-300/70' : 'text-zinc-600',
              )}>
                {copy?.foot}
              </p>
            </motion.div>
          ) : (
            <motion.div key="actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex gap-2 flex-wrap">
              <button
                onClick={() => submitVerdict('approved')}
                disabled={!!busy}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold bg-accent text-black hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-accent/20 transition-all"
              >
                {busy === 'approve' ? <Spinner size={14} /> : <><CheckCircle2 size={14} /> Aprobar</>}
              </button>
              <button
                onClick={() => { setPanel('reject'); setError(null); }}
                disabled={!!busy}
                className="px-4 py-2.5 rounded-lg text-sm font-medium border border-rose-500/30 text-rose-300/90 hover:bg-rose-500/10 transition-colors disabled:opacity-50"
              >
                <XCircle size={14} className="inline mr-1" /> Rechazar
              </button>
              <button
                onClick={() => { setPanel('fix'); setError(null); }}
                disabled={!!busy}
                title="Hay algo que aprovechar. Sella la pieza igual que un rechazo y guarda la propuesta en el corpus."
                className="px-4 py-2.5 rounded-lg text-sm font-medium border border-sky-500/30 text-sky-300/90 hover:bg-sky-500/10 transition-colors disabled:opacity-50"
              >
                <Wrench size={14} className="inline mr-1" /> Fixable
              </button>
              <button
                onClick={() => { setPanel('discard'); setError(null); }}
                disabled={!!busy}
                title="No voy a juzgar esta pieza: sale de la bandeja y no entra al corpus."
                className="px-4 py-2.5 rounded-lg text-sm font-medium border border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors disabled:opacity-50"
              >
                <Archive size={14} className="inline mr-1" /> Descartar
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
