/**
 * LO ELEGIDO POR BLOQUE EN EL TEXTO DE LA IMAGEN (2026-10-23) — los controles de UN bloque (el título o la bajada):
 * el color del texto, el color de su resaltado, la sombra y su grosor. Lo usan los dos editores: el de la imagen de
 * la pieza (y la portada del carrusel) y el de cada lámina 2..N. Las opciones son las de la marca (`_textStyle.ts`).
 */
import { cn } from '../../ui/components';
import type { EmphasisColorOption, ShadowOption } from '../../../api/_overlayText';
import { shadowDefaultLabel } from '../../../api/_overlayText';
import { SHADOW_STRENGTH_CHOICES, type TextBlockDraft } from '../../../api/_textStyle';

const SHADOW_MODES: ReadonlyArray<{ value: 'on' | 'off' | null; label: string }> = [
  { value: null, label: 'Como la marca' }, { value: 'on', label: 'Con sombra' }, { value: 'off', label: 'Sin sombra' },
];

function Chips({ label, options, active, onPick }: {
  label: string; options: EmphasisColorOption[]; active: string | null; onPick: (role: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap" role="radiogroup" aria-label={label}>
      <span className="text-[10px] text-zinc-400 mr-1">{label}</span>
      {options.map((c) => {
        const on = active === c.role;
        return (
          <button
            key={c.role}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={c.role}
            title={c.role}
            onClick={() => onPick(c.role)}
            className={cn('w-6 h-6 rounded-full border-2 transition-transform', on ? 'border-white scale-110' : 'border-zinc-700 hover:border-zinc-400')}
            style={{ backgroundColor: c.hex }}
          />
        );
      })}
    </div>
  );
}

function Pills<T extends string | null>({ label, choices, active, onPick, fmt }: {
  label: string; choices: ReadonlyArray<{ value: T; label: string }>; active: T; onPick: (v: T) => void; fmt?: (c: { value: T; label: string }) => string;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap" role="radiogroup" aria-label={label}>
      <span className="text-[10px] text-zinc-400 mr-1">{label}</span>
      {choices.map((c) => (
        <button
          key={String(c.value)}
          type="button"
          role="radio"
          aria-checked={active === c.value}
          onClick={() => onPick(c.value)}
          className={cn('px-2 py-0.5 rounded-lg text-[11px] border transition-colors',
            active === c.value ? 'border-violet-400/70 text-violet-200 bg-violet-500/10' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200')}
        >
          {fmt ? fmt(c) : c.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Los controles de un bloque. `textDefault` es el color de siempre de ese bloque: el chip activo sin elección.
 * `emphasisColors` sólo se pasa cuando el bloque lleva resaltado; sin él, no se ofrece su color.
 */
export function TextBlockControls({ title, draft, onChange, textColors, textDefault, emphasisColors, shadowOpt, showShadowMode = true, inheritLabel }: {
  title: string;
  /** false = el modo de la sombra se elige en otro sitio (el «Sombra» de siempre del titular); aquí sólo el grosor. */
  showShadowMode?: boolean;
  /** Cómo se dice la opción «sin elección» de la sombra; por defecto, la de la marca. */
  inheritLabel?: string;
  draft: TextBlockDraft;
  onChange: (patch: Partial<TextBlockDraft>) => void;
  textColors: EmphasisColorOption[] | null | undefined;
  textDefault: string | null | undefined;
  emphasisColors?: EmphasisColorOption[] | null;
  shadowOpt: ShadowOption | null | undefined;
}) {
  const emDefault = emphasisColors?.find((c) => c.is_default)?.role ?? null;
  return (
    <fieldset className="space-y-1.5 border border-zinc-800/80 rounded-xl px-2.5 py-2">
      <legend className="px-1 text-[10px] uppercase tracking-wide text-zinc-500">{title}</legend>
      {!!textColors?.length && (
        <Chips label="Color del texto" options={textColors} active={draft.role ?? textDefault ?? null} onPick={(role) => onChange({ role })} />
      )}
      {!!emphasisColors?.length && (
        <Chips label="Color del resaltado" options={emphasisColors} active={draft.emphasisRole ?? emDefault} onPick={(emphasisRole) => onChange({ emphasisRole })} />
      )}
      {shadowOpt?.declared && showShadowMode && (
        <Pills label="Sombra" choices={SHADOW_MODES} active={draft.shadow} onPick={(shadow) => onChange({ shadow })}
          fmt={(c) => (c.value === null ? (inheritLabel ?? `Como la marca (${shadowDefaultLabel(shadowOpt)})`) : c.label)} />
      )}
      {shadowOpt?.declared && draft.shadow !== 'off' && (
        <Pills label="Grosor de la sombra" choices={SHADOW_STRENGTH_CHOICES} active={draft.strength} onPick={(strength) => onChange({ strength })} />
      )}
    </fieldset>
  );
}
