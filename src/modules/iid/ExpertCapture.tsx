import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Clapperboard, UploadCloud, CheckCircle2, AlertTriangle, Store, MessageSquareQuote,
  Link2, Tag, Sparkles, RefreshCw,
} from 'lucide-react';
import { cn, Spinner } from '../../ui/components';
import { listOptions, IidError, type IidSession, type ListOptions } from '../../services/iidInbound';
import {
  submitExpertCapture, signUpload, uploadToSignedUrl, extractFrames,
  type ExpertCaptureResult,
} from '../../services/iidExpert';
import { HonestBanner } from './seedUi';

/* ════════════════════════════════════════════════════════════════════════════
 * ExpertCapture — captura de técnica (video) · Sprint #47 · E3b-2 (Vía D server-side)
 *
 * CAMBIO vs. E3-FRONT original: la extracción de frames ya NO ocurre en el navegador
 * (canvas falló con HEVC/H.265). Ahora el flujo es server-side de punta a punta:
 *
 *   1. POST /api/sign-upload   → URL firmada (service_role server-side)
 *   2. PUT del video crudo     → directo a esa URL (sin policy anon-insert)
 *   3. POST /api/extract-frames → ffmpeg server-side extrae 15 frames JPEG ~720px
 *   4. preview + envío a iid-expert-ocr (submitExpertCapture — INTACTO)
 *
 * Toda la maquinaria canvas (extractFrames local, waitFor, parámetros MAX_FRAMES/
 * TARGET_WIDTH/JPEG_QUALITY) se jubiló — vive ahora en el servidor. La firma + el
 * PUT + la extracción están en services/iidExpert.ts (tipados con IidError).
 *
 * MOUNT TEMPORAL (Expert prueba) — la envoltura definitiva es E5.
 * ════════════════════════════════════════════════════════════════════════════ */

type Phase = 'idle' | 'uploading' | 'extracting' | 'ready' | 'sending';

export default function ExpertCapture({ session }: { session: IidSession }) {
  const fileRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [isDragOver, setIsDragOver] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [frames, setFrames] = useState<string[]>([]);
  const [meta, setMeta] = useState<{ duration: number | null; frameCount: number } | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);

  // Form
  const [brands, setBrands] = useState<ListOptions['brands']>([]);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [creatorHandle, setCreatorHandle] = useState('');
  const [sourceRefs, setSourceRefs] = useState('');
  const [tags, setTags] = useState('');
  const [captions, setCaptions] = useState('');

  // Envío
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<ExpertCaptureResult | null>(null);

  // Marcas del scope (la EF list_options ya filtra por brand_scope) — igual que Basic.
  useEffect(() => {
    listOptions(session.session_token)
      .then((o) => setBrands(o.brands ?? []))
      .catch(() => setBrands([]));
  }, [session.session_token]);

  const busy = phase === 'uploading' || phase === 'extracting' || phase === 'sending';

  const resetFlow = () => {
    setFrames([]);
    setMeta(null);
    setUploadPct(0);
    setFlowError(null);
    setResult(null);
    setSubmitError(null);
  };

  /** Flujo completo: sign → PUT → extract. */
  const handleFile = async (file: File) => {
    if (!file.type.startsWith('video/')) {
      resetFlow();
      setFileName(null);
      setFlowError('Eso no parece un video. Arrastrá o elegí un archivo de video (MP4, MOV, etc.).');
      setPhase('idle');
      return;
    }
    resetFlow();
    setFileName(file.name);
    setPhase('uploading');
    setUploadPct(0);
    try {
      // 1 · Firmar la URL de subida (service_role server-side).
      const signed = await signUpload(session.session_token, file.name);
      // 2 · PUT del video crudo a la URL firmada (con progreso).
      await uploadToSignedUrl(signed.upload_url, file, (pct) => setUploadPct(pct));
      // 3 · Extraer frames server-side (ffmpeg) — borra el video del bucket al terminar.
      setPhase('extracting');
      const ext = await extractFrames(session.session_token, signed.path);
      setFrames(ext.frames);
      setMeta({ duration: ext.duration_sec, frameCount: ext.frame_count });
      setPhase('ready');
    } catch (err) {
      const msg = err instanceof IidError ? err.message : 'No se pudo procesar el video. Reintentá.';
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

  const toggleBrand = (id: string) => {
    setSelectedBrands((prev) => (prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]));
  };

  const canSend = phase === 'ready' && frames.length > 0 && selectedBrands.length > 0;

  const submit = async () => {
    if (!canSend) return;
    setPhase('sending');
    setSubmitError(null);
    setResult(null);
    try {
      // source_refs es jsonb que la EF persiste tal cual, PERO descarta a [] si no es
      // array. Por eso mantenemos array: link(s) como strings + caption como objeto
      // { caption } dentro del mismo array (no como campo suelto, que la EF ignoraba).
      const refs: Array<string | { caption: string }> = [];
      if (sourceRefs.trim()) refs.push(sourceRefs.trim());
      if (captions.trim()) refs.push({ caption: captions.trim() });

      const r = await submitExpertCapture(session.session_token, {
        frames,
        applies_to_brands: selectedBrands,
        creator_handle: creatorHandle.trim() || null,
        source_refs: refs.length ? refs : null,
        tags: tags.trim() ? tags.split(',').map((t) => t.trim()).filter(Boolean) : null,
      });
      setResult(r);
      setPhase('ready');
    } catch (err) {
      let msg = err instanceof IidError ? err.message : 'No se pudo enviar la captura.';
      if (err instanceof IidError && (err.status === 413 || /too large|payload|body/i.test(err.message))) {
        msg = 'El envío es demasiado grande para el lector de texto. Probá con un clip más corto.';
      }
      setSubmitError(msg);
      setPhase('ready');
    }
  };

  // Texto del indicador de progreso por fase (flujo ~40-60s, que no parezca colgado).
  const phaseLabel =
    phase === 'uploading' ? `Subiendo video… ${uploadPct}%`
    : phase === 'extracting' ? 'Extrayendo fotogramas…'
    : phase === 'sending' ? 'Leyendo texto…'
    : null;

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 pb-24 space-y-8">
      {/* Header */}
      <div>
        <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-600 mb-2">Sembrador IID · Expert</p>
        <h2 className="font-display text-2xl font-bold text-white flex items-center gap-2">
          <Clapperboard size={22} className="text-accent" /> Capturar técnica (video)
        </h2>
        <p className="text-sm text-zinc-500 mt-1">
          Subí un clip ya descargado. El servidor extrae fotogramas y los manda al lector de texto en pantalla —
          el video se borra del servidor apenas se extraen los fotogramas.
        </p>
      </div>

      <HonestBanner />

      {/* 1 · Drop zone + extracción */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-5">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
            Video <span className="text-accent ml-1">*</span>
          </span>
          <span className="block text-[10px] text-zinc-600 mt-0.5 mb-2 font-body normal-case tracking-normal">
            El video se sube al servidor, se extraen ~15 fotogramas y luego se borra. Arrastrá el clip o elegilo.
          </span>

          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            onChange={onPickFile}
            disabled={busy}
            className="hidden"
            id="expert-video-input"
          />

          {/* Zona drag-and-drop (con click → file picker) */}
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
                <span>{isDragOver ? 'Soltá el video acá' : 'Arrastrá el clip o hacé click para elegirlo'}</span>
                <span className="text-[10px] text-zinc-600 font-mono">MP4 · MOV · WEBM · cualquier video</span>
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

        {/* 4 · Preview de frames */}
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
                <RefreshCw size={11} /> Otro clip
              </button>
            </div>
            <p className="text-[11px] text-zinc-600 font-body">
              Confirmá que el texto en pantalla se lee bien en estas miniaturas antes de enviar.
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

      {/* 3 · Form (solo si hay frames listos) */}
      {frames.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-5">
          {/* Marca(s) — multi-select por chips */}
          <Field
            label="¿Para qué marca(s)?"
            required
            hint="La técnica se aplicará a estas marcas. La EF re-valida tu scope (marca fuera de alcance → rechazada)."
          >
            {brands.length === 0 ? (
              <p className="text-xs text-zinc-600 font-mono">Cargando marcas…</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {brands.map((b) => {
                  const on = selectedBrands.includes(b.id);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => toggleBrand(b.id)}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-body border transition-colors',
                        on
                          ? 'bg-accent text-black border-accent shadow-sm shadow-accent/20'
                          : 'bg-[#050508] text-zinc-400 border-zinc-800 hover:border-zinc-600'
                      )}
                    >
                      <Store size={12} /> {b.name || b.id}
                    </button>
                  );
                })}
              </div>
            )}
          </Field>

          <Field label="Cuenta / handle del creador (opcional)">
            <input
              type="text"
              value={creatorHandle}
              onChange={(e) => setCreatorHandle(e.target.value)}
              placeholder="@cuenta"
              className="w-full bg-[#050508] border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-zinc-700 outline-none focus:border-accent/60 transition-colors font-mono"
            />
          </Field>

          <Field
            label="Link de referencia (opcional)"
            hint="Solo rastro de origen — NO se procesa (mismo encuadre anti-IP que Basic)."
          >
            <div className="relative">
              <Link2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
              <input
                type="url"
                value={sourceRefs}
                onChange={(e) => setSourceRefs(e.target.value)}
                placeholder="https://… (solo referencia)"
                className="w-full bg-[#050508] border border-zinc-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-zinc-700 outline-none focus:border-accent/60 transition-colors font-mono"
              />
            </div>
          </Field>

          <Field label="Tags (opcional)" hint="Separados por coma.">
            <div className="relative">
              <Tag size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="hook, transición, oferta"
                className="w-full bg-[#050508] border border-zinc-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-zinc-700 outline-none focus:border-accent/60 transition-colors"
              />
            </div>
          </Field>

          <Field
            label="Caption del post (opcional)"
            hint="Pegá el texto del caption — complementa el OCR de los fotogramas."
          >
            <div className="relative">
              <MessageSquareQuote size={14} className="absolute left-3 top-3 text-zinc-600" />
              <textarea
                value={captions}
                onChange={(e) => setCaptions(e.target.value)}
                rows={3}
                placeholder="Pegá acá el caption del post…"
                className="w-full bg-[#050508] border border-zinc-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-zinc-700 outline-none focus:border-accent/60 transition-colors resize-none leading-relaxed"
              />
            </div>
          </Field>

          {submitError && <p className="text-xs text-rose-400 font-mono leading-snug">{submitError}</p>}

          {/* 5 · Envío */}
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            className={cn(
              'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold font-body transition-all',
              !canSend
                ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                : 'bg-accent text-black hover:bg-accent/90 shadow-md shadow-accent/20'
            )}
          >
            {phase === 'sending'
              ? <><Spinner size={15} /> Leyendo texto…</>
              : <><Sparkles size={15} /> Capturar técnica</>}
          </button>
        </div>
      )}

      {/* Resultado */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-start gap-3 bg-emerald-500/[0.07] border border-emerald-500/25 rounded-xl px-4 py-3.5"
          >
            <CheckCircle2 size={18} className="text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="text-emerald-300 font-medium">Técnica capturada — pendiente de revisión de Sam.</p>
              <p className="text-emerald-400/70 text-xs mt-0.5 font-mono">
                {result.frame_count} fotogramas · {result.chars_extracted} caracteres leídos · id {result.technique_id.slice(0, 8)}…
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Field helper (mismo estilo que IidSeedsCapture) ─────────────────────────────
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
