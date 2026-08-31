import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, Square, Volume2 } from 'lucide-react';
import { cn } from './components';

/**
 * SpeechReader — lectura en voz alta de una pieza, con la síntesis nativa del navegador.
 *
 * EL COMPONENTE NO SABE DE DÓNDE VIENE EL TEXTO. Recibe `{title, body}` en texto plano y
 * nada más: ni artefacto, ni endpoint, ni bandeja, ni marca. Cada superficie que quiera
 * leer en voz alta aporta su propio adaptador a esa forma. Si el lector conociera el
 * artefacto HTML, toda superficie que trae el texto de otra manera tendría que fabricar
 * HTML para poder usarlo, y la que mañana lo traiga de una cuarta forma obligaría a editar
 * este archivo.
 *
 * LA SELECCIÓN SE HACE SOBRE EL TEXTO QUE ESTE COMPONENTE RENDERIZA, no dentro de la vista
 * previa de la superficie que lo monta. Motivo medido: las vistas previas de este repo
 * embeben el artefacto en un `<iframe srcdoc sandbox="">`
 * (`ApprovalCalibrationModule.tsx`, `PublishQueueModule.tsx`), y con `sandbox` vacío el
 * documento queda en un origen opaco: el `window.getSelection()` del documento anfitrión no
 * alcanza lo que hay dentro. En vez de resolver esa incógnita se eliminó la dependencia —
 * el lector muestra su propio bloque de texto plano, seleccionable, y la selección ocurre
 * en el DOM normal. Funciona igual en cualquier superficie y no depende de cómo cada una
 * pinte su vista previa.
 *
 * No hay backend, no hay proveedor externo, no hay costo por reproducción: la voz es la del
 * sistema del operador y la elección vive en su navegador.
 */

// ── Contrato ─────────────────────────────────────────────────────────────────────

export interface ReadablePiece {
  title: string | null;
  body: string | null;
}

export interface SpeechReaderProps {
  piece: ReadablePiece;
  /** Idioma sugerido de la pieza, BCP-47 o prefijo ('es', 'en', 'es-ES'). Opcional. */
  suggestedLang?: string | null;
  className?: string;
}

// ── Soporte del navegador ────────────────────────────────────────────────────────

/**
 * Si la síntesis no existe, el componente no se renderiza y no lanza. Se comprueban las
 * DOS piezas: `speechSynthesis` sin `SpeechSynthesisUtterance` no permite hablar.
 */
const SUPPORTED =
  typeof window !== 'undefined' &&
  'speechSynthesis' in window &&
  typeof window.SpeechSynthesisUtterance === 'function';

// ── Idiomas: salen de las voces instaladas, nunca de una lista en el código ──────

/** Prefijo de un tag BCP-47: 'es-ES' → 'es'. Vacío si no hay nada que leer. */
function langPrefix(tag: string | null | undefined): string {
  return (tag ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

/**
 * Nombre legible de un idioma, resuelto por el propio navegador. No hay tabla de idiomas
 * en este archivo a propósito: la lista es la del sistema del operador, y una tabla aquí
 * sería una segunda fuente que envejece.
 */
function languageNamer(): (code: string) => string {
  try {
    const dn = new Intl.DisplayNames(undefined, { type: 'language' });
    return (code) => dn.of(code) ?? code;
  } catch {
    return (code) => code;
  }
}

/**
 * Voces del sistema. La suscripción a `voiceschanged` es obligatoria: en Chrome la primera
 * lectura suele devolver `[]`, y sin ella el selector aparece vacío y parece roto.
 */
function useSystemVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (!SUPPORTED) return undefined;
    const synth = window.speechSynthesis;
    let alive = true;
    const read = () => { if (alive) setVoices(synth.getVoices()); };
    read();
    synth.addEventListener('voiceschanged', read);
    return () => { alive = false; synth.removeEventListener('voiceschanged', read); };
  }, []);

  return voices;
}

// ── Selección ────────────────────────────────────────────────────────────────────

/**
 * Texto seleccionado SÓLO si toda la selección cae dentro de `el`. Una selección que
 * empieza fuera del bloque del lector no es una petición de leer un fragmento de la pieza:
 * es una selección de otra cosa que quedó viva en la página.
 */
function selectionWithin(el: HTMLElement | null): string {
  if (!el || typeof window === 'undefined') return '';
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return '';
  for (let i = 0; i < sel.rangeCount; i++) {
    if (!el.contains(sel.getRangeAt(i).commonAncestorContainer)) return '';
  }
  return sel.toString().trim();
}

// ── Componente ───────────────────────────────────────────────────────────────────

type Playback = 'idle' | 'speaking' | 'paused';

export function SpeechReader({ piece, suggestedLang, className }: SpeechReaderProps) {
  const voices = useSystemVoices();
  const [lang, setLang] = useState('');
  const [voiceUri, setVoiceUri] = useState('');
  const [playback, setPlayback] = useState<Playback>('idle');

  const textRef = useRef<HTMLDivElement | null>(null);
  /** Si la voz que suena la inició ESTE lector. Sin esta marca, una tarjeta hermana que
   *  termina de cargar cortaría la lectura de la tarjeta que el operador está oyendo. */
  const owns = useRef(false);
  const preset = useRef(false);

  const title = (piece.title ?? '').trim();
  const body = (piece.body ?? '').trim();
  /** Título y cuerpo, en ese orden. El salto de línea es lo que la síntesis lee como pausa. */
  const fullText = [title, body].filter(Boolean).join('\n');

  // Preselección: el idioma sugerido si hay al menos una voz que empiece por ese prefijo;
  // si no, la voz `default` del sistema. Ocurre UNA vez: después manda el operador.
  useEffect(() => {
    if (!voices.length || preset.current) return;
    preset.current = true;
    const wanted = langPrefix(suggestedLang);
    const matching = wanted ? voices.filter((v) => langPrefix(v.lang) === wanted) : [];
    const chosen = matching[0] ?? voices.find((v) => v.default) ?? voices[0];
    if (!chosen) return;
    setLang(langPrefix(chosen.lang));
    setVoiceUri(chosen.voiceURI);
  }, [voices, suggestedLang]);

  const languages = useMemo(() => {
    const nameOf = languageNamer();
    const seen = new Map<string, string>();
    for (const v of voices) {
      const code = langPrefix(v.lang);
      if (code && !seen.has(code)) seen.set(code, nameOf(code));
    }
    return [...seen.entries()]
      .map(([code, label]) => ({ code, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [voices]);

  const voicesForLang = useMemo(
    () => voices.filter((v) => langPrefix(v.lang) === lang),
    [voices, lang],
  );

  const stop = useCallback(() => {
    if (!SUPPORTED) return;
    window.speechSynthesis.cancel();
    owns.current = false;
    setPlayback('idle');
  }, []);

  /**
   * Detener al desmontar y al cambiar de pieza — si no, la voz sigue hablando sobre la
   * pieza siguiente. `fullText` en las dependencias es la identidad de lo que se lee: si
   * cambia, lo que suena ya no corresponde a lo que se ve.
   */
  useEffect(() => {
    if (!SUPPORTED) return undefined;
    return () => {
      if (owns.current) { window.speechSynthesis.cancel(); owns.current = false; }
    };
  }, [fullText]);

  /**
   * Defecto conocido de los navegadores basados en Chromium: la síntesis se corta sola
   * alrededor de los 15 s. Un `resume()` periódico mientras suena lo evita; sobre una
   * síntesis que no está pausada es una operación sin efecto. Sin esto, el cuerpo de una
   * pieza larga se cortaría a la mitad, que es justo lo que el lector tiene que poder leer.
   */
  useEffect(() => {
    if (!SUPPORTED || playback !== 'speaking') return undefined;
    const id = window.setInterval(() => {
      const synth = window.speechSynthesis;
      if (synth.speaking && !synth.paused) synth.resume();
    }, 10_000);
    return () => window.clearInterval(id);
  }, [playback]);

  const speak = useCallback(() => {
    if (!SUPPORTED) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const text = selectionWithin(textRef.current) || fullText;
    if (!text) return;

    const utterance = new window.SpeechSynthesisUtterance(text);
    const voice = voices.find((v) => v.voiceURI === voiceUri);
    if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
    const settle = () => { owns.current = false; setPlayback('idle'); };
    utterance.onend = settle;
    utterance.onerror = settle;

    owns.current = true;
    setPlayback('speaking');
    synth.speak(utterance);
  }, [fullText, voiceUri, voices]);

  const togglePause = useCallback(() => {
    if (!SUPPORTED) return;
    const synth = window.speechSynthesis;
    if (playback === 'speaking') { synth.pause(); setPlayback('paused'); }
    else if (playback === 'paused') { synth.resume(); setPlayback('speaking'); }
  }, [playback]);

  const onLangChange = (next: string) => {
    setLang(next);
    const first = voices.find((v) => langPrefix(v.lang) === next);
    setVoiceUri(first?.voiceURI ?? '');
  };

  if (!SUPPORTED) return null;

  const nothingToRead = fullText.length === 0;
  const idle = playback === 'idle';

  return (
    <div className={cn('rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 space-y-2.5', className)}>
      {/* Controles + selectores. Las etiquetas dicen "de lectura" a propósito: en estas
          tarjetas ya se muestra la voz DE MARCA de la pieza, y son dos cosas distintas. */}
      <div className="flex items-center gap-2 flex-wrap">
        <Volume2 size={13} className="text-zinc-600 shrink-0" />

        <button
          type="button"
          onClick={speak}
          disabled={nothingToRead}
          title="Lee la selección si la hay; si no, el título y después el cuerpo"
          className={cn(
            'inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg border transition-colors',
            nothingToRead
              ? 'border-zinc-800 text-zinc-700 cursor-not-allowed'
              : 'border-accent/40 bg-accent/10 text-accent hover:bg-accent/20',
          )}
        >
          <Play size={11} /> Reproducir
        </button>

        <button
          type="button"
          onClick={togglePause}
          disabled={idle}
          className={cn(
            'inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg border transition-colors',
            idle
              ? 'border-zinc-800 text-zinc-700 cursor-not-allowed'
              : 'border-zinc-700 text-zinc-300 hover:border-zinc-600',
          )}
        >
          <Pause size={11} /> {playback === 'paused' ? 'Reanudar' : 'Pausar'}
        </button>

        <button
          type="button"
          onClick={stop}
          disabled={idle}
          className={cn(
            'inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg border transition-colors',
            idle
              ? 'border-zinc-800 text-zinc-700 cursor-not-allowed'
              : 'border-zinc-700 text-zinc-300 hover:border-zinc-600',
          )}
        >
          <Square size={11} /> Detener
        </button>

        <div className="flex items-center gap-2 flex-wrap ml-auto">
          <label className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-600">
            Idioma de lectura
            <select
              value={lang}
              onChange={(e) => onLangChange(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-1.5 py-1 text-[11px] text-zinc-300 max-w-[10rem]"
            >
              {languages.length === 0 && <option value="">sin voces</option>}
              {languages.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-600">
            Voz de lectura
            <select
              value={voiceUri}
              onChange={(e) => setVoiceUri(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-1.5 py-1 text-[11px] text-zinc-300 max-w-[12rem]"
            >
              {voicesForLang.length === 0 && <option value="">sin voces</option>}
              {voicesForLang.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* El texto que se lee, visible y seleccionable. Es el mismo bloque sobre el que
          `window.getSelection()` opera: lo que se ve es lo que se puede oír en parte. */}
      <div
        ref={textRef}
        className="max-h-44 overflow-y-auto rounded-lg bg-black/30 border border-zinc-800/70 px-3 py-2 text-[12px] leading-relaxed text-zinc-300 select-text"
        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      >
        {nothingToRead
          ? <span className="text-zinc-600 italic">Esta pieza no trae texto que leer.</span>
          : fullText}
      </div>

      <p className="text-[10px] font-mono text-zinc-600">
        Sin selección se lee el título y después el cuerpo. Con una selección dentro de este
        bloque se lee sólo esa selección.
      </p>
    </div>
  );
}

export default SpeechReader;
