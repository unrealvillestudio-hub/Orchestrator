/**
 * TextoVisual.tsx — LA AYUDA VISUAL DE LA VENTANA «TEXTO EN PANTALLA» (Sam, 2026-11-17: «la tarjeta de edición de
 * texto no me ayuda visualmente»; boceto aprobado el mismo día).
 *
 * Objetivo: OPERABILIDAD, no conversión. Quien edita ve lo que elige ANTES de elegirlo y ANTES de «Aplicar».
 *   · `ScenePlayer`: dibuja una escena de VideoLab con su propio código (`runtime_url`, contrato §4 ter.6): mismo
 *     código, mismo dibujo que el render. Lo usan la vista grande y las miniaturas de cada estilo.
 *   · `VistaFiel`: el video limpio con la escena encima, sincronizada con `seek(video.currentTime * 1000)`.
 *   · `MarcasDeTexto`: tocar palabras y ponerles resaltado, cursiva, negrita o color (`textoMarcas.ts`).
 *   · `Alineacion`, `Muestras` (color con nombre, hex y aviso de contraste), `PalabrasClave`, `FranjaModo`.
 *
 * Ni una marca, ni un color, ni una URL de VideoLab en este archivo: todo llega del server (dato).
 */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn, Spinner } from '../../ui/components';
import type { EmphasisColorOption } from '../../../api/_overlayText';
import type { SceneResult } from '../../services/calibrationInbox';
import {
  MARK_KINDS, MARK_LABEL, MARK_SYMBOL, contrastOnDark, keywordShare, markupOf, marksByWord, toggleMark, wordRanges,
  type BlockMarks, type MarkKind,
} from './textoMarcas';
import { isDrag, placeAfterDrag, safeOf, visibleAt, type BlockRef, type DragTarget } from './arrastre';
import type { Place } from '../../../api/_onScreenText';

// ── El runtime de VideoLab: se carga una vez por versión ─────────────────────────────────────────

const runtimes = new Map<string, Promise<any>>();
/** Importa el runtime versionado de VideoLab (módulo ES que el navegador guarda sin caducidad). Una versión distinta es otra URL. */
export function loadRuntime(url: string): Promise<any> {
  if (!runtimes.has(url)) runtimes.set(url, import(/* @vite-ignore */ url).catch((e) => { runtimes.delete(url); throw e; }));
  return runtimes.get(url)!;
}

/** La ventana de tiempo donde la escena tiene algo que enseñar: del primer bloque que entra al último que sale. PURO. */
export function sceneWindow(scene: any): { start: number; end: number } {
  const bloques = [...(scene?.blocks ?? []), ...(scene?.captions?.groups ?? [])];
  if (!bloques.length) return { start: 0, end: 3000 };
  const start = Math.min(...bloques.map((b: any) => Number(b.start_ms) || 0));
  const end = Math.max(...bloques.map((b: any) => Number(b.end_ms) || start + 3000));
  return { start, end: Math.max(end, start + 500) };
}

/**
 * El rectángulo que ocupan los bloques de la escena (y la banda de subtítulos), con un margen: lo que una miniatura
 * enseña de cerca. Sin bloques, el lienzo entero. PURO.
 */
export function sceneFocusRect(scene: any, pad = 40): { x: number; y: number; w: number; h: number } {
  const W = Number(scene?.canvas?.width) || 1080; const H = Number(scene?.canvas?.height) || 1920;
  const rects = [...(scene?.blocks ?? []).map((b: any) => b.rect), ...(scene?.captions?.band ? [scene.captions.band] : [])].filter(Boolean);
  if (!rects.length) return { x: 0, y: 0, w: W, h: H };
  const x0 = Math.max(0, Math.min(...rects.map((r: any) => r.x)) - pad), y0 = Math.max(0, Math.min(...rects.map((r: any) => r.y)) - pad);
  const x1 = Math.min(W, Math.max(...rects.map((r: any) => r.x + r.w)) + pad), y1 = Math.min(H, Math.max(...rects.map((r: any) => r.y + r.h)) + pad);
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/**
 * Dibuja una escena a un ancho dado. Con `video`, sigue su `currentTime`; sin él, repite en bucle la ventana de la
 * escena (miniaturas), acotada a `loopMs`. El estado de cada fotograma lo calcula `seek` desde cero: saltar es seguro.
 */
export function ScenePlayer({ scene, runtimeUrl, width, video, loopMs = 3600, paused = false, fit = 'canvas' }: {
  scene: any; runtimeUrl: string; width: number; video?: HTMLVideoElement | null; loopMs?: number; paused?: boolean;
  /** `canvas`: el lienzo entero (vista grande). `blocks`: de cerca, sólo lo que ocupan los bloques (miniaturas). */
  fit?: 'canvas' | 'blocks';
}) {
  const host = useRef<HTMLDivElement>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const W = Number(scene?.canvas?.width) || 1080;
  const H = Number(scene?.canvas?.height) || 1920;
  const foco = fit === 'blocks' ? sceneFocusRect(scene) : { x: 0, y: 0, w: W, h: H };
  const escala = width / foco.w;

  useEffect(() => {
    if (!scene || !runtimeUrl || !host.current) return;
    let vivo = true; let raf = 0; let vl: any = null;
    const root = document.createElement('div');
    host.current.innerHTML = '';
    host.current.appendChild(root);
    const ventana = sceneWindow(scene);
    const t0 = performance.now();
    loadRuntime(runtimeUrl)
      .then(async (rt) => {
        await rt.loadFonts(scene).catch(() => undefined);
        if (!vivo) return;
        vl = rt.mount(root, scene);
        try { vl.prepare?.(); } catch { /* sin cifras que reservar */ }
        const reducir = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const frame = () => {
          if (!vivo) return;
          let t: number;
          if (video) t = video.currentTime * 1000;
          else if (paused || reducir) t = Math.min(ventana.end - 1, ventana.start + 1500);
          else t = ventana.start + ((performance.now() - t0) % Math.min(loopMs, ventana.end - ventana.start + 600));
          vl.seek(t);
          raf = requestAnimationFrame(frame);
        };
        frame();
      })
      .catch((e) => setFallo(`No se pudo cargar el dibujo de VideoLab: ${e?.message ?? e}`));
    return () => { vivo = false; cancelAnimationFrame(raf); try { vl?.destroy(); } catch { /* ya no estaba */ } };
  }, [scene, runtimeUrl, video, loopMs, paused]);

  if (fallo) return <p className="text-[10px] text-amber-300/90 p-1">{fallo}</p>;
  return (
    <div style={{ width, height: Math.round(foco.h * escala), position: 'relative', overflow: 'hidden' }} aria-hidden>
      <div ref={host} style={{ position: 'absolute', left: -foco.x * escala, top: -foco.y * escala, width: W, height: H, transform: `scale(${escala})`, transformOrigin: '0 0' }} />
    </div>
  );
}

/** Lo que dice la etiqueta de fidelidad: si la vista previa es el render o se le parece. */
export function Fidelidad({ fidelity }: { fidelity?: string | null }) {
  if (!fidelity) return null;
  const igual = fidelity === 'same_engine';
  return (
    <span className={cn('px-1.5 py-0.5 rounded-full text-[10px] font-mono border',
      igual ? 'text-cyan-300 border-cyan-400/40' : 'text-amber-300 border-amber-400/40')}
      title={igual ? 'El estilo es del motor nuevo: lo que ves es lo que sale en el video.' : 'Algún estilo es de los antiguos: la vista se parece al video, no es exacta.'}>
      {igual ? 'igual al render' : 'aproximada'}
    </span>
  );
}

/** El nombre que ve quien edita para cada aviso de VideoLab (no son errores). */
const AVISOS: Record<string, string> = {
  TEXT_SPAN_NOT_FOUND: 'Una marca no se encontró en el texto.',
  TEXT_ITALIC_SYNTHESIZED: 'La fuente no tiene cursiva: se inclina por cálculo.',
  TEXT_BOLD_UNAVAILABLE: 'La fuente no tiene negrita: esa marca no se verá.',
  TEXT_EMPHASIS_ROLE_UNKNOWN: 'El color de resaltado no es de la marca: se usa el de siempre.',
  TEXT_CAPTION_FAST: 'Los subtítulos van rápido para leerlos.',
  TEXT_OVER_FACE: 'Un bloque no encuentra sitio y tapa una cara en algún momento.',
};
const avisoDe = (w: unknown) => {
  const code = typeof w === 'string' ? w : String((w as any)?.code ?? (w as any)?.warning ?? '');
  const base = code.split(/[:\s]/)[0];
  return AVISOS[base] ?? code;
};

/**
 * LA VISTA GRANDE: el video limpio de la pieza con el texto encima, dibujado por VideoLab. Cambia mientras se elige,
 * sin «Aplicar». Si aún no hay escena (cargando, error), lo dice; el video se ve igual.
 */
export function VistaFiel({ videoUrl, result, loading, error, width, targets = [], onPlace, lado, abajo, encima, esquina, notasEn }: {
  videoUrl: string; result: SceneResult | null; loading: boolean; error: string | null; width: number;
  /** Los bloques que se pueden arrastrar (ver `arrastre.ts`). Sin `onPlace`, no se arrastra nada. */
  targets?: DragTarget[]; onPlace?: (ref: BlockRef, place: Place) => void;
  /**
   * 2026-11-17 (Sam): lo que va AL LADO del video (el esquema). Con `lado`, la barra de reproducción, la etiqueta y las
   * notas pasan a esa columna, para que la vista ocupe sólo el alto del video.
   */
  lado?: React.ReactNode;
  /**
   * 2026-11-18 (Sam): lo que va DEBAJO del video y del esquema (leyenda, «Fijar arriba»), seguido del play y las notas.
   * Ocupa el ancho de los dos juntos: la barra del play no se estira más allá.
   */
  abajo?: React.ReactNode;
  /**
   * 2026-11-18 (Sam): la vista va en el reproductor de la TARJETA. `encima` se dibuja sobre el video sin recibir el
   * puntero (el esquema de zonas seguras); `esquina`, abajo a la derecha y sí lo recibe (el check que lo muestra);
   * `notasEn` es el sitio de la franja inferior de la tarjeta donde van el play, la etiqueta y las notas.
   */
  encima?: React.ReactNode;
  esquina?: React.ReactNode;
  notasEn?: HTMLElement | null;
}) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const W = Number(result?.scene?.canvas?.width) || 1080;
  const H = Number(result?.scene?.canvas?.height) || 1920;
  const alto = Math.round(width * (H / W));
  const avisos = [...new Set((result?.warnings ?? []).map(avisoDe))];
  // La primera vez que llega una escena, el video salta a un momento con texto: en el segundo 0 la animación aún no
  // empezó y la vista parecería vacía. Después, el cabezal es de quien edita.
  const saltado = useRef(false);
  useEffect(() => {
    if (saltado.current || !video || !result?.ok || !result.scene) return;
    const v = sceneWindow(result.scene);
    const ir = () => { if (video.paused && video.currentTime < 0.05) video.currentTime = Math.min((v.start + 1200) / 1000, (video.duration || 9e9) - 0.1); saltado.current = true; };
    if (video.readyState >= 1) ir(); else video.addEventListener('loadedmetadata', ir, { once: true });
  }, [video, result]);
  const pantalla = (
      <div className="relative mx-auto rounded-lg overflow-hidden bg-black shrink-0" style={{ width, height: alto }}>
        <video ref={setVideo} src={videoUrl} className="absolute inset-0 w-full h-full object-cover" muted playsInline loop controls={false}
          onClick={(e) => { const v = e.currentTarget; if (v.paused) void v.play(); else v.pause(); }} aria-label="Video limpio de la pieza" />
        {result?.ok && result.scene && result.runtime_url && (
          <div className="absolute inset-0 pointer-events-none">
            <ScenePlayer scene={result.scene} runtimeUrl={result.runtime_url} width={width} video={video} />
          </div>
        )}
        {encima && <div className="absolute inset-0 pointer-events-none">{encima}</div>}
        {onPlace && result?.ok && result.scene && (
          <Arrastrables scene={result.scene} targets={targets} video={video} escala={width / W} onPlace={onPlace} />
        )}
        {loading && <span className="absolute top-2 right-2"><Spinner size={14} /></span>}
        {esquina && <div className="absolute bottom-1.5 right-1.5 z-30">{esquina}</div>}
      </div>
  );
  const notas = (<>
      <VideoBarra video={video} />
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
        <Fidelidad fidelity={result?.ok ? result.fidelity : null} />
        {result?.ok && result.fidelity === 'same_engine' && <span>Lo que ves es lo que sale en el video.</span>}
        {result?.ok && result.fidelity === 'approximate' && <span>Algún estilo es de los antiguos: la vista se parece, no es exacta.</span>}
      </div>
      {error && <p className="text-[11px] text-amber-300/90 leading-snug">{error}</p>}
      {result && !result.ok && <p className="text-[11px] text-amber-300/90 leading-snug">VideoLab no pudo preparar la vista ({result.error}): {result.detail}</p>}
      {!!avisos.length && <ul className="text-[10px] text-amber-200/80 list-disc pl-4">{avisos.map((a) => <li key={a}>{a}</li>)}</ul>}
      {onPlace && !!targets.length && (
        <p className="text-[10px] text-zinc-500">Arrastra un texto sobre el video para moverlo. Queda colocado a mano; «Automático» lo devuelve.</p>
      )}
  </>);
  if (notasEn !== undefined) {
    // En la tarjeta: el video ocupa el sitio del reproductor; play, etiqueta y notas, en la franja de abajo. Mientras
    // la franja no existe (primer pintado), van debajo del video para no perderlas.
    const pie = <div className="space-y-1.5">{abajo}{notas}</div>;
    return <>{pantalla}{notasEn ? createPortal(pie, notasEn) : pie}</>;
  }
  if (!lado) return <div className="space-y-1.5">{pantalla}{notas}</div>;
  return (
    <div className="space-y-1.5" style={{ width: width * 2 + 12 }}>
      <div className="flex items-start gap-3">
        {pantalla}
        <div className="shrink-0">{lado}</div>
      </div>
      {abajo}{notas}
    </div>
  );
}

/**
 * Los bloques visibles en este momento, cada uno con un asa del mismo tamaño que el texto que dibuja VideoLab. Se
 * arrastra con ratón o con el dedo; al soltar, el bloque queda colocado a mano donde se soltó. Mientras VideoLab no
 * devuelve la escena nueva, el contorno se queda donde se soltó para que no parezca que volvió atrás.
 */
function Arrastrables({ scene, targets, video, escala, onPlace }: {
  scene: any; targets: DragTarget[]; video: HTMLVideoElement | null; escala: number;
  onPlace: (ref: BlockRef, place: Place) => void;
}) {
  const [ms, setMs] = useState(0);
  const [mov, setMov] = useState<{ i: number; x0: number; y0: number; dx: number; dy: number } | null>(null);
  const [soltado, setSoltado] = useState<{ i: number; dx: number; dy: number } | null>(null);
  useEffect(() => { setSoltado(null); }, [scene]);
  useEffect(() => {
    if (!video) return;
    const u = () => setMs(video.currentTime * 1000);
    const ev = ['timeupdate', 'seeked', 'loadedmetadata'];
    ev.forEach((e) => video.addEventListener(e, u)); u();
    return () => ev.forEach((e) => video.removeEventListener(e, u));
  }, [video]);
  const safe = safeOf(scene);
  if (!safe) return null;
  return (
    <div className="absolute inset-0 pointer-events-none">
      {targets.map((t, i) => {
        const activo = mov?.i === i;
        if (!activo && !visibleAt(t, ms)) return null;
        const d = activo ? { dx: mov!.dx, dy: mov!.dy } : soltado?.i === i ? soltado : { dx: 0, dy: 0 };
        return (
          <div key={`${t.ref.block}-${'index' in t.ref ? t.ref.index : 0}`} role="button" aria-label={`Mover ${t.label}`} title={`Arrastra para mover: ${t.label}`}
            className={cn('absolute pointer-events-auto touch-none cursor-grab rounded-md border border-dashed',
              activo ? 'cursor-grabbing border-violet-300 bg-violet-400/10' : 'border-white/30 hover:border-violet-300/80')}
            style={{ left: (t.rect.x + d.dx) * escala, top: (t.rect.y + d.dy) * escala, width: t.rect.w * escala, height: t.rect.h * escala }}
            onPointerDown={(e) => {
              e.preventDefault(); e.stopPropagation();
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              video?.pause();
              setMov({ i, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 });
            }}
            onPointerMove={(e) => {
              if (!mov || mov.i !== i) return;
              setMov({ ...mov, dx: (e.clientX - mov.x0) / escala, dy: (e.clientY - mov.y0) / escala });
            }}
            onPointerUp={(e) => {
              if (!mov || mov.i !== i) return;
              const m = mov; setMov(null);
              if (!isDrag(e.clientX - m.x0, e.clientY - m.y0)) return;
              setSoltado({ i, dx: m.dx, dy: m.dy });
              onPlace(t.ref, placeAfterDrag(t.rect, safe, m.dx, m.dy, t.zoom));
            }}
            onPointerCancel={() => setMov(null)} />
        );
      })}
    </div>
  );
}

/** Reproducir y mover el cabezal del video de la vista grande. */
function VideoBarra({ video }: { video: HTMLVideoElement | null }) {
  const [t, setT] = useState(0); const [dur, setDur] = useState(0); const [play, setPlay] = useState(false);
  useEffect(() => {
    if (!video) return;
    const u = () => { setT(video.currentTime); setDur(video.duration || 0); setPlay(!video.paused); };
    const ev = ['timeupdate', 'loadedmetadata', 'play', 'pause'];
    ev.forEach((e) => video.addEventListener(e, u)); u();
    return () => ev.forEach((e) => video.removeEventListener(e, u));
  }, [video]);
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => { if (!video) return; if (video.paused) void video.play(); else video.pause(); }}
        className="w-11 h-11 rounded-full border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 grid place-items-center text-zinc-200"
        aria-label={play ? 'Pausar' : 'Reproducir'}>{play ? '❚❚' : '▶'}</button>
      <input type="range" min={0} max={Math.max(0.1, dur)} step={0.05} value={t} aria-label="Momento del video"
        onChange={(e) => { if (video) video.currentTime = Number(e.target.value); }} className="flex-1 min-w-0 accent-violet-500 h-11" />
      <span className="text-[10px] font-mono text-zinc-500 w-10 text-right tabular-nums">{t.toFixed(1)} s</span>
    </div>
  );
}

// ── Marcas por palabra ───────────────────────────────────────────────────────────────────────────

const MARK_CLASS: Record<MarkKind, string> = {
  emphasis: 'bg-[linear-gradient(transparent_55%,rgba(139,92,246,.55)_55%)]',
  italic_spans: 'italic', bold_spans: 'font-extrabold', color_spans: 'text-amber-300 font-semibold',
};

/**
 * Toca palabras y ponles una marca. Lo que se ve es lo que VideoLab hará (primera aparición de cada tramo); debajo,
 * cómo queda escrito con el marcado de la imagen.
 */
export function MarcasDeTexto({ text, marks, onChange }: { text: string; marks: BlockMarks; onChange: (m: BlockMarks) => void }) {
  const [sel, setSel] = useState<number[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const ws = wordRanges(text);
  const porPalabra = marksByWord(text, marks);
  useEffect(() => { setSel((s) => s.filter((i) => i < ws.length)); }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ws.length) return <p className="text-[10px] text-zinc-500">Elige o escribe primero el texto para marcar palabras.</p>;
  const alternar = (i: number) => setSel((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i].sort((a, b) => a - b)));
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-x-1 gap-y-1.5 text-[14px] leading-6 rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-1.5" role="group" aria-label="Palabras del texto">
        {ws.map((w, i) => (
          <button key={i} type="button" aria-pressed={sel.includes(i)} onClick={() => alternar(i)}
            className={cn('px-1 rounded-md border min-h-[32px]', sel.includes(i) ? 'border-violet-500 bg-violet-500/15' : 'border-transparent hover:border-zinc-700',
              ...[...porPalabra[i]].map((k) => MARK_CLASS[k]))}>
            {w.word}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {MARK_KINDS.map((k) => {
          const puesta = sel.length > 0 && sel.every((i) => porPalabra[i]?.has(k));
          return (
            <button key={k} type="button" disabled={!sel.length} aria-pressed={puesta}
              onClick={() => { const r = toggleMark(text, marks, k, sel); if (r.ok) { setAviso(null); onChange(r.marks); } else setAviso(r.reason); }}
              className={cn('min-h-[36px] px-2.5 rounded-lg border text-[12px] inline-flex items-center gap-1.5 disabled:opacity-40',
                puesta ? 'border-violet-500 bg-violet-500/15 text-violet-100' : 'border-zinc-800 text-zinc-300 hover:border-zinc-600')}>
              <span className={MARK_CLASS[k]}>{MARK_LABEL[k]}</span>
              <span className="font-mono text-[10px] text-zinc-500">{MARK_SYMBOL[k][0]}…{MARK_SYMBOL[k][1]}</span>
            </button>
          );
        })}
        <span className="text-[10px] text-zinc-500">{sel.length ? `${sel.length} palabra(s) elegida(s)` : 'Toca una o varias palabras'}</span>
      </div>
      {aviso && <p className="text-[10px] text-amber-300/90">{aviso}</p>}
      <p className="text-[10px] font-mono text-zinc-500 break-words"><span className="text-zinc-400">Se guarda así:</span> {markupOf(text, marks)}</p>
      <p className="text-[10px] text-zinc-600">Cursiva y negrita invierten el estilo: en un título que ya es negrita, la marca lo aligera.</p>
    </div>
  );
}

// ── Alineación ───────────────────────────────────────────────────────────────────────────────────

const ALIGN_PATH: Record<string, string> = { left: 'M2 3h12M2 7h8M2 11h11', center: 'M2 3h12M4 7h8M3 11h10', right: 'M2 3h12M6 7h8M3 11h11' };
const ALIGN_LABEL: Record<string, string> = { left: 'Izquierda', center: 'Centro', right: 'Derecha' };
/** Izquierda, centro o derecha; «del estilo» = lo que trae el estilo elegido. */
export function Alineacion({ value, onChange }: { value: 'left' | 'center' | 'right' | null; onChange: (a: 'left' | 'center' | 'right' | null) => void }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="inline-flex rounded-lg border border-zinc-800 overflow-hidden" role="group" aria-label="Alineación">
        {(['left', 'center', 'right'] as const).map((a) => (
          <button key={a} type="button" aria-pressed={value === a} aria-label={ALIGN_LABEL[a]} title={ALIGN_LABEL[a]}
            onClick={() => onChange(value === a ? null : a)}
            className={cn('w-12 h-11 grid place-items-center border-r border-zinc-800 last:border-r-0', value === a ? 'bg-violet-500/20' : 'bg-zinc-950/40 hover:bg-zinc-900')}>
            <svg width="16" height="14" viewBox="0 0 16 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="text-zinc-200"><path d={ALIGN_PATH[a]} /></svg>
          </button>
        ))}
      </div>
      <span className="text-[10px] text-zinc-500">{value ? ALIGN_LABEL[value] : 'La del estilo'}</span>
    </div>
  );
}

// ── Colores ──────────────────────────────────────────────────────────────────────────────────────

/** Los colores de la paleta de la marca, con su nombre, su hex y un aviso si se leen mal como texto sobre el video. */
export function Muestras({ opts, value, onChange, label, nullable = false }: {
  opts: EmphasisColorOption[]; value: string | null; onChange: (r: string | null) => void; label: string; nullable?: boolean;
}) {
  if (!opts.length) return <p className="text-[10px] text-zinc-500">La marca no declara colores para esto.</p>;
  return (
    <div className="flex items-center gap-1.5 flex-wrap" role="radiogroup" aria-label={label}>
      {nullable && (
        <button type="button" role="radio" aria-checked={!value} onClick={() => onChange(null)}
          className={cn('min-h-[44px] px-2.5 rounded-lg border text-[11px]', !value ? 'border-violet-500 bg-violet-500/15 text-violet-100' : 'border-zinc-800 text-zinc-400 hover:border-zinc-600')}>
          El del estilo
        </button>
      )}
      {opts.map((o) => {
        const bajo = contrastOnDark(o.hex) < 3;
        return (
          <button key={o.role} type="button" role="radio" aria-checked={value === o.role} onClick={() => onChange(o.role)}
            title={`${o.role} ${o.hex}${o.is_default ? ' (el de la marca)' : ''}${bajo ? ' · poco contraste sobre el video' : ''}`}
            className={cn('min-h-[44px] flex items-center gap-2 pl-1 pr-2.5 rounded-lg border text-left',
              value === o.role ? 'border-violet-500 bg-violet-500/15' : 'border-zinc-800 hover:border-zinc-600')}>
            <span className="w-8 h-8 rounded-md border border-white/15 shrink-0" style={{ background: o.hex }} />
            <span className="flex flex-col leading-tight">
              <span className="text-[11px] text-zinc-200">{o.role}{o.is_default ? ' ·' : ''}{o.is_default && <span className="text-zinc-500"> de la marca</span>}</span>
              <span className="text-[9.5px] font-mono text-zinc-500">{o.hex}{bajo && <span className="text-amber-300"> · poco contraste</span>}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Palabras clave de los subtítulos ─────────────────────────────────────────────────────────────

/** Las palabras que el estilo «sólo palabras clave» marca. Propuestas por CopyLab; se tocan para quitar o poner. */
export function PalabrasClave({ candidates, value, spoken, onChange, max = 12 }: {
  candidates: string[]; value: string[]; spoken: string[]; onChange: (v: string[]) => void; max?: number;
}) {
  const [propia, setPropia] = useState('');
  const todas = [...new Set([...candidates, ...value])];
  const pct = keywordShare(spoken, value);
  const estado = pct > 15 ? 'Demasiadas: el color deja de destacar.' : pct < 5 ? 'Muy pocas: casi no se nota.' : 'Bien.';
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {todas.map((w) => {
          const on = value.includes(w);
          return (
            <button key={w} type="button" aria-pressed={on} disabled={!on && value.length >= max}
              onClick={() => onChange(on ? value.filter((x) => x !== w) : [...value, w])}
              className={cn('min-h-[36px] px-2.5 rounded-full border text-[12px] disabled:opacity-40',
                on ? 'border-violet-500 bg-violet-500/20 text-violet-100' : 'border-dashed border-zinc-700 text-zinc-400 hover:border-zinc-500')}>
              {w}
            </button>
          );
        })}
        {!todas.length && <span className="text-[10px] text-zinc-500">CopyLab no propuso palabras: escribe las tuyas.</span>}
      </div>
      <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); const w = propia.trim(); if (w && !value.includes(w) && value.length < max && w.length <= 60) onChange([...value, w]); setPropia(''); }}>
        <input value={propia} onChange={(e) => setPropia(e.target.value)} placeholder="Añadir una palabra" aria-label="Palabra clave propia"
          className="flex-1 min-w-0 bg-zinc-950/60 border border-zinc-800 rounded-lg px-2.5 py-1 text-[12px] text-zinc-200" />
        <button type="submit" className="px-3 rounded-lg border border-zinc-700 text-[12px] text-zinc-300 hover:border-zinc-500">Añadir</button>
      </form>
      <div className="relative h-2 rounded-full bg-zinc-900 overflow-hidden" aria-hidden>
        <div className="absolute inset-y-0 bg-cyan-400/20" style={{ left: '5%', width: '10%' }} />
        <div className="absolute inset-y-0 left-0 bg-violet-500 rounded-full" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <p className="text-[10px] text-zinc-500">{pct} % de lo que se dice va marcado ({value.length} de {max}). Lo recomendado es 5–15 % (la franja clara). {estado}</p>
    </div>
  );
}

// ── Franja ───────────────────────────────────────────────────────────────────────────────────────

const MODOS: Array<[string, string, React.CSSProperties]> = [
  ['none', 'sin franja', {}],
  ['edge_left', 'borde izquierdo', { left: 0, top: 0, bottom: 0, width: '12%' }],
  ['edge_right', 'borde derecho', { right: 0, top: 0, bottom: 0, width: '12%' }],
  ['edge_bottom', 'borde inferior', { left: 0, right: 0, bottom: 0, height: '8%' }],
];
/** Dónde va la franja: lo decide la marca (dato). Aquí sólo se ve, con el color elegido. */
export function FranjaModo({ mode, hex }: { mode: string | null; hex: string | null }) {
  const actual = mode ?? 'edge_left';
  return (
    <div className="grid grid-cols-4 gap-1.5" aria-label="Dónde va la franja (lo decide la marca)">
      {MODOS.map(([k, l, pos]) => (
        <div key={k} className={cn('rounded-md border p-1 text-center text-[9.5px]', k === actual ? 'border-violet-500 text-zinc-200' : 'border-zinc-800 text-zinc-600')}>
          <div className="relative aspect-[9/14] rounded bg-zinc-800/80 mb-0.5 overflow-hidden">
            {k !== 'none' && <span className="absolute" style={{ ...pos, background: hex ?? '#888' }} />}
          </div>
          {l}{k === actual && <><br /><span className="text-zinc-400">el de la marca</span></>}
        </div>
      ))}
    </div>
  );
}

// ── El esquema de la escena (2026-11-17) ───────────────────────────────────────────────────────

const CAPA_NOMBRE: Record<string, string> = {
  hook: 'Gancho', key_title: 'Título clave', cta: 'CTA', role: 'Rol', caption_band: 'Subtítulos',
};

/**
 * El esquema de posiciones con la geometría REAL de VideoLab: la zona segura y el rectángulo de cada bloque tal como
 * los resolvió la escena (Sam, 2026-11-17: al lado de la vista grande, y que se redibuje al elegir un estilo). Morado =
 * colocado a mano; punteado = automático. `foco` resalta la capa que se está editando.
 */
export function EsquemaDeEscena({ scene, width, foco, sinLeyenda }: { scene: any; width: number; foco?: string | null; sinLeyenda?: boolean }) {
  const W = Number(scene?.canvas?.width) || 1080;
  const H = Number(scene?.canvas?.height) || 1920;
  const k = width / W;
  const safe = scene?.safe;
  const blocks: any[] = Array.isArray(scene?.blocks) ? scene.blocks : [];
  const pct = (v: number, total: number) => `${(v / total) * 100}%`;
  return (
    <div className="space-y-1">
      <div className="relative rounded-md border border-zinc-700 bg-zinc-900 overflow-hidden" style={{ width, height: Math.round(H * k) }}
        role="img" aria-label="Esquema de posiciones de la escena">
        {safe && <div className="absolute border border-dashed border-emerald-500/60" title="Zona segura: el espacio disponible para el texto"
          style={{ left: pct(safe.x, W), top: pct(safe.y, H), width: pct(safe.w, W), height: pct(safe.h, H) }} />}
        {blocks.filter((b) => b?.rect).map((b, i) => {
          const manual = b.placed === 'manual';
          const enFoco = foco && b.layer === foco;
          return (
            <div key={i} title={`${CAPA_NOMBRE[b.layer] ?? b.layer} · ${manual ? 'a mano' : 'automático'} · ${Math.round(b.rect.w)}×${Math.round(b.rect.h)} px`}
              className={cn('absolute rounded-sm border text-[8px] leading-tight px-0.5 overflow-hidden',
                manual ? 'border-violet-400 bg-violet-500/25 text-violet-100' : 'border-dashed border-zinc-400/70 bg-zinc-500/10 text-zinc-300',
                enFoco && 'ring-1 ring-cyan-300')}
              style={{ left: pct(b.rect.x, W), top: pct(b.rect.y, H), width: pct(b.rect.w, W), height: pct(b.rect.h, H) }}>
              {CAPA_NOMBRE[b.layer] ?? b.layer}
            </div>
          );
        })}
      </div>
      {!sinLeyenda && <LeyendaEsquema width={width} />}
    </div>
  );
}

/**
 * Un bloque se pinta en ROJO RELLENO cuando el texto se sale: si su caja pasa del borde de la zona segura, o si VideoLab
 * dice que no cabe (`fit.fits === false`). PURO. (Sam, 2026-11-18: «rojo cuando el texto se sale, filled traslúcido».)
 */
export function seSale(rect: { x: number; y: number; w: number; h: number } | null | undefined,
  safe: { x: number; y: number; w: number; h: number } | null | undefined, fits?: boolean | null): boolean {
  if (fits === false) return true;
  if (!rect || !safe) return false;
  const e = 1; // 1 px de tolerancia por redondeo
  return rect.x < safe.x - e || rect.y < safe.y - e || rect.x + rect.w > safe.x + safe.w + e || rect.y + rect.h > safe.y + safe.h + e;
}

/**
 * EL ESQUEMA SOBRE EL VIDEO (Sam, 2026-11-18): la zona segura en verde punteado y cada bloque en punteado, encima del
 * reproductor de la tarjeta y sin taparlo. Se ven todos los bloques a la vez, con su nombre; el que se sale va en rojo
 * relleno traslúcido. No recibe el puntero: el arrastre sigue funcionando debajo.
 */
export function EsquemaSobreVideo({ scene, fits = [] }: {
  scene: any; fits?: Array<{ layer: string; start_ms: number; fit: { fits: boolean } }>;
}) {
  const W = Number(scene?.canvas?.width) || 1080;
  const H = Number(scene?.canvas?.height) || 1920;
  const safe = scene?.safe && Number.isFinite(Number(scene.safe.w)) ? scene.safe : null;
  const blocks: any[] = Array.isArray(scene?.blocks) ? scene.blocks : [];
  const pct = (v: number, total: number) => `${(v / total) * 100}%`;
  const fitDe = (b: any) => fits.find((f) => f.layer === b.layer && Number(f.start_ms) === Number(b.start_ms ?? 0))?.fit.fits ?? null;
  return (
    <div className="absolute inset-0" aria-hidden="true" data-esquema-sobre-video>
      {safe && <div className="absolute border border-dashed border-emerald-400/80"
        style={{ left: pct(safe.x, W), top: pct(safe.y, H), width: pct(safe.w, W), height: pct(safe.h, H) }} />}
      {blocks.filter((b) => b?.rect).map((b, i) => {
        const fuera = seSale(b.rect, safe, fitDe(b));
        const manual = b.placed === 'manual';
        return (
          <div key={i} data-se-sale={fuera ? 'si' : 'no'}
            className={cn('absolute rounded-sm border border-dashed text-[9px] leading-tight px-0.5 overflow-hidden',
              fuera ? 'border-rose-500 bg-rose-500/30 text-rose-50' : manual ? 'border-violet-300 text-violet-100' : 'border-white/60 text-white/80')}
            style={{ left: pct(b.rect.x, W), top: pct(b.rect.y, H), width: pct(b.rect.w, W), height: pct(b.rect.h, H) }}>
            <span className="bg-black/40 rounded-sm px-0.5">{CAPA_NOMBRE[b.layer] ?? b.layer}</span>
          </div>
        );
      })}
    </div>
  );
}

/** La leyenda del esquema; en la vista grande va debajo, a lo ancho (Sam, 2026-11-18). */
export function LeyendaEsquema({ width }: { width?: number }) {
  return <p className="text-[9.5px] text-zinc-500 leading-snug min-w-0 flex-1" style={width ? { width } : undefined}>Verde: zona segura. Morado: a mano. Punteado: automático. Rojo relleno: el texto se sale. Medidas reales de VideoLab.</p>;
}
