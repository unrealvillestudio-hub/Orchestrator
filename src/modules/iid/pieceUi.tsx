import React, { useState } from 'react';
import {
  ChevronLeft, ChevronRight, ShieldCheck, ShieldAlert, ShieldQuestion, Copy, Check, Clock, GitBranch, History,
  CalendarCheck, CalendarClock, CalendarOff, CalendarX,
} from 'lucide-react';
import { cn } from '../../ui/components';
import type {
  FlowGeneration, PieceMetrics, CountAgainstLimit, SignatureCheck,
} from '../../services/calibrationInbox';

/* ════════════════════════════════════════════════════════════════════════════
 * pieceUi — piezas de interfaz compartidas por las bandejas de PIEZAS
 * (calibración y publicación).
 *
 * Salieron de `ApprovalCalibrationModule` cuando apareció la segunda bandeja: dos copias
 * del bloque de procedencia habrían divergido en el primer cambio, y la procedencia es
 * justamente el dato que las dos vistas tienen que contar igual.
 *
 * Acá vive lo PRESENTACIONAL y transversal. Lo específico de cada bandeja (qué acciones
 * hay, qué se lista) se queda en su módulo.
 * ════════════════════════════════════════════════════════════════════════════ */

// ── Fechas: hora local del operador, con la hora visible (no sólo el día) ────────
const DT = new Intl.DateTimeFormat(undefined, {
  year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : DT.format(d);
}

// ── PR-C · EL ÚNICO FORMATEADOR DE FECHA CON HUSO DEL REPO ──────────────────────
//
// `fmtDate` de arriba sitúa un instante en la hora del OPERADOR: sirve para la procedencia
// («cuándo se creó esta pieza», que se lee desde donde uno esté). `fmtInZone` sitúa un
// instante en la hora de la MARCA: sirve para cuándo SALE una pieza, que es una hora de su
// público y no de quien mira la pantalla.
//
// Son dos ejes distintos y por eso son dos funciones — pero viven juntas a propósito: un
// tercer formateador escrito en otro archivo divergiría de éstos en el primer cambio, y
// este repo ya tiene el precedente documentado con el idioma. Si hace falta formatear una
// fecha con huso en cualquier otra pantalla, se importa ésta.
//
// NI UN HUSO NI UN DESFASE ESCRITOS ACÁ. El `timeZone` llega como dato desde
// `public.brands.publish_timezone`, en forma IANA. Un desfase cableado acertaría hasta el
// cambio de horario y luego mentiría en silencio; el nombre IANA no.
//
// El IDIOMA tampoco se escribe: el locale es `undefined` —el del operador—, igual que en
// `fmtDate`. La lista de idiomas es la del operador y la del catálogo, nunca la del código.

const ZONED_OPTS: Intl.DateTimeFormatOptions = {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
};

/**
 * El huso en forma legible, DERIVADO del propio nombre IANA: último segmento, sin guiones
 * bajos. `America/Panama` → `Panama`. Cero mapas, cero enumeraciones: un huso nuevo se lee
 * bien sin tocar este archivo.
 */
export function zoneLabel(timeZone: string): string {
  const last = timeZone.split('/').pop() ?? timeZone;
  return last.replace(/_/g, ' ').trim() || timeZone;
}

export interface ZonedDate {
  /** Día, fecha y hora, ya situados en el huso de la marca. */
  when: string;
  /** El huso en forma legible, para la pantalla. */
  zone: string;
  /** El nombre IANA y el instante original, para quien pase el cursor. */
  title: string;
}

/**
 * Sitúa un instante en el huso de una marca. Devuelve `null` —y NO una hora aproximada—
 * cuando el instante o el huso no se pueden usar: una fecha mostrada en el huso equivocado
 * es peor que no mostrarla, porque se decide sobre ella.
 */
export function fmtInZone(iso: string | null | undefined, timeZone: string | null | undefined): ZonedDate | null {
  if (!iso || !timeZone) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const when = new Intl.DateTimeFormat(undefined, { ...ZONED_OPTS, timeZone }).format(d);
    // El nombre largo del huso enriquece el tooltip cuando el motor lo da; si no, el IANA
    // solo ya identifica el huso sin ambigüedad.
    let long = '';
    try {
      long = new Intl.DateTimeFormat(undefined, { timeZone, timeZoneName: 'long' })
        .formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? '';
    } catch { long = ''; }
    return {
      when,
      zone: zoneLabel(timeZone),
      title: `${timeZone}${long ? ` · ${long}` : ''} · ${d.toISOString()}`,
    };
  } catch {
    // Huso que el motor no reconoce: se declara la ausencia, no se cae a la hora local del
    // operador — eso mostraría una hora creíble y falsa.
    return null;
  }
}

// ── PR-C · CUÁNDO SALE ESTA PIEZA ───────────────────────────────────────────────
//
// DOS BANDEJAS, DOS COSAS DISTINTAS, DOS ETIQUETAS DISTINTAS. La distinción no es
// cosmética y no se puede colapsar:
//
//   · Cola de publicación → «Publica:»  — COMPROMISO. Existe la fila reservada.
//   · Calibración         → «Fecha prevista de publicación:» — PREVISIÓN. La pieza todavía
//     no está aprobada, así que no tiene franja: es dónde CAERÍA si se aprobara ahora, y
//     otra pieza aprobada antes se la lleva.
//
// Llamar «fecha de publicación» a las dos sería tener dos cosas distintas con el mismo
// nombre. Los dos bloques viven acá, juntos, por el mismo motivo que el formateador: separados
// divergen.

const DATE_ROW = 'flex items-start gap-2 rounded-lg px-3 py-2 text-[11px] font-mono leading-snug border';

/**
 * LAS FRANJAS NO SE PUDIERON LEER — un aviso de la bandeja entera, no de cada tarjeta.
 *
 * Existe porque «esta pieza no tiene franja» y «no se pudo saber si la tiene» son dos
 * afirmaciones distintas. Sin este aviso, una lectura caída pintaría «Aprobada sin franja
 * asignada» en todas las tarjetas aprobadas a la vez: una alarma falsa a escala, que es la
 * forma más rápida de enseñar a ignorar la alarma verdadera. Con él, las tarjetas callan y
 * la pantalla dice que las fechas FALTAN, no que estén vacías.
 */
export function SlotsNotice({ source }: { source: 'ok' | 'unavailable' | undefined }) {
  if (source !== 'unavailable') return null;
  return (
    <div className="flex items-start gap-2.5 text-[12px] text-amber-300/90 bg-amber-500/[0.06] border border-amber-500/25 rounded-xl px-3.5 py-3 mb-5 leading-relaxed">
      <CalendarOff size={15} className="shrink-0 mt-0.5" />
      <div>
        <p className="font-semibold text-amber-200">Las fechas de esta pantalla faltan, no están vacías.</p>
        <p className="mt-1 text-amber-300/75">
          No se pudo leer <span className="text-amber-200">intel.brand_publish_slots</span>, así que ninguna
          tarjeta muestra franja. Que no aparezca una fecha acá no significa que la pieza no la tenga.
        </p>
      </div>
    </div>
  );
}

/** Falta el huso de la marca: se nombra la columna exacta, no se aproxima la hora. */
function ZoneMissing({ what }: { what: string }) {
  return (
    <div className={cn(DATE_ROW, 'bg-amber-500/[0.06] border-amber-500/40 border-dashed text-amber-300/90')}>
      <CalendarClock size={13} className="shrink-0 mt-0.5" />
      <span>
        {what} — el huso de esta marca no está sembrado (<span className="text-amber-200">public.brands.publish_timezone</span>),
        así que la hora no se sitúa. Sembrar esa fila la muestra; acá no se supone ninguna.
      </span>
    </div>
  );
}

/**
 * La franja RESERVADA de una pieza — el COMPROMISO.
 *
 * EL AVISO DE «SIN FRANJA» SÓLO SE PINTA EN PIEZAS APROBADAS, y eso es deliberado: en una
 * pieza que todavía no se aprobó, no tener franja no es una anomalía, es lo esperado.
 * Pintarlo igual diría «aprobada» de piezas que no lo están, y un aviso que describe mal el
 * sistema deja de leerse — que es exactamente el modo de fallo que el aviso viene a evitar.
 *
 * POR QUÉ EXISTE EL AVISO, para que nadie lo quite por parecer redundante: medido el
 * 2026-09-05, hay 15 piezas aprobadas sin franja. La suposición de que una pieza aprobada
 * «ya tendrá franja» es falsa hoy. Y cuando el reservador falle, este aviso es lo único que
 * lo hará visible antes de que un canal lleve una semana mudo.
 */
export function SlotLine({ slot, approvedAt, slotsRead }: {
  slot: { slot_at: string; status: string; timezone: string | null } | null;
  approvedAt: string | null;
  /** ¿Se pudieron leer las franjas? Cuando no, la tarjeta calla y avisa `SlotsNotice`. */
  slotsRead: boolean;
}) {
  if (!slotsRead) return null; // sin lectura no se afirma nada sobre esta pieza.
  if (!slot) {
    if (!approvedAt) return null; // sin aprobar y sin franja: nada que avisar.
    return (
      <div className={cn(DATE_ROW, 'bg-amber-500/[0.08] border-amber-500/40 text-amber-200')}>
        <CalendarOff size={13} className="shrink-0 mt-0.5" />
        <span>
          <span className="font-semibold">Aprobada sin franja asignada.</span>{' '}
          <span className="text-amber-300/80">
            Esta pieza tiene el visto bueno y ninguna franja reservada, así que no va a salir sola.
          </span>
        </span>
      </div>
    );
  }

  const z = fmtInZone(slot.slot_at, slot.timezone);
  if (!z) return <ZoneMissing what="Franja reservada" />;

  return (
    <div className={cn(DATE_ROW, 'bg-emerald-500/[0.07] border-emerald-500/25 text-emerald-200/90')} title={z.title}>
      <CalendarCheck size={13} className="shrink-0 mt-0.5" />
      <span>
        <span className="text-emerald-300/70">Publica:</span>{' '}
        <span className="font-semibold">{z.when}</span>{' '}
        <span className="text-emerald-300/70">({z.zone})</span>
        {/* El estado de la franja se dice sólo cuando NO es el de una reserva viva: una
            franja fallida no es un compromiso y no se puede leer como tal. */}
        {slot.status !== 'reserved' && (
          <span className="text-amber-300/90"> · franja en estado {slot.status}</span>
        )}
      </span>
    </div>
  );
}

/**
 * La PREVISIÓN de una pieza en calibración: la próxima franja libre de su marca × canal.
 *
 * Borde punteado y verbo en condicional a propósito: lo que se muestra puede cambiar, y una
 * previsión que se ve igual que un compromiso se recuerda como un compromiso. Cuando no hay
 * franja libre futura se dice, porque eso es información sobre el canal, no un error.
 */
export function ForecastLine({ forecast, slotsRead }: {
  forecast: { slot_at: string; timezone: string | null } | null;
  /** ¿Se pudieron leer las franjas? Cuando no, «sin franja libre» sería una afirmación sin medir. */
  slotsRead: boolean;
}) {
  if (!slotsRead) return null;
  if (!forecast) {
    return (
      <div className={cn(DATE_ROW, 'bg-zinc-800/40 border-zinc-700/60 border-dashed text-zinc-400')}>
        <CalendarX size={13} className="shrink-0 mt-0.5" />
        <span>
          Sin franja libre en el horizonte — este canal no tiene ninguna franja futura sin ocupar.
          Aprobarla no le daría fecha todavía.
        </span>
      </div>
    );
  }

  const z = fmtInZone(forecast.slot_at, forecast.timezone);
  if (!z) return <ZoneMissing what="Franja libre prevista" />;

  return (
    <div
      className={cn(DATE_ROW, 'bg-sky-500/[0.06] border-sky-500/30 border-dashed text-sky-200/90')}
      title={`${z.title} — previsión: otra pieza aprobada antes puede llevarse esta franja.`}
    >
      <CalendarClock size={13} className="shrink-0 mt-0.5" />
      <span>
        <span className="text-sky-300/70">Fecha prevista de publicación:</span>{' '}
        <span className="font-semibold">{z.when}</span>{' '}
        <span className="text-sky-300/70">({z.zone})</span>
        <span className="text-sky-300/55"> · previsión, no reserva: otra pieza aprobada antes se la lleva</span>
      </span>
    </div>
  );
}

/** Id corto: lo que Sam le pasa a Claude en el chat para referirse a una pieza. */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : '—';
}

// ── Pill de marca / canal ────────────────────────────────────────────────────────
export function CountPill({ label, count, active, onClick }: {
  label: string; count: number; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all font-body',
        active ? 'bg-accent text-black shadow' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
      )}
    >
      {label}
      <span className={cn(
        'text-[9px] font-mono px-1.5 py-0.5 rounded-full',
        active ? 'bg-black/20 text-black' : 'bg-zinc-800 text-zinc-600'
      )}>{count}</span>
    </button>
  );
}

// ── Selector de orden / filtro ───────────────────────────────────────────────────
export function Selector({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]>;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-zinc-600">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-zinc-300 outline-none focus:border-accent/50 transition-colors"
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

// ── Paginación: los botones se ven SIEMPRE, deshabilitados incluido ──────────────
// Un botón invisible cuando no aplica deja al operador sin saber dónde está parado.
function PageButton({ onClick, disabled, label, icon, iconRight }: {
  onClick: () => void; disabled: boolean; label: string; icon: React.ReactNode; iconRight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-1 px-3 py-1.5 rounded-lg border transition-colors',
        disabled
          ? 'border-zinc-800/70 bg-zinc-900/40 text-zinc-600 cursor-not-allowed'
          : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-white'
      )}
    >
      {!iconRight && icon}{label}{iconRight && icon}
    </button>
  );
}

export function Pager({ offset, pageSize, total, loading, onGo, noun = 'pieza' }: {
  offset: number; pageSize: number; total: number; loading: boolean;
  onGo: (offset: number) => void; noun?: string;
}) {
  const pages  = Math.max(1, Math.ceil(total / pageSize));
  const pageNo = Math.min(pages, Math.floor(offset / pageSize) + 1);
  return (
    <div className="flex items-center justify-between gap-3 mt-6 text-[11px] font-mono">
      <PageButton
        onClick={() => onGo(Math.max(0, offset - pageSize))}
        disabled={offset <= 0 || loading}
        label="Anterior"
        icon={<ChevronLeft size={13} />}
      />
      <span className="text-zinc-400">
        Página <span className="text-zinc-200">{pageNo}</span> de <span className="text-zinc-200">{pages}</span>
        <span className="text-zinc-600"> · {total} {noun}{total === 1 ? '' : 's'}</span>
      </span>
      <PageButton
        onClick={() => onGo(offset + pageSize)}
        disabled={offset + pageSize >= total || loading}
        label="Siguiente"
        icon={<ChevronRight size={13} />}
        iconRight
      />
    </div>
  );
}

// ── Id copiable ──────────────────────────────────────────────────────────────────
export function CopyableId({ id, title }: { id: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Sin permiso de portapapeles: el id sigue visible y seleccionable a mano.
      setCopied(false);
    }
  };
  return (
    <button
      onClick={copy}
      title={`${title}: ${id} — clic para copiar`}
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono transition-colors',
        copied ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
      )}
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {shortId(id)}
    </button>
  );
}

// ── Cabecera de pieza ────────────────────────────────────────────────────────────
// FIX-CARD-06 · QUÉ ES ESTA PIEZA Y SI CABE EN SU CANAL, SIN ABRIR NADA.
//
// EL DEFECTO: la cabecera decía marca, canal, formato y voz, y ahí se acababa. Para saber
// si la pieza pasaba del tope del canal, o si llevaba la firma que su voz declara, había
// que abrir el artefacto y contar a ojo — sobre una bandeja de veinte tarjetas por página.
//
// LA REGLA DEL COLOR, y por qué «sin dato» no es verde:
//   verde  → hay tope sembrado Y la pieza lo cumple
//   ámbar  → pasa el objetivo pero no el tope duro
//   rojo   → pasa el tope duro: el canal la corta
//   ámbar CON MOTIVO → el tope no está sembrado. No se aproxima ni se supone.
// Pintar verde lo que nadie midió es una ausencia con forma de aprobación, que es el mismo
// defecto que ya hizo rechazar material bueno en esta bandeja (ver `WatcherBadge`).
//
// NINGÚN NÚMERO DE TOPE VIVE ACÁ. Salen de `public.platform_configs` por canal y la firma
// esperada de `brand_voice_genome`, resueltos en el server (`api/_pieceMetrics.ts`). Este
// archivo sólo pinta lo que le llega.

/** Lo mínimo que una pieza necesita exponer para que su cabecera se pueda dibujar. */
export interface PieceHeaderData {
  brand_id: string;
  platform: string | null;
  format: string | null;
  voice: string | null;
  domain: string | null;
  metrics: PieceMetrics | null;
}

const CHIP = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border';
const CHIP_BY_STATUS: Record<string, string> = {
  ok:          'bg-emerald-500/10 border-emerald-500/25 text-emerald-300/85',
  over_target: 'bg-amber-500/10 border-amber-500/40 text-amber-300',
  over_limit:  'bg-rose-500/10 border-rose-500/35 text-rose-300',
  // Ausencia de dato: ámbar, y con el borde punteado para que no se confunda con «pasa el
  // objetivo». Son dos ámbares distintos y la tarjeta tiene que poder distinguirlos.
  no_data:     'bg-amber-500/[0.06] border-amber-500/40 border-dashed text-amber-300/85',
};

/**
 * Un conteo contra su tope: `300/2200 car`. Cuando el tope no está sembrado se escribe
 * `sin dato` en el lugar del número — nunca un cero, nunca un guion que se lea como cero.
 */
function LimitChip({ c, noun, hint }: { c: CountAgainstLimit; noun: string; hint: string }) {
  const cap = c.limit === null ? 'sin dato' : String(c.limit);
  return (
    <span className={cn(CHIP, CHIP_BY_STATUS[c.status] ?? CHIP_BY_STATUS.no_data)} title={c.reason ?? hint}>
      {c.count}/{cap} {noun}
      {c.status === 'over_target' && c.target !== null && (
        <span className="opacity-60">· sobre el objetivo ({c.target})</span>
      )}
    </span>
  );
}

const SIGNATURE_CHIP: Record<SignatureCheck['status'], { cls: string; label: string }> = {
  match:        { cls: CHIP_BY_STATUS.ok,      label: 'firma ✓' },
  mismatch:     { cls: CHIP_BY_STATUS.over_limit, label: 'firma ✗' },
  // Decisión declarada del genoma, no un defecto: esta voz no firma. Ni verde ni rojo.
  not_declared: { cls: 'bg-zinc-800/60 border-zinc-700 text-zinc-400', label: 'firma — no firma' },
  no_voice:     { cls: CHIP_BY_STATUS.no_data, label: 'firma — sin dato' },
  no_data:      { cls: CHIP_BY_STATUS.no_data, label: 'firma — sin dato' },
};

/**
 * La firma, COMPARADA. La esperada sale del genoma por `brand_id`/`voice_id`; la estampada
 * es con lo que la pieza cierra de verdad. Se muestran LAS DOS y en la línea, no en un
 * tooltip: una comparación que hay que descubrir pasando el cursor no es una comparación.
 */
function SignatureLine({ s }: { s: SignatureCheck }) {
  const quote = (v: string | null) => (v ? `«${v}»` : 'sin cierre');
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[10px] font-mono leading-snug">
      <span className="text-zinc-700">firma</span>
      {s.expected !== null && (
        <span className="text-zinc-500">esperada <span className="text-zinc-300">{quote(s.expected)}</span></span>
      )}
      <span className={cn(
        s.status === 'match' ? 'text-emerald-400/80'
          : s.status === 'mismatch' ? 'text-rose-300'
          : 'text-zinc-500',
      )}>
        estampada <span className={s.status === 'match' ? 'text-emerald-300/90' : 'text-zinc-300'}>{quote(s.stamped)}</span>
      </span>
      {s.reason && <span className="text-amber-400/70">— {s.reason}</span>}
    </div>
  );
}

export function PieceHeader({ piece }: { piece: PieceHeaderData }) {
  const m = piece.metrics;
  // Los motivos de «sin dato» se leen SIN pasar el cursor: un ámbar sin motivo alarma en vez
  // de informar, y el motivo nombra la columna exacta que falta por sembrar.
  const gaps = m
    ? [m.chars.reason, m.hashtags.reason].filter((r): r is string => Boolean(r))
    : [];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-x-2 gap-y-1 flex-wrap text-[10px] font-mono text-zinc-600">
        <span className="text-accent/80 font-semibold">{piece.brand_id}</span>
        <span title="content_pieces.platform — el canal al que va esta pieza.">
          · {piece.platform ?? 'sin canal'}
        </span>
        {piece.format && <span>· {piece.format}</span>}
        {piece.voice && <span>· voice:{piece.voice}</span>}
        {piece.domain && <span>· {piece.domain}</span>}
        {m ? (
          <>
            <LimitChip
              c={m.chars}
              noun="car"
              hint={m.text_source === 'channel_adapted'
                ? 'Caracteres del texto ADAPTADO a este canal, contra los topes de public.platform_configs.'
                : 'Caracteres del texto maestro (no hay adaptación para este canal), contra los topes de public.platform_configs.'}
            />
            <LimitChip
              c={m.hashtags}
              noun="hashtags"
              hint="Hashtags del texto que sale por este canal, contra platform_configs.hashtag_limit."
            />
            <span
              className={cn(CHIP, SIGNATURE_CHIP[m.signature.status].cls)}
              title={m.signature.reason ?? 'La pieza cierra con la firma que el genoma declara para su voz.'}
            >
              {SIGNATURE_CHIP[m.signature.status].label}
            </span>
          </>
        ) : (
          <span className={cn(CHIP, CHIP_BY_STATUS.no_data)}
                title="El server no resolvió los catálogos de topes y firmas para esta pieza.">
            conteos — sin dato
          </span>
        )}
      </div>

      {m && <SignatureLine s={m.signature} />}

      {gaps.length > 0 && (
        <div className="text-[10px] font-mono text-amber-400/70 leading-snug space-y-0.5">
          {gaps.map((g) => <div key={g}>— {g}</div>)}
        </div>
      )}
    </div>
  );
}

// ── Generación del flujo ─────────────────────────────────────────────────────────
export function GenerationBadge({ generation, label, at }: {
  generation: FlowGeneration; label: string | null; at: string | null;
}) {
  // FIX-CARD-06 · EL CORTE SE NOMBRA EN LA ETIQUETA, NO EN EL TOOLTIP.
  // «Flujo anterior», a secas, no dice anterior A QUÉ: obligaba a pasar el cursor por cada
  // tarjeta para saber contra qué corte se comparó. El dato ya llegaba como prop — estaba
  // escondido, no ausente. El tooltip conserva la fecha y la explicación, que sí son
  // secundarias; el nombre del corte no lo era.
  if (generation === 'previous') {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/40 text-amber-300"
        title={label ? `Anterior al corte «${label}» (${fmtDate(at)}). La juzgó un flujo que ya se arregló.` : 'Anterior al último corte del flujo.'}
      >
        <History size={10} /> Flujo anterior
        {label && <span className="text-amber-300/60">· {label}</span>}
      </span>
    );
  }
  if (generation === 'current') {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-500/25 text-sky-300/85"
        title={label ? `Posterior al corte «${label}» (${fmtDate(at)}).` : 'Posterior al último corte del flujo.'}
      >
        <GitBranch size={10} /> Flujo corregido
        {label && <span className="text-sky-300/50">· {label}</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-800/70 border border-zinc-700/60 text-zinc-500"
          title="No hay ningún corte de flujo aplicable a esta pieza: no se puede afirmar de qué generación es.">
      <GitBranch size={10} /> Flujo: sin corte
    </span>
  );
}

// ── Aviso sobre el origen de los cortes ──────────────────────────────────────────
export function CutoffsNotice({ source }: { source: 'unavailable' | 'empty' | 'seeded' }) {
  if (source === 'seeded') return null;
  return (
    <div className="flex items-start gap-2 text-[11px] text-amber-400/80 bg-amber-500/[0.05] border border-amber-500/20 rounded-xl px-3 py-2 mb-4 font-mono leading-snug">
      <History size={13} className="shrink-0 mt-0.5" />
      <span>
        {source === 'unavailable'
          ? 'intel.pipeline_cutoffs no está disponible todavía — la generación del flujo se muestra como «sin corte».'
          : 'intel.pipeline_cutoffs está vacía — sembrar los cortes para que la generación del flujo se calcule.'}
      </span>
    </div>
  );
}

// ── Etiqueta de la primera opinión del watcher ───────────────────────────────────
// Informativa: NO condiciona ninguna acción. Sam puede aprobar lo que el watcher rechazó
// (el dato valioso: "watcher se equivocó") o rechazar lo que el watcher aprobó.
// ── SIGN-01 corte D · EL VEREDICTO, SIN AMBIGÜEDAD ────────────────────────────────
// EL DEFECTO, reportado sobre las tarjetas del 2026-08-25:
//   · «Watcher: RECHAZÓ» con el código pero SIN la explicación — que la pestaña de Retenidas sí da;
//   · «Watcher: OK», sin que quedara claro si significa "evaluó y pasó" o "aprobó";
//   · tarjetas SIN NINGUNA indicación, donde no se sabía si el Watcher llegó a evaluarla.
//
// Y el peor de los tres, porque hace rechazar material perfecto: la lista de códigos ERA el conjunto
// EVALUADO y se leía como si fuera de violaciones. En `c92b2b9f` aparecían 19 códigos y el Watcher
// había dado OK. Con eso a la vista, rechazar una pieza correcta es lo esperable.
//
// Los cuatro estados se nombran, cada uno con su razón, y "evaluadas" nunca se muestra con la misma
// forma que "incumplidas": las incumplidas se enumeran, las evaluadas se cuentan.
export function WatcherBadge({ verdict, reason, failedRules, rulesEvaluated, passType }: {
  verdict: 'PASS' | 'REJECT' | 'RESCHEDULE' | 'not_evaluated';
  reason?: string | null;
  failedRules?: string[] | null;
  rulesEvaluated?: number | null;
  passType?: string | null;
}) {
  const codes = (Array.isArray(failedRules) ? failedRules : []).filter(Boolean);
  const estilo: Record<string, { cls: string; icon: React.ReactNode; label: string; title: string }> = {
    REJECT: {
      cls: 'bg-rose-500/10 border-rose-500/30 text-rose-300',
      icon: <ShieldAlert size={10} />, label: 'Watcher: RECHAZÓ',
      title: 'El watcher rechazó esta pieza. Si se equivocó, la pieza se aprueba igual — ese es el dato valioso.',
    },
    PASS: {
      cls: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400/80',
      icon: <ShieldCheck size={10} />, label: 'Watcher: evaluó y PASÓ',
      title: 'El watcher juzgó esta pieza y no encontró incumplimientos. No es una aprobación: la aprobación es tuya.',
    },
    RESCHEDULE: {
      cls: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
      icon: <ShieldQuestion size={10} />, label: 'Watcher: APLAZÓ',
      title: 'El sistema la apartó para más adelante. No es un defecto de la pieza.',
    },
    not_evaluated: {
      cls: 'bg-zinc-800/60 border-zinc-700 text-zinc-400',
      icon: <ShieldQuestion size={10} />, label: 'Watcher: SIN evaluar',
      title: 'No hay veredicto registrado para esta pieza. Distinto de "pasó": nadie la juzgó.',
    },
  };
  const e = estilo[verdict] ?? estilo.not_evaluated;
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded border w-fit', e.cls)} title={e.title}>
        {e.icon} {e.label}
        {/* INCUMPLIDAS: se enumeran. Es la única lista de códigos que la tarjeta muestra. */}
        {verdict === 'REJECT' && codes.length > 0 && <span className="font-mono">· {codes.join(', ')}</span>}
        {/* EVALUADAS: se CUENTAN, nunca se enumeran — enumerarlas es lo que se leía como violaciones. */}
        {typeof rulesEvaluated === 'number' && (
          <span className="opacity-50" title="Contra cuántas reglas enumeradas se juzgó esta pieza. NO son incumplimientos.">
            · {rulesEvaluated} evaluada{rulesEvaluated === 1 ? '' : 's'}
          </span>
        )}
        {/* SIGN-01 corte D · el tipo de pase: si cuenta para el 90% o para el ratio aprovechable. */}
        {passType === 'assisted' && (
          <span className="opacity-70" title="Hubo intervención humana: cuenta para el ratio aprovechable, no para el objetivo del 90% de PASS limpio.">
            · asistida
          </span>
        )}
      </span>
      {/* LA RAZÓN, no sólo el código. La redacta el server, que es quien tiene el gate_detail. */}
      {reason && <span className="text-[10px] text-zinc-500 leading-snug">{reason}</span>}
    </span>
  );
}

// ── Procedencia: de dónde salió esta pieza y contra qué se la juzgó ──────────────
/** Lo mínimo que una pieza necesita exponer para que su procedencia se pueda dibujar. */
export interface PieceProvenance {
  piece_id: string;
  job_id: string | null;
  finding_id: string | null;
  status: string | null;
  created_at: string | null;
  watcher_verdict_at: string | null;
  attempts: number | null;
  gate_rules_evaluated: number | null;
  gate_evaluated_codes: string[];
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={hint}>
      <span className="text-zinc-700">{label}</span>
      {children}
    </span>
  );
}

export function Provenance({ piece }: { piece: PieceProvenance }) {
  const codes = piece.gate_evaluated_codes ?? [];
  return (
    <div className="rounded-xl border border-zinc-800/80 bg-[#08080c] px-3 py-2.5 text-[10px] font-mono text-zinc-500 space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <Field label="pieza"><CopyableId id={piece.piece_id} title="piece_id" /></Field>
        {piece.job_id && <Field label="job"><CopyableId id={piece.job_id} title="orchestrator_job_id" /></Field>}
        {piece.finding_id && (
          <Field label="hallazgo" hint="intel.iid_findings.id — el hallazgo del que salió esta pieza.">
            <CopyableId id={piece.finding_id} title="finding_id" />
          </Field>
        )}
        {typeof piece.attempts === 'number' && (
          <Field label="intentos" hint="Jobs corridos sobre la misma fila de cola. Los reintentos no son piezas.">
            <span className={cn('text-zinc-300', piece.attempts > 1 && 'text-amber-300/90')}>{piece.attempts}</span>
          </Field>
        )}
        {piece.status && <Field label="estado"><span className="text-zinc-400">{piece.status}</span></Field>}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <Field label="creada" hint="content_pieces.created_at, en tu hora local.">
          <span className="inline-flex items-center gap-1 text-zinc-400"><Clock size={9} /> {fmtDate(piece.created_at)}</span>
        </Field>
        <Field label="veredicto" hint="watcher_log.created_at, en tu hora local.">
          <span className="inline-flex items-center gap-1 text-zinc-400"><Clock size={9} /> {fmtDate(piece.watcher_verdict_at)}</span>
        </Field>
        {typeof piece.gate_rules_evaluated === 'number' && (
          <Field label="reglas evaluadas"><span className="text-zinc-300">{piece.gate_rules_evaluated}</span></Field>
        )}
      </div>

      {codes.length > 0 && (
        <div className="flex flex-wrap items-start gap-1.5 pt-0.5">
          <span className="text-zinc-700 pt-0.5">códigos</span>
          {codes.map((c) => (
            <span key={c} className="px-1 py-0.5 rounded bg-zinc-800/80 text-zinc-400">{c}</span>
          ))}
        </div>
      )}
    </div>
  );
}
