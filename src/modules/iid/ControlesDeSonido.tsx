/**
 * CONTROLES DE SONIDO (2026-11-17). Boceto aprobado por Sam el mismo día: https://claude.ai/artifact/YBy45hQkGdW8DquXaQKvaq
 * («Boceto aprobado, cada momento se puede apagar, usa tus 6 presets»).
 *
 * Se abre con el botón «Sonido», al lado de «Texto en pantalla», en la tarjeta de un video. Dos pestañas:
 *   · FONDO: presets de fondo (rotan: la tarjeta sugerida lleva «rota»), volumen bajo la voz y librería de fondos.
 *   · EFECTOS: presets de efectos (no rotan), qué suena en cada momento de esta pieza —cada uno se puede apagar o cambiar
 *     por otro de la librería—, volumen y librería de efectos.
 * «Aplicar» vuelve a mezclar el video (contrato VideoLab v1.10.0, `text_layers.sound`); el texto de la pieza no cambia.
 *
 * Ni una marca, ni un sonido, ni un preset con nombre en este archivo: todo llega del catálogo (dato).
 */
import React, { useEffect, useRef, useState } from 'react';
import { cn, Spinner } from '../../ui/components';
import {
  soundCatalog, applyPieceSound, pollPieceText, changePresetStatus, CalibrationError, type PieceSoundCatalog,
} from '../../services/calibrationInbox';
import {
  EFFECT_FNS, BED_FN, soundDraftOf, soundFromDraft, effectSoundNow, bedSoundNow,
  type EffectFn, type LibrarySound, type SoundDraft, type SoundPresetView,
} from '../../../api/_pieceSound';

const POLL_MS = 4000;
const errorDe = (err: unknown, caida: string) => (err instanceof CalibrationError ? err.message : caida);

/** Cómo se llama cada momento para quien edita, y cuándo suena. Vocabulario del contrato, no de una marca. */
export const FN_LABEL: Record<EffectFn, { nombre: string; cuando: string }> = {
  block_entry: { nombre: 'Entrada de un texto', cuando: 'el gancho y cada título clave al aparecer' },
  cta: { nombre: 'Llamada a la acción', cuando: 'cuando aparece el llamado a compartir' },
  digit_land: { nombre: 'Cifra que cae', cuando: 'cada número del contador que se detiene' },
  impact: { nombre: 'Golpe de un título', cuando: 'los títulos con estilo de golpe' },
  shot_cut: { nombre: 'Corte de toma', cuando: 'cada cambio de toma del video' },
  word_pop: { nombre: 'Nombre o rol en pantalla', cuando: 'la tarjeta con nombre y cargo' },
};

const dur = (ms: number | null) => (ms == null ? '' : ms >= 1000 ? `${(ms / 1000).toFixed(1).replace('.', ',')} s` : `${ms} ms`);
const firmado = (n: number, unidad: string) => (n === 0 ? 'como el preset' : `${n > 0 ? '+' : '−'}${Math.abs(n)} ${unidad}`);

// ── Escuchar ───────────────────────────────────────────────────────────────────────────────────

/** Un solo reproductor para toda la ventana: al tocar otro sonido, el anterior se calla. */
function useEscucha() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [sonando, setSonando] = useState<string | null>(null);
  useEffect(() => () => { audio.current?.pause(); }, []);
  const tocar = (key: string, url: string | null) => {
    audio.current?.pause();
    if (!url || sonando === key) { setSonando(null); return; }
    const a = new Audio(url); audio.current = a; setSonando(key);
    a.onended = () => setSonando((s) => (s === key ? null : s));
    a.play().catch(() => setSonando(null));
  };
  return { sonando, tocar };
}

function Escuchar({ k, lib, esc, label }: { k: string | null; lib: LibrarySound[] | null; esc: ReturnType<typeof useEscucha>; label: string }) {
  const url = k ? lib?.find((s) => s.sound_key === k)?.url ?? null : null;
  const on = !!k && esc.sonando === k;
  return (
    <button type="button" disabled={!url} onClick={(e) => { e.stopPropagation(); if (k) esc.tocar(k, url); }}
      aria-label={`${on ? 'Parar' : 'Escuchar'} ${label}`} title={url ? undefined : 'Sin muestra para escuchar'}
      className={cn('w-9 h-9 shrink-0 rounded-full border grid place-items-center text-[11px] disabled:opacity-30',
        on ? 'border-cyan-300 text-cyan-300' : 'border-zinc-700 bg-zinc-950 text-zinc-200 hover:border-zinc-500')}>
      {on ? '■' : '▶'}
    </button>
  );
}

// ── Piezas de la ventana ───────────────────────────────────────────────────────────────────────

function Interruptor({ on, onChange, titulo, ayuda, id }: { on: boolean; onChange: (v: boolean) => void; titulo: string; ayuda: string; id: string }) {
  return (
    <label htmlFor={id} className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 min-h-11 cursor-pointer">
      <input id={id} type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="w-5 h-5 accent-violet-500" />
      <span className="text-[13px] font-semibold text-zinc-100 whitespace-nowrap">{titulo}</span>
      <span className="text-[11px] text-zinc-500">{ayuda}</span>
    </label>
  );
}

function Tarjetas({ lista, valor, onPick, sugerido, escuchaDe, lib, esc }: {
  lista: SoundPresetView[]; valor: string; onPick: (k: string) => void; sugerido?: string | null;
  escuchaDe: (p: SoundPresetView) => string | null; lib: LibrarySound[] | null; esc: ReturnType<typeof useEscucha>;
}) {
  return (
    <div role="radiogroup" className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
      {lista.map((p) => {
        const sel = p.preset_key === valor;
        const validado = (p.status ?? '').startsWith('validated');
        return (
          <div key={p.preset_key} role="radio" aria-checked={sel} tabIndex={0}
            onClick={() => onPick(p.preset_key)} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onPick(p.preset_key); } }}
            className={cn('relative flex flex-col gap-1 p-2.5 rounded-lg border text-left cursor-pointer min-h-[104px]',
              sel ? 'border-violet-500 ring-1 ring-violet-500 bg-zinc-900' : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-600')}>
            <span className="text-[13px] font-semibold text-zinc-100 pr-10">{p.name}</span>
            {p.description && <span className="text-[11px] text-zinc-400 leading-snug pr-8">{p.description}</span>}
            <span className="mt-auto flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
              <span className={cn('w-[7px] h-[7px] rounded-full', validado ? 'bg-cyan-300' : 'border-[1.5px] border-amber-400')} />
              {validado ? 'validado' : 'propuesto'}
              {p.under_voice_lu != null && <span>· {p.under_voice_lu} LU bajo la voz</span>}
              {p.sounds_by_fn && <span>· {Object.keys(p.sounds_by_fn).length} de {EFFECT_FNS.length} momentos</span>}
              {sugerido === p.preset_key && <span className="ml-auto font-mono text-[9px] text-cyan-300 border border-cyan-300/40 rounded-full px-1.5">rota</span>}
            </span>
            <span className="absolute top-2 right-2"><Escuchar k={escuchaDe(p)} lib={lib} esc={esc} label={p.name} /></span>
          </div>
        );
      })}
    </div>
  );
}

function Volumen({ id, valor, rango, onChange, extremos }: {
  id: string; valor: number; rango: { min: number; max: number; step: number; unit: string }; onChange: (n: number) => void; extremos: [string, string];
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3">
        <input id={id} type="range" min={rango.min} max={rango.max} step={rango.step} value={valor} aria-label={`Volumen (${rango.unit})`}
          onChange={(e) => onChange(Number(e.target.value))} className="flex-1 min-w-0 h-11 accent-violet-500" />
        <span className="text-[12px] font-mono tabular-nums text-zinc-200 w-32 text-right whitespace-nowrap">{firmado(valor, rango.unit)}</span>
      </div>
      <div className="flex justify-between text-[10.5px] text-zinc-500"><span>{extremos[0]}</span><span>lo del preset</span><span>{extremos[1]}</span></div>
      {valor !== 0 && <button type="button" onClick={() => onChange(0)} className="px-2.5 py-1 rounded-md text-[11px] border border-zinc-700 text-zinc-300 hover:text-white">Volver a lo del preset</button>}
    </div>
  );
}

function Libreria({ sonidos, enUso, onUsar, esc, lib }: {
  sonidos: LibrarySound[]; enUso: (s: LibrarySound) => boolean; onUsar: (s: LibrarySound) => void;
  esc: ReturnType<typeof useEscucha>; lib: LibrarySound[] | null;
}) {
  return (
    <div className="flex flex-col gap-1.5 max-h-80 overflow-y-auto pr-0.5">
      {sonidos.map((s) => {
        const uso = enUso(s);
        return (
          <div key={s.sound_key} className={cn('grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2.5 items-center p-2 rounded-lg border bg-zinc-900/60',
            uso ? 'border-violet-500' : 'border-zinc-800')}>
            <Escuchar k={s.sound_key} lib={lib} esc={esc} label={s.description || s.sound_key} />
            <div className="min-w-0">
              <p className="text-[12px] text-zinc-200 leading-snug">{s.description || s.sound_key}</p>
              <p className="text-[10px] font-mono text-zinc-500 truncate">{[dur(s.duration_ms), s.license ? `licencia ${s.license}` : null, s.sound_key].filter(Boolean).join(' · ')}</p>
            </div>
            <button type="button" onClick={() => onUsar(s)} disabled={uso}
              className={cn('px-2.5 min-h-9 rounded-md text-[12px] border', uso ? 'border-violet-500 text-zinc-100' : 'border-zinc-700 text-zinc-300 hover:text-white')}>
              {uso ? 'En uso' : 'Usar'}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function Seccion({ titulo, pista, children }: { titulo: string; pista?: string | null; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 space-y-2.5">
      <h4 className="flex flex-wrap items-baseline gap-2 text-[11px] font-semibold tracking-wider uppercase text-zinc-400">
        {titulo}{pista && <span className="ml-auto normal-case tracking-normal font-normal text-[10.5px] text-zinc-500">{pista}</span>}
      </h4>
      {children}
    </section>
  );
}

// ── La ventana ─────────────────────────────────────────────────────────────────────────────────

export function ControlesDeSonido({ pieceId, token, onApplied }: {
  pieceId: string; token: string;
  onApplied?: (r: { html: string | null; artifact_url: string | null }) => void;
}) {
  const [cat, setCat] = useState<PieceSoundCatalog | null>(null);
  const [draft, setDraft] = useState<SoundDraft | null>(null);
  const [tab, setTab] = useState<'bed' | 'effects'>('bed');
  const [filtro, setFiltro] = useState<EffectFn | 'todos'>('todos');
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [job, setJob] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const esc = useEscucha();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const cargar = () => soundCatalog(token, pieceId)
    .then((c) => { setCat(c); setDraft((d) => d ?? soundDraftOf(c.current, c.presets, c.suggested_bed)); if (c.pending?.job_id) setJob(c.pending.job_id); })
    .catch((err) => setError(errorDe(err, 'No se pudo leer el catálogo de sonido.')));
  useEffect(() => { void cargar(); }, [pieceId, token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!job) return;
    const tick = () => pollPieceText(token, pieceId).then((r) => {
      if (r.status === 'running') return;
      setJob(null);
      if (r.status === 'completed') {
        setAviso(`Listo: el video ya suena con esta elección${r.video?.version ? ` (${r.video.version})` : ''}. El anterior quedó en el historial.`);
        onApplied?.({ html: r.html ?? null, artifact_url: r.artifact_url ?? null });
      } else if (r.status === 'failed') setError(`VideoLab no pudo mezclar el sonido (${r.error_label}): ${r.detail}`);
    }).catch((err) => setError(errorDe(err, 'No se pudo consultar la mezcla.')));
    timer.current = setInterval(tick, POLL_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [job, pieceId, token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !cat) return <p className="text-[11px] text-rose-300">{error}</p>;
  if (!cat || !draft) return <p className="flex items-center gap-2 text-[11px] text-zinc-400"><Spinner size={12} /> Leyendo los sonidos…</p>;

  const lib = cat.library;
  const presets = cat.presets;
  const set = (d: SoundDraft) => { setDraft(d); setAviso(null); };
  const bed = draft.bed, fx = draft.effects;
  const enCurso = !!job;
  const presetBed = presets.bed.find((p) => p.preset_key === bed.preset_key) ?? null;
  const presetFx = presets.effects.find((p) => p.preset_key === fx.preset_key) ?? null;

  const cambiarEstado = (p: SoundPresetView | null, action: 'validate' | 'retire' | 'reactivate') => {
    if (!p) return;
    setOcupado(true); setError(null);
    changePresetStatus(token, p.preset_key, cat.brand_id, action, 'sound')
      .then(() => cargar())
      .catch((err) => setError(errorDe(err, 'No se pudo cambiar el estado del preset.')))
      .finally(() => setOcupado(false));
  };
  const barraAdmin = (p: SoundPresetView | null) => cat.can_change_preset_status && p && (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
      <span>Solo admin, para el preset elegido:</span>
      {!(p.status ?? '').startsWith('validated') && (
        <button type="button" disabled={ocupado} onClick={() => cambiarEstado(p, 'validate')} className="px-2.5 min-h-9 rounded-md border border-cyan-400/50 text-cyan-300">Validar</button>
      )}
      <button type="button" disabled={ocupado} onClick={() => cambiarEstado(p, 'retire')} className="px-2.5 min-h-9 rounded-md border border-zinc-700 text-zinc-300 hover:border-rose-400/60 hover:text-rose-300">Retirar</button>
    </div>
  );
  const retirados = (kind: 'bed' | 'effects') => cat.can_change_preset_status && cat.retired_presets.filter((p) => p.kind === kind).length > 0 && (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
      <span>Retirados:</span>
      {cat.retired_presets.filter((p) => p.kind === kind).map((p) => (
        <button key={p.preset_key} type="button" disabled={ocupado} onClick={() => cambiarEstado(p, 'reactivate')}
          className="px-2 min-h-8 rounded-full border border-zinc-700 text-zinc-400 hover:text-zinc-100">{p.name} · Reactivar</button>
      ))}
    </div>
  );

  const aplicar = () => {
    if (ocupado) return;
    setError(null); setAviso(null); setOcupado(true);
    applyPieceSound(token, pieceId, soundFromDraft(draft, presets))
      .then((r) => setJob(r.job_id))
      .catch((err) => setError(errorDe(err, 'No se pudo mandar el sonido a VideoLab.')))
      .finally(() => setOcupado(false));
  };

  const fondos = (lib ?? []).filter((s) => s.fn === BED_FN);
  const efectos = (lib ?? []).filter((s) => (EFFECT_FNS as readonly string[]).includes(s.fn));
  const sinLibreria = lib ? null : (cat.library_error ?? 'La librería de sonidos no respondió.');

  return (
    <div className="space-y-2.5">
      {!cat.has_clean_video && <p className="text-[11px] rounded-lg px-3 py-2 border border-amber-500/40 bg-amber-500/[0.08] text-amber-200">{cat.clean_video_note}</p>}
      {cat.presets_error && <p className="text-[11px] text-amber-300/90">{cat.presets_error}</p>}

      <div role="tablist" className="flex gap-1.5 overflow-x-auto">
        {([['bed', 'Sonido de fondo', bed.on], ['effects', 'Efectos de sonido', fx.on]] as const).map(([k, l, on]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn('flex items-center gap-2 min-h-11 px-3.5 rounded-lg border text-[13px] shrink-0',
              tab === k ? 'border-violet-500 bg-violet-500/15 text-zinc-100' : 'border-zinc-800 bg-zinc-900 text-zinc-400')}>
            <span className={cn('w-2 h-2 rounded-full', on ? 'bg-cyan-300' : 'bg-zinc-700')} />{l}
          </button>
        ))}
      </div>

      {tab === 'bed' && (
        <div className="space-y-2.5">
          <Interruptor id={`bed-on-${pieceId}`} on={bed.on} onChange={(v) => set({ ...draft, bed: { ...bed, on: v } })}
            titulo="Música de fondo" ayuda="Va por debajo de la voz y baja sola cuando alguien habla." />
          {bed.on && (<>
            <Seccion titulo="Presets de fondo" pista={cat.suggested_bed ? '«rota» = el que sugiere la rotación' : null}>
              {presets.bed.length
                ? <Tarjetas lista={presets.bed} valor={bed.preset_key} sugerido={cat.suggested_bed} lib={lib} esc={esc}
                    escuchaDe={(p) => p.bed_sound ?? null}
                    onPick={(k) => set({ ...draft, bed: { ...bed, preset_key: k, sound_key: null } })} />
                : <p className="text-[11px] text-zinc-500">No hay presets de fondo.</p>}
              {barraAdmin(presetBed)}
              {retirados('bed')}
            </Seccion>
            <Seccion titulo="Volumen">
              <Volumen id={`bed-vol-${pieceId}`} valor={bed.level_lu} rango={cat.ranges.bed_level} extremos={['más suave', 'más presente']}
                onChange={(n) => set({ ...draft, bed: { ...bed, level_lu: n } })} />
              <p className="text-[11px] text-zinc-500">Se mide contra la voz: el fondo queda siempre por debajo y el video sale a la sonoridad de la plataforma.</p>
            </Seccion>
            <Seccion titulo="Librería de fondos" pista={lib ? `${fondos.length} sonidos` : null}>
              <p className="text-[11px] text-zinc-500">Elegir un sonido de la librería cambia solo la música; el resto del preset (cómo baja bajo la voz) se queda.</p>
              {sinLibreria ? <p className="text-[11px] text-amber-300/90">{sinLibreria}</p>
                : <Libreria sonidos={fondos} lib={lib} esc={esc} enUso={(s) => s.sound_key === bedSoundNow(draft, presets)}
                    onUsar={(s) => set({ ...draft, bed: { ...bed, sound_key: s.sound_key } })} />}
            </Seccion>
          </>)}
        </div>
      )}

      {tab === 'effects' && (
        <div className="space-y-2.5">
          <Interruptor id={`fx-on-${pieceId}`} on={fx.on} onChange={(v) => set({ ...draft, effects: { ...fx, on: v } })}
            titulo="Efectos de sonido" ayuda="Suenan con lo que pasa en pantalla: entra un texto, cae una cifra, corta la toma." />
          {fx.on && (<>
            <Seccion titulo="Presets de efectos" pista="no rotan: se eligen según la pieza">
              {presets.effects.length
                ? <Tarjetas lista={presets.effects} valor={fx.preset_key} lib={lib} esc={esc}
                    escuchaDe={(p) => p.sounds_by_fn?.cta ?? p.sounds_by_fn?.block_entry ?? Object.values(p.sounds_by_fn ?? {})[0] ?? null}
                    onPick={(k) => set({ ...draft, effects: { ...fx, preset_key: k, overrides: {} } })} />
                : <p className="text-[11px] text-zinc-500">No hay presets de efectos.</p>}
              {barraAdmin(presetFx)}
              {retirados('effects')}
            </Seccion>
            <Seccion titulo="Qué suena en esta pieza" pista="cuántas veces aparece cada momento">
              <p className="text-[11px] text-zinc-500">Cada momento usa el sonido del preset. Se puede apagar uno o cambiarlo por otro de la librería.</p>
              <div className="flex flex-col gap-1.5">
                {EFFECT_FNS.map((fn) => {
                  const k = effectSoundNow(draft, presets, fn);
                  const n = cat.cue_counts?.[fn];
                  const opciones = efectos.filter((s) => s.fn === fn);
                  return (
                    <div key={fn} className={cn('grid grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,190px)_auto] gap-2.5 items-center p-2 rounded-lg border border-zinc-800 bg-zinc-900/60', !k && 'opacity-60')}>
                      <input type="checkbox" checked={!!k} aria-label={`Sonar en: ${FN_LABEL[fn].nombre}`} className="w-5 h-5 accent-violet-500"
                        disabled={!k && !opciones.length && !presetFx?.sounds_by_fn?.[fn]}
                        onChange={(e) => {
                          const base = presetFx?.sounds_by_fn?.[fn] ?? opciones[0]?.sound_key ?? null;
                          set({ ...draft, effects: { ...fx, overrides: { ...fx.overrides, [fn]: e.target.checked ? base : null } } });
                        }} />
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-zinc-100">{FN_LABEL[fn].nombre}</p>
                        <p className="text-[11px] text-zinc-500">{FN_LABEL[fn].cuando}</p>
                        <p className={cn('text-[10px] font-mono', n ? 'text-zinc-300' : 'text-zinc-600')}>
                          {n == null ? 'no se sabe hasta mezclar' : n ? `suena ${n} ${n === 1 ? 'vez' : 'veces'} en esta pieza` : 'no aparece en esta pieza'}
                        </p>
                      </div>
                      <select value={k ?? ''} disabled={!k || !opciones.length} aria-label={`Sonido para: ${FN_LABEL[fn].nombre}`}
                        onChange={(e) => set({ ...draft, effects: { ...fx, overrides: { ...fx.overrides, [fn]: e.target.value } } })}
                        className="col-span-3 sm:col-span-1 min-h-10 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-[12px] text-zinc-200 min-w-0">
                        {!opciones.some((s) => s.sound_key === k) && <option value={k ?? ''}>{k ?? 'en silencio'}</option>}
                        {opciones.map((s) => <option key={s.sound_key} value={s.sound_key}>{(s.description || s.sound_key).split(' (')[0]} · {dur(s.duration_ms)}</option>)}
                      </select>
                      <Escuchar k={k} lib={lib} esc={esc} label={FN_LABEL[fn].nombre} />
                    </div>
                  );
                })}
              </div>
            </Seccion>
            <Seccion titulo="Volumen">
              <Volumen id={`fx-vol-${pieceId}`} valor={fx.gain_db} rango={cat.ranges.fx_gain} extremos={['más suave', 'más fuerte']}
                onChange={(n) => set({ ...draft, effects: { ...fx, gain_db: n } })} />
            </Seccion>
            <Seccion titulo="Librería de efectos" pista={lib ? `${efectos.length} sonidos en ${EFFECT_FNS.length} momentos` : null}>
              {sinLibreria ? <p className="text-[11px] text-amber-300/90">{sinLibreria}</p> : (<>
                <div className="flex flex-wrap gap-1.5">
                  {(['todos', ...EFFECT_FNS] as const).map((f) => (
                    <button key={f} type="button" aria-pressed={filtro === f} onClick={() => setFiltro(f)}
                      className={cn('px-2.5 min-h-8 rounded-full border text-[12px]', filtro === f ? 'border-violet-500 bg-violet-500/15 text-zinc-100' : 'border-zinc-800 text-zinc-400')}>
                      {f === 'todos' ? 'Todos' : FN_LABEL[f].nombre}
                    </button>
                  ))}
                </div>
                <Libreria sonidos={efectos.filter((s) => filtro === 'todos' || s.fn === filtro)} lib={lib} esc={esc}
                  enUso={(s) => effectSoundNow(draft, presets, s.fn as EffectFn) === s.sound_key}
                  onUsar={(s) => set({ ...draft, effects: { ...fx, overrides: { ...fx.overrides, [s.fn]: s.sound_key } } })} />
              </>)}
            </Seccion>
          </>)}
        </div>
      )}

      {error && <p className="text-[11px] text-rose-300">{error}</p>}
      {aviso && <p className="text-[11px] text-emerald-300">{aviso}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        <span className="mr-auto text-[11px] text-zinc-500">{enCurso ? 'VideoLab está mezclando el sonido…' : 'Al aplicar, el video se vuelve a mezclar con esta elección. El texto no cambia.'}</span>
        <button type="button" onClick={aplicar} disabled={enCurso || ocupado || !cat.has_clean_video}
          className="px-4 min-h-11 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[13px] font-semibold disabled:opacity-40 flex items-center gap-2">
          {enCurso && <Spinner size={12} />} Aplicar
        </button>
      </div>
    </div>
  );
}
