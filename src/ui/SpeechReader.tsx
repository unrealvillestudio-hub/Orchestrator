import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Play, Pause, Square, Volume2, Settings2 } from 'lucide-react';
import { cn } from './components';
import { splitForSpeech } from './speechChunks';

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
 * 2026-10-01 — SIN BLOQUE DE TEXTO NI LECTURA POR SELECCIÓN, y con VELOCIDAD (decisión de Sam: «el
 * texto que usa el tts no me hace falta verlo mientras lo lea y no uso texto seleccionado, escucho
 * toda la pieza siempre»; pidió 1,5× y 2×). El lector queda en una fila de controles que cabe fuera
 * de «Detalles»; idioma y voz se pliegan tras un botón. Lo de abajo es el diseño anterior.
 *
 * ⛔ NO OPERATIVO — LA SELECCIÓN SE HACE SOBRE EL TEXTO QUE ESTE COMPONENTE RENDERIZA, no dentro de la vista
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
 * Velocidades de lectura. 1× es la del sistema; 1,5× y 2× las pidió Sam el 2026-10-01. La elegida
 * se recuerda en el navegador (sólo comodidad: si el almacenamiento falla, vuelve a 1×).
 */
export const SPEECH_RATES = [1, 1.5, 2] as const;
const RATE_KEY = 'speechReader.rate';
function loadRate(): number {
  try {
    const v = Number(window.localStorage.getItem(RATE_KEY));
    return (SPEECH_RATES as readonly number[]).includes(v) ? v : 1;
  } catch { return 1; }
}
function saveRate(v: number) {
  try { window.localStorage.setItem(RATE_KEY, String(v)); } catch { /* sin almacenamiento: no pasa nada */ }
}

// ── Componente ───────────────────────────────────────────────────────────────────

type Playback = 'idle' | 'speaking' | 'paused';

export function SpeechReader({ piece, suggestedLang, className }: SpeechReaderProps) {
  const voices = useSystemVoices();
  const [lang, setLang] = useState('');
  const [voiceUri, setVoiceUri] = useState('');
  const [playback, setPlayback] = useState<Playback>('idle');
  /** Error de la síntesis, en palabras del navegador. Antes se tragaba y el botón parecía no hacer nada. */
  const [speechError, setSpeechError] = useState<string | null>(null);

  const [rate, setRateState] = useState<number>(() => (typeof window === 'undefined' ? 1 : loadRate()));
  /** La velocidad la lee cada TRAMO al empezar: cambiarla durante la lectura afecta al siguiente. */
  const rateRef = useRef(rate);
  const setRate = (v: number) => { rateRef.current = v; setRateState(v); saveRate(v); };
  const [ajustes, setAjustes] = useState(false);
  /** Si la voz que suena la inició ESTE lector. Sin esta marca, una tarjeta hermana que
   *  termina de cargar cortaría la lectura de la tarjeta que el operador está oyendo. */
  const owns = useRef(false);
  /** Identidad de la lectura en curso. Cada tramo encadena el siguiente sólo si sigue siendo
   *  la misma lectura: detener, volver a reproducir o cambiar de pieza la invalidan. */
  const run = useRef(0);
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
    run.current += 1;
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
      if (owns.current) { run.current += 1; window.speechSynthesis.cancel(); owns.current = false; }
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

  /**
   * Lee por TRAMOS, uno detrás de otro (`speechChunks.ts`). Una sola utterance con un artículo de
   * blog entero se cortaba o no sonaba en Chromium; las piezas sociales, más cortas, no llegaban
   * al límite y por eso el defecto sólo se veía en el blog.
   */
  const speak = useCallback(() => {
    if (!SUPPORTED) return;
    const synth = window.speechSynthesis;
    run.current += 1;
    const id = run.current;
    synth.cancel();
    const chunks = splitForSpeech(fullText);
    if (!chunks.length) return;

    const voice = voices.find((v) => v.voiceURI === voiceUri);
    const settle = () => { if (run.current !== id) return; owns.current = false; setPlayback('idle'); };
    const next = (i: number) => {
      if (run.current !== id) return;
      if (i >= chunks.length) { settle(); return; }
      const utterance = new window.SpeechSynthesisUtterance(chunks[i]);
      if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
      utterance.rate = rateRef.current;
      utterance.onend = () => next(i + 1);
      utterance.onerror = (e: SpeechSynthesisErrorEvent) => {
        if (run.current !== id) return;
        // `interrupted` y `canceled` son el propio Detener o una lectura nueva: no son fallos.
        if (e.error !== 'interrupted' && e.error !== 'canceled') {
          setSpeechError(`La voz se detuvo en el tramo ${i + 1} de ${chunks.length} (${e.error}). Prueba con otra voz de lectura.`);
        }
        settle();
      };
      synth.speak(utterance);
    };

    owns.current = true;
    setSpeechError(null);
    setPlayback('speaking');
    next(0);
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

  const boton = 'inline-flex items-center justify-center gap-1.5 text-[12px] px-3 py-2 md:px-2 md:py-1 rounded-lg border transition-colors';
  return (
    <div className={cn('rounded-xl border border-zinc-800 bg-zinc-900/40 p-2.5 space-y-2', className)}>
      <div className="flex items-center gap-2 flex-wrap">
        <Volume2 size={14} className="text-zinc-600 shrink-0" />

        <button
          type="button"
          onClick={speak}
          disabled={nothingToRead}
          title="Lee la pieza entera: el título y después el cuerpo"
          className={cn(boton, nothingToRead
            ? 'border-zinc-800 text-zinc-700 cursor-not-allowed'
            : 'border-accent/40 bg-accent/10 text-accent hover:bg-accent/20')}
        >
          <Play size={12} /> Reproducir
        </button>

        <button
          type="button"
          onClick={togglePause}
          disabled={idle}
          aria-label={playback === 'paused' ? 'Reanudar' : 'Pausar'}
          className={cn(boton, idle ? 'border-zinc-800 text-zinc-700 cursor-not-allowed' : 'border-zinc-700 text-zinc-300 hover:border-zinc-600')}
        >
          <Pause size={12} /> <span className="hidden sm:inline">{playback === 'paused' ? 'Reanudar' : 'Pausar'}</span>
        </button>

        <button
          type="button"
          onClick={stop}
          disabled={idle}
          aria-label="Detener"
          className={cn(boton, idle ? 'border-zinc-800 text-zinc-700 cursor-not-allowed' : 'border-zinc-700 text-zinc-300 hover:border-zinc-600')}
        >
          <Square size={12} /> <span className="hidden sm:inline">Detener</span>
        </button>

        {/* Velocidad: se aplica desde el próximo tramo si ya está sonando. */}
        <div className="flex items-center rounded-lg border border-zinc-800 overflow-hidden" role="group" aria-label="Velocidad de lectura">
          {SPEECH_RATES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRate(r)}
              aria-pressed={rate === r}
              className={cn('px-2.5 py-2 md:py-1 text-[12px] font-mono transition-colors',
                rate === r ? 'bg-accent/20 text-accent' : 'text-zinc-500 hover:text-zinc-300')}
            >
              {String(r).replace('.', ',')}×
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setAjustes((v) => !v)}
          aria-expanded={ajustes}
          title="Idioma y voz de lectura"
          className={cn(boton, 'ml-auto border-zinc-800 text-zinc-500 hover:text-zinc-300')}
        >
          <Settings2 size={12} />
        </button>
      </div>

      {ajustes && (
        <div className="flex items-center gap-2 flex-wrap">
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
      )}

      {nothingToRead && <p className="text-[11px] text-zinc-600 italic">Esta pieza no trae texto que leer.</p>}
      {speechError && (
        <p className="text-[10px] font-mono text-amber-500">{speechError}</p>
      )}
    </div>
  );
}

export default SpeechReader;
