import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Clapperboard, Film, CheckCircle2, AlertTriangle, Store, MessageSquareQuote,
  Link2, Tag, Sparkles, RefreshCw,
} from 'lucide-react';
import { cn, Spinner } from '../../ui/components';
import { listOptions, IidError, type IidSession, type ListOptions } from '../../services/iidInbound';
import { submitExpertCapture, type ExpertCaptureResult } from '../../services/iidExpert';
import { HonestBanner } from './seedUi';

/* ════════════════════════════════════════════════════════════════════════════
 * PARÁMETROS DE EXTRACCIÓN — tunear acá tras la prueba real en el navegador
 * de Marisol. Son el único punto de ajuste del payload vs. legibilidad del OCR.
 * ════════════════════════════════════════════════════════════════════════════ */
const MAX_FRAMES = 15;       // tope de frames por envío (no reventar el body de la EF)
const TARGET_WIDTH = 720;    // ancho al redibujar (alto se calcula por aspect ratio)
const JPEG_QUALITY = 0.8;    // calidad JPEG del canvas (0–1)
const SEEK_TIMEOUT_MS = 8000; // safety: si un seek nunca dispara 'seeked', abortamos

/* ════════════════════════════════════════════════════════════════════════════
 * EXTRACCIÓN DE FRAMES — canvas nativo, CERO dependencias externas.
 * Carga el video en un <video> oculto, busca N timestamps equiespaciados,
 * dibuja cada frame en un <canvas> redimensionado y exporta JPEG base64.
 * ════════════════════════════════════════════════════════════════════════════ */

interface ExtractionOutput {
  frames: string[];   // data URLs JPEG
  duration: number;   // segundos
  width: number;      // ancho de salida (canvas)
  height: number;     // alto de salida (canvas)
}

/** Espera un evento del <video>; rechaza ante 'error' (códec no soportado) o timeout. */
function waitFor(
  video: HTMLVideoElement,
  event: 'loadedmetadata' | 'seeked',
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const cleanup = () => {
      video.removeEventListener(event, onOk);
      video.removeEventListener('error', onErr);
      clearTimeout(timer);
    };
    const onOk = () => { if (done) return; done = true; cleanup(); resolve(); };
    const onErr = () => { if (done) return; done = true; cleanup(); reject(new Error('decode')); };
    const timer = setTimeout(() => { if (done) return; done = true; cleanup(); reject(new Error('timeout')); }, timeoutMs);
    video.addEventListener(event, onOk);
    video.addEventListener('error', onErr);
  });
}

/**
 * Extrae hasta MAX_FRAMES del video. Lanza Error con código legible en .message:
 *   'decode'   → el navegador no pudo decodificar (códec/formato no soportado)
 *   'timeout'  → un seek se colgó
 *   'empty'    → duración/dimensiones inválidas
 */
async function extractFrames(
  file: File,
  onProgress?: (n: number, total: number) => void,
): Promise<ExtractionOutput> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.src = url;

  try {
    await waitFor(video, 'loadedmetadata', SEEK_TIMEOUT_MS);

    const duration = video.duration;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!isFinite(duration) || duration <= 0 || !vw || !vh) {
      throw new Error('empty');
    }

    // Lienzo de salida redimensionado (mantiene aspect ratio).
    const scale = Math.min(1, TARGET_WIDTH / vw);
    const w = Math.round(vw * scale);
    const h = Math.round(vh * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('decode');

    // Timestamps equiespaciados, tomados en el centro de cada segmento.
    const total = Math.max(1, Math.min(MAX_FRAMES, Math.ceil(duration)));
    const frames: string[] = [];
    for (let i = 0; i < total; i++) {
      const t = (duration * (i + 0.5)) / total;
      // Evita pedir exactamente el final (algunos navegadores no disparan 'seeked').
      video.currentTime = Math.min(t, Math.max(0, duration - 0.05));
      await waitFor(video, 'seeked', SEEK_TIMEOUT_MS);
      ctx.drawImage(video, 0, 0, w, h);
      frames.push(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      onProgress?.(i + 1, total);
    }

    return { frames, duration, width: w, height: h };
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute('src');
    video.load();
  }
}

/** Tamaño aproximado del payload de frames en KB (para tunear MAX_FRAMES/calidad). */
function approxPayloadKB(frames: string[]): number {
  const chars = frames.reduce((acc, f) => acc + f.length, 0);
  return Math.round(chars / 1024);
}

/* ════════════════════════════════════════════════════════════════════════════
 * COMPONENTE
 * ════════════════════════════════════════════════════════════════════════════ */

type Phase = 'idle' | 'extracting' | 'ready' | 'sending';

const EXTRACT_ERRORS: Record<string, string> = {
  decode: 'Este formato de video no se pudo leer en tu navegador. Probá con otro clip (MP4/H.264 suele funcionar) o convertilo antes.',
  timeout: 'La lectura del video tardó demasiado y se canceló. Probá con un clip más corto o liviano.',
  empty: 'No se pudo leer la duración del video (archivo dañado o formato no soportado).',
};

/**
 * ExpertCapture — extracción de frames en el navegador + envío a iid-expert-ocr.
 *
 * MÓDULO AISLADO (E3-FRONT). La envoltura de UI Expert completa (renombrar
 * Capturar→Basic, gating, etc.) es E5 — acá solo se prueba que la extracción
 * canvas + el envío funcionen end-to-end en el navegador real de Marisol.
 *
 * Reusa el `session_token` de la sesión IID existente (mismo patrón que Basic).
 */
export default function ExpertCapture({ session }: { session: IidSession }) {
  const fileRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [fileName, setFileName] = useState<string | null>(null);
  const [frames, setFrames] = useState<string[]>([]);
  const [meta, setMeta] = useState<{ duration: number; width: number; height: number } | null>(null);
  const [progress, setProgress] = useState<{ n: number; total: number } | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);

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

  const resetExtraction = () => {
    setFrames([]);
    setMeta(null);
    setProgress(null);
    setExtractError(null);
    setResult(null);
    setSubmitError(null);
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    resetExtraction();
    setFileName(file.name);
    setPhase('extracting');
    setProgress({ n: 0, total: MAX_FRAMES });
    try {
      const out = await extractFrames(file, (n, total) => setProgress({ n, total }));
      setFrames(out.frames);
      setMeta({ duration: out.duration, width: out.width, height: out.height });
      setPhase('ready');
    } catch (err) {
      const code = err instanceof Error ? err.message : 'decode';
      setExtractError(EXTRACT_ERRORS[code] ?? EXTRACT_ERRORS.decode);
      setPhase('idle');
    } finally {
      setProgress(null);
      // Permite re-elegir el mismo archivo (onChange no dispara si el value no cambia).
      if (fileRef.current) fileRef.current.value = '';
    }
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
      const r = await submitExpertCapture(session.session_token, {
        frames,
        applies_to_brands: selectedBrands,
        creator_handle: creatorHandle.trim() || null,
        source_refs: sourceRefs.trim() ? [sourceRefs.trim()] : null,
        tags: tags.trim() ? tags.split(',').map((t) => t.trim()).filter(Boolean) : null,
        captions: captions.trim() || null,
      });
      setResult(r);
      setPhase('ready');
    } catch (err) {
      let msg = err instanceof IidError ? err.message : 'No se pudo enviar la captura.';
      // Caso esperado a tunear: payload demasiado grande para el body de la EF.
      if (err instanceof IidError && (err.status === 413 || /too large|payload|body/i.test(err.message))) {
        msg = `El envío es demasiado grande (${approxPayloadKB(frames)} KB). Bajá MAX_FRAMES o JPEG_QUALITY en ExpertCapture.tsx y reintentá.`;
      }
      setSubmitError(msg);
      setPhase('ready');
    }
  };

  const payloadKB = frames.length ? approxPayloadKB(frames) : 0;

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 pb-24 space-y-8">
      {/* Header */}
      <div>
        <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-600 mb-2">Sembrador IID · Expert</p>
        <h2 className="font-display text-2xl font-bold text-white flex items-center gap-2">
          <Clapperboard size={22} className="text-accent" /> Capturar técnica (video)
        </h2>
        <p className="text-sm text-zinc-500 mt-1">
          Subí un clip ya descargado. Tu navegador extrae fotogramas y los manda al lector de texto en pantalla —
          el video nunca sale de tu equipo entero, solo los fotogramas.
        </p>
      </div>

      <HonestBanner />

      {/* 1 · Input de video + extracción */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-5">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
            Video <span className="text-accent ml-1">*</span>
          </span>
          <span className="block text-[10px] text-zinc-600 mt-0.5 mb-2 font-body normal-case tracking-normal">
            Se extraen hasta {MAX_FRAMES} fotogramas a {TARGET_WIDTH}px de ancho. El video no se sube — solo los fotogramas.
          </span>

          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            onChange={onPickFile}
            disabled={phase === 'extracting' || phase === 'sending'}
            className="hidden"
            id="expert-video-input"
          />
          <label
            htmlFor="expert-video-input"
            className={cn(
              'flex items-center justify-center gap-2 w-full py-3 rounded-xl border border-dashed text-sm font-body cursor-pointer transition-colors',
              phase === 'extracting' || phase === 'sending'
                ? 'border-zinc-800 text-zinc-600 cursor-not-allowed'
                : 'border-zinc-700 text-zinc-300 hover:border-accent/60 hover:text-accent'
            )}
          >
            <Film size={15} />
            {fileName ? <span className="font-mono text-xs truncate max-w-[60%]">{fileName}</span> : 'Elegir clip de video'}
          </label>
        </div>

        {/* Estado de extracción */}
        {phase === 'extracting' && (
          <div className="flex items-center gap-3 text-sm text-zinc-400">
            <Spinner size={16} />
            Extrayendo fotogramas{progress ? ` (${progress.n}/${progress.total})` : ''}…
          </div>
        )}

        {extractError && (
          <div className="flex items-start gap-2.5 bg-rose-500/[0.07] border border-rose-500/25 rounded-xl px-4 py-3.5">
            <AlertTriangle size={18} className="text-rose-400 shrink-0 mt-0.5" />
            <p className="text-sm text-rose-300 leading-snug">{extractError}</p>
          </div>
        )}

        {/* 4 · Preview de frames */}
        {phase !== 'extracting' && frames.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                {frames.length} fotograma{frames.length !== 1 ? 's' : ''}
                {meta && <span className="text-zinc-600"> · {meta.duration.toFixed(1)}s · {meta.width}×{meta.height} · ~{payloadKB} KB</span>}
              </p>
              <button
                onClick={() => fileRef.current?.click()}
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
              ? <><Spinner size={15} /> Enviando {frames.length} fotogramas…</>
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
