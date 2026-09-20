import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, XCircle, Archive, Wrench, ImagePlay, PenLine } from 'lucide-react';
import { cn, Spinner } from '../../ui/components';
import {
  saveVerdict, discardPiece, recomposeImage, CalibrationError,
  REJECT_REASONS, buildCriterion,
  type PieceActionKey, type PieceActions, type SlotRelease, type Verdict,
} from '../../services/calibrationInbox';
import { savePieceEdit } from '../../services/challengedInbox';
import { fmtInZone } from './pieceUi';

/**
 * pieceActions.tsx — U-5 · LAS ACCIONES DE UNA PIEZA, EN UN SOLO SITIO.
 *
 * ── POR QUÉ UN SOLO COMPONENTE ───────────────────────────────────────────────────
 * Si dos pantallas PUEDEN divergir, divergirán: ya pasó con `bodyTextOf` y
 * `channelTextOf`, y se arregló dejando una sola función. Aquí se aplica antes de que
 * ocurra, no después. Publicación y Calibración montan ESTE componente; Retenidas e
 * Historial lo montarán en U-6, y por eso no se llama `publishActions` — ése sería el
 * nombre del caso, la bandeja desde la que se montó primero.
 *
 * ── EL COMPONENTE NO SABE DESDE QUÉ BANDEJA LO MONTAN ────────────────────────────
 * Recibe la pieza con su `actions` y pinta. No hay una prop `inbox`, ni un `variant`, ni
 * una rama por pantalla: en cuanto exista una, la disponibilidad habrá vuelto al front.
 *
 * ── REGLA DURA: EL FRONT NO EVALÚA ESTADO ────────────────────────────────────────
 * Nada de comparar el estado de la pieza, ni su sello de descarte, ni la presencia de una
 * imagen para decidir si una acción se puede. **Lo dice `actions[k].available`, y el motivo
 * `actions[k].reason`.** Hay una prueba que barre este archivo buscando esos condicionales
 * — y este comentario evita nombrarlos en su forma literal a propósito, para que el barrido
 * del brief no se tropiece con la regla que lo exige.
 *
 * ── UN BOTÓN NO DISPONIBLE SE APAGA, NUNCA SE OCULTA ─────────────────────────────
 * Un botón que desaparece obliga a preguntarse si existe; uno apagado con su motivo dice
 * qué pasa y qué hacer. El motivo viaja en el `title`, que es donde el operador ya mira.
 *
 * ── LA JERARQUÍA NO ES ESTÉTICA: LA DECIDE QUÉ DEJA APRENDIZAJE ──────────────────
 * Principio de Sam, 2026-09-13 · U-6 §2 bis. El carril es CALIBRACIÓN y existe para que
 * haya aprendizaje. Editar el texto no deja aprendizaje por sí mismo: es un complemento
 * «good to have», no el camino correcto para el objetivo de la calibración.
 *
 * De ahí salen los tres niveles, y no son una opinión de estilo — las seis acciones no
 * pesan lo mismo porque no producen lo mismo:
 *
 *   · PRIMARIO — juicio: `approve`, `reject`, `fixable`. **Escriben el corpus.** Son las
 *     que enseñan, y se pintan PRIMERO Y JUNTAS, sin nada intercalado entre las tres.
 *   · SECUNDARIO — sello sin juicio: `discard`. Saca la pieza de la bandeja y NO entra al
 *     corpus. Sella, pero no enseña.
 *   · TERCIARIO — arreglo: `edit_text`, `recompose_image`. Corrigen el artefacto y no
 *     dejan aprendizaje. Van después de las demás y visualmente subordinadas.
 *
 * Lo que se degrada es el PESO, nunca la DISPONIBILIDAD: las seis siguen ahí y siguen
 * funcionando. Quién puede hacer qué lo sigue diciendo el contrato, no este orden.
 *
 * Y el corolario que evita la discusión de la próxima vez: cuando entre una acción nueva,
 * lo primero que se pregunta no es dónde ponerla, sino SI ESCRIBE EN EL CORPUS — la
 * respuesta decide el nivel. Un orden de botones sin el motivo escrito se reordena en el
 * siguiente PR que toque el archivo, y vuelve.
 */

// ── El contrato de entrada ───────────────────────────────────────────────────────
/**
 * Lo que el componente necesita de una pieza. Deliberadamente MÍNIMO: cuanto menos sepa,
 * menos puede decidir. `slot` es opcional porque sólo la bandeja de publicación entrega un
 * compromiso de fecha; donde no lo hay, los textos de confirmación no prometen liberarlo.
 */
export interface ActionablePiece {
  piece_id: string;
  actions: PieceActions;
  /** El texto efectivo que el panel de edición carga. `null` = la pieza no tiene texto. */
  body: string | null;
  title: string | null;
  /** El COMPROMISO de fecha, cuando la bandeja lo entrega. Nunca se recalcula acá. */
  slot?: { slot_at: string; status: string; timezone: string | null } | null;
}

/** Lo que le pasa a la pieza cuando una acción termina. `null` = sigue en la bandeja. */
export type ActionOutcome = 'approved' | 'rejected' | 'fixable' | 'discarded';

// ── La tabla de acciones: eje del sistema, no de una bandeja ─────────────────────
/**
 * Las seis, EN EL ORDEN EN QUE SE PINTAN — y ese orden es el de la doctrina de arriba:
 * primero las tres que escriben el corpus, después la que sella sin juicio, al final las
 * dos que sólo arreglan. Cada una declara su etiqueta, su forma y su NIVEL, y nada sobre
 * cuándo está disponible — eso es del contrato.
 *
 * `weight` es el nivel, y es lógica pura a propósito: así el orden se puede probar sin
 * mirar una clase de CSS. Una prueba de estilos se rompe al cambiar un color; una de orden
 * se rompe sólo cuando cambia la doctrina, que es cuando tiene que romperse.
 *
 * `panel` dice qué panel de texto abre. `null` = se ejecuta de un clic, sin panel: aprobar
 * es la única que no pide nada escrito, porque no hay nada que explicar en un visto bueno.
 *
 * `seals` marca las tres que SACAN LA PIEZA DE CIRCULACIÓN. Es lo que decide si el texto de
 * confirmación habla de la franja: son exactamente las que la liberan (U-3). No coincide
 * con `weight`: `discard` sella y no enseña, y por eso no está en el nivel primario.
 */
export type ActionWeight = 'primary' | 'secondary' | 'tertiary';

export const ACTION_SPECS: ReadonlyArray<{
  key: PieceActionKey;
  label: string;
  panel: PanelKey | null;
  seals: boolean;
  weight: ActionWeight;
  hint: string;
}> = [
  // Nivel primario — juicio: escriben el corpus. Van primero y juntas.
  { key: 'approve', label: 'Aprobar', panel: null, seals: false, weight: 'primary',
    hint: 'Habilita la pieza. La franja la calcula content-scheduler.' },
  { key: 'reject', label: 'Rechazar', panel: 'reject', seals: true, weight: 'primary',
    hint: 'Entra al corpus como rechazo y sella la pieza.' },
  // `seals: false` — y es el cambio del 2026-09-20. Un fixable RETA la pieza: la saca de
  // «esperando» y la pone en la cola de arreglos, pero no la descarta. Sellarla la sacaba del
  // sistema entero (imagen, franjas, re-adaptación), que es lo contrario de marcarla para arreglar.
  { key: 'fixable', label: 'Fixable', panel: 'fix', seals: false, weight: 'primary',
    hint: 'Hay algo que aprovechar. Reta la pieza y guarda la propuesta: queda por arreglar, no descartada.' },
  // Nivel secundario — sella sin juicio: saca la pieza y no enseña nada.
  { key: 'discard', label: 'Descartar', panel: 'discard', seals: true, weight: 'secondary',
    hint: 'No voy a juzgar esta pieza: sale de la bandeja y NO entra al corpus.' },
  // Nivel terciario — arreglo: corrigen el artefacto y no dejan aprendizaje.
  { key: 'edit_text', label: 'Editar texto', panel: 'edit', seals: false, weight: 'tertiary',
    hint: 'Corrige el texto de la pieza. No es un veredicto: la pieza sigue donde está.' },
  { key: 'recompose_image', label: 'Regenerar imagen', panel: 'regen', seals: false, weight: 'tertiary',
    hint: 'Regenera la escena con una corrección, sin votar.' },
];

export type PanelKey = 'reject' | 'fix' | 'edit' | 'regen' | 'discard';

// ── Lógica pura, probable sin montar React ───────────────────────────────────────
/**
 * QUÉ BOTONES SE PINTAN Y CUÁL SE APAGA. Devuelve SIEMPRE los seis, en orden: apagar no es
 * ocultar. `reason` viaja tal cual lo mandó el server — la pantalla no redacta motivos.
 *
 * Una acción que el contrato no declara se trata como NO disponible, con un motivo que lo
 * dice. Es fail-loud: un contrato viejo produce botones apagados y explicados, nunca botones
 * activos que fallarían al pulsarse.
 */
export function actionButtons(actions: PieceActions | null | undefined): Array<{
  key: PieceActionKey; label: string; panel: PanelKey | null; seals: boolean;
  weight: ActionWeight; available: boolean; reason: string | null; hint: string;
}> {
  return ACTION_SPECS.map((spec) => {
    const a = actions?.[spec.key];
    if (!a || typeof a.available !== 'boolean') {
      return {
        ...spec,
        available: false,
        reason: 'El servidor no declaró esta acción para esta pieza.',
      };
    }
    return { ...spec, available: a.available, reason: a.available ? null : (a.reason ?? null) };
  });
}

/**
 * EL AVISO DE FRANJA QUE VA *ANTES* DE LA ACCIÓN, no después.
 *
 * Sam decide con el compromiso delante, no después de haberlo roto. La fecha sale de
 * `fmtInZone` — la MISMA función que ya pinta `SlotLine` en la tarjeta. Un segundo formateo
 * de la misma fecha son dos fechas en cuanto alguien toque uno.
 *
 * Devuelve `null` cuando no hay nada que avisar: acción que no sella, pieza sin franja, o
 * huso sin sembrar (y entonces no se inventa una hora: se calla, como hace `SlotLine`).
 */
export function slotWarning(
  seals: boolean,
  slot: ActionablePiece['slot'],
): { when: string; zone: string; text: string } | null {
  if (!seals || !slot) return null;
  const z = fmtInZone(slot.slot_at, slot.timezone);
  if (!z) return null;
  return {
    when: z.when,
    zone: z.zone,
    text: `Esta pieza tiene franja reservada para el ${z.when} (${z.zone}). `
      + 'Al sellarla, esa franja vuelve al pozo y otra pieza podrá ocuparla.',
  };
}

/**
 * QUÉ DECIR DESPUÉS, sobre la franja. Es la única vía por la que el fallo de liberación de
 * U-3 puede llegar hasta Sam: el endpoint lo atrapa a propósito para no tumbar un veredicto
 * ya aplicado, y un error atrapado sin vía de aparecer es un error invisible.
 *
 * `null` = no hay nada que decir (la acción no libera, o el server no informó).
 */
export function slotReleaseNotice(
  release: SlotRelease | null | undefined,
): { tone: 'ok' | 'alert'; text: string } | null {
  if (!release) return null;
  if (!release.ok) {
    return {
      tone: 'alert',
      text: 'La pieza quedó sellada, pero su FRANJA NO SE LIBERÓ'
        + (release.error ? ` (${release.error})` : '')
        + '. El hueco sigue reservado a una pieza que ya no va a salir: hay que revisarlo '
        + 'con la consulta de vigilancia de franjas.',
    };
  }
  if (release.released === 0) return { tone: 'ok', text: 'No tenía franja reservada: no había hueco que devolver.' };
  return {
    tone: 'ok',
    text: release.released === 1
      ? 'Su franja volvió al pozo: otra pieza puede ocuparla.'
      : `Sus ${release.released} franjas volvieron al pozo.`,
  };
}

/**
 * QUÉ SE LE DICE A SAM CUANDO UNA ACCIÓN RESUELVE LA PIEZA.
 *
 * Un acuse ausente no se distingue de una acción que no ocurrió. La tarjeta va a
 * desaparecer de la lista en cuanto la bandeja la retire, así que la única ventana para
 * decir qué pasó es ésta — y tiene que existir en las DOS bandejas por igual.
 *
 * Cada línea dice el efecto REAL, no el clic: aprobar habilita pero no publica, y fixable
 * sella igual que un rechazo. Nombrarlo mal acá enseñaría el sistema al revés.
 */
export const OUTCOME_COPY: Record<ActionOutcome, { tone: 'ok' | 'sealed'; text: string }> = {
  approved: { tone: 'ok', text: 'Aprobada y guardada en el corpus. Habilitada para salir: la franja la calcula content-scheduler, no este clic.' },
  rejected: { tone: 'sealed', text: 'Rechazada y guardada en el corpus. La pieza queda sellada y sale de la bandeja.' },
  fixable: { tone: 'ok', text: 'Marcada como fixable. La pieza queda RETADA, no descartada: espera una sesión de arreglos con la propuesta en su motivo.' },
  discarded: { tone: 'sealed', text: 'Descartada. Sale de la bandeja y NO entra al corpus: un descarte no es un rechazo.' },
};

/** El copy de cada panel. Un solo sitio, porque el mismo textarea significa cosas distintas. */
export const PANEL_COPY: Record<PanelKey, {
  label: string | null; placeholder: string; confirm: string; foot: string;
  focus: string; button: string; required: boolean;
}> = {
  reject: {
    label: null,
    placeholder: 'Criterio del rechazo (opcional — normalmente lo escribe Claude desde el chat)…',
    confirm: 'Confirmar rechazo',
    foot: 'El rechazo entra al corpus con o sin criterio. Mejor vacío que de relleno.',
    focus: 'focus:border-rose-500/60', button: 'bg-rose-500/90 hover:bg-rose-500', required: false,
  },
  fix: {
    label: 'Qué propongo para aprovecharla',
    placeholder: 'Qué se rescata de esta pieza y cómo — con esto se corrige después en el chat…',
    confirm: 'Confirmar fixable',
    foot: 'Fixable RETA la pieza: queda «por arreglar», no descartada, y conserva su imagen y su '
      + 'sitio en la cola. La propuesta es obligatoria y baja al motivo del reto.',
    focus: 'focus:border-sky-500/60', button: 'bg-sky-500/90 hover:bg-sky-500', required: true,
  },
  edit: {
    label: 'El texto de la pieza',
    placeholder: 'El texto corregido…',
    confirm: 'Guardar texto',
    foot: 'Esto NO es un veredicto: la pieza no se mueve y no entra al corpus. La guarda de la '
      + 'marca AVISA y no bloquea — si algún aviso salta, se muestra y se puede guardar igual.',
    focus: 'focus:border-emerald-500/60', button: 'bg-emerald-500/90 hover:bg-emerald-500', required: true,
  },
  regen: {
    label: 'Directriz para el generador',
    placeholder: 'La directriz ya redactada para el generador — la que Claude escribe a partir de tus palabras…',
    confirm: 'Regenerar imagen',
    foot: 'Esto NO es un veredicto: la pieza sigue en la bandeja y no entra al corpus. Cuesta una '
      + 'generación de imagen, reemplaza la de ESTA pieza (no crea una nueva) y actualiza los posts '
      + 'que sigan pendientes de publicar. La directriz es obligatoria y queda registrada.',
    focus: 'focus:border-violet-500/60', button: 'bg-violet-500/90 hover:bg-violet-500', required: true,
  },
  discard: {
    label: null,
    placeholder: 'Motivo del descarte (opcional)…',
    confirm: 'Confirmar descarte',
    foot: 'Descartar no es rechazar: sale de la bandeja y NO entra al corpus.',
    focus: 'focus:border-zinc-500/60', button: 'bg-zinc-700 hover:bg-zinc-600', required: false,
  },
};

/** Forma de cada botón. Sin marcas, sin canales: sólo la acción. */
/**
 * UN BOTÓN APAGADO TIENE QUE VERSE APAGADO — corrección del 2026-09-13, sobre captura.
 *
 * El defecto: `approve` es el único con RELLENO sólido (los otros cinco son sólo borde), así
 * que atenuarlo con `opacity` lo dejaba siendo **el elemento más llamativo de la fila**.
 * La pieza decía «ya está aprobada» en su tooltip y el botón seguía leyéndose como la acción
 * principal disponible — el estado y su apariencia decían cosas opuestas.
 *
 * Un botón deshabilitado no se distingue por su transparencia: se distingue por NO tener la
 * forma de una acción ofrecida. Por eso el apagado no atenúa el estilo activo, lo SUSTITUYE
 * por uno neutro, igual para las seis acciones — qué acción era deja de importar cuando lo
 * que hay que leer es que no se puede.
 *
 * Esto NO es evaluar estado en el front: la rama va sobre `available`, que es lo que el
 * contrato declara. La pantalla sigue sin saber por qué.
 */
const DISABLED_STYLE =
  'border border-dashed border-zinc-800 bg-transparent text-zinc-600 shadow-none font-normal';

const BUTTON_STYLE: Record<PieceActionKey, string> = {
  // Primario — juicio: color propio, porque son las que escriben el corpus.
  approve: 'bg-accent text-black hover:bg-accent/90 shadow-md shadow-accent/20 font-semibold',
  reject: 'border border-rose-500/30 text-rose-300/90 hover:bg-rose-500/10',
  fixable: 'border border-sky-500/30 text-sky-300/90 hover:bg-sky-500/10',
  // Secundario — sella sin juicio: borde neutro, sin color que señale una decisión.
  discard: 'border border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
  // Terciario — arreglo: sin color y sin borde a la vista, el mismo tratamiento que
  // «Editar» tiene ya en Retenidas. El borde transparente existe sólo para que el apagado
  // no abulte MÁS que el disponible: `DISABLED_STYLE` trae borde punteado.
  edit_text: 'border border-transparent text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60',
  recompose_image: 'border border-transparent text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60',
};

/**
 * LA FORMA DE CADA NIVEL, separada del color. Un arreglo no sólo cambia de color respecto a
 * un juicio: ocupa menos sitio y pesa menos tipográficamente. Si sólo cambiara el color,
 * seguiría leyéndose como un botón más de la misma fila.
 */
const WEIGHT_SHAPE: Record<ActionWeight, string> = {
  primary: 'px-4 py-2.5 rounded-lg text-sm font-medium',
  secondary: 'px-4 py-2.5 rounded-lg text-sm font-medium',
  tertiary: 'px-2.5 py-1.5 rounded-md text-[12px] font-normal',
};

const ICON: Record<PieceActionKey, React.ReactNode> = {
  approve: <CheckCircle2 size={14} />,
  reject: <XCircle size={14} />,
  fixable: <Wrench size={14} />,
  edit_text: <PenLine size={14} />,
  recompose_image: <ImagePlay size={14} />,
  discard: <Archive size={14} />,
};

/** Lo que la tarjeta muestra de un error: la frase, y el crudo del server si lo hay. */
function cardError(err: unknown, caida: string): { message: string; detail: string | null } {
  if (!(err instanceof CalibrationError)) return { message: caida, detail: null };
  const body = err.body as { server_detail?: unknown } | null | undefined;
  const detail = typeof body?.server_detail === 'string' ? body.server_detail : null;
  return { message: err.message, detail };
}

// ── El componente ────────────────────────────────────────────────────────────────
export function PieceActionsBar({
  piece, token, onResolved, onRegenerated, onEdited,
}: {
  piece: ActionablePiece;
  token: string;
  /** La pieza salió de circulación: la bandeja la quita de la lista. */
  onResolved: (pieceId: string, outcome: ActionOutcome) => void;
  /** La imagen cambió: la bandeja refresca el artefacto sin recargar. */
  onRegenerated?: (r: { html: string | null; artifact_url: string | null; composed: boolean; refreshed: boolean; posts: number }) => void;
  /** El texto cambió: la bandeja puede refrescar lo que muestre de él. */
  onEdited?: (after: string) => void;
}) {
  const [panel, setPanel] = useState<PanelKey | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<PieceActionKey | null>(null);
  const [error, setError] = useState<null | { message: string; detail: string | null }>(null);
  const [slotNote, setSlotNote] = useState<null | { tone: 'ok' | 'alert'; text: string }>(null);
  const [doneNote, setDoneNote] = useState<null | { tone: 'ok' | 'sealed'; text: string }>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [regenNote, setRegenNote] = useState<null | { compuesta: boolean; refrescado: boolean; posts: number }>(null);

  const buttons = actionButtons(piece.actions);
  /**
   * LOS DOS GRUPOS SALEN DEL NIVEL, no de una lista escrita aparte. Si mañana entra una
   * acción nueva, basta con declarar su `weight` en `ACTION_SPECS` y cae donde le toca.
   */
  const juicio = buttons.filter((b) => b.weight !== 'tertiary');
  const arreglo = buttons.filter((b) => b.weight === 'tertiary');
  const spec = panel ? buttons.find((b) => b.panel === panel) : null;
  const copy = panel ? PANEL_COPY[panel] : null;
  const warning = spec ? slotWarning(spec.seals, piece.slot) : null;
  const faltaTexto = !!copy?.required && !note.trim();

  const open = (p: PanelKey) => {
    setPanel(p); setError(null); setWarnings([]);
    // El panel de edición arranca con el texto ACTUAL: editar es corregir lo que hay, no
    // escribir de cero sobre un campo que no se ve.
    setNote(p === 'edit' ? (piece.body ?? '') : '');
  };

  /** Tras una acción que sella: se dice qué pasó con la franja y se saca la pieza. */
  /**
   * EL ACUSE LO DA EL COMPONENTE, NO CADA BANDEJA. Toda acción que resuelve una pieza dice
   * qué pasó ANTES de que la tarjeta desaparezca, y lo dice igual en las dos pantallas.
   *
   * POR QUÉ ESTÁ ACÁ Y NO EN CADA BANDEJA, medido el 2026-09-13: en la primera versión de
   * U-5, `approve` llamaba a `onResolved` directo. Calibración mostraba su tarjeta de
   * confirmación y Publicación quitaba la pieza EN SECO — aprobar desde ahí no decía nada,
   * y un acuse ausente no se distingue de una acción que no ocurrió. Es la misma divergencia
   * entre pantallas que este corte vino a cerrar, dejada abierta en el propio corte.
   *
   * El acuse vive donde vive la acción. Una bandeja puede añadir lo suyo después —
   * calibración conserva su tarjeta final— pero ninguna puede quedarse muda.
   */
  const finish = (outcome: ActionOutcome, release: SlotRelease | null | undefined) => {
    const slot = slotReleaseNotice(release);
    setSlotNote(slot);
    setDoneNote(OUTCOME_COPY[outcome]);
    // Un fallo de liberación se queda en pantalla más tiempo: es lo único que Sam tiene
    // que leer antes de que la tarjeta desaparezca.
    setTimeout(() => onResolved(piece.piece_id, outcome), slot?.tone === 'alert' ? 6000 : 1800);
  };

  const submitVerdict = async (verdict: Verdict, key: PieceActionKey) => {
    setBusy(key); setError(null);
    try {
      const esFixable = verdict === 'fixable';
      const r = await saveVerdict(token, {
        piece_id: piece.piece_id,
        verdict,
        criterion: esFixable ? buildCriterion(reason, null) : buildCriterion(reason, note),
        fix_proposal: esFixable ? note.trim() : null,
      });
      // `approved` pasa por el MISMO acuse que los demás. Que no libere franja no es motivo
      // para que no diga nada: `slot_release` viene null y el acuse lo omite, pero el
      // «Aprobada» se lee igual que el «Rechazada».
      finish(verdict === 'approved' ? 'approved' : verdict === 'fixable' ? 'fixable' : 'rejected', r.slot_release);
    } catch (err) {
      setError(cardError(err, 'No se pudo guardar el veredicto.'));
      setBusy(null);
    }
  };

  const submitDiscard = async () => {
    setBusy('discard'); setError(null);
    try {
      const r = await discardPiece(token, { piece_id: piece.piece_id, reason: buildCriterion(reason, note) });
      finish('discarded', r.slot_release);
    } catch (err) {
      setError(cardError(err, 'No se pudo descartar la pieza.'));
      setBusy(null);
    }
  };

  const submitRegen = async () => {
    setBusy('recompose_image'); setError(null); setRegenNote(null);
    try {
      const r = await recomposeImage(token, { piece_id: piece.piece_id, visual_directive: note.trim() });
      onRegenerated?.({ html: r.html, artifact_url: r.artifact_url, composed: r.composed, refreshed: r.artifact_refreshed, posts: r.scheduled_posts_updated });
      setRegenNote({ compuesta: r.composed, refrescado: r.artifact_refreshed, posts: r.scheduled_posts_updated });
      setNote(''); setPanel(null);
    } catch (err) {
      setError(cardError(err, 'No se pudo regenerar la imagen.'));
    } finally { setBusy(null); }
  };

  /**
   * Guardar el texto. La guarda de la marca AVISA Y NO BLOQUEA: sus avisos se muestran y se
   * puede insistir con `acknowledge_warnings`. Convertir un aviso en bloqueo sería un cambio
   * de contrato por la puerta de atrás — un sistema que le impide a Sam publicar lo que
   * quiere publicar en su propia marca está roto.
   */
  const submitEdit = async (acknowledge: boolean) => {
    setBusy('edit_text'); setError(null);
    try {
      const r = await savePieceEdit(token, {
        piece_id: piece.piece_id,
        field: 'body',
        after_text: note,
        edit_reason: reason || null,
        acknowledge_warnings: acknowledge,
      }) as { guard?: { warnings?: Array<{ message?: string } | string> } };
      const avisos = (r?.guard?.warnings ?? [])
        .map((w) => (typeof w === 'string' ? w : w?.message ?? ''))
        .filter(Boolean);
      if (avisos.length && !acknowledge) { setWarnings(avisos); setBusy(null); return; }
      onEdited?.(note);
      setWarnings([]); setPanel(null); setBusy(null);
    } catch (err) {
      setError(cardError(err, 'No se pudo guardar el texto.'));
      setBusy(null);
    }
  };

  const confirm = () => {
    if (panel === 'reject') return submitVerdict('rejected', 'reject');
    if (panel === 'fix') return submitVerdict('fixable', 'fixable');
    if (panel === 'regen') return submitRegen();
    if (panel === 'edit') return submitEdit(false);
    return submitDiscard();
  };

  /**
   * UN SOLO PINTOR PARA LOS TRES NIVELES. Lo que cambia entre un juicio y un arreglo es la
   * FORMA (`WEIGHT_SHAPE`) y el COLOR (`BUTTON_STYLE`), nunca el comportamiento: el mismo
   * clic, el mismo panel, el mismo apagado con su motivo. Dos renderizadores distintos
   * habrían divergido en el primer arreglo que tocara sólo uno.
   */
  const pintar = (b: (typeof buttons)[number]) => (
    <button
      key={b.key}
      onClick={() => {
        if (!b.available) return;
        if (b.panel) return open(b.panel);
        return submitVerdict('approved', 'approve');
      }}
      disabled={!!busy || !b.available}
      // EL MOTIVO VIAJA EN EL TÍTULO. Un botón apagado sin explicación obliga a
      // adivinar, y quien adivina termina preguntándolo por chat.
      title={b.available ? b.hint : (b.reason ?? 'No disponible para esta pieza.')}
      className={cn(
        'flex items-center justify-center gap-2 transition-colors',
        WEIGHT_SHAPE[b.weight],
        // Apagado: estilo neutro en lugar del suyo, no su estilo atenuado.
        b.available ? BUTTON_STYLE[b.key] : DISABLED_STYLE,
        // `busy` atenúa sin cambiar la forma: la acción sigue siendo la que era,
        // sólo está en curso.
        !b.available && 'cursor-not-allowed',
        !!busy && b.available && 'opacity-50 cursor-wait',
      )}
    >
      {busy === b.key ? <Spinner size={14} /> : <>{ICON[b.key]} {b.label}</>}
    </button>
  );

  // Resuelta: lo único que queda en la tarjeta es el acuse. Los botones se retiran para que
  // nadie vuelva a pulsar sobre una pieza que ya se movió.
  if (doneNote) {
    return (
      <div className="space-y-2">
        <div className={cn(
          'flex items-center gap-2 text-sm font-medium rounded-xl px-3 py-2.5 border',
          doneNote.tone === 'ok'
            ? 'bg-emerald-500/[0.07] border-emerald-500/30 text-emerald-300'
            : 'bg-zinc-800/40 border-zinc-700/60 text-zinc-300',
        )}>
          {doneNote.tone === 'ok' ? <CheckCircle2 size={16} className="shrink-0" /> : <Archive size={16} className="shrink-0" />}
          <span>{doneNote.text}</span>
        </div>
        {slotNote && (
          <div className={cn(
            'text-[11px] font-mono leading-snug rounded-xl px-3 py-2 border',
            slotNote.tone === 'alert'
              ? 'bg-amber-500/[0.08] border-amber-500/40 text-amber-200'
              : 'bg-emerald-500/[0.06] border-emerald-500/25 text-emerald-300/80',
          )}>
            {slotNote.text}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {slotNote && (
        <div className={cn(
          'text-[11px] font-mono leading-snug rounded-xl px-3 py-2 border',
          slotNote.tone === 'alert'
            ? 'bg-amber-500/[0.08] border-amber-500/40 text-amber-200'
            : 'bg-emerald-500/[0.06] border-emerald-500/25 text-emerald-300/80',
        )}>
          {slotNote.text}
        </div>
      )}

      {regenNote && (
        <div className="text-[11px] font-mono leading-snug text-violet-300/80 bg-violet-500/[0.06] border border-violet-500/20 rounded-xl px-3 py-2 space-y-0.5">
          <p>{regenNote.compuesta
            ? 'Imagen regenerada y compuesta.'
            : 'Escena regenerada, pero la composición falló: la pieza queda con la imagen limpia, sin titular ni franja.'}</p>
          {!regenNote.refrescado && <p className="text-amber-300/80">La imagen cambió, pero el artefacto no se pudo rehacer: la vista de arriba puede estar mostrando la anterior.</p>}
          {regenNote.posts > 0 && <p className="text-violet-300/60">{regenNote.posts} post pendiente de publicar actualizado con la imagen nueva.</p>}
          <p className="text-violet-300/50">Sigue sin veredicto: la pieza no se ha movido de la bandeja.</p>
        </div>
      )}

      {error && (
        <div className="text-xs text-rose-400 font-mono leading-snug space-y-1">
          <p>{error.message}</p>
          {error.detail && (
            <details className="text-[10px] text-rose-300/70">
              <summary className="cursor-pointer hover:text-rose-300">Respuesta del servidor</summary>
              <pre className="mt-1 whitespace-pre-wrap break-all">{error.detail}</pre>
            </details>
          )}
        </div>
      )}

      <AnimatePresence mode="wait">
        {panel ? (
          <motion.div key={panel} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
            {/* EL COMPROMISO, ANTES DE ROMPERLO. La fecha sale de la misma función que la
                pinta en la tarjeta: no se recalcula ni se formatea una segunda vez. */}
            {warning && (
              <div className="flex items-start gap-2 text-[11px] font-mono leading-snug rounded-xl px-3 py-2 border bg-amber-500/[0.08] border-amber-500/40 text-amber-200">
                <span>{warning.text}</span>
              </div>
            )}

            {/* Clases de defecto de un VEREDICTO. En `regen` y en `edit` no hay veredicto que
                clasificar, y ofrecerlas ahí haría creer que la elección viaja a algún sitio. */}
            <div className={cn('flex items-center gap-1.5 flex-wrap', (panel === 'regen' || panel === 'edit') && 'hidden')}>
              {REJECT_REASONS.map((r) => (
                <button
                  key={r.value}
                  onClick={() => { setReason(reason === r.value ? '' : r.value); setError(null); }}
                  className={cn(
                    'text-[11px] px-2 py-1 rounded-lg border transition-colors',
                    reason === r.value
                      ? 'border-accent/50 bg-accent/15 text-accent'
                      : 'border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700',
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {copy?.label && (
              <label className="block text-[11px] font-medium text-zinc-300">{copy.label}</label>
            )}
            <textarea
              value={note}
              onChange={(e) => { setNote(e.target.value); setError(null); setWarnings([]); }}
              rows={panel === 'edit' ? 8 : 3}
              autoFocus
              placeholder={copy?.placeholder}
              className={cn(
                'w-full bg-[#050508] border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-700 outline-none transition-colors resize-none',
                copy?.focus,
              )}
            />

            {/* LA GUARDA AVISA Y NO BLOQUEA. Se muestran sus avisos y se ofrece insistir:
                convertirlos en un bloqueo sería cambiar el contrato por la puerta de atrás. */}
            {warnings.length > 0 && (
              <div className="text-[11px] font-mono leading-snug rounded-xl px-3 py-2 border bg-amber-500/[0.08] border-amber-500/40 text-amber-200 space-y-1">
                <p className="font-semibold">La guarda de la marca avisa:</p>
                <ul className="list-disc pl-4 space-y-0.5">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                <button
                  onClick={() => submitEdit(true)}
                  disabled={!!busy}
                  className="mt-1 px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 disabled:opacity-50"
                >
                  Guardar igual
                </button>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={confirm}
                disabled={!!busy || faltaTexto}
                title={faltaTexto ? 'Falta el texto para poder confirmar' : undefined}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors',
                  copy?.button,
                )}
              >
                {busy ? <Spinner size={14} /> : <>{spec && ICON[spec.key]} {copy?.confirm}</>}
              </button>
              <button
                onClick={() => { setPanel(null); setError(null); setWarnings([]); }}
                disabled={!!busy}
                className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:bg-zinc-800 transition-colors"
              >
                Cancelar
              </button>
            </div>
            <p className="text-[10px] font-mono leading-snug text-zinc-600">{copy?.foot}</p>
          </motion.div>
        ) : (
          <motion.div key="actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
            {/* Juicio y sello: primero y juntos, sin un arreglo intercalado entre ellos. */}
            <div className="flex gap-2 flex-wrap">{juicio.map(pintar)}</div>
            {/* Arreglos: después, y subordinados. Siguen disponibles — pesan menos, nada más. */}
            {arreglo.length > 0 && (
              <div className="flex gap-1.5 flex-wrap items-center">{arreglo.map(pintar)}</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
