/**
 * CHIP DE REGLA (Sam, 2026-10-05) — en cualquier sitio de las bandejas donde aparece un código de
 * regla, pasar el ratón por encima muestra qué dice esa regla.
 *
 *   · al pasar el ratón o al enfocar con el teclado: la PRIMERA FRASE del enunciado y la severidad;
 *   · al hacer clic o tocar (teléfono): el enunciado ENTERO; Escape o un toque fuera lo cierran.
 *
 * El enunciado llega en la respuesta de la bandeja (`rule_texts`), ya filtrado por la marca de la
 * pieza en el server (`api/_ruleCodes.ts → ruleTextsFor`): una regla de otra marca no llega, y un
 * código sin enunciado se pinta como texto, sin chip. La regex que reconoce un código es la MISMA
 * del server, importada de `api/_ruleCodes.ts`. `FIXABLE-PROPUESTA` no tiene la forma de un código y
 * queda como texto.
 *
 * El aviso se pinta en un portal sobre `document.body` con posición fija: las tarjetas llevan
 * `overflow-hidden` y una transformación de `motion`, y cualquiera de las dos lo recortaría.
 */
import React, { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { tokenizeRuleText, firstSentence, type RuleText as RuleTextEntry, type RuleTexts } from '../../../api/_ruleCodes';
import { cn } from '../../ui/components';

export type { RuleTexts };

const RuleTextsContext = createContext<RuleTexts | null>(null);

/** Los enunciados de UNA pieza. Envuelve la tarjeta: todo `RuleText` de dentro los usa. */
export function RuleTextsProvider({ value, children }: { value: RuleTexts | null | undefined; children: React.ReactNode }) {
  return <RuleTextsContext.Provider value={value ?? null}>{children}</RuleTextsContext.Provider>;
}

/** La severidad, dicha en palabras. Son los valores del sistema (`watcher_rules.severity`), no de una marca. */
const SEVERITY_LABEL: Readonly<Record<string, { label: string; cls: string }>> = Object.freeze({
  blocking: { label: 'bloqueante', cls: 'text-rose-300' },
  warn: { label: 'aviso', cls: 'text-amber-300' },
});
function severityOf(s: string | null): { label: string; cls: string } | null {
  if (!s) return null;
  return SEVERITY_LABEL[s] ?? { label: s, cls: 'text-zinc-400' };
}

type Open = 'none' | 'peek' | 'full';
const GAP = 6;
const MARGIN = 8;
const MAX_W = 320;

/** Un código con su enunciado. Sin entrada para esta pieza, es texto. */
export function RuleChip({ code }: { code: string }) {
  const texts = useContext(RuleTextsContext);
  const entry: RuleTextEntry | undefined = texts && Object.prototype.hasOwnProperty.call(texts, code) ? texts[code] : undefined;
  if (!entry) return <>{code}</>;
  return <Chip code={code} entry={entry} />;
}

function Chip({ code, entry }: { code: string; entry: RuleTextEntry }) {
  const [open, setOpen] = useState<Open>('none');
  const [pos, setPos] = useState<{ left: number; top: number; width: number; above: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const id = useId();
  const sev = severityOf(entry.severity);

  const place = useCallback(() => {
    const b = btn.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const width = Math.min(MAX_W, vw - 2 * MARGIN);
    const left = Math.max(MARGIN, Math.min(r.left, vw - width - MARGIN));
    const h = pop.current?.offsetHeight ?? 0;
    const above = r.bottom + GAP + h > vh - MARGIN && r.top - GAP - h > MARGIN;
    setPos({ left, top: above ? r.top - GAP - h : r.bottom + GAP, width, above });
  }, []);

  useLayoutEffect(() => { if (open !== 'none') place(); }, [open, place]);

  useEffect(() => {
    if (open === 'none') return;
    const cerrarFuera = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && (btn.current?.contains(t) || pop.current?.contains(t))) return;
      setOpen('none');
    };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen('none'); btn.current?.focus(); } };
    window.addEventListener('pointerdown', cerrarFuera, true);
    window.addEventListener('keydown', tecla);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('pointerdown', cerrarFuera, true);
      window.removeEventListener('keydown', tecla);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  const peek = () => setOpen((o) => (o === 'none' ? 'peek' : o));
  const unpeek = () => setOpen((o) => (o === 'peek' ? 'none' : o));

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="inline font-[inherit] text-inherit bg-transparent p-0 m-0 border-0 underline decoration-dotted underline-offset-2 cursor-help rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-current"
        aria-describedby={open !== 'none' ? id : undefined}
        aria-expanded={open === 'full'}
        aria-label={`${code}: ${open === 'full' ? 'ocultar' : 'ver'} el enunciado de la regla`}
        onMouseEnter={peek}
        onMouseLeave={unpeek}
        onFocus={peek}
        onBlur={unpeek}
        onClick={(e) => {
          // La tarjeta puede tener sus propios clics: el chip no los dispara.
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => (o === 'full' ? 'none' : 'full'));
        }}
      >
        {code}
      </button>
      {open !== 'none' && typeof document !== 'undefined' && createPortal(
        <span
          ref={pop}
          id={id}
          role="tooltip"
          className={cn(
            'fixed z-[1000] block rounded-lg border border-zinc-700 bg-zinc-950/95 shadow-xl px-3 py-2',
            'text-[12px] leading-relaxed text-zinc-200 font-sans normal-case tracking-normal text-left',
            open === 'full' && 'max-h-[60vh] overflow-y-auto',
          )}
          style={pos ? { left: pos.left, top: pos.top, width: pos.width } : { left: -9999, top: 0, width: MAX_W }}
          onMouseEnter={peek}
          onMouseLeave={unpeek}
        >
          <span className="flex items-center gap-2 mb-1 font-mono text-[10px]">
            <span className="text-zinc-300">{code}</span>
            {sev && <span className={sev.cls}>· {sev.label}</span>}
          </span>
          <span className="block whitespace-pre-wrap break-words">
            {open === 'full' ? entry.statement : firstSentence(entry.statement)}
          </span>
          {open === 'peek' && entry.statement.trim() !== firstSentence(entry.statement) && (
            <span className="block mt-1 text-[10px] text-zinc-500">Clic o toque para leer la regla entera.</span>
          )}
        </span>,
        document.body,
      )}
    </>
  );
}

/** Un texto cualquiera con sus códigos de regla convertidos en chips. El resto queda igual. */
export function RuleText({ text }: { text: string | null | undefined }) {
  const tokens = tokenizeRuleText(text);
  return (
    <>
      {tokens.map((k, i) => (k.t === 'code'
        ? <RuleChip key={i} code={k.v} />
        : <React.Fragment key={i}>{k.v}</React.Fragment>))}
    </>
  );
}
