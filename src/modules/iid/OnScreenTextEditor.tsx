import React, { useEffect, useRef, useState } from 'react';
import { cn, Spinner } from '../../ui/components';
import {
  proposePieceText, applyPieceText, pollPieceText, CalibrationError,
  type PieceTextProposal, type TextProposal,
} from '../../services/calibrationInbox';
import type { CastMember, PresetsByLayer, TextLayers } from '../../../api/_pieceText';
import type { EmphasisColorOption } from '../../../api/_overlayText';
import {
  BLOCK_LABELS, CAPTIONS_BAND, PCT_STEP, PREVIEW_AUTO, PREVIEW_NOTE, ROLE_NO_PERSONA, VIDEO_SAFE_ZONE_APPROX,
  ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, blockSupport, clampPct, clampPlace, clampZoom, controlSupport, previewRect,
  type ImagePlacementDraft, type Medium, type Place, type SafeZone, type ScreenBlock,
} from '../../../api/_onScreenText';

/**
 * OnScreenTextEditor.tsx — UNA SOLA VENTANA «TEXTO EN PANTALLA» PARA IMAGEN Y VIDEO (2026-11-16).
 *
 * Contrato «Bloques de texto colocados a mano» v1 §4. Sustituye a las dos ventanas que había: el editor del texto en
 * pantalla del video (`VideoTextEditor`, este mismo archivo antes de renombrarse) y los controles de ubicación y tamaño
 * de «Texto de la imagen». Una tarjeta por bloque, en el mismo orden en los dos formatos: Título/Gancho, Subtítulo,
 * Títulos clave, CTA, Rol y Subtítulos. Cada tarjeta lleva su texto (y en video sus propuestas, estilo y tiempos), X, Y
 * y Zoom, y un botón «Automático» que quita la colocación a mano. Lo que no aplica al formato se pinta DESACTIVADO con
 * su motivo (`_onScreenText.ts`, `blockSupport` y `controlSupport`); no se oculta.
 *
 * Todas las secciones abren PLEGADAS (regla de Sam). El patrón de pliegue es el `<details>` nativo de las tarjetas.
 * Las propuestas las escribe CopyLab; el texto lo dibujan VideoLab (video) e ImageLab (imagen). Nada de marcas aquí:
 * presets, colores, personas, zona segura y proporción llegan del server.
 */

// ── El borrador del video y su traducción a capas (lógica pura, probable sin montar React) ─────────

export const OWN = 'own' as const;
export type Choice = number | typeof OWN | null;

export interface VideoTextDraft {
  hook: { choice: Choice; own: string; preset_key: string; dur_s: number; place: Place | null };
  roles: Array<{ person_id: string; name: string; show: boolean; text: string; at_s: number; dur_s: number; preset_key: string; place: Place | null }>;
  /** `zoom` null = el tamaño de siempre; los subtítulos sólo cambian de tamaño (banda fija). */
  captions: { enabled: boolean; preset_key: string; accent_role: string; zoom: number | null };
  key_titles: Array<{ text: string; on: boolean; at_s: number; dur_s: number; preset_key: string; own: boolean; place: Place | null }>;
  cta: { choice: Choice; own: string; preset_key: string; at_s: number; place: Place | null };
  strip: { on: boolean; role: string };
}

const firstKey = (presets: PresetsByLayer | null, layer: keyof PresetsByLayer) => presets?.[layer]?.[0]?.preset_key ?? '';
const defaultRole = (opts: EmphasisColorOption[]) => (opts.find((o) => o.is_default) ?? opts[0])?.role ?? '';
const placeOf = (p: unknown): Place | null => (p && typeof p === 'object' && 'x_pct' in (p as object) ? clampPlace(p as Place) : null);

/** El borrador con el que abre la ventana: lo vigente del video si lo hay, si no lo primero de cada catálogo. PURO. */
export function videoTextDraftOf(p: Pick<PieceTextProposal, 'presets' | 'cast' | 'accent_options' | 'strip_options' | 'proposals' | 'current'>): VideoTextDraft {
  const cur = p.current?.text_layers ?? null;
  const rolDe = (c: CastMember) => cur?.roles?.find((r) => r.person_id === c.person_id) ?? null;
  const zoomCap = cur?.captions?.place?.zoom;
  return {
    hook: {
      choice: cur?.hook?.text ? OWN : null, own: cur?.hook?.text ?? '',
      preset_key: cur?.hook?.preset_key ?? firstKey(p.presets, 'hook'),
      dur_s: cur?.hook ? Math.max(0.5, (cur.hook.end_ms - cur.hook.start_ms) / 1000) : 2.6,
      place: placeOf(cur?.hook?.place),
    },
    roles: (p.cast ?? []).map((c, i) => {
      const r = rolDe(c);
      return {
        person_id: c.person_id, name: c.name, show: r ? r.show : false,
        text: r?.text ?? [c.name, c.title].filter(Boolean).join(' — '),
        at_s: r ? r.at_ms / 1000 : 0.4 + i * 4, dur_s: r ? r.dur_ms / 1000 : 3.8,
        preset_key: r?.preset_key ?? firstKey(p.presets, 'role'),
        place: placeOf(r?.place),
      };
    }),
    captions: {
      enabled: cur?.captions?.enabled ?? false,
      preset_key: cur?.captions?.preset_key ?? firstKey(p.presets, 'caption'),
      accent_role: cur?.captions?.accent_role ?? defaultRole(p.accent_options ?? []),
      zoom: typeof zoomCap === 'number' ? clampZoom(zoomCap) : null,
    },
    key_titles: [
      ...(p.proposals?.key_phrases ?? []).map((k) => {
        const v = cur?.key_titles?.find((t) => t.text === k.text);
        return { text: k.text, on: !!v, at_s: v ? v.at_ms / 1000 : 0, dur_s: v ? v.dur_ms / 1000 : 2.5, preset_key: v?.preset_key ?? firstKey(p.presets, 'key_title'), own: false, place: placeOf(v?.place) };
      }),
      ...(cur?.key_titles ?? []).filter((t) => !(p.proposals?.key_phrases ?? []).some((k) => k.text === t.text))
        .map((t) => ({ text: t.text, on: true, at_s: t.at_ms / 1000, dur_s: t.dur_ms / 1000, preset_key: t.preset_key, own: true, place: placeOf(t.place) })),
    ],
    cta: {
      choice: cur?.cta?.text ? OWN : null, own: cur?.cta?.text ?? '',
      preset_key: cur?.cta?.preset_key ?? firstKey(p.presets, 'cta'), at_s: cur?.cta ? cur.cta.at_ms / 1000 : 0,
      place: placeOf(cur?.cta?.place),
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
/** `place` viaja sólo si el bloque está a mano: sin él, VideoLab lo coloca como siempre (contrato §1). */
const conPlace = (p: Place | null) => (p ? { place: clampPlace(p) } : {});

/**
 * Lo que viaja a `apply`, en la forma del contrato §3.2 más `place` por capa (contrato «Bloques a mano» §2). La
 * validación de verdad la hace el server; aquí sólo se traduce el borrador. `durationMs` coloca el CTA al final
 * cuando no se eligió un segundo. PURO.
 */
export function textLayersFromDraft(d: VideoTextDraft, proposals: PieceTextProposal['proposals'], durationMs: number | null): TextLayers {
  const hook = elegido(d.hook.choice, d.hook.own, proposals.hooks);
  const cta = elegido(d.cta.choice, d.cta.own, proposals.share_ctas);
  const ctaAt = d.cta.at_s > 0 ? ms(d.cta.at_s) : Math.max(0, (durationMs ?? 0) - 6000);
  return {
    hook: hook ? { text: hook.text, preset_key: d.hook.preset_key, start_ms: 0, end_ms: ms(d.hook.dur_s), emphasis: [], pattern_key: hook.pattern_key ?? null, ...conPlace(d.hook.place) } : null,
    roles: d.roles.filter((r) => r.show).map((r) => ({ person_id: r.person_id, text: r.text.trim(), show: true, at_ms: ms(r.at_s), dur_ms: ms(r.dur_s), preset_key: r.preset_key, ...conPlace(r.place) })),
    captions: d.captions.enabled
      ? { enabled: true, preset_key: d.captions.preset_key, accent_role: d.captions.accent_role, ...(d.captions.zoom != null ? { place: { zoom: clampZoom(d.captions.zoom) } } : {}) }
      : null,
    key_titles: d.key_titles.filter((k) => k.on && k.text.trim()).map((k) => ({ text: k.text.trim(), at_ms: ms(k.at_s), dur_ms: ms(k.dur_s), preset_key: k.preset_key, ...conPlace(k.place) })),
    cta: cta ? { text: cta.text, at_ms: ctaAt, preset_key: d.cta.preset_key, pattern_key: cta.pattern_key ?? null, ...conPlace(d.cta.place) } : null,
    identity: { strip: d.strip.on, strip_role: d.strip.on ? d.strip.role || null : null },
  };
}

/** Los rectángulos de la vista previa de un video: un bloque por capa elegida. PURO. */
export function videoPreviewItems(d: VideoTextDraft, proposals: PieceTextProposal['proposals']): PreviewItem[] {
  const out: PreviewItem[] = [];
  if (elegido(d.hook.choice, d.hook.own, proposals.hooks)) out.push({ block: 'headline', label: 'Gancho', place: d.hook.place });
  d.key_titles.filter((k) => k.on && k.text.trim()).forEach((k, i) => out.push({ block: 'key_titles', label: `Título clave ${i + 1}`, place: k.place }));
  if (elegido(d.cta.choice, d.cta.own, proposals.share_ctas)) out.push({ block: 'cta', label: 'CTA', place: d.cta.place });
  d.roles.filter((r) => r.show).forEach((r) => out.push({ block: 'role', label: `Rol · ${r.name}`, place: r.place }));
  if (d.captions.enabled) out.push({ block: 'captions', label: 'Subtítulos', place: null, zoom: d.captions.zoom });
  return out;
}

/** Los rectángulos de la vista previa de una imagen. PURO. */
export function imagePreviewItems(d: ImagePlacementDraft, hasSub: boolean): PreviewItem[] {
  return [
    { block: 'headline', label: 'Título', place: d.headline },
    ...(hasSub ? [{ block: 'subheadline' as const, label: 'Subtítulo', place: d.subheadline }] : []),
    ...(d.role.enabled ? [{ block: 'role' as const, label: 'Rol', place: d.role.place }] : []),
  ];
}

/** Cada cuánto se pregunta por el render. */
export const POLL_MS = 5000;

// ── Piezas comunes de la ventana ─────────────────────────────────────────────────────────────────

const errorDe = (err: unknown, caida: string) => (err instanceof CalibrationError ? err.message : caida);

export interface PreviewItem { block: ScreenBlock; label: string; place: Place | null; zoom?: number | null }

function Seccion({ titulo, resumen, children, disabledReason }: {
  titulo: string; resumen?: string | null; children?: React.ReactNode; disabledReason?: string | null;
}) {
  if (disabledReason) {
    // Lo que no aplica al formato se VE, desactivado y con su motivo (contrato §4): no se oculta.
    return (
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/20 px-3 py-2 opacity-60" aria-disabled="true">
        <p className="text-[12px] font-medium text-zinc-400">{titulo}</p>
        <p className="text-[10px] text-zinc-500 leading-snug">{disabledReason}</p>
      </div>
    );
  }
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

/** Un control que no aplica al formato: desactivado, con su motivo. */
function NoAplica({ label, reason }: { label: string; reason: string }) {
  return (
    <p className="text-[10px] text-zinc-500 leading-snug opacity-70" aria-disabled="true">
      <span className="line-through decoration-zinc-600 mr-1">{label}</span>— {reason}
    </p>
  );
}

function Deslizador({ label, value, min, max, step, fmt, onChange, disabled, reason }: {
  label: string; value: number; min: number; max: number; step: number; fmt: (n: number) => string;
  onChange: (n: number) => void; disabled?: boolean; reason?: string | null;
}) {
  return (
    <label className={cn('flex items-center gap-2 text-[11px]', disabled ? 'text-zinc-600' : 'text-zinc-400')} title={reason ?? undefined}>
      <span className="w-10 shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))} aria-label={label} aria-valuetext={fmt(value)}
        className="flex-1 accent-violet-400 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40" />
      <span className="w-12 text-right font-mono text-zinc-300">{disabled ? '—' : fmt(value)}</span>
    </label>
  );
}

const pct = (n: number) => `${Math.round(n)} %`;
const zx = (n: number) => `${n.toFixed(2).replace('.', ',')}×`;

/**
 * X, Y y Zoom de un bloque, y «Automático». `place` null = automático: el lab elige el lugar y esquiva caras. Al pasar
 * a mano, el bloque arranca donde lo dibuja la vista previa en automático, para que no salte.
 */
export function PlaceControls({ medium, block, place, onChange, zoomOnly, zoom, onZoom, disabledReason }: {
  medium: Medium; block: ScreenBlock; place: Place | null; onChange: (p: Place | null) => void;
  /** Subtítulos del video: sólo zoom (`zoom`/`onZoom`). */
  zoomOnly?: boolean; zoom?: number | null; onZoom?: (z: number | null) => void;
  /** Toda la colocación desactivada (p. ej. una lámina 2..N): el motivo. */
  disabledReason?: string | null;
}) {
  if (disabledReason) return <NoAplica label="X, Y y Zoom" reason={disabledReason} />;
  if (zoomOnly) {
    const z = zoom ?? 1;
    return (
      <div className="space-y-1 rounded-lg border border-zinc-800/70 p-2">
        <NoAplica label="X e Y" reason={CAPTIONS_BAND} />
        <Deslizador label="Zoom" value={z} min={ZOOM_MIN} max={ZOOM_MAX} step={ZOOM_STEP} fmt={zx} onChange={(n) => onZoom?.(clampZoom(n))} />
        <button type="button" onClick={() => onZoom?.(null)} disabled={zoom == null}
          className="px-2 py-0.5 rounded-lg text-[11px] border border-zinc-700 text-zinc-300 hover:text-white disabled:opacity-40">
          Tamaño de siempre
        </button>
      </div>
    );
  }
  const sx = controlSupport(medium, block, 'x');
  const auto = !place;
  return (
    <div className="space-y-1 rounded-lg border border-zinc-800/70 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-zinc-400">
          {auto ? 'Automático: el lab elige el lugar y esquiva caras.' : 'A mano: el bloque va donde se elige, no esquiva caras (el lab avisa si tapa una).'}
        </span>
        {auto
          ? <button type="button" disabled={!sx.enabled} title={sx.reason ?? undefined}
              onClick={() => onChange(clampPlace({ ...PREVIEW_AUTO[block], zoom: 1 }))}
              className="px-2 py-0.5 rounded-lg text-[11px] border border-violet-500/60 bg-violet-500/15 text-violet-100 hover:bg-violet-500/25 disabled:opacity-40">
              Colocar a mano
            </button>
          : <button type="button" onClick={() => onChange(null)}
              className="px-2 py-0.5 rounded-lg text-[11px] border border-zinc-700 text-zinc-300 hover:text-white">
              Automático
            </button>}
      </div>
      <Deslizador label="X" value={place?.x_pct ?? PREVIEW_AUTO[block].x_pct} min={0} max={100} step={PCT_STEP} fmt={pct} disabled={auto}
        onChange={(n) => place && onChange({ ...place, x_pct: clampPct(n) })} />
      <Deslizador label="Y" value={place?.y_pct ?? PREVIEW_AUTO[block].y_pct} min={0} max={100} step={PCT_STEP} fmt={pct} disabled={auto}
        onChange={(n) => place && onChange({ ...place, y_pct: clampPct(n) })} />
      <Deslizador label="Zoom" value={place?.zoom ?? 1} min={ZOOM_MIN} max={ZOOM_MAX} step={ZOOM_STEP} fmt={zx} disabled={auto}
        onChange={(n) => place && onChange({ ...place, zoom: clampZoom(n) })} />
      <p className="text-[10px] text-zinc-600">X e Y: el centro del bloque, de 0 a 100 % de la zona segura.</p>
    </div>
  );
}

/** El lienzo con la proporción de la pieza, la zona segura y un rectángulo por bloque. Aproximado. */
export function SchematicPreview({ aspect, safe, items }: { aspect: number; safe: SafeZone; items: PreviewItem[] }) {
  const ancho = aspect >= 1 ? 220 : Math.round(220 * aspect + 40);
  return (
    <div className="space-y-1">
      <div className="relative mx-auto rounded-md border border-zinc-700 bg-zinc-900 overflow-hidden"
        style={{ width: ancho, aspectRatio: String(aspect) }} aria-label="Vista previa esquemática del texto en pantalla" role="img">
        <div className="absolute border border-dashed border-emerald-500/50"
          style={{ left: `${safe.left}%`, top: `${safe.top}%`, right: `${safe.right}%`, bottom: `${safe.bottom}%` }} />
        {items.map((it, i) => {
          // Los subtítulos no se mueven: su ancla es la automática y sólo cambia el tamaño.
          const rz = !it.place && it.zoom != null
            ? previewRect(it.block, { ...PREVIEW_AUTO[it.block], zoom: it.zoom }, safe)
            : previewRect(it.block, it.place, safe);
          const manual = !!it.place;
          return (
            <div key={i} title={`${it.label} · ${manual ? 'a mano' : 'automático'}`}
              className={cn('absolute rounded-sm border text-[8px] leading-tight px-0.5 overflow-hidden',
                manual ? 'border-violet-400 bg-violet-500/25 text-violet-100' : 'border-dashed border-zinc-400/70 bg-zinc-500/10 text-zinc-300')}
              style={{ left: `${rz.left}%`, top: `${rz.top}%`, width: `${rz.width}%`, height: `${rz.height}%` }}>
              {it.label}
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-zinc-500 leading-snug text-center">
        Verde: zona segura. Morado: a mano. Punteado: automático. {PREVIEW_NOTE}
      </p>
    </div>
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

/** Las tarjetas que no aplican a este formato, pintadas desactivadas en su sitio. */
const noAplica = (medium: Medium, block: ScreenBlock) => {
  const s = blockSupport(medium, block);
  return s.enabled ? null : s.reason;
};

// ── La ventana ───────────────────────────────────────────────────────────────────────────────────

export type OnScreenTextEditorProps =
  | {
    medium: 'video'; pieceId: string; token: string;
    /** El video nuevo quedó en la pieza: la tarjeta cambia el artefacto. */
    onApplied?: (r: { html: string | null; artifact_url: string | null }) => void;
  }
  | {
    medium: 'image';
    aspect: number; safeZone: SafeZone;
    /** La colocación de cada bloque y el rol. La aplica el panel con «Aplicar» (`recomposeImage` con `blocks`). */
    draft: ImagePlacementDraft; onDraft: (d: ImagePlacementDraft) => void;
    /** ¿Hay persona que rotular? Si no, el interruptor «Mostrar rol» queda desactivado con su motivo. */
    roleAvailable: boolean;
    /** El texto del titular y de la bajada, con su estilo: los editores de siempre, dentro de su tarjeta. */
    headlineSlot: React.ReactNode; subheadlineSlot: React.ReactNode; hasSubheadline: boolean;
    /** Lo que vale para todo el texto de la imagen (colores del resaltado, sombra, franja, barra lateral). */
    generalSlot?: React.ReactNode;
    /** Los atajos de la colocación automática (fila, columna, tamaño): rigen los bloques en «Automático». */
    shortcutsSlot?: React.ReactNode;
    /** Una lámina 2..N de un carrusel: se coloca con los atajos; X, Y y Zoom rigen la imagen y la portada. */
    placementDisabledReason?: string | null;
  };

export function OnScreenTextEditor(props: OnScreenTextEditorProps) {
  return props.medium === 'video' ? <VideoBody {...props} /> : <ImageBody {...props} />;
}

// ── Imagen ───────────────────────────────────────────────────────────────────────────────────────

function ImageBody(p: Extract<OnScreenTextEditorProps, { medium: 'image' }>) {
  const d = p.draft;
  const set = (patch: Partial<ImagePlacementDraft>) => p.onDraft({ ...d, ...patch });
  const entry = controlSupport('image', 'headline', 'entry');
  const lam = p.placementDisabledReason ?? null;
  return (
    <div className="space-y-2">
      <Seccion titulo="Vista previa" resumen="aproximada">
        <SchematicPreview aspect={p.aspect} safe={p.safeZone} items={imagePreviewItems(d, p.hasSubheadline)} />
      </Seccion>

      <Seccion titulo={BLOCK_LABELS.headline} resumen={d.headline ? 'a mano' : 'automático'}>
        {p.headlineSlot}
        <NoAplica label="Animación y segundo de entrada" reason={entry.reason ?? ''} />
        <PlaceControls medium="image" block="headline" place={d.headline} onChange={(pl) => set({ headline: pl })} disabledReason={lam} />
      </Seccion>

      <Seccion titulo={BLOCK_LABELS.subheadline} resumen={d.subheadline ? 'a mano' : 'automático'}>
        {p.subheadlineSlot}
        <NoAplica label="Animación y segundo de entrada" reason={entry.reason ?? ''} />
        <PlaceControls medium="image" block="subheadline" place={d.subheadline} onChange={(pl) => set({ subheadline: pl })}
          disabledReason={lam ?? (p.hasSubheadline ? null : 'Escribe primero la bajada: sin texto no hay bloque que colocar.')} />
      </Seccion>

      <Seccion titulo={BLOCK_LABELS.key_titles} disabledReason={noAplica('image', 'key_titles')} />
      <Seccion titulo={BLOCK_LABELS.cta} disabledReason={noAplica('image', 'cta')} />

      <Seccion titulo={BLOCK_LABELS.role} resumen={d.role.enabled ? 'se muestra' : 'apagado'}>
        <label className={cn('flex items-center gap-2 text-[12px]', p.roleAvailable && !lam ? 'text-zinc-200' : 'text-zinc-500')}
          title={!p.roleAvailable ? ROLE_NO_PERSONA : lam ?? undefined}>
          <input type="checkbox" checked={d.role.enabled && p.roleAvailable} disabled={!p.roleAvailable || !!lam}
            onChange={(e) => set({ role: { ...d.role, enabled: e.target.checked } })} />
          Mostrar rol
        </label>
        {!p.roleAvailable && <p className="text-[10px] text-zinc-500 leading-snug">{ROLE_NO_PERSONA}</p>}
        {lam && <p className="text-[10px] text-zinc-500 leading-snug">{lam}</p>}
        {d.role.enabled && p.roleAvailable && !lam && (
          <>
            <input value={d.role.text} onChange={(e) => set({ role: { ...d.role, text: e.target.value } })} aria-label="Texto del rol"
              className="w-full bg-zinc-950/60 border border-zinc-800 rounded-lg px-2.5 py-1 text-[12px] text-zinc-200" />
            <p className="text-[10px] text-zinc-500">Nombre — Cargo — Marca, de la ficha de la persona; se puede retocar.</p>
            <NoAplica label="Animación y segundo de entrada" reason={entry.reason ?? ''} />
            <PlaceControls medium="image" block="role" place={d.role.place} onChange={(pl) => set({ role: { ...d.role, place: pl } })} />
          </>
        )}
      </Seccion>

      <Seccion titulo={BLOCK_LABELS.captions} disabledReason={noAplica('image', 'captions')} />

      {p.shortcutsSlot && (
        <Seccion titulo="Colocación automática (atajos)" resumen="rige los bloques en Automático">{p.shortcutsSlot}</Seccion>
      )}
      {p.generalSlot && <Seccion titulo="Estilo de todo el texto">{p.generalSlot}</Seccion>}
    </div>
  );
}

// ── Video ────────────────────────────────────────────────────────────────────────────────────────

function VideoBody({ pieceId, token, onApplied }: Extract<OnScreenTextEditorProps, { medium: 'video' }>) {
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
  const modo = (pl: Place | null) => (pl ? 'a mano' : 'automático');

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

      <Seccion titulo="Vista previa" resumen="aproximada">
        <SchematicPreview aspect={prop.aspect ?? 9 / 16} safe={VIDEO_SAFE_ZONE_APPROX} items={videoPreviewItems(draft, prop.proposals)} />
      </Seccion>

      <Seccion titulo={BLOCK_LABELS.headline} resumen={hookElegido ? `${hookElegido.text} · ${modo(draft.hook.place)}` : null}>
        <Propuestas list={prop.proposals.hooks} choice={draft.hook.choice} own={draft.hook.own} propio="Escribir uno propio"
          onChoice={(c) => set({ hook: { ...draft.hook, choice: c } })} onOwn={(t) => set({ hook: { ...draft.hook, own: t } })} />
        <p className="text-[10px] text-zinc-500">Animación</p>
        <Presets list={p?.hook} value={draft.hook.preset_key} label="Animación del gancho" onChange={(k) => set({ hook: { ...draft.hook, preset_key: k } })} />
        <Segundo label="Duración" value={draft.hook.dur_s} onChange={(n) => set({ hook: { ...draft.hook, dur_s: n } })} />
        <PlaceControls medium="video" block="headline" place={draft.hook.place} onChange={(pl) => set({ hook: { ...draft.hook, place: pl } })} />
      </Seccion>

      <Seccion titulo={BLOCK_LABELS.subheadline} disabledReason={noAplica('video', 'subheadline')} />

      <Seccion titulo={BLOCK_LABELS.key_titles} resumen={`${draft.key_titles.filter((k) => k.on).length} elegidos`}>
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
                <div className="space-y-1.5 pl-5">
                  <div className="flex gap-3 flex-wrap items-center">
                    <Segundo label="En el segundo" value={k.at_s} onChange={(n) => upd({ at_s: n })} />
                    <Segundo label="Dura" value={k.dur_s} onChange={(n) => upd({ dur_s: n })} />
                  </div>
                  <Presets list={p?.key_title} value={k.preset_key} label="Estilo del título clave" onChange={(key) => upd({ preset_key: key })} />
                  <PlaceControls medium="video" block="key_titles" place={k.place} onChange={(pl) => upd({ place: pl })} />
                </div>
              )}
            </div>
          );
        })}
        <button type="button"
          onClick={() => set({ key_titles: [...draft.key_titles, { text: '', on: true, at_s: 0, dur_s: 2.5, preset_key: firstKey(p, 'key_title'), own: true, place: null }] })}
          className="px-2.5 py-1 rounded-lg text-[11px] border border-dashed border-zinc-700 text-zinc-400 hover:border-zinc-500">
          Añadir uno propio
        </button>
      </Seccion>

      <Seccion titulo={BLOCK_LABELS.cta} resumen={ctaElegido ? `${ctaElegido.text} · ${modo(draft.cta.place)}` : null}>
        {!prop.proposals.share_ctas.length && <p className="text-[11px] text-zinc-500">CopyLab no propuso CTA de reenvío para esta pieza.</p>}
        <Propuestas list={prop.proposals.share_ctas} choice={draft.cta.choice} own={draft.cta.own} propio="Escribir uno propio"
          onChoice={(c) => set({ cta: { ...draft.cta, choice: c } })} onOwn={(t) => set({ cta: { ...draft.cta, own: t } })} />
        <p className="text-[10px] text-zinc-500">Formato</p>
        <Presets list={p?.cta} value={draft.cta.preset_key} label="Formato del CTA" onChange={(k) => set({ cta: { ...draft.cta, preset_key: k } })} />
        <Segundo label="En el segundo (0 = 6 s antes del final)" value={draft.cta.at_s} onChange={(n) => set({ cta: { ...draft.cta, at_s: n } })} />
        <PlaceControls medium="video" block="cta" place={draft.cta.place} onChange={(pl) => set({ cta: { ...draft.cta, place: pl } })} />
      </Seccion>

      <Seccion titulo={BLOCK_LABELS.role} resumen={`${draft.roles.filter((r) => r.show).length} de ${draft.roles.length}`}>
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
                  <PlaceControls medium="video" block="role" place={r.place} onChange={(pl) => upd({ place: pl })} />
                </>
              )}
            </div>
          );
        })}
      </Seccion>

      <Seccion titulo={BLOCK_LABELS.captions} resumen={draft.captions.enabled ? draft.captions.accent_role : 'sin subtítulos'}>
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
            <PlaceControls medium="video" block="captions" place={null} onChange={() => undefined} zoomOnly
              zoom={draft.captions.zoom} onZoom={(z) => set({ captions: { ...draft.captions, zoom: z } })} />
          </>
        )}
      </Seccion>

      <Seccion titulo="Franja de la marca" resumen={draft.strip.on ? draft.strip.role : 'sin franja'}>
        <label className="flex items-center gap-2 text-[12px] text-zinc-200">
          <input type="checkbox" checked={draft.strip.on} onChange={(e) => set({ strip: { ...draft.strip, on: e.target.checked } })} />
          Mostrar la franja de la marca
        </label>
        {draft.strip.on && (
          <Colores opts={prop.strip_options} value={draft.strip.role} label="Color de la franja" onChange={(r) => set({ strip: { ...draft.strip, role: r } })} />
        )}
        <NoAplica label="X, Y y Zoom" reason="La franja va fija en el borde de la marca: no es un bloque que se coloque." />
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

/** Sección plegada dentro de la tarjeta del título de una imagen: elegir un gancho llena el titular. */
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
