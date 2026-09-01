import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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

/** Tag completo normalizado: 'es_ES' → 'es-es'. Para comparar locales, no sólo prefijos. */
function langTag(tag: string | null | undefined): string {
  return (tag ?? '').trim().toLowerCase().replace('_', '-');
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

// ── La voz elegida se recuerda, POR IDIOMA, mientras dure la sesión ──────────────

/**
 * EL DEFECTO QUE CIERRA: el lector reelegía voz en CADA tarjeta, así que el operador que
 * recorre veinte piezas de la misma marca tenía que volver a elegir veinte veces.
 *
 * Se recuerda POR IDIOMA y no una sola voz global, y esa es la decisión que hace que las dos
 * cosas convivan: mantener la elección entre tarjetas, y que una pieza en otro idioma NO herede
 * la voz del anterior. Una voz global obligaría a elegir entre las dos.
 *
 * Vive en `sessionStorage` —dura lo que dura la sesión del navegador, que es exactamente lo
 * pedido— con una copia en memoria y suscripción, para que todas las tarjetas montadas reflejen
 * el cambio en el momento. Nunca sale del navegador del operador.
 */
const VOICE_MEMORY_KEY = 'unrlvl.speechReader.voiceByLang';

let voiceByLang: Record<string, string> = readVoiceMemory();
const voiceMemoryListeners = new Set<() => void>();

function readVoiceMemory(): Record<string, string> {
  // Cualquier acceso puede lanzar (modo privado, almacenamiento bloqueado). Nunca rompe: la
  // ausencia de recuerdo es un estado válido, no un fallo.
  try {
    const raw = window.sessionStorage.getItem(VOICE_MEMORY_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function rememberVoice(lang: string, voiceUri: string) {
  if (!lang || !voiceUri) return;
  voiceByLang = { ...voiceByLang, [lang]: voiceUri };
  try { window.sessionStorage.setItem(VOICE_MEMORY_KEY, JSON.stringify(voiceByLang)); } catch { /* sin recuerdo */ }
  for (const notify of voiceMemoryListeners) notify();
}

function subscribeVoiceMemory(notify: () => void): () => void {
  voiceMemoryListeners.add(notify);
  return () => { voiceMemoryListeners.delete(notify); };
}

/** El recuerdo vivo. Todas las tarjetas montadas leen el mismo. */
function useVoiceMemory(): Record<string, string> {
  return useSyncExternalStore(subscribeVoiceMemory, () => voiceByLang, () => voiceByLang);
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
  /** Qué sugerencia se aplicó ya. Si cambia la sugerencia se vuelve a resolver; si no cambia,
   *  manda el operador y ni las voces que llegan tarde le pisan la elección. */
  const appliedFor = useRef<string | null>(null);
  const remembered = useVoiceMemory();

  const title = (piece.title ?? '').trim();
  const body = (piece.body ?? '').trim();
  /** Título y cuerpo, en ese orden. El salto de línea es lo que la síntesis lee como pausa. */
  const fullText = [title, body].filter(Boolean).join('\n');

  /**
   * PRESELECCIÓN, en este orden y por este motivo:
   *
   *   1. la voz que el operador ya eligió PARA ESE IDIOMA en esta sesión — no se le vuelve a
   *      preguntar tarjeta tras tarjeta, que es el defecto que esto cierra;
   *   2. una voz del locale exacto (`es-ES` antes que un `es` cualquiera), si la sugerencia
   *      trae la forma completa;
   *   3. la primera voz del idioma sugerido;
   *   4. la voz `default` del sistema, cuando no hay sugerencia o el idioma no tiene voces
   *      instaladas — degradar a lo que había antes, nunca inventar.
   *
   * Se rehace SÓLO cuando cambia la sugerencia. Mientras no cambie, manda el operador: ni las
   * voces que Chrome entrega tarde le pisan la elección.
   */
  useEffect(() => {
    if (!voices.length) return;
    const suggestion = langTag(suggestedLang);
    if (appliedFor.current === suggestion) return;
    appliedFor.current = suggestion;

    const wanted = langPrefix(suggestedLang);
    const matching = wanted ? voices.filter((v) => langPrefix(v.lang) === wanted) : [];

    const rememberedUri = wanted ? remembered[wanted] : undefined;
    const chosen =
      matching.find((v) => v.voiceURI === rememberedUri)
      ?? (suggestion.includes('-') ? matching.find((v) => langTag(v.lang) === suggestion) : undefined)
      ?? matching[0]
      ?? voices.find((v) => v.default)
      ?? voices[0];

    if (!chosen) return;
    setLang(langPrefix(chosen.lang));
    setVoiceUri(chosen.voiceURI);
  }, [voices, suggestedLang, remembered]);

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

  /** Elegir a mano —voz o idioma— es una decisión del operador, y se recuerda. */
  const onVoiceChange = (uri: string) => {
    setVoiceUri(uri);
    rememberVoice(lang, uri);
  };

  const onLangChange = (next: string) => {
    setLang(next);
    // Si ya eligió voz para ese idioma en esta sesión, se le devuelve la suya.
    const rememberedUri = remembered[next];
    const pool = voices.filter((v) => langPrefix(v.lang) === next);
    const chosen = pool.find((v) => v.voiceURI === rememberedUri) ?? pool[0];
    setVoiceUri(chosen?.voiceURI ?? '');
    if (chosen) rememberVoice(next, chosen.voiceURI);
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
              onChange={(e) => onVoiceChange(e.target.value)}
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
