import React, { useEffect, useRef, useState } from 'react';
import { cn, Spinner } from '../../ui/components';
import {
  proposePieceText, applyPieceText, pollPieceText, CalibrationError,
  type PieceTextProposal, type TextProposal,
} from '../../services/calibrationInbox';
import type { CastMember, PresetsByLayer, TextLayers } from '../../../api/_pieceText';
import type { EmphasisColorOption } from '../../../api/_overlayText';

/**
 * VideoTextEditor.tsx — EL TEXTO EN PANTALLA DE UNA PIEZA (2026-11-16 · contrato «Texto en pantalla» v1, §4).
 *
 * Seis secciones PLEGADAS al abrir (Sam: que el panel no abra con todo desplegado): Gancho, Rol de las personas,
 * Subtítulos, Títulos clave, CTA de reenvío y Franja. Las propuestas las escribe CopyLab y el texto lo dibuja VideoLab;
 * esta pantalla sólo deja elegir y manda lo elegido (`api/piece-text.ts`). Nada de marcas aquí: los presets, los
 * colores y las personas llegan del server.
 *
 * El patrón de pliegue es el `<details>` nativo que ya usan las tarjetas (`ResearchCaseLine`).
 */

// ── El borrador y su traducción a capas (lógica pura, probable sin montar React) ────────────────

export const OWN = 'own' as const;
export type Choice = number | typeof OWN | null;

export interface VideoTextDraft {
  hook: { choice: Choice; own: string; preset_key: string; dur_s: number };
  roles: Array<{ person_id: string; name: string; show: boolean; text: string; at_s: number; dur_s: number; preset_key: string }>;
  captions: { enabled: boolean; preset_key: string; accent_role: string };
  key_titles: Array<{ text: string; on: boolean; at_s: number; dur_s: number; preset_key: string; own: boolean }>;
  cta: { choice: Choice; own: string; preset_key: string; at_s: number };
  strip: { on: boolean; role: string };
}

const firstKey = (presets: PresetsByLayer | null, layer: keyof PresetsByLayer) => presets?.[layer]?.[0]?.preset_key ?? '';
const defaultRole = (opts: EmphasisColorOption[]) => (opts.find((o) => o.is_default) ?? opts[0])?.role ?? '';

/** El borrador con el que abre el panel: lo vigente del video si lo hay, si no lo primero de cada catálogo. PURO. */
export function videoTextDraftOf(p: Pick<PieceTextProposal, 'presets' | 'cast' | 'accent_options' | 'strip_options' | 'proposals' | 'current'>): VideoTextDraft {
  const cur = p.current?.text_layers ?? null;
  const rolDe = (c: CastMember) => cur?.roles?.find((r) => r.person_id === c.person_id) ?? null;
  return {
    hook: {
      choice: cur?.hook?.text ? OWN : null, own: cur?.hook?.text ?? '',
      preset_key: cur?.hook?.preset_key ?? firstKey(p.presets, 'hook'),
      dur_s: cur?.hook ? Math.max(0.5, (cur.hook.end_ms - cur.hook.start_ms) / 1000) : 2.6,
    },
    roles: (p.cast ?? []).map((c, i) => {
      const r = rolDe(c);
      return {
        person_id: c.person_id, name: c.name, show: r ? r.show : false,
        text: r?.text ?? [c.name, c.title].filter(Boolean).join(' — '),
        at_s: r ? r.at_ms / 1000 : 0.4 + i * 4, dur_s: r ? r.dur_ms / 1000 : 3.8,
        preset_key: r?.preset_key ?? firstKey(p.presets, 'role'),
      };
    }),
    captions: {
      enabled: cur?.captions?.enabled ?? false,
      preset_key: cur?.captions?.preset_key ?? firstKey(p.presets, 'caption'),
      accent_role: cur?.captions?.accent_role ?? defaultRole(p.accent_options ?? []),
    },
    key_titles: [
      ...(p.proposals?.key_phrases ?? []).map((k) => {
        const v = cur?.key_titles?.find((t) => t.text === k.text);
        return { text: k.text, on: !!v, at_s: v ? v.at_ms / 1000 : 0, dur_s: v ? v.dur_ms / 1000 : 2.5, preset_key: v?.preset_key ?? firstKey(p.presets, 'key_title'), own: false };
      }),
      ...(cur?.key_titles ?? []).filter((t) => !(p.proposals?.key_phrases ?? []).some((k) => k.text === t.text))
        .map((t) => ({ text: t.text, on: true, at_s: t.at_ms / 1000, dur_s: t.dur_ms / 1000, preset_key: t.preset_key, own: true })),
    ],
    cta: {
      choice: cur?.cta?.text ? OWN : null, own: cur?.cta?.text ?? '',
      preset_key: cur?.cta?.preset_key ?? firstKey(p.presets, 'cta'), at_s: cur?.cta ? cur.cta.at_ms / 1000 : 0,
    },
    strip: { on: cur?.identity?.strip ?? false, role: cur?.identity?.strip_role ?? defaultRole(p.strip_options ?? []) },
  };
}

const ms = (s: number) => Math.max(0, Math.round((Number.isFinite(s) ? s : 0) * 1000));
const elegido = (choice: Choice, own: string, list: TextProposal[]): TextProposal | null => {
  if (choice === OWN) return own.trim() ? { text: own.trim(), pattern_key: null } : null;
  if (typeof choice === 'number') return list[choice] ?? null;
  return null;
};

/**
 * Lo que viaja a `apply`, en la forma del contrato §3.2. La validación de verdad la hace el server; aquí sólo se
 * traduce el borrador. `durationMs` coloca el CTA al final cuando no se eligió un segundo. PURO.
 */
export function textLayersFromDraft(d: VideoTextDraft, proposals: PieceTextProposal['proposals'], durationMs: number | null): TextLayers {
  const hook = elegido(d.hook.choice, d.hook.own, proposals.hooks);
  const cta = elegido(d.cta.choice, d.cta.own, proposals.share_ctas);
  const ctaAt = d.cta.at_s > 0 ? ms(d.cta.at_s) : Math.max(0, (durationMs ?? 0) - 6000);
  return {
    hook: hook ? { text: hook.text, preset_key: d.hook.preset_key, start_ms: 0, end_ms: ms(d.hook.dur_s), emphasis: [], pattern_key: hook.pattern_key ?? null } : null,
    roles: d.roles.filter((r) => r.show).map((r) => ({ person_id: r.person_id, text: r.text.trim(), show: true, at_ms: ms(r.at_s), dur_ms: ms(r.dur_s), preset_key: r.preset_key })),
    captions: d.captions.enabled ? { enabled: true, preset_key: d.captions.preset_key, accent_role: d.captions.accent_role } : null,
    key_titles: d.key_titles.filter((k) => k.on && k.text.trim()).map((k) => ({ text: k.text.trim(), at_ms: ms(k.at_s), dur_ms: ms(k.dur_s), preset_key: k.preset_key })),
    cta: cta ? { text: cta.text, at_ms: ctaAt, preset_key: d.cta.preset_key, pattern_key: cta.pattern_key ?? null } : null,
    identity: { strip: d.strip.on, strip_role: d.strip.on ? d.strip.role || null : null },
  };
}

/** Cada cuánto se pregunta por el render. */
export const POLL_MS = 5000;

// ── Piezas de la pantalla ────────────────────────────────────────────────────────────────────────

const errorDe = (err: unknown, caida: string) => (err instanceof CalibrationError ? err.message : caida);

function Seccion({ titulo, resumen, children }: { titulo: string; resumen?: string | null; children: React.ReactNode }) {
  return (
    <details className="rounded-xl border border-zinc-800 bg-zinc-950/40">
      <summary className="cursor-pointer select-none px-3 py-2 text-[12px] font-medium text-zinc-200 flex items-center justify-between gap-2">
        <span>{titulo}</span>
        {resumen && <span className="text-[10px] font-mono text-zinc-500 truncate">{resumen}</span>}
      </summary>
      <div className="px-3 pb-3 pt-1 space-y-2">{children}</div>
    </details>
  );
}

function Presets({ list, value, onChange, label }: { list: PresetsByLayer[keyof PresetsByLayer] | undefined; value: string; onChange: (k: string) => void; label: string }) {
  if (!list?.length) return <p className="text-[10px] text-amber-300/80">No hay estilos disponibles para esta capa.</p>;
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
      {list.map((p) => (
        <button key={p.preset_key} type="button" role="radio" aria-checked={value === p.preset_key} title={p.description}
          onClick={() => onChange(p.preset_key)}
          className={cn('px-2 py-1 rounded-lg text-[11px] border transition-colors',
            value === p.preset_key ? 'border-violet-500/70 bg-violet-500/15 text-violet-100' : 'border-zinc-800 text-zinc-400 hover:border-zinc-600')}>
          {p.name}
        </button>
      ))}
    </div>
  );
}

function Colores({ opts, value, onChange, label }: { opts: EmphasisColorOption[]; value: string; onChange: (r: string) => void; label: string }) {
  if (!opts.length) return <p className="text-[10px] text-zinc-500">La marca no declara colores para esto.</p>;
  return (
    <div className="flex items-center gap-1.5 flex-wrap" role="radiogroup" aria-label={label}>
      {opts.map((o) => (
        <button key={o.role} type="button" role="radio" aria-checked={value === o.role} onClick={() => onChange(o.role)}
          title={`${o.role}${o.is_default ? ' (el de la marca)' : ''}`}
          className={cn('flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] border',
            value === o.role ? 'border-violet-500/70 bg-violet-500/15 text-violet-100' : 'border-zinc-800 text-zinc-400 hover:border-zinc-600')}>
          <span className="inline-block w-3 h-3 rounded-full border border-white/20" style={{ background: o.hex }} />
          {o.role}
        </button>
      ))}
    </div>
  );
}

function Segundo({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <label className="flex items-center gap-1 text-[11px] text-zinc-400">
      {label}
      <input type="number" min={0} step={0.1} value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-16 bg-zinc-950/60 border border-zinc-800 rounded px-1.5 py-0.5 text-zinc-200 text-[11px]" />
      s
    </label>
  );
}

/** Tarjetas seleccionables de propuestas + «Escribir uno propio». */
function Propuestas({ list, choice, own, onChoice, onOwn, propio }: {
  list: TextProposal[]; choice: Choice; own: string; onChoice: (c: Choice) => void; onOwn: (t: string) => void; propio: string;
}) {
  return (
    <div className="space-y-1.5">
      {list.map((h, i) => (
        <button key={i} type="button" onClick={() => onChoice(choice === i ? null : i)} aria-pressed={choice === i}
          className={cn('w-full text-left rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors',
            choice === i ? 'border-violet-500/70 bg-violet-500/10 text-white' : 'border-zinc-800 text-zinc-300 hover:border-zinc-600')}>
          <span>{h.text}</span>
          {h.why && <span className="block text-[10px] text-zinc-500 mt-0.5">{h.why}</span>}
        </button>
      ))}
      <button type="button" onClick={() => onChoice(choice === OWN ? null : OWN)} aria-pressed={choice === OWN}
        className={cn('w-full text-left rounded-lg border px-2.5 py-1.5 text-[12px]',
          choice === OWN ? 'border-violet-500/70 bg-violet-500/10 text-white' : 'border-dashed border-zinc-700 text-zinc-400 hover:border-zinc-500')}>
        {propio}
      </button>
      {choice === OWN && (
        <input value={own} onChange={(e) => onOwn(e.target.value)} autoFocus aria-label={propio}
          className="w-full bg-zinc-950/60 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-violet-500/60" />
      )}
    </div>
  );
}

// ── El editor de video ───────────────────────────────────────────────────────────────────────────

export function VideoTextEditor({ pieceId, token, onApplied }: {
  pieceId: string; token: string;
  /** El video nuevo quedó en la pieza: la tarjeta cambia el artefacto. */
  onApplied?: (r: { html: string | null; artifact_url: string | null }) => void;
}) {
  const [prop, setProp] = useState<PieceTextProposal | null>(null);
  const [draft, setDraft] = useState<VideoTextDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<null | { id: string; since: number }>(null);
  const [done, setDone] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const proponer = () => {
    setLoading(true); setError(null);
    proposePieceText(token, pieceId)
      .then((r) => {
        setProp(r); setDraft(videoTextDraftOf(r));
        if (r.pending?.job_id) setJob({ id: r.pending.job_id, since: Date.now() });
      })
      .catch((err) => setError(errorDe(err, 'No se pudieron pedir las propuestas a CopyLab.')))
      .finally(() => setLoading(false));
  };
  useEffect(proponer, [pieceId, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sondeo del render mientras haya un job en curso.
  useEffect(() => {
    if (!job) return;
    const tick = () => pollPieceText(token, pieceId).then((r) => {
      if (r.status === 'running') return;
      setJob(null);
      if (r.status === 'completed') {
        setDone(`Listo: la pieza ya tiene el video nuevo${r.video?.version ? ` (${r.video.version})` : ''}. El anterior quedó en el historial.`);
        onApplied?.({ html: r.html ?? null, artifact_url: r.artifact_url ?? null });
      } else if (r.status === 'failed') {
        setError(`VideoLab no pudo aplicar el texto (${r.error_label}): ${r.detail}`);
      }
    }).catch((err) => setError(errorDe(err, 'No se pudo consultar el render.')));
    timer.current = setInterval(tick, POLL_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [job, pieceId, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const aplicar = () => {
    if (!prop || !draft) return;
    setError(null); setDone(null);
    applyPieceText(token, pieceId, textLayersFromDraft(draft, prop.proposals, prop.duration_ms))
      .then((r) => setJob({ id: r.job_id, since: Date.now() }))
      .catch((err) => setError(errorDe(err, 'No se pudo mandar el texto a VideoLab.')));
  };

  if (loading && !prop) return <p className="flex items-center gap-2 text-[11px] text-zinc-400"><Spinner size={12} /> CopyLab está proponiendo los textos…</p>;
  if (!prop || !draft) {
    return (
      <div className="space-y-1.5">
        {error && <p className="text-[11px] text-rose-300">{error}</p>}
        <button type="button" onClick={proponer} className="px-3 py-1 rounded-lg text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200">Volver a pedir propuestas</button>
      </div>
    );
  }

  const set = (patch: Partial<VideoTextDraft>) => setDraft({ ...draft, ...patch });
  const p = prop.presets;
  const sinLimpio = !prop.has_clean_video;
  const hookElegido = elegido(draft.hook.choice, draft.hook.own, prop.proposals.hooks);
  const ctaElegido = elegido(draft.cta.choice, draft.cta.own, prop.proposals.share_ctas);
  const enCurso = !!job;

  return (
    <div className="space-y-2">
      {sinLimpio && (
        <p className="text-[11px] leading-snug rounded-lg px-3 py-2 border border-amber-500/40 bg-amber-500/[0.08] text-amber-200">
          {prop.clean_video_note}
        </p>
      )}
      {prop.presets_error && <p className="text-[11px] text-amber-300/90">{prop.presets_error}</p>}
      {prop.meta?.n8_filter === 'no_recent_list' && (
        <p className="text-[10px] text-zinc-500">CopyLab no recibió los patrones recientes: los ganchos pueden repetir patrón.</p>
      )}

      <Seccion titulo="Gancho" resumen={hookElegido?.text ?? null}>
        <Propuestas list={prop.proposals.hooks} choice={draft.hook.choice} own={draft.hook.own} propio="Escribir uno propio"
          onChoice={(c) => set({ hook: { ...draft.hook, choice: c } })} onOwn={(t) => set({ hook: { ...draft.hook, own: t } })} />
        <p className="text-[10px] text-zinc-500">Animación</p>
        <Presets list={p?.hook} value={draft.hook.preset_key} label="Animación del gancho" onChange={(k) => set({ hook: { ...draft.hook, preset_key: k } })} />
        <Segundo label="Duración" value={draft.hook.dur_s} onChange={(n) => set({ hook: { ...draft.hook, dur_s: n } })} />
      </Seccion>

      <Seccion titulo="Rol de las personas" resumen={`${draft.roles.filter((r) => r.show).length} de ${draft.roles.length}`}>
        {!draft.roles.length && <p className="text-[11px] text-zinc-500">El video no tiene el elenco guardado como dato: no hay personas que rotular.</p>}
        {draft.roles.map((r, i) => {
          const upd = (patch: Partial<typeof r>) => set({ roles: draft.roles.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
          return (
            <div key={r.person_id} className="space-y-1.5 border-b border-zinc-800/60 pb-2 last:border-0">
              <label className="flex items-center gap-2 text-[12px] text-zinc-200">
                <input type="checkbox" checked={r.show} onChange={(e) => upd({ show: e.target.checked })} />
                {r.name}
              </label>
              {r.show && (
                <>
                  <input value={r.text} onChange={(e) => upd({ text: e.target.value })} aria-label={`Rótulo de ${r.name}`}
                    className="w-full bg-zinc-950/60 border border-zinc-800 rounded-lg px-2.5 py-1 text-[12px] text-zinc-200" />
                  <div className="flex gap-3 flex-wrap">
                    <Segundo label="Aparece en" value={r.at_s} onChange={(n) => upd({ at_s: n })} />
                    <Segundo label="Dura" value={r.dur_s} onChange={(n) => upd({ dur_s: n })} />
                  </div>
                  <Presets list={p?.role} value={r.preset_key} label={`Formato del rótulo de ${r.name}`} onChange={(k) => upd({ preset_key: k })} />
                </>
              )}
            </div>
          );
        })}
      </Seccion>

      <Seccion titulo="Subtítulos" resumen={draft.captions.enabled ? draft.captions.accent_role : 'sin subtítulos'}>
        <label className="flex items-center gap-2 text-[12px] text-zinc-200">
          <input type="checkbox" checked={draft.captions.enabled} onChange={(e) => set({ captions: { ...draft.captions, enabled: e.target.checked } })} />
          Mostrar subtítulos
        </label>
        {draft.captions.enabled && (
          <>
            <p className="text-[10px] text-zinc-500">Color de acento</p>
            <Colores opts={prop.accent_options} value={draft.captions.accent_role} label="Color de acento de los subtítulos"
              onChange={(r) => set({ captions: { ...draft.captions, accent_role: r } })} />
            <p className="text-[10px] text-zinc-500">Estilo</p>
            <Presets list={p?.caption} value={draft.captions.preset_key} label="Estilo de los subtítulos"
              onChange={(k) => set({ captions: { ...draft.captions, preset_key: k } })} />
          </>
        )}
      </Seccion>

      <Seccion titulo="Títulos clave" resumen={`${draft.key_titles.filter((k) => k.on).length} elegidos`}>
        {draft.key_titles.map((k, i) => {
          const upd = (patch: Partial<typeof k>) => set({ key_titles: draft.key_titles.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
          return (
            <div key={i} className="space-y-1">
              <label className="flex items-start gap-2 text-[12px] text-zinc-200">
                <input type="checkbox" className="mt-0.5" checked={k.on} onChange={(e) => upd({ on: e.target.checked })} />
                {k.own
                  ? <input value={k.text} onChange={(e) => upd({ text: e.target.value })} aria-label="Título clave propio"
                      className="flex-1 bg-zinc-950/60 border border-zinc-800 rounded px-2 py-0.5 text-[12px] text-zinc-200" />
                  : <span>{k.text}</span>}
              </label>
              {k.on && (
                <div className="flex gap-3 flex-wrap pl-5 items-center">
                  <Segundo label="En el segundo" value={k.at_s} onChange={(n) => upd({ at_s: n })} />
                  <Segundo label="Dura" value={k.dur_s} onChange={(n) => upd({ dur_s: n })} />
                  <Presets list={p?.key_title} value={k.preset_key} label="Estilo del título clave" onChange={(key) => upd({ preset_key: key })} />
                </div>
              )}
            </div>
          );
        })}
        <button type="button"
          onClick={() => set({ key_titles: [...draft.key_titles, { text: '', on: true, at_s: 0, dur_s: 2.5, preset_key: firstKey(p, 'key_title'), own: true }] })}
          className="px-2.5 py-1 rounded-lg text-[11px] border border-dashed border-zinc-700 text-zinc-400 hover:border-zinc-500">
          Añadir uno propio
        </button>
      </Seccion>

      <Seccion titulo="CTA de reenvío" resumen={ctaElegido?.text ?? null}>
        {!prop.proposals.share_ctas.length && <p className="text-[11px] text-zinc-500">CopyLab no propuso CTA de reenvío para esta pieza.</p>}
        <Propuestas list={prop.proposals.share_ctas} choice={draft.cta.choice} own={draft.cta.own} propio="Escribir uno propio"
          onChoice={(c) => set({ cta: { ...draft.cta, choice: c } })} onOwn={(t) => set({ cta: { ...draft.cta, own: t } })} />
        <p className="text-[10px] text-zinc-500">Formato</p>
        <Presets list={p?.cta} value={draft.cta.preset_key} label="Formato del CTA" onChange={(k) => set({ cta: { ...draft.cta, preset_key: k } })} />
        <Segundo label="En el segundo (0 = 6 s antes del final)" value={draft.cta.at_s} onChange={(n) => set({ cta: { ...draft.cta, at_s: n } })} />
      </Seccion>

      <Seccion titulo="Franja" resumen={draft.strip.on ? draft.strip.role : 'sin franja'}>
        <label className="flex items-center gap-2 text-[12px] text-zinc-200">
          <input type="checkbox" checked={draft.strip.on} onChange={(e) => set({ strip: { ...draft.strip, on: e.target.checked } })} />
          Mostrar la franja de la marca
        </label>
        {draft.strip.on && (
          <Colores opts={prop.strip_options} value={draft.strip.role} label="Color de la franja" onChange={(r) => set({ strip: { ...draft.strip, role: r } })} />
        )}
      </Seccion>

      {error && <p className="text-[11px] text-rose-300 leading-snug">{error}</p>}
      {done && <p className="text-[11px] text-emerald-300 leading-snug">{done}</p>}
      {enCurso && (
        <p className="flex items-center gap-2 text-[11px] text-zinc-300"><Spinner size={12} /> VideoLab está aplicando el texto sobre el video limpio…</p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={aplicar} disabled={sinLimpio || enCurso || !p}
          title={sinLimpio ? prop.clean_video_note ?? undefined : undefined}
          className="flex-1 py-2 rounded-lg text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed">
          Aplicar
        </button>
        <button type="button" onClick={proponer} disabled={loading || enCurso}
          className="px-3 py-2 rounded-lg text-[12px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">
          {loading ? <Spinner size={12} /> : 'Otras propuestas'}
        </button>
      </div>
      <p className="text-[10px] font-mono leading-snug text-zinc-600">
        Sólo se vuelve a dibujar el texto sobre el video limpio: no se regeneran las tomas. El video anterior queda en el historial.
      </p>
    </div>
  );
}

// ── Ganchos propuestos para una imagen ───────────────────────────────────────────────────────────

/** Sección plegada dentro del editor de texto de la imagen: elegir un gancho llena el titular. */
export function HookProposals({ pieceId, token, onPick }: { pieceId: string; token: string; onPick: (text: string) => void }) {
  const [hooks, setHooks] = useState<TextProposal[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pedir = () => {
    setLoading(true); setError(null);
    proposePieceText(token, pieceId)
      .then((r) => setHooks(r.proposals.hooks))
      .catch((err) => setError(errorDe(err, 'No se pudieron pedir los ganchos a CopyLab.')))
      .finally(() => setLoading(false));
  };
  return (
    <details className="rounded-xl border border-zinc-800 bg-zinc-950/40"
      onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open && hooks === null && !loading) pedir(); }}>
      <summary className="cursor-pointer select-none px-3 py-2 text-[12px] font-medium text-zinc-200">Ganchos propuestos</summary>
      <div className="px-3 pb-3 pt-1 space-y-1.5">
        {loading && <p className="flex items-center gap-2 text-[11px] text-zinc-400"><Spinner size={12} /> CopyLab está proponiendo ganchos…</p>}
        {error && <p className="text-[11px] text-rose-300">{error}</p>}
        {(hooks ?? []).map((h, i) => (
          <button key={i} type="button" onClick={() => onPick(h.text)}
            className="w-full text-left rounded-lg border border-zinc-800 px-2.5 py-1.5 text-[12px] text-zinc-300 hover:border-violet-500/60">
            {h.text}
            {h.why && <span className="block text-[10px] text-zinc-500 mt-0.5">{h.why}</span>}
          </button>
        ))}
        {hooks !== null && !loading && (
          <button type="button" onClick={pedir} className="px-2.5 py-1 rounded-lg text-[11px] text-zinc-400 hover:bg-zinc-800">Otras propuestas</button>
        )}
        <p className="text-[10px] text-zinc-600">Elegir uno lo copia al titular; se puede retocar antes de aplicar.</p>
      </div>
    </details>
  );
}
