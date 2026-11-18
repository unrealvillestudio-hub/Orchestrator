import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { cn, Spinner } from '../../ui/components';
import {
  proposePieceText, applyPieceText, pollPieceText, undoPieceVideo, changePresetStatus, previewPieceText, CalibrationError, type SceneResult,
  type PieceTextProposal, type TextProposal,
} from '../../services/calibrationInbox';
import type { CastMember, PresetsByLayer, PresetView, TextAlign, TextFit, TextLayers } from '../../../api/_pieceText';
import { MARK_KINDS, pruneMarks, parseMarkup, mergeMarks, type BlockMarks } from './textoMarcas';
import { dragTargetsOf, type BlockRef, type DraftBlocks } from './arrastre';
import { BarraDeshacer } from './BarraDeshacer';
import type { SoundLayer } from '../../../api/_pieceSound';
import { Alineacion, EsquemaDeEscena, FranjaModo, MarcasDeTexto, Muestras, PalabrasClave, ScenePlayer, VistaFiel } from './TextoVisual';
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

/**
 * Estilo en línea de un bloque (2026-11-17, ventana visual): alineación, color del resaltado y marcas por palabra
 * (`textoMarcas.ts`). `null` = lo del estilo elegido.
 */
export interface BlockStyle { align: TextAlign | null; emphasis_role: string | null; marks: BlockMarks }
const SIN_ESTILO: BlockStyle = { align: null, emphasis_role: null, marks: {} };
/** El estilo en línea guardado en un bloque de `text_layers`. PURO. */
export function blockStyleOf(b: any): BlockStyle {
  if (!b) return SIN_ESTILO;
  const lista = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);
  const marks: BlockMarks = {};
  for (const k of MARK_KINDS) { const l = lista(b[k]); if (l.length) marks[k] = l; }
  return {
    align: b.align === 'left' || b.align === 'center' || b.align === 'right' ? b.align : null,
    emphasis_role: typeof b.emphasis_role === 'string' && b.emphasis_role ? b.emphasis_role : null,
    marks,
  };
}
/** Los campos del contrato que salen de un estilo en línea, sólo los que tienen algo; las marcas que ya no están en el texto se caen. PURO. */
export function styleFields(text: string, st: BlockStyle): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (st.align) out.align = st.align;
  if (st.emphasis_role) out.emphasis_role = st.emphasis_role;
  const vivas = pruneMarks(text, st.marks);
  for (const k of MARK_KINDS) if (vivas[k]?.length) out[k] = vivas[k];
  return out;
}

export interface VideoTextDraft {
  hook: { choice: Choice; own: string; preset_key: string; dur_s: number; place: Place | null; style: BlockStyle };
  roles: Array<{ person_id: string; name: string; show: boolean; text: string; at_s: number; dur_s: number; preset_key: string; place: Place | null }>;
  /** `zoom` null = el tamaño de siempre; los subtítulos sólo cambian de tamaño (banda fija). */
  captions: { enabled: boolean; preset_key: string; accent_role: string; zoom: number | null; keywords: string[] };
  key_titles: Array<{ text: string; on: boolean; at_s: number; dur_s: number; preset_key: string; own: boolean; place: Place | null; style: BlockStyle }>;
  cta: { choice: Choice; own: string; preset_key: string; at_s: number; place: Place | null; style: BlockStyle };
  strip: { on: boolean; role: string };
}

const firstKey = (presets: PresetsByLayer | null, layer: keyof PresetsByLayer) => presets?.[layer]?.[0]?.preset_key ?? '';
/**
 * El estilo por defecto de una capa: el que sugiere la rotación de VideoLab (sólo llega en una generación nueva) y, si
 * no hay, el primero. Lo ya guardado en la pieza manda siempre sobre esto (lo resuelve quien llama con `cur?.… ??`).
 */
const defaultKey = (p: Pick<PieceTextProposal, 'presets' | 'suggested_presets'>, layer: keyof PresetsByLayer) =>
  p.suggested_presets?.[layer] ?? firstKey(p.presets, layer);
const defaultRole = (opts: EmphasisColorOption[]) => (opts.find((o) => o.is_default) ?? opts[0])?.role ?? '';
const placeOf = (p: unknown): Place | null => (p && typeof p === 'object' && 'x_pct' in (p as object) ? clampPlace(p as Place) : null);

/**
 * El borrador tal como se guarda en la tarjeta mientras no se aplica (2026-11-17). Una propuesta elegida se guarda
 * por su TEXTO, no por su posición: al reabrir la ventana CopyLab propone otra lista y «la segunda» sería otra frase. PURO.
 */
export function draftParaGuardar(d: VideoTextDraft, proposals: PieceTextProposal['proposals']): VideoTextDraft {
  const fijar = <T extends { choice: Choice; own: string }>(b: T, list: TextProposal[]): T =>
    typeof b.choice === 'number' && list[b.choice] ? { ...b, choice: OWN, own: list[b.choice].text } : b;
  return { ...d, hook: fijar(d.hook, proposals.hooks), cta: fijar(d.cta, proposals.share_ctas) };
}

/** El borrador con el que abre la ventana: lo vigente del video si lo hay, si no lo primero de cada catálogo. PURO. */
export function videoTextDraftOf(p: Pick<PieceTextProposal, 'presets' | 'cast' | 'accent_options' | 'strip_options' | 'proposals' | 'current'> & Partial<Pick<PieceTextProposal, 'suggested_presets'>>): VideoTextDraft {
  const cur = p.current?.text_layers ?? null;
  const rolDe = (c: CastMember) => cur?.roles?.find((r) => r.person_id === c.person_id) ?? null;
  const zoomCap = cur?.captions?.place?.zoom;
  return {
    hook: {
      choice: cur?.hook?.text ? OWN : null, own: parseMarkup(cur?.hook?.text ?? '').text,
      preset_key: cur?.hook?.preset_key ?? defaultKey(p, 'hook'),
      dur_s: cur?.hook ? Math.max(0.5, (cur.hook.end_ms - cur.hook.start_ms) / 1000) : 2.6,
      place: placeOf(cur?.hook?.place),
      // Un texto guardado con el marcado escrito a mano (2026-11-17) abre limpio y con sus marcas.
      style: (() => { const st = blockStyleOf(cur?.hook); return { ...st, marks: mergeMarks(st.marks, parseMarkup(cur?.hook?.text ?? '').marks) }; })(),
    },
    roles: (p.cast ?? []).map((c, i) => {
      const r = rolDe(c);
      return {
        person_id: c.person_id, name: c.name, show: r ? r.show : false,
        text: r?.text ?? [c.name, c.title].filter(Boolean).join(' — '),
        at_s: r ? r.at_ms / 1000 : 0.4 + i * 4, dur_s: r ? r.dur_ms / 1000 : 3.8,
        preset_key: r?.preset_key ?? defaultKey(p, 'role'),
        place: placeOf(r?.place),
      };
    }),
    captions: {
      enabled: cur?.captions?.enabled ?? false,
      preset_key: cur?.captions?.preset_key ?? defaultKey(p, 'caption'),
      accent_role: cur?.captions?.accent_role ?? defaultRole(p.accent_options ?? []),
      zoom: typeof zoomCap === 'number' ? clampZoom(zoomCap) : null,
      keywords: Array.isArray(cur?.captions?.keywords) ? cur!.captions!.keywords!.filter((w) => typeof w === 'string' && w) : [],
    },
    key_titles: [
      ...(p.proposals?.key_phrases ?? []).map((k) => {
        const v = cur?.key_titles?.find((t) => t.text === k.text);
        return { text: k.text, on: !!v, at_s: v ? v.at_ms / 1000 : 0, dur_s: v ? v.dur_ms / 1000 : 2.5, preset_key: v?.preset_key ?? defaultKey(p, 'key_title'), own: false, place: placeOf(v?.place), style: blockStyleOf(v) };
      }),
      ...(cur?.key_titles ?? []).filter((t) => !(p.proposals?.key_phrases ?? []).some((k) => k.text === t.text))
        .map((t) => ({ text: t.text, on: true, at_s: t.at_ms / 1000, dur_s: t.dur_ms / 1000, preset_key: t.preset_key, own: true, place: placeOf(t.place), style: blockStyleOf(t) })),
    ],
    cta: {
      choice: cur?.cta?.text ? OWN : null, own: cur?.cta?.text ?? '',
      preset_key: cur?.cta?.preset_key ?? defaultKey(p, 'cta'), at_s: cur?.cta ? cur.cta.at_ms / 1000 : 0,
      place: placeOf(cur?.cta?.place),
      style: blockStyleOf(cur?.cta),
    },
    strip: { on: cur?.identity?.strip ?? false, role: cur?.identity?.identity_role ?? cur?.identity?.strip_role ?? defaultRole(p.strip_options ?? []) },
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
    hook: hook ? (() => {
      const { emphasis, ...resto } = styleFields(hook.text, d.hook.style) as { emphasis?: string[] };
      return { text: hook.text, preset_key: d.hook.preset_key, start_ms: 0, end_ms: ms(d.hook.dur_s), emphasis: emphasis ?? [], pattern_key: hook.pattern_key ?? null, ...conPlace(d.hook.place), ...resto };
    })() : null,
    roles: d.roles.filter((r) => r.show).map((r) => ({ person_id: r.person_id, text: r.text.trim(), show: true, at_ms: ms(r.at_s), dur_ms: ms(r.dur_s), preset_key: r.preset_key, ...conPlace(r.place) })),
    captions: d.captions.enabled
      ? { enabled: true, preset_key: d.captions.preset_key, accent_role: d.captions.accent_role, ...(d.captions.zoom != null ? { place: { zoom: clampZoom(d.captions.zoom) } } : {}),
          ...(d.captions.keywords.length ? { keywords: d.captions.keywords.slice(0, 12) } : {}) }
      : null,
    key_titles: d.key_titles.filter((k) => k.on && k.text.trim()).map((k) => ({ text: k.text.trim(), at_ms: ms(k.at_s), dur_ms: ms(k.dur_s), preset_key: k.preset_key, ...conPlace(k.place), ...styleFields(k.text.trim(), k.style) })),
    cta: cta ? { text: cta.text, at_ms: ctaAt, preset_key: d.cta.preset_key, pattern_key: cta.pattern_key ?? null, ...conPlace(d.cta.place), ...styleFields(cta.text, d.cta.style) } : null,
    identity: { strip: d.strip.on, identity_role: d.strip.on ? d.strip.role || null : null },
  };
}

/**
 * Qué bloques del borrador viajan a VideoLab, con su índice en el borrador y su hora de inicio: lo que necesita el
 * arrastre para saber qué bloque de la escena es cuál. Sale de `textLayersFromDraft`, la misma fuente que se manda. PURO.
 */
export function draftBlocksOf(d: VideoTextDraft, proposals: PieceTextProposal['proposals'], durationMs: number | null): DraftBlocks {
  const capas = textLayersFromDraft(d, proposals, durationMs);
  const kIdx = d.key_titles.map((k, i) => (k.on && k.text.trim() ? i : -1)).filter((i) => i >= 0);
  const rIdx = d.roles.map((r, i) => (r.show ? i : -1)).filter((i) => i >= 0);
  return {
    hook: capas.hook ? { sent: true, place: d.hook.place } : null,
    cta: capas.cta ? { sent: true, at_ms: capas.cta.at_ms, place: d.cta.place } : null,
    key_titles: kIdx.map((i, j) => ({ index: i, at_ms: capas.key_titles[j]?.at_ms ?? 0, place: d.key_titles[i].place, label: `Título clave ${j + 1}` })),
    roles: rIdx.map((i, j) => ({ index: i, at_ms: capas.roles[j]?.at_ms ?? 0, place: d.roles[i].place, label: `Rol · ${d.roles[i].name}` })),
  };
}

/** El borrador con un bloque colocado a mano en `place` (lo que hace soltar un bloque arrastrado). PURO. */
export function withPlace(d: VideoTextDraft, ref: BlockRef, place: Place): VideoTextDraft {
  if (ref.block === 'hook') return { ...d, hook: { ...d.hook, place } };
  if (ref.block === 'cta') return { ...d, cta: { ...d.cta, place } };
  if (ref.block === 'key_titles') return { ...d, key_titles: d.key_titles.map((k, i) => (i === ref.index ? { ...k, place } : k)) };
  return { ...d, roles: d.roles.map((r, i) => (i === ref.index ? { ...r, place } : r)) };
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

function Seccion({ titulo, resumen, children, disabledReason, onOpen }: {
  titulo: string; resumen?: string | null; children?: React.ReactNode; disabledReason?: string | null;
  /** 2026-11-17 — al abrirse: pide las miniaturas de sus estilos sólo cuando alguien va a verlas. */
  onOpen?: () => void;
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
    <details data-seccion className="group rounded-xl border border-zinc-800 bg-zinc-950/40"
      onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) onOpen?.(); }}>
      <summary className="cursor-pointer select-none list-none px-3 py-2 text-[12px] font-medium text-zinc-200 flex items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
        {/* 2026-11-16 — el pliegue se VE: sin flecha, Sam no veía que cada sección se abre y se cierra. */}
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block w-3 text-zinc-500 transition-transform group-open:rotate-90">▸</span>
          {titulo}
        </span>
        {resumen && <span className="text-[10px] font-mono text-zinc-500 truncate">{resumen}</span>}
      </summary>
      <div className="px-3 pb-3 pt-1 space-y-2">{children}</div>
    </details>
  );
}

/**
 * Plegar o desplegar TODAS las secciones de la ventana de una vez. Todas abren plegadas (regla de Sam): el operador
 * elige con cuál trabaja. Actúa sobre los `<details data-seccion>` de su ventana, sin estado propio.
 */
function BarraSecciones({ raiz }: { raiz: React.RefObject<HTMLDivElement | null> }) {
  const todas = (abrir: boolean) => raiz.current?.querySelectorAll<HTMLDetailsElement>('details[data-seccion]').forEach((d) => { d.open = abrir; });
  return (
    <div className="flex items-center justify-end gap-3 text-[10px] text-zinc-500">
      <button type="button" onClick={() => todas(true)} className="hover:text-zinc-200">Desplegar todo</button>
      <button type="button" onClick={() => todas(false)} className="hover:text-zinc-200">Plegar todo</button>
    </div>
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

/** El nombre que ve quien edita para cada estado de `videolab_text_presets.status` (2026-11-17). */
export const STATUS_LABEL: Record<string, string> = {
  proposed: 'propuesto', validated_by_judgment: 'validado', validated_by_data: 'validado por datos', retired: 'retirado',
};
const esValidado = (st: string | null) => st === 'validated_by_judgment' || st === 'validated_by_data';

/**
 * Cambia el estado de un estilo en la propuesta que ya está en pantalla, sin volver a pedirla (pedirla otra vez llama
 * a CopyLab). Un estilo retirado sale de su capa y pasa a `retired_presets`; uno reactivado vuelve a su capa, al final.
 * PURO.
 */
export function withPresetStatus(prop: PieceTextProposal, presetKey: string, status: string): PieceTextProposal {
  if (!prop.presets) return prop;
  const capas = Object.fromEntries(Object.entries(prop.presets).map(([l, list]) => [l, [...list]])) as PresetsByLayer;
  let retirados = [...(prop.retired_presets ?? [])];
  let hallado: PresetView | null = null;
  for (const l of Object.keys(capas) as Array<keyof PresetsByLayer>) {
    const i = capas[l].findIndex((x) => x.preset_key === presetKey);
    if (i >= 0) { hallado = capas[l][i]; capas[l].splice(i, 1); }
  }
  const j = retirados.findIndex((x) => x.preset_key === presetKey);
  if (j >= 0) { hallado = hallado ?? retirados[j]; retirados.splice(j, 1); }
  if (!hallado) return prop;
  const nuevo = { ...hallado, status };
  if (status === 'retired') retirados = [...retirados, nuevo];
  else {
    const l = nuevo.layer as keyof PresetsByLayer;
    const k = (prop.presets[l] ?? []).findIndex((x) => x.preset_key === presetKey);
    if (k >= 0) capas[l].splice(k, 0, nuevo); else capas[l].push(nuevo);
  }
  return { ...prop, presets: capas, retired_presets: retirados };
}

/** Lo que el selector de estilos necesita para que un admin cambie su estado. Sin admin, el contexto va vacío. */
interface EstadoDeEstilos {
  cambiar: (presetKey: string, action: 'validate' | 'retire' | 'reactivate') => void;
  retirados: PresetView[]; ocupado: string | null; aviso: string | null;
}
const EstadoCtx = createContext<EstadoDeEstilos | null>(null);

/** Las miniaturas de una capa: la escena de cada estilo (o su error), y si se están pidiendo. */
export interface Miniaturas { loading: boolean; byKey: Record<string, SceneResult>; error: string | null }

function Presets({ list, value, onChange, label, previews, suggested }: {
  list: PresetsByLayer[keyof PresetsByLayer] | undefined; value: string; onChange: (k: string) => void; label: string;
  /** 2026-11-17 — con miniaturas, cada estilo es una tarjeta animada con el texto real (dibujada por VideoLab). */
  previews?: Miniaturas; suggested?: string | null;
}) {
  const admin = useContext(EstadoCtx);
  const [verRetirados, setVerRetirados] = useState(false);
  const capa = list?.[0]?.layer;
  const retirados = admin && capa ? admin.retirados.filter((r) => r.layer === capa) : [];
  if (!list?.length && !retirados.length) return <p className="text-[10px] text-amber-300/80">No hay estilos disponibles para esta capa.</p>;
  const elegido = list?.find((x) => x.preset_key === value) ?? null;
  // 2026-11-17 (Sam): con un estilo elegido, la rejilla se pliega a ese estilo; «Cambiar» la vuelve a abrir.
  const [abierta, setAbierta] = useState(!elegido);
  const visibles = (list ?? []).filter((p) => abierta || p.preset_key === value);
  const elegir = (k: string) => { onChange(k); setAbierta(false); };
  return (
    <div className="space-y-1.5">
      {previews && (
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))' }} role="radiogroup" aria-label={label}>
          {visibles.map((p) => {
            const m = previews.byKey[p.preset_key];
            return (
              <button key={p.preset_key} type="button" role="radio" aria-checked={value === p.preset_key} onClick={() => elegir(p.preset_key)}
                title={`${p.description}${p.description ? ' · ' : ''}Estado: ${STATUS_LABEL[p.status ?? ''] ?? p.status ?? 'sin estado'}`}
                className={cn('relative flex flex-col gap-1 p-1 rounded-lg border text-left',
                  value === p.preset_key ? 'border-violet-500 ring-1 ring-violet-500 bg-violet-500/10' : 'border-zinc-800 bg-zinc-950/40 hover:border-zinc-600')}>
                <div className="relative rounded-md overflow-hidden bg-zinc-900" style={{ aspectRatio: '9 / 13' }}>
                  {m?.ok && m.scene && m.runtime_url
                    ? <div className="absolute inset-0 grid place-items-center p-1"><ScenePlayer scene={m.scene} runtimeUrl={m.runtime_url} width={88} fit="blocks" /></div>
                    : <span className="absolute inset-0 grid place-items-center text-[9px] text-zinc-600 px-1 text-center">
                        {previews.loading && !m ? <Spinner size={12} /> : m && !m.ok ? 'sin vista previa' : ''}
                      </span>}
                  {suggested === p.preset_key && (
                    <span className="absolute bottom-1 right-1 px-1.5 rounded-full text-[9px] font-mono bg-black/70 text-cyan-300 border border-cyan-400/40" title="El estilo que propone la rotación para esta marca">rota</span>
                  )}
                </div>
                <span className="text-[11px] leading-tight text-zinc-200 min-h-[2.4em]">{p.name}</span>
                <span className="flex items-center gap-1 text-[9.5px] text-zinc-500">
                  <span aria-hidden className={cn('inline-block w-1.5 h-1.5 rounded-full', esValidado(p.status) ? 'bg-cyan-300' : 'border border-amber-400/80')} />
                  {STATUS_LABEL[p.status ?? ''] ?? 'sin estado'}
                  <span className="ml-auto font-mono" title={p.engine === 'html' ? 'Vista previa igual al render' : 'Vista previa aproximada'}>{p.engine === 'html' ? 'exacta' : 'aprox.'}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      {previews && elegido && (list?.length ?? 0) > 1 && (
        <button type="button" onClick={() => setAbierta((v) => !v)} className="text-[11px] text-violet-300 hover:text-violet-200">
          {abierta ? 'Plegar los estilos' : `Cambiar de estilo (${list!.length})`}
        </button>
      )}
      {previews?.error && <p className="text-[10px] text-amber-300/90">{previews.error}</p>}
      {!previews && <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {(list ?? []).map((p) => (
          <button key={p.preset_key} type="button" role="radio" aria-checked={value === p.preset_key}
            title={`${p.description}${p.description ? ' · ' : ''}Estado: ${STATUS_LABEL[p.status ?? ''] ?? p.status ?? 'sin estado'}`}
            onClick={() => onChange(p.preset_key)}
            className={cn('inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] border transition-colors',
              value === p.preset_key ? 'border-violet-500/70 bg-violet-500/15 text-violet-100' : 'border-zinc-800 text-zinc-400 hover:border-zinc-600')}>
            {p.name}
            {/* El estado se ve sin abrir nada: punto cian = validado; anillo ámbar = propuesto (sin validar). */}
            <span aria-hidden className={cn('inline-block w-1.5 h-1.5 rounded-full',
              esValidado(p.status) ? 'bg-cyan-300' : 'border border-amber-400/80')} />
            <span className="sr-only">({STATUS_LABEL[p.status ?? ''] ?? 'sin estado'})</span>
          </button>
        ))}
      </div>}
      {admin && elegido && (
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
          <span>«{elegido.name}»: <span className={esValidado(elegido.status) ? 'text-cyan-300' : 'text-amber-300/90'}>{STATUS_LABEL[elegido.status ?? ''] ?? 'sin estado'}</span></span>
          {elegido.status === 'proposed' && (
            <button type="button" disabled={!!admin.ocupado} onClick={() => admin.cambiar(elegido.preset_key, 'validate')}
              className="px-2 py-0.5 rounded-md border border-cyan-500/50 text-cyan-200 hover:bg-cyan-500/10 disabled:opacity-40">
              {admin.ocupado === elegido.preset_key ? 'Guardando…' : 'Validar estilo'}
            </button>
          )}
          <button type="button" disabled={!!admin.ocupado}
            onClick={() => { if (window.confirm(`¿Retirar «${elegido.name}» para todas las marcas? Deja de ofrecerse y de rotar; se puede reactivar.`)) admin.cambiar(elegido.preset_key, 'retire'); }}
            className="px-2 py-0.5 rounded-md border border-zinc-700 text-zinc-400 hover:border-red-500/50 hover:text-red-300 disabled:opacity-40">
            Retirar
          </button>
          <span className="text-zinc-600">vale para todas las marcas</span>
        </div>
      )}
      {admin && value && !elegido && (
        <p className="text-[10px] text-amber-300/90">El estilo elegido ya no se ofrece (retirado): elige otro antes de aplicar.</p>
      )}
      {retirados.length > 0 && (
        <div className="text-[10px]">
          <button type="button" onClick={() => setVerRetirados(!verRetirados)} className="text-zinc-500 hover:text-zinc-300">
            {verRetirados ? '▾' : '▸'} Retirados ({retirados.length})
          </button>
          {verRetirados && (
            <ul className="mt-1 space-y-1">
              {retirados.map((r) => (
                <li key={r.preset_key} className="flex items-center gap-2 text-zinc-500">
                  <span className="line-through">{r.name}</span>
                  <button type="button" disabled={!!admin?.ocupado} onClick={() => admin?.cambiar(r.preset_key, 'reactivate')}
                    className="px-2 py-0.5 rounded-md border border-zinc-700 text-zinc-300 hover:border-zinc-500 disabled:opacity-40">
                    {admin?.ocupado === r.preset_key ? 'Guardando…' : 'Reactivar'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {admin?.aviso && <p className="text-[10px] text-amber-300/90">{admin.aviso}</p>}
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
  // 2026-11-17 (Sam): con una propuesta elegida, las demás se pliegan para que la vista grande quede a la vista.
  const [verTodas, setVerTodas] = useState(choice === null);
  const elegir = (c: Choice) => { onChoice(c); setVerTodas(c === null); };
  const visibles = list.map((h, i) => ({ h, i })).filter(({ i }) => verTodas || choice === i);
  return (
    <div className="space-y-1.5">
      {visibles.map(({ h, i }) => (
        <button key={i} type="button" onClick={() => elegir(choice === i ? null : i)} aria-pressed={choice === i}
          className={cn('w-full text-left rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors',
            choice === i ? 'border-violet-500/70 bg-violet-500/10 text-white' : 'border-zinc-800 text-zinc-300 hover:border-zinc-600')}>
          <span>{h.text}</span>
          {h.why && <span className="block text-[10px] text-zinc-500 mt-0.5">{h.why}</span>}
        </button>
      ))}
      {(verTodas || choice === OWN) && (
        <button type="button" onClick={() => elegir(choice === OWN ? null : OWN)} aria-pressed={choice === OWN}
          className={cn('w-full text-left rounded-lg border px-2.5 py-1.5 text-[12px]',
            choice === OWN ? 'border-violet-500/70 bg-violet-500/10 text-white' : 'border-dashed border-zinc-700 text-zinc-400 hover:border-zinc-500')}>
          {propio}
        </button>
      )}
      {choice === OWN && <TextoPropio value={own} onChange={onOwn} label={propio} />}
      {choice !== null && (
        <button type="button" onClick={() => setVerTodas((v) => !v)} className="text-[11px] text-violet-300 hover:text-violet-200">
          {verTodas ? 'Plegar las otras propuestas' : `Ver las otras propuestas (${list.length + (choice === OWN ? 0 : 1)})`}
        </button>
      )}
    </div>
  );
}

/**
 * El texto propio de un bloque: varias líneas (Enter = salto de línea; VideoLab respeta `\n` hasta el máximo de líneas
 * del estilo) y el marcado del editor de imagen (`^ _ + *`), que al cerrarse cada par pasa a marcas. 2026-11-17 (Sam).
 */
function TextoPropio({ value, onChange, label }: { value: string; onChange: (t: string) => void; label: string }) {
  return (
    <div className="space-y-1">
      <textarea value={value} onChange={(e) => onChange(e.target.value)} autoFocus aria-label={label} rows={Math.min(4, Math.max(2, value.split('\n').length))}
        className="w-full resize-y bg-zinc-950/60 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-violet-500/60" />
      <p className="text-[10px] text-zinc-500">Enter: salto de línea. Marcado: ^resaltado^ _cursiva_ +negrita+ *color* (al cerrar el par pasa a «Marcas»). {value.replace(/\s+/g, ' ').trim().length} caracteres.</p>
    </div>
  );
}

/**
 * El medidor de un bloque (VideoLab v1.12.0): si la escena salió, el `fit` de ese bloque; si VideoLab dijo que no cabe,
 * el `fit` del error cuando es de ese bloque. `layer`: 'hook' | 'cta' | 'key_title'; un título clave se reconoce por su
 * hora de entrada (`at_ms`), o por su índice en el error (`key_titles[i]`). PURO.
 */
export function fitFor(result: SceneResult | null | undefined, layer: 'hook' | 'cta' | 'key_title', opts: { at_ms?: number; index?: number } = {}): TextFit | null {
  if (!result) return null;
  if (result.ok) {
    const f = (result.fits ?? []).filter((x) => x.layer === layer);
    if (layer !== 'key_title') return f[0]?.fit ?? null;
    return f.find((x) => x.start_ms === opts.at_ms)?.fit ?? null;
  }
  const e = result.fit;
  if (!e) return null;
  const etiqueta = layer === 'key_title' ? `key_titles[${opts.index ?? -1}]` : layer;
  return e.label === etiqueta || (!e.label && e.layer === layer) ? e : null;
}

// ── El tamaño de la vista grande (2026-11-17) ──────────────────────────────────────────────────────
export const VISTA_ANCHO_MIN = 110;
export const VISTA_ANCHO_MAX = 320;
export const VISTA_ANCHO_INICIAL = 170;
/** El ancho de la vista dentro de su rango; un valor que no es número vuelve al inicial. PURO. */
/** Ancho fijo de la columna al lado del video (esquema, play y notas): sigue al esquema y nunca se estira. */
export const anchoLado = (anchoVista: number) => Math.max(150, Math.round(clampAncho(anchoVista) * 0.62));

export function clampAncho(n: number): number {
  if (!Number.isFinite(n)) return VISTA_ANCHO_INICIAL;
  return Math.round(Math.min(VISTA_ANCHO_MAX, Math.max(VISTA_ANCHO_MIN, n)));
}
const leerPreferencia = (k: string, porDefecto: string): string => {
  try { return globalThis.localStorage?.getItem(k) ?? porDefecto; } catch { return porDefecto; }
};
const guardarPreferencia = (k: string, v: string) => { try { globalThis.localStorage?.setItem(k, v); } catch { /* sin almacenamiento */ } };

/** «Caben hasta N caracteres»: lo que mide VideoLab con este estilo (mismo cálculo que decide si cabe). */
function Medidor({ fit }: { fit: TextFit | null }) {
  if (!fit) return null;
  return (
    <p className={cn('text-[11px] font-mono', fit.fits ? 'text-zinc-400' : 'text-amber-300')} role="status">
      {fit.fits
        ? `Cabe con este estilo: ${fit.chars} caracteres, máx. ${fit.max_lines} línea${fit.max_lines === 1 ? '' : 's'}.`
        : `No cabe: con este estilo caben hasta ${fit.chars_fit} de sus ${fit.chars} caracteres (máx. ${fit.max_lines} línea${fit.max_lines === 1 ? '' : 's'}). Acorta el texto o elige otro estilo.`}
    </p>
  );
}

/** Un bloque que se abre y se cierra (Sam, 2026-11-17: «abrir y cerrar según se requiera»). Cerrado de entrada. */
function Plegable({ titulo, resumen, children }: { titulo: string; resumen?: string | null; children: React.ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="rounded-lg border border-zinc-800/70">
      <button type="button" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto}
        className="w-full flex items-center gap-2 px-2 min-h-9 text-left text-[11px] text-zinc-300">
        <span aria-hidden className="text-zinc-500">{abierto ? '▾' : '▸'}</span>{titulo}
        {resumen && <span className="ml-auto text-[10px] text-zinc-500 truncate">{resumen}</span>}
      </button>
      {abierto && <div className="space-y-2 px-2 pb-2">{children}</div>}
    </div>
  );
}

/** Lo que dice la cabecera plegada de «Marcas, alineación y color». PURO. */
export function resumenEstilo(st: BlockStyle): string {
  const n = MARK_KINDS.reduce((a, k) => a + (st.marks[k]?.length ?? 0), 0);
  const partes = [n ? `${n} marca${n === 1 ? '' : 's'}` : 'sin marcas'];
  if (st.align) partes.push(st.align === 'left' ? 'izquierda' : st.align === 'right' ? 'derecha' : 'centro');
  if (st.emphasis_role) partes.push(st.emphasis_role);
  return partes.join(' · ');
}

/** El texto propio con el marcado ya convertido en marcas: lo que se guarda en el borrador. PURO. */
export function ownWithMarkup(t: string, st: BlockStyle): { own: string; style: BlockStyle } {
  const r = parseMarkup(t);
  return { own: r.text, style: { ...st, marks: mergeMarks(st.marks, r.marks) } };
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
    /**
     * 2026-11-17 (Sam: «sí a aplicar juntos»). Lo editado sin aplicar vive en la tarjeta: al cerrar la ventana y abrir
     * «Sonido» no se pierde, y un solo «Aplicar» manda texto y sonido. `borrador` = lo que había quedado sin aplicar.
     */
    borrador?: VideoTextDraft | null;
    onBorrador?: (b: { draft: VideoTextDraft; layers: TextLayers } | null) => void;
    /** El sonido editado sin aplicar en la otra ventana: viaja con este «Aplicar». */
    sonidoPendiente?: SoundLayer | null;
    /** El pedido salió: la tarjeta vacía los dos borradores. */
    onEnviado?: () => void;
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
  const raiz = useRef<HTMLDivElement>(null);
  return (
    <div ref={raiz} className="space-y-2">
      <BarraSecciones raiz={raiz} />
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

function VideoBody({ pieceId, token, onApplied, borrador, onBorrador, sonidoPendiente, onEnviado }: Extract<OnScreenTextEditorProps, { medium: 'video' }>) {
  const [prop, setProp] = useState<PieceTextProposal | null>(null);
  const [draft, setDraft] = useState<VideoTextDraft | null>(null);
  // 2026-11-17 (Sam): la vista se fija o se suelta, y su tamaño se cambia arrastrando el borde inferior. Se recuerda en
  // este navegador (comodidad de quien edita; si el navegador no deja guardar, vale lo de siempre).
  const [vistaFija, setVistaFija] = useState<boolean>(() => leerPreferencia('orchestrator.vista.fija', 'si') === 'si');
  const [anchoVista, setAnchoVista] = useState<number>(() => clampAncho(Number(leerPreferencia('orchestrator.vista.ancho', String(VISTA_ANCHO_INICIAL)))));
  const cambiarFija = (v: boolean) => { setVistaFija(v); guardarPreferencia('orchestrator.vista.fija', v ? 'si' : 'no'); };
  const cambiarAncho = (n: number) => { const a = clampAncho(n); setAnchoVista(a); guardarPreferencia('orchestrator.vista.ancho', String(a)); };
  /** Lo guardado en la pieza, como borrador: contra esto se sabe si hay cambios sin aplicar y a esto vuelve «Descartar». */
  const base = useRef<VideoTextDraft | null>(null);
  const [confirmarDeshacer, setConfirmarDeshacer] = useState(false);
  const [deshaciendo, setDeshaciendo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<null | { id: string; since: number }>(null);
  // 2026-11-17 — mientras el pedido viaja, «Aplicar» no se puede volver a pulsar: dos pedidos seguidos creaban dos renders.
  const [enviando, setEnviando] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const [presetOcupado, setPresetOcupado] = useState<string | null>(null);
  const [presetAviso, setPresetAviso] = useState<string | null>(null);
  /** Validar, retirar o reactivar un estilo (sólo admin). Actualiza la lista en pantalla sin volver a pedir propuestas. */
  const cambiarEstado = (presetKey: string, action: 'validate' | 'retire' | 'reactivate') => {
    if (!prop) return;
    setPresetOcupado(presetKey); setPresetAviso(null);
    changePresetStatus(token, presetKey, prop.brand_id, action)
      .then((r) => setProp((cur) => (cur ? withPresetStatus(cur, presetKey, r.status) : cur)))
      .catch((err) => setPresetAviso(errorDe(err, 'No se pudo cambiar el estado del estilo.')))
      .finally(() => setPresetOcupado(null));
  };

  const proponer = () => {
    setLoading(true); setError(null);
    proposePieceText(token, pieceId)
      .then((r) => {
        const guardado = videoTextDraftOf(r);
        base.current = guardado;
        setProp(r); setDraft(borrador ?? guardado);
        if (r.pending?.job_id) setJob({ id: r.pending.job_id, since: Date.now() });
      })
      .catch((err) => setError(errorDe(err, 'No se pudieron pedir las propuestas a CopyLab.')))
      .finally(() => setLoading(false));
  };
  useEffect(proponer, [pieceId, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cambios sin aplicar → a la tarjeta (sobreviven al cerrar la ventana y viajan con el «Aplicar» de «Sonido»).
  const sinAplicar = !!(draft && base.current && JSON.stringify(draft) !== JSON.stringify(base.current));
  useEffect(() => {
    if (!prop || !draft || !base.current) return;
    onBorrador?.(sinAplicar ? { draft: draftParaGuardar(draft, prop.proposals), layers: textLayersFromDraft(draft, prop.proposals, prop.duration_ms ?? null) } : null);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const descartar = () => { if (base.current) setDraft(base.current); setDone(null); setError(null); };
  /** Deshacer lo aplicado: un paso atrás, sin render (Sam: «deshacer (a)»). Lo editado sin aplicar se descarta. */
  const deshacer = () => {
    if (!prop) return;
    setDeshaciendo(true); setError(null); setDone(null); setConfirmarDeshacer(false);
    undoPieceVideo(token, pieceId)
      .then((r) => {
        const nuevo = { ...prop, current: { ...prop.current, text_layers: (r.video?.text_layers ?? null) as any }, undo: r.undo };
        const d = videoTextDraftOf(nuevo);
        base.current = d; setProp(nuevo); setDraft(d); onBorrador?.(null);
        setDone(`Listo: volvió la versión ${r.to_version ?? 'anterior'} (con su texto y su sonido). Deshacer otra vez devuelve la ${r.from_version ?? 'que estaba'}.`);
        onApplied?.({ html: r.html ?? null, artifact_url: r.artifact_url ?? null });
      })
      .catch((err) => setError(errorDe(err, 'No se pudo deshacer.')))
      .finally(() => setDeshaciendo(false));
  };

  // ── 2026-11-17 · La vista previa fiel: la escena de VideoLab sobre el video limpio, al momento (sin «Aplicar»). ──
  const [vista, setVista] = useState<{ loading: boolean; result: SceneResult | null; error: string | null }>({ loading: false, result: null, error: null });
  const capas = prop && draft ? textLayersFromDraft(draft, prop.proposals, prop.duration_ms ?? null) : null;
  const firma = capas ? JSON.stringify(capas) : '';
  useEffect(() => {
    if (!capas || !prop?.clean_video_url) return;
    let vivo = true;
    setVista((v) => ({ ...v, loading: true }));
    // Se espera a que quien edita deje de tocar: un pedido por pausa, no por tecla.
    const t = setTimeout(() => {
      previewPieceText(token, pieceId, capas)
        .then((r) => { if (vivo) setVista({ loading: false, result: r.main, error: null }); })
        .catch((err) => { if (vivo) setVista({ loading: false, result: null, error: errorDe(err, 'No se pudo preparar la vista previa.') }); });
    }, 700);
    return () => { vivo = false; clearTimeout(t); };
  }, [firma]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Las miniaturas de cada estilo: se piden al abrir la sección, y otra vez si cambia el texto de esa capa. ──
  const [minis, setMinis] = useState<Partial<Record<keyof PresetsByLayer, Miniaturas & { firma: string }>>>({});
  const abiertas = useRef<Set<keyof PresetsByLayer>>(new Set());
  const firmaCapa = (layer: keyof PresetsByLayer): string => {
    if (!capas) return '';
    const sinEstilo = (b: any) => (b ? { ...b, preset_key: undefined, place: undefined, at_ms: undefined } : null);
    if (layer === 'hook') return JSON.stringify(sinEstilo(capas.hook));
    if (layer === 'cta') return JSON.stringify(sinEstilo(capas.cta));
    if (layer === 'key_title') return JSON.stringify(sinEstilo(capas.key_titles[0] ?? null));
    if (layer === 'role') return JSON.stringify(sinEstilo(capas.roles[0] ?? null));
    return JSON.stringify(sinEstilo(capas.captions));
  };
  const pedirMiniaturas = (layer: keyof PresetsByLayer) => {
    abiertas.current.add(layer);
    if (!prop?.clean_video_url || !capas || !prop.presets) return;
    const f = firmaCapa(layer);
    if (minis[layer]?.firma === f) return;
    if (f === 'null') { setMinis((m) => ({ ...m, [layer]: { loading: false, byKey: {}, error: 'Elige primero el texto de esta capa para ver cómo queda cada estilo.', firma: f } })); return; }
    setMinis((m) => ({ ...m, [layer]: { loading: true, byKey: m[layer]?.byKey ?? {}, error: null, firma: f } }));
    const variantes = prop.presets[layer].slice(0, 12).map((x) => ({ layer, preset_key: x.preset_key }));
    previewPieceText(token, pieceId, capas, variantes)
      .then((r) => setMinis((m) => ({ ...m, [layer]: { loading: false, error: null, firma: f, byKey: Object.fromEntries(r.variants.map((v) => [v.preset_key, v])) } })))
      .catch((err) => setMinis((m) => ({ ...m, [layer]: { loading: false, byKey: {}, firma: f, error: errorDe(err, 'No se pudieron preparar las miniaturas.') } })));
  };
  useEffect(() => {
    const t = setTimeout(() => abiertas.current.forEach((l) => pedirMiniaturas(l)), 1200);
    return () => clearTimeout(t);
  }, [firma]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (enviando) return;
    setError(null); setDone(null); setEnviando(true);
    applyPieceText(token, pieceId, textLayersFromDraft(draft, prop.proposals, prop.duration_ms), sonidoPendiente ?? undefined)
      .then((r) => { setJob({ id: r.job_id, since: Date.now() }); base.current = draft; onBorrador?.(null); onEnviado?.(); })
      .catch((err) => setError(errorDe(err, 'No se pudo mandar el texto a VideoLab.')))
      .finally(() => setEnviando(false));
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
  /** Marcas por palabra, alineación y color del resaltado de un bloque (gancho, título clave, CTA). */
  const controlesDeEstilo = (texto: string, st: BlockStyle, onSt: (s: BlockStyle) => void) => (
    <Plegable titulo="Marcas, alineación y color" resumen={resumenEstilo(st)}>
      <p className="text-[10px] text-zinc-500">Marcas</p>
      <MarcasDeTexto text={texto} marks={st.marks} onChange={(m) => onSt({ ...st, marks: m })} />
      <p className="text-[10px] text-zinc-500">Alineación</p>
      <Alineacion value={st.align} onChange={(a) => onSt({ ...st, align: a })} />
      <p className="text-[10px] text-zinc-500">Color del resaltado</p>
      <Muestras opts={prop.accent_options} value={st.emphasis_role} nullable label="Color del resaltado"
        onChange={(r) => onSt({ ...st, emphasis_role: r })} />
    </Plegable>
  );
  const sug = prop.suggested_presets ?? {};

  const estadoCtx: EstadoDeEstilos | null = prop.can_change_preset_status
    ? { cambiar: cambiarEstado, retirados: prop.retired_presets ?? [], ocupado: presetOcupado, aviso: presetAviso }
    : null;

  return (
    <EstadoCtx.Provider value={estadoCtx}>
    <div ref={raiz} className="space-y-2">
      <BarraSecciones raiz={raiz} />
      {sinLimpio && (
        <p className="text-[11px] leading-snug rounded-lg px-3 py-2 border border-amber-500/40 bg-amber-500/[0.08] text-amber-200">
          {prop.clean_video_note}
        </p>
      )}
      {prop.presets_error && <p className="text-[11px] text-amber-300/90">{prop.presets_error}</p>}
      {prop.rotation_note && <p className="text-[10px] text-zinc-500">{prop.rotation_note}</p>}
      {prop.meta?.n8_filter === 'no_recent_list' && (
        <p className="text-[10px] text-zinc-500">CopyLab no recibió los patrones recientes: los ganchos pueden repetir patrón.</p>
      )}

      {/* 2026-11-18 (Sam): «no hay motivos para agrandar la barra del play… hay mucho espacio inutilizado». La vista y
          las secciones van lado a lado cuando caben: con la vista chica, las secciones ocupan el espacio de la derecha;
          con la vista grande, bajan solas debajo (flex-wrap). La columna del esquema y el play tiene ancho fijo. */}
      <div className="flex flex-wrap items-start gap-2">
      {prop.clean_video_url && (
        // 2026-11-17 (Sam): la vista grande arriba, con el esquema, la barra de reproducción y las notas AL LADO del video
        // (ocupa sólo el alto del video). Se puede fijar o soltar, y su borde inferior se arrastra para hacerla más
        // grande o más chica: lo de abajo se reacomoda.
        <div className={cn('z-20 shrink-0 max-w-full rounded-xl border border-zinc-800 bg-zinc-950 shadow-lg shadow-black/40', vistaFija && 'md:sticky md:top-0')}>
          <div className="p-2">
            <VistaFiel videoUrl={prop.clean_video_url} result={vista.result} loading={vista.loading} error={vista.error} width={anchoVista} ladoAncho={anchoLado(anchoVista)}
              targets={vista.result?.ok && vista.result.scene ? dragTargetsOf(vista.result.scene, draftBlocksOf(draft, prop.proposals, prop.duration_ms ?? null)) : []}
              onPlace={enCurso ? undefined : (ref, place) => setDraft(withPlace(draft, ref, place))}
              lado={
                <div className="flex flex-col items-start gap-2">
                  {vista.result?.ok && vista.result.scene
                    ? <EsquemaDeEscena scene={vista.result.scene} width={Math.round(anchoVista * 0.62)} />
                    : <SchematicPreview aspect={prop.aspect ?? 9 / 16} safe={VIDEO_SAFE_ZONE_APPROX} items={videoPreviewItems(draft, prop.proposals)} />}
                  <button type="button" onClick={() => cambiarFija(!vistaFija)} aria-pressed={vistaFija}
                    className="hidden md:inline-flex px-2 min-h-8 rounded-md border border-zinc-700 text-[11px] text-zinc-300 hover:text-white"
                    title={vistaFija ? 'La vista sigue arriba al desplazarse. Pulsa para soltarla.' : 'Pulsa para que la vista siga arriba al desplazarse.'}>
                    {vistaFija ? 'Fijada arriba · soltar' : 'Fijar arriba'}
                  </button>
                </div>
              } />
          </div>
          <div role="separator" aria-orientation="horizontal" aria-label="Arrastra para cambiar el tamaño de la vista" tabIndex={0}
            title="Arrastra hacia arriba o hacia abajo para achicar o agrandar la vista"
            onKeyDown={(e) => { if (e.key === 'ArrowUp') cambiarAncho(anchoVista - 10); if (e.key === 'ArrowDown') cambiarAncho(anchoVista + 10); }}
            onPointerDown={(e) => {
              e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              const y0 = e.clientY; const a0 = anchoVista;
              const mover = (ev: PointerEvent) => cambiarAncho(a0 + (ev.clientY - y0) * (9 / 16));
              const soltar = () => { window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', soltar); };
              window.addEventListener('pointermove', mover); window.addEventListener('pointerup', soltar);
            }}
            className="h-3 cursor-row-resize touch-none rounded-b-xl flex items-center justify-center hover:bg-violet-500/20 focus:bg-violet-500/20 focus:outline-none">
            <span aria-hidden className="block w-10 h-1 rounded-full bg-zinc-700" />
          </div>
        </div>
      )}
      {!prop.clean_video_url && (
        <div className="w-full">
          <Seccion titulo="Vista previa" resumen="aproximada">
            <SchematicPreview aspect={prop.aspect ?? 9 / 16} safe={VIDEO_SAFE_ZONE_APPROX} items={videoPreviewItems(draft, prop.proposals)} />
          </Seccion>
        </div>
      )}

      <div className="flex-1 min-w-[240px] space-y-2">
      <Seccion titulo={BLOCK_LABELS.headline} resumen={hookElegido ? `${hookElegido.text} · ${modo(draft.hook.place)}` : null} onOpen={() => pedirMiniaturas('hook')}>
        <Propuestas list={prop.proposals.hooks} choice={draft.hook.choice} own={draft.hook.own} propio="Escribir uno propio"
          onChoice={(c) => set({ hook: { ...draft.hook, choice: c } })} onOwn={(t) => set({ hook: { ...draft.hook, ...ownWithMarkup(t, draft.hook.style) } })} />
        <Medidor fit={hookElegido ? fitFor(vista.result, 'hook') : null} />
        <p className="text-[10px] text-zinc-500">Animación</p>
        <Presets list={p?.hook} value={draft.hook.preset_key} label="Animación del gancho" onChange={(k) => set({ hook: { ...draft.hook, preset_key: k } })}
          previews={prop.clean_video_url ? minis.hook ?? { loading: false, byKey: {}, error: null } : undefined} suggested={sug.hook} />
        {hookElegido && controlesDeEstilo(hookElegido.text, draft.hook.style, (st) => set({ hook: { ...draft.hook, style: st } }))}
        <Segundo label="Duración" value={draft.hook.dur_s} onChange={(n) => set({ hook: { ...draft.hook, dur_s: n } })} />
        <PlaceControls medium="video" block="headline" place={draft.hook.place} onChange={(pl) => set({ hook: { ...draft.hook, place: pl } })} />
      </Seccion>

      <Seccion titulo={BLOCK_LABELS.subheadline} disabledReason={noAplica('video', 'subheadline')} />

      <Seccion titulo={BLOCK_LABELS.key_titles} resumen={`${draft.key_titles.filter((k) => k.on).length} elegidos`} onOpen={() => pedirMiniaturas('key_title')}>
        {draft.key_titles.map((k, i) => {
          const upd = (patch: Partial<typeof k>) => set({ key_titles: draft.key_titles.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
          return (
            <div key={i} className="space-y-1">
              <label className="flex items-start gap-2 text-[12px] text-zinc-200">
                <input type="checkbox" className="mt-0.5" checked={k.on} onChange={(e) => upd({ on: e.target.checked })} />
                {k.own
                  ? <textarea value={k.text} rows={Math.min(3, Math.max(1, k.text.split('\n').length))} aria-label="Título clave propio"
                      onChange={(e) => { const r = ownWithMarkup(e.target.value, k.style); upd({ text: r.own, style: r.style }); }}
                      className="flex-1 resize-y bg-zinc-950/60 border border-zinc-800 rounded px-2 py-0.5 text-[12px] text-zinc-200" />
                  : <span>{k.text}</span>}
              </label>
              {k.on && (
                <div className="space-y-1.5 pl-5">
                  {k.text.trim() && <Medidor fit={fitFor(vista.result, 'key_title', {
                    at_ms: ms(k.at_s),
                    index: draft.key_titles.slice(0, i).filter((x) => x.on && x.text.trim()).length,
                  })} />}
                  <div className="flex gap-3 flex-wrap items-center">
                    <Segundo label="En el segundo" value={k.at_s} onChange={(n) => upd({ at_s: n })} />
                    <Segundo label="Dura" value={k.dur_s} onChange={(n) => upd({ dur_s: n })} />
                  </div>
                  <Presets list={p?.key_title} value={k.preset_key} label="Estilo del título clave" onChange={(key) => upd({ preset_key: key })}
                    previews={prop.clean_video_url ? minis.key_title ?? { loading: false, byKey: {}, error: null } : undefined} suggested={sug.key_title} />
                  {k.text.trim() && controlesDeEstilo(k.text.trim(), k.style, (st) => upd({ style: st }))}
                  <PlaceControls medium="video" block="key_titles" place={k.place} onChange={(pl) => upd({ place: pl })} />
                </div>
              )}
            </div>
          );
        })}
        <button type="button"
          onClick={() => set({ key_titles: [...draft.key_titles, { text: '', on: true, at_s: 0, dur_s: 2.5, preset_key: defaultKey(prop, 'key_title'), own: true, place: null, style: SIN_ESTILO }] })}
          className="px-2.5 py-1 rounded-lg text-[11px] border border-dashed border-zinc-700 text-zinc-400 hover:border-zinc-500">
          Añadir uno propio
        </button>
      </Seccion>

      <Seccion titulo={BLOCK_LABELS.cta} resumen={ctaElegido ? `${ctaElegido.text} · ${modo(draft.cta.place)}` : null} onOpen={() => pedirMiniaturas('cta')}>
        {!prop.proposals.share_ctas.length && <p className="text-[11px] text-zinc-500">CopyLab no propuso CTA de reenvío para esta pieza.</p>}
        <Propuestas list={prop.proposals.share_ctas} choice={draft.cta.choice} own={draft.cta.own} propio="Escribir uno propio"
          onChoice={(c) => set({ cta: { ...draft.cta, choice: c } })} onOwn={(t) => set({ cta: { ...draft.cta, ...ownWithMarkup(t, draft.cta.style) } })} />
        <Medidor fit={ctaElegido ? fitFor(vista.result, 'cta') : null} />
        <p className="text-[10px] text-zinc-500">Formato</p>
        <Presets list={p?.cta} value={draft.cta.preset_key} label="Formato del CTA" onChange={(k) => set({ cta: { ...draft.cta, preset_key: k } })}
          previews={prop.clean_video_url ? minis.cta ?? { loading: false, byKey: {}, error: null } : undefined} suggested={sug.cta} />
        {ctaElegido && controlesDeEstilo(ctaElegido.text, draft.cta.style, (st) => set({ cta: { ...draft.cta, style: st } }))}
        <Segundo label="En el segundo (0 = 6 s antes del final)" value={draft.cta.at_s} onChange={(n) => set({ cta: { ...draft.cta, at_s: n } })} />
        <PlaceControls medium="video" block="cta" place={draft.cta.place} onChange={(pl) => set({ cta: { ...draft.cta, place: pl } })} />
      </Seccion>

      <Seccion titulo={BLOCK_LABELS.role} resumen={`${draft.roles.filter((r) => r.show).length} de ${draft.roles.length}`} onOpen={() => pedirMiniaturas('role')}>
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
                  <Presets list={p?.role} value={r.preset_key} label={`Formato del rótulo de ${r.name}`} onChange={(k) => upd({ preset_key: k })}
                    previews={prop.clean_video_url ? minis.role ?? { loading: false, byKey: {}, error: null } : undefined} suggested={sug.role} />
                  <PlaceControls medium="video" block="role" place={r.place} onChange={(pl) => upd({ place: pl })} />
                </>
              )}
            </div>
          );
        })}
      </Seccion>

      <Seccion titulo={BLOCK_LABELS.captions} resumen={draft.captions.enabled ? draft.captions.accent_role : 'sin subtítulos'} onOpen={() => pedirMiniaturas('caption')}>
        <label className="flex items-center gap-2 text-[12px] text-zinc-200">
          <input type="checkbox" checked={draft.captions.enabled} onChange={(e) => set({ captions: { ...draft.captions, enabled: e.target.checked } })} />
          Mostrar subtítulos
        </label>
        {draft.captions.enabled && (
          <>
            <p className="text-[10px] text-zinc-500">Color de acento</p>
            <Muestras opts={prop.accent_options} value={draft.captions.accent_role} label="Color de acento de los subtítulos"
              onChange={(r) => r && set({ captions: { ...draft.captions, accent_role: r } })} />
            <p className="text-[10px] text-zinc-500">Estilo</p>
            <Presets list={p?.caption} value={draft.captions.preset_key} label="Estilo de los subtítulos"
              onChange={(k) => set({ captions: { ...draft.captions, preset_key: k } })}
              previews={prop.clean_video_url ? minis.caption ?? { loading: false, byKey: {}, error: null } : undefined} suggested={sug.caption} />
            {p?.caption.find((x) => x.preset_key === draft.captions.preset_key)?.uses_keywords && (
              <>
                <p className="text-[10px] text-zinc-500">Palabras clave (este estilo sólo marca estas)</p>
                <PalabrasClave candidates={prop.keyword_candidates ?? []} spoken={prop.spoken_words ?? []} value={draft.captions.keywords}
                  onChange={(v) => set({ captions: { ...draft.captions, keywords: v } })} />
              </>
            )}
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
          <>
            <FranjaModo mode={prop.strip_mode ?? null} hex={prop.strip_options.find((o) => o.role === draft.strip.role)?.hex ?? null} />
            <Muestras opts={prop.strip_options} value={draft.strip.role} label="Color de la franja" onChange={(r) => r && set({ strip: { ...draft.strip, role: r } })} />
          </>
        )}
        <NoAplica label="X, Y y Zoom" reason="La franja va fija en el borde de la marca: no es un bloque que se coloque." />
      </Seccion>

      </div>
      </div>

      {error && <p className="text-[11px] text-rose-300 leading-snug">{error}</p>}
      {done && <p className="text-[11px] text-emerald-300 leading-snug">{done}</p>}
      {enCurso && (
        <p className="flex items-center gap-2 text-[11px] text-zinc-300"><Spinner size={12} /> VideoLab está aplicando el texto sobre el video limpio…</p>
      )}
      {sonidoPendiente && !enCurso && (
        <p className="text-[11px] rounded-lg px-3 py-1.5 border border-cyan-400/30 bg-cyan-400/[0.06] text-cyan-100">
          Hay cambios de sonido sin aplicar: «Aplicar» los manda junto con este texto, en un solo render.
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={aplicar} disabled={sinLimpio || enCurso || enviando || !p}
          title={sinLimpio ? prop.clean_video_note ?? undefined : undefined}
          className="flex-1 py-2 rounded-lg text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed">
          {enviando ? 'Enviando…' : 'Aplicar'}
        </button>
        <button type="button" onClick={proponer} disabled={loading || enCurso}
          className="px-3 py-2 rounded-lg text-[12px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">
          {loading ? <Spinner size={12} /> : 'Otras propuestas'}
        </button>
      </div>
      <BarraDeshacer sinAplicar={sinAplicar} onDescartar={descartar} undo={prop.undo} confirmando={confirmarDeshacer}
        onPedir={() => setConfirmarDeshacer(true)} onCancelar={() => setConfirmarDeshacer(false)} onDeshacer={deshacer}
        ocupado={deshaciendo} bloqueado={enCurso || enviando} />
      <p className="text-[10px] font-mono leading-snug text-zinc-600">
        Sólo se vuelve a dibujar el texto sobre el video limpio: no se regeneran las tomas. El video anterior queda en el historial.
      </p>
    </div>
    </EstadoCtx.Provider>
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
