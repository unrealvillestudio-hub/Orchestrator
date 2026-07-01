import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sprout, Dna, UploadCloud, CheckCircle2, AlertTriangle, Store, RefreshCw, Inbox, ArrowRight,
} from 'lucide-react';
import { cn, Spinner } from '../../ui/components';
import {
  list, listOptions, IidError,
  type IidSession, type Seed, type SeedStatus, type ListOptions,
} from '../../services/iidInbound';
import {
  submitExpertCapture, captureSeed, signUpload, uploadToSignedUrl, extractFrames,
} from '../../services/iidExpert';
import { StatusBadge, fmtDate, HonestBanner } from './seedUi';

/* ════════════════════════════════════════════════════════════════════════════
 * IidSeedsUnified — pestaña única "IID Seeds" · Sprint #47 · E5a
 *
 * Colapsa el toggle temporal Basic / "Expert (prueba)" en UN solo flujo de captura:
 *   Post (drag&drop imagen O video) → OCR obligatorio → bifurcador de destino.
 *
 * Maquinaria de subida+extracción REUSADA de ExpertCapture (E3b-2, server-side):
 *   sign-upload → PUT → extract-frames → frames. Mismo pipeline imagen y video.
 *
 * Dos destinos, misma captura+OCR, bifurcan al final:
 *   · "Calibrar Genoma" → iid-expert-ocr (persist:true) → captured_techniques.
 *   · "Guardar como Seed" → OCR (persist:false) + iid-inbound capture → iid_seeds.
 *
 * Anti-IP: el OCR es insumo de aprendizaje, nunca se republica. Eliminados del front:
 * link de referencia, cuenta/handle, tags, caption, criterio-opcional separado.
 * ════════════════════════════════════════════════════════════════════════════ */

type Phase = 'idle' | 'uploading' | 'extracting' | 'ready';
type Dest = 'seed' | 'genoma';

// Estados que componen la vista "mis semillas" (read-only, best-effort).
const MINE_STATUSES: SeedStatus[] = ['awaiting_approval', 'dispatched', 'rejected', 'failed', 'approved', 'captured'];

interface Done {
  dest: Dest;
  topic?: string | null; // neutral_topic (solo Seed)
}

export default function IidSeedsUnified({ session }: { session: IidSession }) {
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Post + extracción ────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>('idle');
  const [isDragOver, setIsDragOver] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [frames, setFrames] = useState<string[]>([]);
  const [postPath, setPostPath] = useState<string | null>(null); // path en bucket (rastro de origen)
  const [meta, setMeta] = useState<{ duration: number | null; frameCount: number } | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);

  // ── Intención + marca + por qué importa ──────────────────────────────────────
  const [tema, setTema] = useState(false);
  const [metodo, setMetodo] = useState(false);
  const [brands, setBrands] = useState<ListOptions['brands']>([]);
  const [selectedBrand, setSelectedBrand] = useState('');
  const [whyMatters, setWhyMatters] = useState('');

  // ── Envío / resultado ─────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState<Dest | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  // ── Mis semillas (read-only) ────────────────────────────────────────────────
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [loadingSeeds, setLoadingSeeds] = useState(true);

  // Marcas del scope (la EF list_options ya filtra por brand_scope) — igual que Basic.
  useEffect(() => {
    listOptions(session.session_token)
      .then((o) => setBrands(o.brands ?? []))
      .catch(() => setBrands([]));
  }, [session.session_token]);

  const loadMine = async () => {
    setLoadingSeeds(true);
    try {
      const batches = await Promise.all(MINE_STATUSES.map((s) => list(session.session_token, s)));
      const merged = batches.flat();
      merged.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      setSeeds(merged);
    } catch {
      setSeeds([]);
    } finally {
      setLoadingSeeds(false);
    }
  };
  useEffect(() => { loadMine(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = phase === 'uploading' || phase === 'extracting' || submitting !== null;

  const resetFlow = () => {
    setFrames([]);
    setPostPath(null);
    setMeta(null);
    setUploadPct(0);
    setFlowError(null);
    setSubmitError(null);
    setDone(null);
  };

  /**
   * Bifurca por tipo de archivo (E5a-fix):
   *   · IMAGEN → ya ES el frame. Se lee en el navegador como data URL base64 y va
   *     directo al OCR. Sin sign-upload ni extract-frames: ffmpeg falla con una
   *     imagen fija (sin pista de video → 0 frames → 500 en /api/extract-frames).
   *   · VIDEO  → flujo server-side intacto: sign-upload → PUT → extract-frames → frames.
   * Ambos convergen en `frames: string[]` (1 para imagen, ~15 para video) → OCR.
   */
  const handleFile = async (file: File) => {
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) {
      resetFlow();
      setFileName(null);
      setFlowError('Eso no parece un post. Arrastrá o elegí una imagen o un video.');
      setPhase('idle');
      return;
    }
    resetFlow();
    setFileName(file.name);

    // ── IMAGEN: la imagen es su propio frame. Sin subida al bucket ni ffmpeg.
    if (isImage) {
      try {
        const dataUrl = await readFileAsDataURL(file);
        setFrames([dataUrl]);       // frame único: el OCR (stripDataUrl) acepta data:image/…;base64
        setPostPath(null);          // no toca el bucket → source_url será 'ocr-capture'
        setMeta({ duration: null, frameCount: 1 });
        setPhase('ready');
      } catch {
        setFlowError('No se pudo leer la imagen. Reintentá.');
        setPhase('idle');
      } finally {
        if (fileRef.current) fileRef.current.value = '';
      }
      return;
    }

    // ── VIDEO: flujo server-side (sign-upload → PUT → extract-frames) — sin cambios.
    setPhase('uploading');
    setUploadPct(0);
    try {
      // 1 · Firmar la URL de subida (service_role server-side).
      const signed = await signUpload(session.session_token, file.name);
      // 2 · PUT del post crudo a la URL firmada (con progreso).
      await uploadToSignedUrl(signed.upload_url, file, (pct) => setUploadPct(pct));
      // 3 · Extraer frames server-side (ffmpeg) — borra el archivo del bucket al terminar.
      setPhase('extracting');
      const ext = await extractFrames(session.session_token, signed.path);
      setFrames(ext.frames);
      setPostPath(signed.path);
      setMeta({ duration: ext.duration_sec, frameCount: ext.frame_count });
      setPhase('ready');
    } catch (err) {
      const msg = err instanceof IidError ? err.message : 'No se pudo procesar el post. Reintentá.';
      setFlowError(msg);
      setPhase('idle');
    } finally {
      // Permite re-elegir el mismo archivo (onChange no dispara si el value no cambia).
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  };
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (busy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!busy) setIsDragOver(true);
  };
  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const captureIntent = (): string[] => {
    const out: string[] = [];
    if (tema) out.push('tema');
    if (metodo) out.push('metodo');
    return out;
  };

  // Habilitación de los botones de destino (contrato E5a):
  // post capturado + OCR listo + al menos un checkbox + marca + por qué importa.
  const ready =
    phase === 'ready' &&
    frames.length > 0 &&
    (tema || metodo) &&
    !!selectedBrand &&
    whyMatters.trim().length > 0 &&
    submitting === null;

  const submit = async (dest: Dest) => {
    if (!ready) return;
    setSubmitting(dest);
    setSubmitError(null);
    setDone(null);
    try {
      if (dest === 'genoma') {
        // Genoma: OCR persiste en captured_techniques. capture_intent + why_matters
        // viajan estructurados dentro de source_refs (jsonb libre que la EF persiste tal cual).
        await submitExpertCapture(session.session_token, {
          frames,
          applies_to_brands: [selectedBrand],
          source_refs: [{ capture_intent: captureIntent(), why_matters: whyMatters.trim() }],
          persist: true,
        });
        setDone({ dest: 'genoma' });
      } else {
        // Seed: OCR sin persistir → destilar en iid-inbound.
        const r = await captureSeed(session.session_token, {
          frames,
          applies_to_brands: [selectedBrand],
          source_url: postPath ?? 'ocr-capture',
          raw_signal: whyMatters.trim(),
          seeder_brand_suggestion: selectedBrand,
          capture_intent: captureIntent(),
        });
        setDone({ dest: 'seed', topic: r.neutral_topic });
        loadMine();
      }
      // Limpiar la captura tras un envío exitoso (deja listo para el próximo post).
      setFrames([]);
      setPostPath(null);
      setMeta(null);
      setFileName(null);
      setTema(false);
      setMetodo(false);
      setSelectedBrand('');
      setWhyMatters('');
      setPhase('idle');
    } catch (err) {
      let msg = err instanceof IidError ? err.message : 'No se pudo enviar la captura.';
      if (err instanceof IidError && (err.status === 413 || /too large|payload|body/i.test(err.message))) {
        msg = 'El envío es demasiado grande para el lector de texto. Probá con un post más liviano.';
      }
      setSubmitError(msg);
    } finally {
      setSubmitting(null);
    }
  };

  // Texto del indicador de progreso por fase.
  const phaseLabel =
    phase === 'uploading' ? `Subiendo post… ${uploadPct}%`
    : phase === 'extracting' ? 'Extrayendo fotogramas…'
    : submitting === 'genoma' ? 'Leyendo y calibrando…'
    : submitting === 'seed' ? 'Leyendo y destilando…'
    : null;

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 pb-24 space-y-8">
      {/* Header */}
      <div>
        <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-600 mb-2">Sembrador IID</p>
        <h2 className="font-display text-2xl font-bold text-white flex items-center gap-2">
          <Sprout size={22} className="text-accent" /> Capturar de un post
        </h2>
        <p className="text-sm text-zinc-500 mt-1">
          Arrastrá el post (imagen o video): el servidor lo lee por OCR. De ahí sale el tema y el método —
          vos aportás por qué importa. El original nunca se republica.
        </p>
      </div>

      <HonestBanner />

      {/* 1 · Post — drop zone + extracción */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-5">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
            Post <span className="text-accent ml-1">*</span>
          </span>
          <span className="block text-[10px] text-zinc-600 mt-0.5 mb-2 font-body normal-case tracking-normal">
            Imagen o video. Se sube al servidor, se leen los fotogramas por OCR y luego se borra.
          </span>

          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            onChange={onPickFile}
            disabled={busy}
            className="hidden"
            id="iid-post-input"
          />

          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onClick={() => { if (!busy) fileRef.current?.click(); }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !busy) fileRef.current?.click(); }}
            className={cn(
              'flex flex-col items-center justify-center gap-2 w-full py-8 rounded-xl border border-dashed text-sm font-body transition-colors text-center',
              busy
                ? 'border-zinc-800 text-zinc-600 cursor-not-allowed'
                : isDragOver
                  ? 'border-accent bg-accent/[0.06] text-accent cursor-copy'
                  : 'border-zinc-700 text-zinc-300 hover:border-accent/60 hover:text-accent cursor-pointer'
            )}
          >
            <UploadCloud size={22} className={isDragOver ? 'text-accent' : 'text-zinc-500'} />
            {fileName ? (
              <span className="font-mono text-xs truncate max-w-[80%]">{fileName}</span>
            ) : (
              <>
                <span>{isDragOver ? 'Soltá el post acá' : 'Arrastrá el post o hacé click para elegirlo'}</span>
                <span className="text-[10px] text-zinc-600 font-mono">JPG · PNG · MP4 · MOV · imagen o video</span>
              </>
            )}
          </div>
        </div>

        {/* Estado del flujo (uploading / extracting / sending) */}
        {phaseLabel && (
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-sm text-zinc-400">
              <Spinner size={16} />
              {phaseLabel}
            </div>
            {phase === 'uploading' && (
              <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent transition-[width] duration-200"
                  style={{ width: `${uploadPct}%` }}
                />
              </div>
            )}
          </div>
        )}

        {flowError && (
          <div className="flex items-start gap-2.5 bg-rose-500/[0.07] border border-rose-500/25 rounded-xl px-4 py-3.5">
            <AlertTriangle size={18} className="text-rose-400 shrink-0 mt-0.5" />
            <p className="text-sm text-rose-300 leading-snug">{flowError}</p>
          </div>
        )}

        {/* Preview de frames */}
        {!busy && frames.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                {frames.length} fotograma{frames.length !== 1 ? 's' : ''}
                {meta?.duration != null && <span className="text-zinc-600"> · {meta.duration.toFixed(1)}s</span>}
              </p>
              <button
                onClick={() => { if (!busy) fileRef.current?.click(); }}
                className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-600 hover:text-zinc-300 transition-colors"
              >
                <RefreshCw size={11} /> Otro post
              </button>
            </div>
            <p className="text-[11px] text-zinc-600 font-body">
              Confirmá que el texto se lee bien en estas miniaturas antes de capturar.
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {frames.map((f, i) => (
                <img
                  key={i}
                  src={f}
                  alt={`Fotograma ${i + 1}`}
                  className="w-full aspect-square object-cover rounded-lg border border-zinc-800"
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 2–5 · Intención + marca + por qué importa + destino (solo con frames listos) */}
      {frames.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-5">
          {/* 2 · ¿Qué querés capturar? */}
          <Field
            label="¿Qué querés capturar de este post?"
            required
            hint="Al menos uno. Define qué aprende el IID del post."
          >
            <div className="flex flex-wrap gap-2">
              <CheckChip label="Tema" checked={tema} onToggle={() => setTema((v) => !v)} />
              <CheckChip label="Método de comunicación" checked={metodo} onToggle={() => setMetodo((v) => !v)} />
            </div>
          </Field>

          {/* 3 · ¿Para qué marca lo ves? */}
          <Field
            label="¿Para qué marca lo ves?"
            required
            hint="Tu scope de marcas. La EF re-valida (marca fuera de alcance → rechazada)."
          >
            <div className="relative">
              <Store size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
              <select
                value={selectedBrand}
                onChange={(e) => setSelectedBrand(e.target.value)}
                className={cn(
                  'w-full bg-[#050508] border rounded-xl pl-9 pr-3 py-2.5 text-sm text-white outline-none focus:border-accent/60 transition-colors',
                  selectedBrand ? 'border-zinc-800' : 'border-amber-500/40'
                )}
              >
                <option value="">— elegí una marca —</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name || b.id}</option>)}
              </select>
            </div>
          </Field>

          {/* 4 · ¿Por qué importa? */}
          <Field label="¿Por qué importa?" required hint="Tu visión — lo que viste y por qué te llamó la atención.">
            <textarea
              value={whyMatters}
              onChange={(e) => setWhyMatters(e.target.value)}
              rows={3}
              placeholder="Lo que viste y por qué te llamó la atención…"
              className="w-full bg-[#050508] border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-zinc-700 outline-none focus:border-accent/60 transition-colors resize-none leading-relaxed"
            />
          </Field>

          {submitError && <p className="text-xs text-rose-400 font-mono leading-snug">{submitError}</p>}

          {/* 5 · Destino */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <button
              type="button"
              onClick={() => submit('seed')}
              disabled={!ready}
              className={cn(
                'flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold font-body transition-all',
                !ready
                  ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                  : 'bg-accent text-black hover:bg-accent/90 shadow-md shadow-accent/20'
              )}
            >
              {submitting === 'seed' ? <><Spinner size={15} /> Destilando…</> : <><Sprout size={15} /> Guardar como Seed</>}
            </button>
            <button
              type="button"
              onClick={() => submit('genoma')}
              disabled={!ready}
              className={cn(
                'flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold font-body transition-all border',
                !ready
                  ? 'bg-zinc-800 text-zinc-600 border-zinc-800 cursor-not-allowed'
                  : 'bg-transparent text-accent border-accent/60 hover:bg-accent/10'
              )}
            >
              {submitting === 'genoma' ? <><Spinner size={15} /> Calibrando…</> : <><Dna size={15} /> Calibrar Genoma</>}
            </button>
          </div>

          {/* 6 · Enlace gold — visible desde ya, inerte en E5a (su salto nace en E5b). */}
          <button
            type="button"
            disabled
            title="Disponible pronto"
            className="w-full flex items-center justify-center gap-1.5 text-[11px] font-body text-amber-300/80 hover:text-amber-300 disabled:cursor-not-allowed transition-colors pt-1"
          >
            ¿No tenés un post de modelo? Entrá directo a calibrar y hablemos <ArrowRight size={13} />
          </button>
        </div>
      )}

      {/* Confirmación */}
      <AnimatePresence>
        {done && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-start gap-3 bg-emerald-500/[0.07] border border-emerald-500/25 rounded-xl px-4 py-3.5"
          >
            <CheckCircle2 size={18} className="text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-sm">
              {done.dest === 'genoma' ? (
                <p className="text-emerald-300 font-medium">Material capturado — en cola para calibrar.</p>
              ) : (
                <>
                  <p className="text-emerald-300 font-medium">Semilla guardada — pendiente de revisión de Sam.</p>
                  {done.topic && <p className="text-emerald-400/70 text-xs mt-0.5 font-mono">Tema detectado: {done.topic}</p>}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mis semillas */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-600">Mis semillas</h3>
          <button
            onClick={loadMine}
            className="p-1.5 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-600 hover:text-zinc-400"
            title="Refrescar"
          >
            <RefreshCw size={13} className={loadingSeeds ? 'animate-spin' : ''} />
          </button>
        </div>

        {loadingSeeds ? (
          <div className="flex items-center justify-center py-12 text-zinc-700">
            <Spinner size={20} />
          </div>
        ) : seeds.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-zinc-700">
            <Inbox size={32} strokeWidth={1} />
            <p className="text-sm">Todavía no guardaste ninguna semilla.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {seeds.map((s) => (
              <div key={s.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm text-white leading-snug min-w-0">
                    {s.neutral_topic || <span className="text-zinc-500 italic">{s.raw_signal}</span>}
                  </p>
                  <StatusBadge status={s.status} />
                </div>
                <div className="flex items-center gap-3 mt-2 text-[10px] font-mono text-zinc-600">
                  <span>{fmtDate(s.created_at)}</span>
                  {s.mapped_domain && <span className="text-zinc-500">· {s.mapped_domain}</span>}
                </div>
                {s.status === 'rejected' && s.rejected_reason && (
                  <p className="text-[11px] text-zinc-500 mt-2 leading-snug">
                    <span className="text-zinc-600">Motivo:</span> {s.rejected_reason}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Lectura de imagen → data URL base64 (para el OCR sin pasar por el bucket) ────
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

// ── CheckChip (checkbox estilo chip) ────────────────────────────────────────────
function CheckChip({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      role="checkbox"
      aria-checked={checked}
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-body border transition-colors',
        checked
          ? 'bg-accent text-black border-accent shadow-sm shadow-accent/20'
          : 'bg-[#050508] text-zinc-400 border-zinc-800 hover:border-zinc-600'
      )}
    >
      <span className={cn(
        'w-3.5 h-3.5 rounded flex items-center justify-center border',
        checked ? 'bg-black/20 border-black/30' : 'border-zinc-600'
      )}>
        {checked && <CheckCircle2 size={11} />}
      </span>
      {label}
    </button>
  );
}

// ── Field helper (mismo estilo que IidSeedsCapture / ExpertCapture) ─────────────
function Field({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
        {label}{required && <span className="text-accent ml-1">*</span>}
      </span>
      {hint && <span className="block text-[10px] text-zinc-600 mt-0.5 mb-1.5 font-body normal-case tracking-normal">{hint}</span>}
      <div className={hint ? '' : 'mt-2'}>{children}</div>
    </label>
  );
}
