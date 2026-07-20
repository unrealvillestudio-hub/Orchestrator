import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Dna, Store, ArrowLeft, RefreshCw, CheckCircle2, AlertTriangle,
  Plus, X, Sparkles, RotateCcw, Lock,
} from 'lucide-react';
import { cn, Spinner } from '../../ui/components';
import { listOptions, IidError, type IidSession, type ListOptions } from '../../services/iidInbound';
import {
  listSessions, startCalibration, submitVerdict, convergeSession, getStatus,
  type CalibrationSessionSummary, type CalibrationTurn, type CalibrationProgress, type VerdictResult,
  type VoiceType, type PsyFamily, type TargetArtifact, type CraftWarning,
} from '../../services/iidCalibrate';

/* ════════════════════════════════════════════════════════════════════════════
 * CalibrationConsole — IID #47 Fase 2 · E5b FRONT (#65)
 *
 * Consola de calibración de voz (bucle Boids) para Marisol (rol seeder). Vive como
 * segunda vista dentro del SeederShell. Todo pasa por `api/calibrate.ts` — el front
 * nunca toca las tablas. La convergencia es SOLO reflejo: el server decide, el front
 * pinta `progress` tal cual (nunca recomputa ni bloquea por umbral).
 *
 * Scope-gating: el <select> de marca se limita a listOptions(session_token) (que la EF
 * iid-inbound ya filtra por brand_scope). calibrate.ts no valida JWT — el gate vive acá.
 *
 * from_genome = stub honesto (no hay flujo: depende de piezas que no existen). Solo
 * from_scratch se construye.
 * ════════════════════════════════════════════════════════════════════════════ */

type Mode = 'select' | 'new' | 'loop' | 'converged';

// Retomo/arranque puede fallar en generar (502) — se distingue para ofrecer reintento.
type RetryKind = 'start' | 'verdict' | null;

interface AxisPair { key: string; value: string; fixed: boolean }

const CORE_AXIS: AxisPair[] = [
  { key: 'defiende', value: '', fixed: true },
  { key: 'contra_que', value: '', fixed: true },
  { key: 'para_quien', value: '', fixed: true },
];

// ── CRAFT-01: opciones de los 3 selectores declarados ──────────────────────────────
// El FRONT deriva `mode` del canal (§3): guion/podcast → 'oral'; el resto → 'written'.
const CHANNELS: { value: string; label: string; mode: 'written' | 'oral' }[] = [
  { value: 'ig_feed', label: 'Instagram — feed (caption)', mode: 'written' },
  { value: 'ig_carousel', label: 'Instagram — carrusel', mode: 'written' },
  { value: 'email', label: 'Email', mode: 'written' },
  { value: 'blog', label: 'Blog / artículo largo', mode: 'written' },
  { value: 'x_thread', label: 'X / hilo', mode: 'written' },
  { value: 'landing', label: 'Landing / web', mode: 'written' },
  { value: 'video_script', label: 'Guion de video (Reel / TikTok)', mode: 'oral' },
  { value: 'podcast', label: 'Podcast / audio', mode: 'oral' },
  { value: 'yt_script', label: 'Guion de YouTube', mode: 'oral' },
];

const VOICE_OPTIONS: { value: VoiceType; label: string }[] = [
  { value: 'conversion', label: 'Conversión' },
  { value: 'editorial', label: 'Editorial' },
  { value: 'educative', label: 'Educativa' },
  { value: 'professional', label: 'Profesional' },
];

const PSY_OPTIONS: { value: PsyFamily; label: string; help: string }[] = [
  { value: 'CONVERSION', label: 'CONVERSION', help: 'mover a una acción concreta' },
  { value: 'COMMUNITY', label: 'COMMUNITY', help: 'construir pertenencia / “nosotros”' },
  { value: 'AUTHORITY', label: 'AUTHORITY', help: 'establecer criterio y credibilidad' },
  { value: 'BRIDGE', label: 'BRIDGE', help: 'conectar lo conocido con lo nuevo' },
];

// CRAFT-01 #75: mapa a texto legible para el operador, keyeado sobre el CÓDIGO ESTABLE
// (`reason`, en MAYÚSCULAS) que manda el backend — NO sobre una frase intermedia. Antes había
// dos capas de traducción encadenadas (backend frase→minúscula, front frase→legible); si la
// frase intermedia cambiaba, este mapa fallaba EN SILENCIO. Ahora se traduce UNA sola vez,
// sobre `reason`. Fallback obligatorio: un `reason` sin mapa se muestra tal cual (no se
// descarta ni rompe).
const WARNING_TEXT: Record<string, string> = {
  'ARTEFACTO NO DECLARADO': 'No dijiste dónde se publica',
  'MODO NO DECLARADO': 'No está claro si es texto o guion hablado',
  'FAMILIA NO DECLARADA': 'No declaraste el objetivo psicológico',
  'TIPO DE VOZ NO DECLARADO': 'No declaraste el tipo de voz',
};
const humanizeWarning = (w: CraftWarning): string => WARNING_TEXT[w.reason] ?? w.reason;

export default function CalibrationConsole({ session }: { session: IidSession }) {
  const [mode, setMode] = useState<Mode>('select');

  // ── Selector ──────────────────────────────────────────────────────────────────
  const [brands, setBrands] = useState<ListOptions['brands']>([]);
  const [selectedBrand, setSelectedBrand] = useState('');
  const [sessions, setSessions] = useState<CalibrationSessionSummary[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [selectError, setSelectError] = useState<string | null>(null);

  // ── Sesión nueva (from_scratch) ─────────────────────────────────────────────────
  const [intentLabel, setIntentLabel] = useState('');
  const [axis, setAxis] = useState<AxisPair[]>(CORE_AXIS.map((p) => ({ ...p })));
  // CRAFT-01: los 3 selectores declarados. '' = no elegido → se manda null → modo degradado
  // (§7). No bloquean el inicio; el aviso de degradación es visible pero no obligatorio.
  const [voiceType, setVoiceType] = useState<VoiceType | ''>('');
  const [psyFamily, setPsyFamily] = useState<PsyFamily | ''>('');
  const [channel, setChannel] = useState('');
  const [format, setFormat] = useState('');
  const [lengthHint, setLengthHint] = useState('');
  const resetCraft = () => { setVoiceType(''); setPsyFamily(''); setChannel(''); setFormat(''); setLengthHint(''); };

  // ── Bucle ────────────────────────────────────────────────────────────────────
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turn, setTurn] = useState<CalibrationTurn | null>(null);
  const [pendingVerdict, setPendingVerdict] = useState<'si' | 'no' | null>(null);
  const [notes, setNotes] = useState('');
  const [progress, setProgress] = useState<CalibrationProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [loopError, setLoopError] = useState<string | null>(null);
  const [retry, setRetry] = useState<RetryKind>(null);

  // ── Convergencia ────────────────────────────────────────────────────────────────
  const [converged, setConverged] = useState<{ message: string; total_turns: number } | null>(null);

  // CRAFT-01 §5.4: avisos NO bloqueantes del modo degradado, derivados de `skipped` server-side.
  const [craftWarnings, setCraftWarnings] = useState<CraftWarning[]>([]);

  // Marcas del scope (la EF list_options ya filtra por brand_scope — mismo patrón que Unified).
  useEffect(() => {
    listOptions(session.session_token)
      .then((o) => setBrands(o.brands ?? []))
      .catch(() => setBrands([]));
  }, [session.session_token]);

  // ── Selector: al elegir marca, listar sesiones activas ─────────────────────────
  const onPickBrand = async (brandId: string) => {
    setSelectedBrand(brandId);
    setSessions([]);
    setSelectError(null);
    if (!brandId) return;
    setLoadingSessions(true);
    try {
      const r = await listSessions(brandId, 'active');
      setSessions(r.sessions ?? []);
    } catch (err) {
      setSelectError(err instanceof IidError ? err.message : 'No se pudieron cargar las sesiones.');
      setSessions([]);
    } finally {
      setLoadingSessions(false);
    }
  };

  const backToSelector = () => {
    setMode('select');
    setSessionId(null);
    setTurn(null);
    setPendingVerdict(null);
    setNotes('');
    setProgress(null);
    setLoopError(null);
    setRetry(null);
    setConverged(null);
    setCraftWarnings([]);
    // Refrescar el listado (los turn_count pueden haber cambiado).
    if (selectedBrand) void onPickBrand(selectedBrand);
  };

  // ── Aplica el resultado de un verdict (bifurca active / converged) ──────────────
  const applyVerdictResult = (r: VerdictResult) => {
    if (r.status === 'converged') {
      setConverged({ message: r.message, total_turns: r.total_turns });
      setMode('converged');
      return;
    }
    setTurn(r.turn);
    setProgress(r.progress);
    setCraftWarnings(r.craft_warnings ?? []);
    setPendingVerdict(null);
    setNotes('');
  };

  // ── Entrar a una sesión existente (Retomar) ─────────────────────────────────────
  const enterSession = async (sid: string) => {
    setMode('loop');
    setSessionId(sid);
    setTurn(null);
    setPendingVerdict(null);
    setNotes('');
    setProgress(null);
    setLoopError(null);
    setRetry(null);
    setCraftWarnings([]);
    setBusy(true);
    try {
      const st = await getStatus(sid);
      if (st.session.status === 'converged') {
        setConverged({
          message: 'Esta sesión ya había convergido.',
          total_turns: st.turns.length,
        });
        setMode('converged');
        return;
      }
      if (st.session.status !== 'active') {
        setLoopError(`La sesión está en estado '${st.session.status}' y no se puede retomar.`);
        return;
      }
      // E5c: reflejar el progreso del server (incluye can_converge) para que, si la sesión
      // ya pasó el umbral, aparezca "Cerrar y calibrar voz" sin juzgar otro turno.
      if (st.progress) setProgress(st.progress);
      const turns = [...st.turns].sort((a, b) => a.turn_number - b.turn_number);
      if (turns.length === 0) {
        // Sembrada (0 turnos): start con session_id genera el turno 1 desde el founder_axis.
        const r = await startCalibration({ session_id: sid });
        setTurn(r.turn);
        return;
      }
      const pending = turns.find((t) => t.verdict_voice === null);
      if (pending) {
        setTurn({ turn_number: pending.turn_number, proposed_text: pending.proposed_text });
        return;
      }
      // Caso raro: todos juzgados y no convergió → re-enviar el último veredicto (idempotente)
      // re-evalúa convergencia y regenera el turno siguiente.
      const last = turns[turns.length - 1];
      const vr = await submitVerdict({
        session_id: sid,
        turn_number: last.turn_number,
        verdict_voice: (last.verdict_voice ?? 'si') as 'si' | 'no',
        notes_intent: last.notes_intent ?? null,
        verdict_operator: session.sub,
      });
      applyVerdictResult(vr);
    } catch (err) {
      handleLoopError(err, 'start');
    } finally {
      setBusy(false);
    }
  };

  // ── Crear sesión nueva (from_scratch) ───────────────────────────────────────────
  const axisObject = (): Record<string, string> => {
    const obj: Record<string, string> = {};
    for (const p of axis) {
      const k = p.key.trim();
      const v = p.value.trim();
      if (k && v) obj[k] = v;
    }
    return obj;
  };

  const coreFilled = axis
    .filter((p) => p.fixed)
    .every((p) => p.value.trim().length > 0);
  const newReady = intentLabel.trim().length > 0 && coreFilled && !busy;

  const startNew = async () => {
    if (!newReady) return;
    setBusy(true);
    setLoopError(null);
    setRetry(null);
    try {
      // CRAFT-01: el front deriva `mode` del canal (§3). Sin canal → target_artifact null.
      const chan = CHANNELS.find((c) => c.value === channel);
      const target_artifact: TargetArtifact | null = chan
        ? { channel: chan.label, format: format.trim(), length_hint: lengthHint.trim(), mode: chan.mode }
        : null;
      const r = await startCalibration({
        brand_id: selectedBrand,
        operator: session.sub,
        intent_label: intentLabel.trim(),
        founder_axis: axisObject(),
        voice_type: voiceType || null,
        psy_family: psyFamily || null,
        target_artifact,
      });
      setSessionId(r.session_id);
      setTurn(r.turn);
      setProgress(null);
      setCraftWarnings(r.craft_warnings ?? []);
      setPendingVerdict(null);
      setNotes('');
      setMode('loop');
    } catch (err) {
      // Si la sesión se creó pero falló la generación (502), el endpoint devuelve session_id.
      const sid = err instanceof IidError ? (err.body?.session_id as string | undefined) : undefined;
      if (sid) setSessionId(sid);
      handleLoopError(err, 'start');
      setMode('loop'); // mostrar el banner de reintento en el bucle, no perder el formulario detrás
    } finally {
      setBusy(false);
    }
  };

  // ── Manejo de errores del bucle (distingue 502 reintentable) ───────────────────
  const handleLoopError = (err: unknown, kind: Exclude<RetryKind, null>) => {
    if (err instanceof IidError && err.status === 502) {
      setRetry(kind);
      setLoopError('No se pudo generar el siguiente texto (fallo temporal del generador).');
      return;
    }
    if (err instanceof IidError && err.status === 409) {
      // Sesión no activa (p.ej. convergió en paralelo). Reconstruir estado.
      setLoopError(err.message || 'La sesión ya no está activa.');
      setRetry(null);
      return;
    }
    setLoopError(err instanceof IidError ? err.message : 'Error inesperado. Reintentá.');
    setRetry(null);
  };

  // ── Enviar veredicto ─────────────────────────────────────────────────────────
  const sendVerdict = async () => {
    if (!sessionId || !turn || !pendingVerdict || busy) return;
    setBusy(true);
    setLoopError(null);
    setRetry(null);
    try {
      const vr = await submitVerdict({
        session_id: sessionId,
        turn_number: turn.turn_number,
        verdict_voice: pendingVerdict,
        notes_intent: notes.trim() || null,
        verdict_operator: session.sub,
      });
      applyVerdictResult(vr);
    } catch (err) {
      // El veredicto ya quedó guardado server-side (red de seguridad). No perder notas/verdict local.
      handleLoopError(err, 'verdict');
    } finally {
      setBusy(false);
    }
  };

  // ── Reintento tras 502 ─────────────────────────────────────────────────────────
  const doRetry = async () => {
    if (!sessionId || busy) return;
    setBusy(true);
    setLoopError(null);
    try {
      if (retry === 'start') {
        const r = await startCalibration({ session_id: sessionId });
        setTurn(r.turn);
        setCraftWarnings(r.craft_warnings ?? []);
        setRetry(null);
      } else if (retry === 'verdict' && turn && pendingVerdict) {
        const vr = await submitVerdict({
          session_id: sessionId,
          turn_number: turn.turn_number,
          verdict_voice: pendingVerdict,
          notes_intent: notes.trim() || null,
          verdict_operator: session.sub,
        });
        applyVerdictResult(vr);
        setRetry(null);
      }
    } catch (err) {
      handleLoopError(err, retry ?? 'verdict');
    } finally {
      setBusy(false);
    }
  };

  // ── Cerrar y calibrar (E5c — acción explícita del operador) ─────────────────────
  // Solo se ofrece cuando el server habilitó can_converge. El backend revalida el umbral:
  // un 409 not_convergeable (front desincronizado) oculta el botón sin cerrar la sesión.
  const doConverge = async () => {
    if (!sessionId || busy) return;
    setBusy(true);
    setLoopError(null);
    setRetry(null);
    try {
      const vr = await convergeSession(sessionId, session.sub);
      applyVerdictResult(vr); // shape 'converged' → pantalla de convergencia (E6 en el chat)
    } catch (err) {
      if (err instanceof IidError && err.status === 409) {
        // Aún no se cumple el umbral (o sesión no activa): ocultar el botón y avisar suave.
        const detail = (err.body?.detail as string | undefined) || 'Aún no se puede cerrar la sesión.';
        setLoopError(detail);
        setProgress((p) => (p ? { ...p, can_converge: false } : p));
        setRetry(null);
      } else {
        handleLoopError(err, 'verdict');
      }
    } finally {
      setBusy(false);
    }
  };

  // ════════════════════════════════════════════════════════════════════════════
  // Render
  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div className="max-w-2xl mx-auto px-6 py-10 pb-24 space-y-8">
      {/* Header */}
      <div>
        <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-600 mb-2">Calibración de voz</p>
        <h2 className="font-display text-2xl font-bold text-white flex items-center gap-2">
          <Dna size={22} className="text-accent" /> Calibrar la voz de la marca
        </h2>
        <p className="text-sm text-zinc-500 mt-1">
          El generador propone textos; vos juzgás si suenan a la marca. Cuando converge, la voz queda
          calibrada. El original nunca se republica.
        </p>
      </div>

      {mode === 'select' && (
        <SelectorView
          brands={brands}
          selectedBrand={selectedBrand}
          onPickBrand={onPickBrand}
          sessions={sessions}
          loading={loadingSessions}
          error={selectError}
          onResume={enterSession}
          onNew={() => { setIntentLabel(''); setAxis(CORE_AXIS.map((p) => ({ ...p }))); resetCraft(); setMode('new'); }}
        />
      )}

      {mode === 'new' && (
        <NewSessionView
          brandLabel={brands.find((b) => b.id === selectedBrand)?.name || selectedBrand}
          intentLabel={intentLabel}
          setIntentLabel={setIntentLabel}
          axis={axis}
          setAxis={setAxis}
          voiceType={voiceType}
          setVoiceType={setVoiceType}
          psyFamily={psyFamily}
          setPsyFamily={setPsyFamily}
          channel={channel}
          setChannel={setChannel}
          format={format}
          setFormat={setFormat}
          lengthHint={lengthHint}
          setLengthHint={setLengthHint}
          ready={newReady}
          busy={busy}
          onStart={startNew}
          onCancel={() => setMode('select')}
        />
      )}

      {mode === 'loop' && (
        <LoopView
          turn={turn}
          busy={busy}
          pendingVerdict={pendingVerdict}
          setPendingVerdict={setPendingVerdict}
          notes={notes}
          setNotes={setNotes}
          progress={progress}
          craftWarnings={craftWarnings}
          loopError={loopError}
          retry={retry}
          onSend={sendVerdict}
          onRetry={doRetry}
          onConverge={doConverge}
          onBack={backToSelector}
        />
      )}

      {mode === 'converged' && converged && (
        <ConvergedView data={converged} onBack={backToSelector} />
      )}
    </div>
  );
}

// ── Selector ──────────────────────────────────────────────────────────────────
function SelectorView({
  brands, selectedBrand, onPickBrand, sessions, loading, error, onResume, onNew,
}: {
  brands: ListOptions['brands'];
  selectedBrand: string;
  onPickBrand: (id: string) => void;
  sessions: CalibrationSessionSummary[];
  loading: boolean;
  error: string | null;
  onResume: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="space-y-6">
      {/* Marca */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
        <label className="block">
          <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
            Marca <span className="text-accent ml-1">*</span>
          </span>
          <span className="block text-[10px] text-zinc-600 mt-0.5 mb-2 font-body normal-case tracking-normal">
            Solo tus marcas en alcance. Elegí una para ver sus sesiones de calibración.
          </span>
          <div className="relative mt-1">
            <Store size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
            <select
              value={selectedBrand}
              onChange={(e) => onPickBrand(e.target.value)}
              className={cn(
                'w-full bg-[#050508] border rounded-xl pl-9 pr-3 py-2.5 text-sm text-white outline-none focus:border-accent/60 transition-colors',
                selectedBrand ? 'border-zinc-800' : 'border-amber-500/40'
              )}
            >
              <option value="">— elegí una marca —</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name || b.id}</option>)}
            </select>
          </div>
        </label>
      </div>

      {selectedBrand && (
        <div className="space-y-3">
          {error && (
            <div className="flex items-start gap-2.5 bg-rose-500/[0.07] border border-rose-500/25 rounded-xl px-4 py-3.5">
              <AlertTriangle size={18} className="text-rose-400 shrink-0 mt-0.5" />
              <p className="text-sm text-rose-300 leading-snug">{error}</p>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-10 text-zinc-700"><Spinner size={20} /></div>
          ) : (
            <>
              {sessions.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-600">Sesiones para retomar</p>
                  {sessions.map((s) => (
                    <div key={s.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-white leading-snug">
                            {s.intent_label || <span className="text-zinc-500 italic">sin etiqueta de intención</span>}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 mt-2">
                            <span className={cn(
                              'text-[10px] font-mono px-2 py-0.5 rounded-md border',
                              s.turn_count === 0
                                ? 'text-amber-300/80 border-amber-500/30 bg-amber-500/[0.06]'
                                : 'text-zinc-400 border-zinc-700 bg-zinc-800/40'
                            )}>
                              {s.turn_count === 0 ? 'sembrada · 0 turnos' : `en progreso · ${s.turn_count} turno${s.turn_count !== 1 ? 's' : ''}`}
                            </span>
                            {s.has_founder_axis && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400/80">
                                <CheckCircle2 size={11} /> eje fundador
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onResume(s.id)}
                          className="shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold font-body bg-accent text-black hover:bg-accent/90 shadow-md shadow-accent/20 transition-all"
                        >
                          <Sparkles size={13} /> Retomar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {sessions.length === 0 && (
                <p className="text-sm text-zinc-600 py-2">No hay sesiones activas para esta marca todavía.</p>
              )}

              <button
                type="button"
                onClick={onNew}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold font-body border border-accent/60 text-accent hover:bg-accent/10 transition-colors"
              >
                <Plus size={15} /> Crear sesión nueva
              </button>

              {/* from_genome — stub honesto (no clickable a un flujo inexistente). */}
              <div className="flex items-start gap-2.5 bg-zinc-900/60 border border-zinc-800 border-dashed rounded-xl px-4 py-3 mt-1">
                <Lock size={15} className="text-zinc-600 shrink-0 mt-0.5" />
                <p className="text-[11px] text-zinc-600 leading-snug">
                  <span className="text-zinc-500 font-medium">Calibrar desde un genoma capturado</span> — disponible más
                  adelante. Depende de piezas del pipeline que aún no existen; por ahora toda calibración arranca desde cero.
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sesión nueva ────────────────────────────────────────────────────────────────
function NewSessionView({
  brandLabel, intentLabel, setIntentLabel, axis, setAxis,
  voiceType, setVoiceType, psyFamily, setPsyFamily, channel, setChannel,
  format, setFormat, lengthHint, setLengthHint,
  ready, busy, onStart, onCancel,
}: {
  brandLabel: string;
  intentLabel: string;
  setIntentLabel: (v: string) => void;
  axis: AxisPair[];
  setAxis: React.Dispatch<React.SetStateAction<AxisPair[]>>;
  voiceType: VoiceType | '';
  setVoiceType: (v: VoiceType | '') => void;
  psyFamily: PsyFamily | '';
  setPsyFamily: (v: PsyFamily | '') => void;
  channel: string;
  setChannel: (v: string) => void;
  format: string;
  setFormat: (v: string) => void;
  lengthHint: string;
  setLengthHint: (v: string) => void;
  ready: boolean;
  busy: boolean;
  onStart: () => void;
  onCancel: () => void;
}) {
  // CRAFT-01 §7: los 3 selectores son OPCIONALES. Lo no declarado corre en modo degradado
  // (el backend usa solo core+structure para eso). Aviso visible, nunca bloqueante.
  const psyHelp = PSY_OPTIONS.find((o) => o.value === psyFamily)?.help ?? '';
  const degraded = !voiceType || !psyFamily || !channel;
  const label: Record<string, string> = {
    defiende: 'Qué defiende',
    contra_que: 'Contra qué',
    para_quien: 'Para quién',
  };
  const placeholder: Record<string, string> = {
    defiende: 'la creencia central que la marca sostiene…',
    contra_que: 'el enemigo / la norma que rechaza…',
    para_quien: 'la persona a la que le habla…',
  };

  const setPair = (i: number, patch: Partial<AxisPair>) =>
    setAxis((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const addPair = () => setAxis((prev) => [...prev, { key: '', value: '', fixed: false }]);
  const removePair = (i: number) => setAxis((prev) => prev.filter((_, idx) => idx !== i));

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-600">Nueva sesión · {brandLabel}</p>
        <button onClick={onCancel} className="text-[11px] font-mono text-zinc-600 hover:text-zinc-300 flex items-center gap-1 transition-colors">
          <ArrowLeft size={12} /> volver
        </button>
      </div>

      {/* Intención */}
      <label className="block">
        <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
          ¿Qué voz buscás? <span className="text-accent ml-1">*</span>
        </span>
        <span className="block text-[10px] text-zinc-600 mt-0.5 mb-1.5 font-body normal-case tracking-normal">
          La intención de la voz — ej. "conversión directa", "editorial reflexivo".
        </span>
        <input
          value={intentLabel}
          onChange={(e) => setIntentLabel(e.target.value)}
          placeholder="conversión directa, editorial reflexivo…"
          className="w-full bg-[#050508] border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-zinc-700 outline-none focus:border-accent/60 transition-colors"
        />
      </label>

      {/* Eje fundador */}
      <div>
        <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
          Eje fundador <span className="text-accent ml-1">*</span>
        </span>
        <span className="block text-[10px] text-zinc-600 mt-0.5 mb-2.5 font-body normal-case tracking-normal">
          El motor de la voz. Sin esto el generador arranca sin rumbo. Los tres primeros son obligatorios.
        </span>
        <div className="space-y-2">
          {axis.map((p, i) => (
            <div key={i} className="flex items-start gap-2">
              {p.fixed ? (
                <div className="w-32 shrink-0 pt-2.5">
                  <span className="text-[11px] font-mono text-zinc-400">{label[p.key] ?? p.key}</span>
                </div>
              ) : (
                <input
                  value={p.key}
                  onChange={(e) => setPair(i, { key: e.target.value })}
                  placeholder="clave"
                  className="w-32 shrink-0 bg-[#050508] border border-zinc-800 rounded-lg px-2.5 py-2 text-xs font-mono text-white placeholder:text-zinc-700 outline-none focus:border-accent/60 transition-colors"
                />
              )}
              <input
                value={p.value}
                onChange={(e) => setPair(i, { value: e.target.value })}
                placeholder={placeholder[p.key] ?? 'valor…'}
                className="flex-1 bg-[#050508] border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-700 outline-none focus:border-accent/60 transition-colors"
              />
              {!p.fixed && (
                <button
                  onClick={() => removePair(i)}
                  className="p-2 text-zinc-600 hover:text-rose-400 transition-colors shrink-0"
                  title="Quitar par"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          onClick={addPair}
          className="mt-2 flex items-center gap-1.5 text-[11px] font-mono text-zinc-600 hover:text-accent transition-colors"
        >
          <Plus size={12} /> Añadir par
        </button>
      </div>

      {/* ── CRAFT-01: contexto de la pieza (opcional — degrada limpiamente) ── */}
      <div className="pt-1 border-t border-zinc-800/70 space-y-4">
        <p className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
          Contexto <span className="text-zinc-600 normal-case tracking-normal font-body">— opcional, ayuda al generador a afinar</span>
        </p>

        {/* Tipo de voz */}
        <label className="block">
          <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">Tipo de voz</span>
          <select
            value={voiceType}
            onChange={(e) => setVoiceType(e.target.value as VoiceType | '')}
            className="mt-1.5 w-full bg-[#050508] border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-accent/60 transition-colors"
          >
            <option value="">— sin declarar —</option>
            {VOICE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>

        {/* Objetivo psicológico */}
        <label className="block">
          <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">Objetivo psicológico</span>
          <select
            value={psyFamily}
            onChange={(e) => setPsyFamily(e.target.value as PsyFamily | '')}
            className="mt-1.5 w-full bg-[#050508] border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-accent/60 transition-colors"
          >
            <option value="">— sin declarar —</option>
            {PSY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {psyHelp && <span className="block text-[10px] text-zinc-600 mt-1 font-body">{psyHelp}</span>}
        </label>

        {/* Artefacto de destino */}
        <div>
          <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">Dónde se publica</span>
          <span className="block text-[10px] text-zinc-600 mt-0.5 mb-2 font-body normal-case tracking-normal">
            Un texto para Instagram y uno para un blog no se escriben igual. Decir dónde va cambia cómo se escribe.
          </span>
          <div className="space-y-2">
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="w-full bg-[#050508] border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-accent/60 transition-colors"
            >
              <option value="">— canal sin declarar —</option>
              {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <input
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              placeholder="formato — ej. caption con hashtags, carrusel de 6 slides…"
              className="w-full bg-[#050508] border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-700 outline-none focus:border-accent/60 transition-colors"
            />
            <input
              value={lengthHint}
              onChange={(e) => setLengthHint(e.target.value)}
              placeholder="largo aproximado — ej. máximo 280 caracteres, 600 a 800 palabras…"
              className="w-full bg-[#050508] border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-700 outline-none focus:border-accent/60 transition-colors"
            />
          </div>
        </div>

        {degraded && (
          <div className="flex items-start gap-2.5 bg-amber-500/[0.06] border border-amber-500/25 rounded-xl px-4 py-3">
            <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[12px] text-amber-200/90 leading-snug">
              Podés arrancar igual. Lo que dejes sin declarar, el generador lo trabaja con menos
              información — funciona, pero afina menos. Podés completarlo ahora o más adelante.
            </p>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onStart}
        disabled={!ready}
        className={cn(
          'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold font-body transition-all',
          !ready
            ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
            : 'bg-accent text-black hover:bg-accent/90 shadow-md shadow-accent/20'
        )}
      >
        {busy ? <><Spinner size={15} /> Generando el primer texto…</> : <><Sparkles size={15} /> Comenzar calibración</>}
      </button>
    </div>
  );
}

// ── Bucle de calibración ─────────────────────────────────────────────────────────
function LoopView({
  turn, busy, pendingVerdict, setPendingVerdict, notes, setNotes, progress, craftWarnings,
  loopError, retry, onSend, onRetry, onConverge, onBack,
}: {
  turn: CalibrationTurn | null;
  busy: boolean;
  pendingVerdict: 'si' | 'no' | null;
  setPendingVerdict: (v: 'si' | 'no' | null) => void;
  notes: string;
  setNotes: (v: string) => void;
  progress: CalibrationProgress | null;
  craftWarnings: CraftWarning[];
  loopError: string | null;
  retry: RetryKind;
  onSend: () => void;
  onRetry: () => void;
  onConverge: () => void;
  onBack: () => void;
}) {
  const notesPlaceholder =
    pendingVerdict === 'no'
      ? 'Qué falló, qué esperabas…'
      : pendingVerdict === 'si'
        ? 'Qué acertó (refuerza el patrón)…'
        : '¿Por qué? (opcional, muy útil)';

  // E5c: el umbral habilita cerrar, no lo fuerza. can_converge es reflejo puro del server.
  const canConverge = !!progress?.can_converge;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-[11px] font-mono text-zinc-600 hover:text-zinc-300 flex items-center gap-1 transition-colors">
          <ArrowLeft size={12} /> volver al selector
        </button>
        {progress && (
          <p className="text-[11px] font-mono text-zinc-500">
            Turnos juzgados: <span className="text-zinc-300">{progress.turns_done}</span>
            <span className="text-zinc-700 mx-1.5">·</span>
            Racha de SÍ: <span className="text-emerald-400">{progress.consecutive_si}/3</span>
            {canConverge && (
              <span className="ml-1.5 inline-flex items-center gap-1 text-emerald-400">
                <span className="text-zinc-700">·</span> <CheckCircle2 size={11} /> lista para cerrar
              </span>
            )}
          </p>
        )}
      </div>

      {/* CRAFT-01 §5.4: aviso NO bloqueante del modo degradado (contexto no declarado).
          Derivado de skipped server-side; NUNCA de errors (fallo de lectura = infra). */}
      {craftWarnings.length > 0 && (
        <div className="flex items-start gap-2.5 bg-amber-500/[0.05] border border-amber-500/20 rounded-xl px-4 py-2.5">
          <AlertTriangle size={15} className="text-amber-400/80 shrink-0 mt-0.5" />
          <p className="text-[12px] text-amber-200/80 leading-snug">
            Se generó igual, con menos información: {craftWarnings.map(humanizeWarning).join(' · ')}.
          </p>
        </div>
      )}

      {/* Banner de reintento (502) */}
      {retry && (
        <div className="flex items-start gap-3 bg-amber-500/[0.07] border border-amber-500/30 rounded-xl px-4 py-3.5">
          <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-amber-200 leading-snug">
              {loopError || 'Fallo temporal del generador.'} Tu juicio no se perdió.
            </p>
            <button
              onClick={onRetry}
              disabled={busy}
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-400 text-black hover:bg-amber-300 disabled:opacity-50 transition-colors"
            >
              {busy ? <Spinner size={13} /> : <RotateCcw size={13} />} Reintentar
            </button>
          </div>
        </div>
      )}

      {/* Error no reintentable */}
      {loopError && !retry && (
        <div className="flex items-start gap-2.5 bg-rose-500/[0.07] border border-rose-500/25 rounded-xl px-4 py-3.5">
          <AlertTriangle size={18} className="text-rose-400 shrink-0 mt-0.5" />
          <p className="text-sm text-rose-300 leading-snug">{loopError}</p>
        </div>
      )}

      {/* Cargando el turno (sin pieza aún) */}
      {!turn && busy && !retry && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-600">
          <Spinner size={22} />
          <p className="text-sm">Generando el texto…</p>
        </div>
      )}

      {/* E5c · Aviso suave "¿cerrás o seguís?" + cierre explícito. Informativo, NO bloquea:
          el operador puede seguir votando SÍ/NO tranquilamente. El botón es la única vía
          que cierra la sesión (el umbral ya no auto-cierra). */}
      {canConverge && !retry && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-emerald-500/[0.07] border border-emerald-500/30 rounded-2xl px-5 py-4 space-y-3"
        >
          <div className="flex items-start gap-2.5">
            <CheckCircle2 size={18} className="text-emerald-400 shrink-0 mt-0.5" />
            <p className="text-sm text-emerald-100/90 leading-snug">
              Ya podés cerrar la voz cuando quieras. ¿Cerramos, o seguís puliendo unos textos más?
              <span className="block text-[12px] text-emerald-300/60 mt-0.5">
                Seguir es simplemente juzgar otro turno abajo. Cerrar es una decisión tuya.
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onConverge}
            disabled={busy}
            className={cn(
              'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold font-body border-2 transition-all',
              busy
                ? 'border-emerald-500/30 text-emerald-500/50 cursor-not-allowed'
                : 'border-emerald-500 text-emerald-300 hover:bg-emerald-500 hover:text-black shadow-md shadow-emerald-500/20'
            )}
          >
            {busy ? <><Spinner size={15} /> Cerrando…</> : <><CheckCircle2 size={16} /> Cerrar y calibrar voz</>}
          </button>
        </motion.div>
      )}

      {/* Tarjeta del turno */}
      {turn && (
        <AnimatePresence mode="wait">
          <motion.div
            key={turn.turn_number}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-5"
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-accent/70">Turno {turn.turn_number}</span>
              <span className="text-[10px] font-mono text-zinc-600">— ¿suena a la marca?</span>
            </div>

            <p className="text-[15px] text-white leading-relaxed whitespace-pre-wrap">{turn.proposed_text}</p>

            {/* Veredicto */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPendingVerdict('si')}
                disabled={busy}
                className={cn(
                  'flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold font-body border transition-all',
                  pendingVerdict === 'si'
                    ? 'bg-emerald-500 text-black border-emerald-500 shadow-md shadow-emerald-500/20'
                    : 'bg-transparent text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/10'
                )}
              >
                <CheckCircle2 size={15} /> SÍ, suena a la marca
              </button>
              <button
                type="button"
                onClick={() => setPendingVerdict('no')}
                disabled={busy}
                className={cn(
                  'flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold font-body border transition-all',
                  pendingVerdict === 'no'
                    ? 'bg-rose-500 text-black border-rose-500 shadow-md shadow-rose-500/20'
                    : 'bg-transparent text-rose-400 border-rose-500/40 hover:bg-rose-500/10'
                )}
              >
                <X size={15} /> NO, no suena
              </button>
            </div>

            {/* Notas */}
            <label className="block">
              <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                ¿Por qué? {pendingVerdict === 'no' && <span className="text-amber-400/80 ml-1 normal-case tracking-normal font-body">— muy útil en los NO</span>}
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder={notesPlaceholder}
                className="mt-1.5 w-full bg-[#050508] border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-zinc-700 outline-none focus:border-accent/60 transition-colors resize-none leading-relaxed"
              />
            </label>

            <button
              type="button"
              onClick={onSend}
              disabled={busy || !pendingVerdict}
              className={cn(
                'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold font-body transition-all',
                busy || !pendingVerdict
                  ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                  : 'bg-accent text-black hover:bg-accent/90 shadow-md shadow-accent/20'
              )}
            >
              {busy ? <><Spinner size={15} /> Enviando…</> : 'Enviar veredicto →'}
            </button>
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}

// ── Convergencia ────────────────────────────────────────────────────────────────
function ConvergedView({ data, onBack }: { data: { message: string; total_turns: number }; onBack: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-zinc-900 border border-emerald-500/30 rounded-2xl p-8 space-y-5 text-center"
    >
      <div className="flex flex-col items-center gap-3">
        <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
          <CheckCircle2 size={28} className="text-emerald-400" />
        </div>
        <h3 className="font-display text-xl font-bold text-white">Voz calibrada ✓</h3>
      </div>

      <p className="text-sm text-zinc-300 leading-relaxed">{data.message}</p>
      <p className="text-[11px] font-mono text-zinc-600">{data.total_turns} turnos en total</p>

      <div className="bg-[#050508] border border-zinc-800 rounded-xl px-4 py-3.5 text-left">
        <p className="text-[13px] text-zinc-400 leading-relaxed">
          La voz convergió. El siguiente paso —destilar el genoma y activarlo— lo hace Sam en el chat.
          <span className="text-zinc-500"> No se activa desde aquí.</span>
        </p>
      </div>

      <button
        type="button"
        onClick={onBack}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold font-body border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
      >
        <ArrowLeft size={15} /> Volver al selector
      </button>
    </motion.div>
  );
}
