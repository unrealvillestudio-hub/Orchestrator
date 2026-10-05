import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, XCircle, Archive, Wrench, ImagePlay, PenLine, Search } from 'lucide-react';
import { cn, Spinner } from '../../ui/components';
import {
  saveVerdict, discardPiece, recomposeImage, renderArtifact, CalibrationError,
  REJECT_REASONS, buildCriterion, fetchResearchCases, openResearchCase,
  type PieceActionKey, type PieceActions, type SlotRelease, type Verdict, type ResearchCase,
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
  /**
   * SIN-IMAGEN-01 — si la pieza YA tiene imagen. Lo resuelve el server (`toContext`).
   *
   * Es lo que separa las dos caras de la misma acción: CORREGIR una escena que existe, o PEDIR la
   * primera. Opcional para que una bandeja que todavía no lo mande no se rompa; `undefined` se
   * trata como «no se sabe», y ahí manda el caso conservador — se pide la directriz, que es lo
   * que nunca produce una generación tirada.
   */
  has_image?: boolean;
  /**
   * INVESTIGAR (2026-10-05) — la pieza tiene que ver con un caso de investigación: sólo entonces la
   * tarjeta pide su estado. Lo resuelve el server (`researchHintOf`); `undefined` = no se pide.
   */
  research_hint?: boolean;
}

/** Lo que le pasa a la pieza cuando una acción termina. `null` = sigue en la bandeja. */
export type ActionOutcome = 'approved' | 'rejected' | 'fixable' | 'research' | 'discarded';

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
  // INVESTIGAR (2026-10-05) — también escribe el corpus (veredicto `research`), por eso es primario y
  // va junto a Fixable. La diferencia con Fixable: arreglar esta pieza pide MATERIAL que su
  // investigación no trae, y eso no lo resuelve una edición.
  { key: 'research', label: 'Investigar', panel: 'research', seals: false, weight: 'primary',
    hint: 'Falta un escenario o un dato que la investigación de la pieza no trae. Escribe la pregunta: el agente de la marca la investiga y, con material, nace una pieza nueva del mismo tema.' },
  // Nivel secundario — sella sin juicio: saca la pieza y no enseña nada.
  { key: 'discard', label: 'Descartar', panel: 'discard', seals: true, weight: 'secondary',
    hint: 'No voy a juzgar esta pieza: sale de la bandeja y NO entra al corpus.' },
  // Nivel terciario — arreglo: corrigen el artefacto y no dejan aprendizaje.
  { key: 'edit_text', label: 'Editar texto', panel: 'edit', seals: false, weight: 'tertiary',
    hint: 'Corrige el texto de la pieza. No es un veredicto: la pieza sigue donde está.' },
  { key: 'recompose_image', label: 'Regenerar imagen', panel: 'regen', seals: false, weight: 'tertiary',
    hint: 'Regenera la escena con una corrección, sin votar.' },
];

/**
 * SIN-IMAGEN-01 — CÓMO SE LLAMA LA ACCIÓN CUANDO NO HAY NADA QUE REGENERAR.
 *
 * «Regenerar» describe una de las dos caras. Sobre una pieza que nunca tuvo imagen, el verbo es
 * GENERAR — y no es una sutileza de redacción: mientras el botón decía «regenerar», la respuesta
 * coherente con esa palabra era apagarlo, que es justo el defecto que este corte arregla. El
 * nombre sostenía la puerta.
 *
 * `undefined` conserva el texto de siempre: una bandeja que todavía no manda el dato no puede
 * empezar a prometer «generar» sin saber si hay imagen.
 */
export function imageActionLabel(hasImage: boolean | undefined): string {
  return hasImage === false ? 'Generar imagen' : 'Regenerar imagen';
}

export type PanelKey = 'reject' | 'fix' | 'research' | 'edit' | 'regen' | 'discard';

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
  research: { tone: 'ok', text: 'Enviada a investigar. La pieza queda RETADA con «Investigación pendiente». Con material, nace una pieza nueva del mismo tema en Calibración, con sus fuentes; sin material, vuelve a Arreglos diciéndolo.' },
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
  research: {
    label: 'Qué hay que investigar',
    placeholder: 'La pregunta: qué escenario deja fuera la pieza y qué hay que averiguar para cubrirlo…',
    confirm: 'Enviar a investigar',
    foot: 'Investigar RETA la pieza y abre un caso para el agente de investigación de la marca. Con '
      + 'material, se escribe una pieza NUEVA del mismo tema que cubre la pregunta y cita sus fuentes, y '
      + 'la actual queda reemplazada; sin material, vuelve a Arreglos diciéndolo. La pregunta es obligatoria.',
    focus: 'focus:border-amber-500/60', button: 'bg-amber-500/90 hover:bg-amber-500', required: true,
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

/**
 * SIN-IMAGEN-01 — EL PANEL DE LA IMAGEN TIENE DOS CARAS, Y LA DIRECTRIZ SÓLO ES OBLIGATORIA EN UNA.
 *
 * El texto de `regen` decía «La directriz es obligatoria» porque el argumento que la exigía era:
 * regenerar sin directriz devuelve la misma imagen con el mismo defecto y cobra una generación por
 * no cambiar nada. Es cierto — y **no aplica a una pieza que no tiene imagen**: ahí no hay «la
 * misma imagen» que devolver ni defecto que repetir. El motor arma la escena con el título, la
 * cabeza del copy y la `visual_directive` del dominio, exactamente como habría hecho el stage 3.
 *
 * El server hace cumplir lo mismo (`api/recompose-image.ts`), así que esto no es una guarda: es
 * que la pantalla diga la verdad sobre lo que el server va a aceptar. Una pantalla que exige más
 * que el server enseña a desconfiar de las dos.
 *
 * PURA y exportada para que el test la ejecute tal cual, sin montar React.
 */
/**
 * BRIEF-IMG-01 fase 4 — LOS DOS BOTONES. Corregir sobre la imagen actual es el camino por defecto:
 * cada instrucción continúa la anterior (la imagen vigente + el prompt entero + las directrices
 * acumuladas). Repintar desde cero es la salida cuando la escena entera está mal.
 */
export const REGEN_MODES: ReadonlyArray<{ value: 'edit_from_current' | 'regenerate_full'; label: string; hint: string }> = [
  { value: 'edit_from_current', label: 'Corregir sobre la imagen actual',
    hint: 'Parte de la imagen vigente y aplica tu directriz, sumada a las anteriores. Mantiene lo que ya está bien.' },
  { value: 'regenerate_full', label: 'Repintar desde cero',
    hint: 'Genera la escena de nuevo con el prompt entero y todas las directrices. Para cuando la escena completa está mal.' },
];

export function panelCopyFor(panel: PanelKey, hasImage: boolean | undefined) {
  const base = PANEL_COPY[panel];
  if (panel !== 'regen' || hasImage !== false) return base;
  return {
    ...base,
    label: 'Directriz para el generador (opcional)',
    placeholder: 'Si se quiere dirigir la escena, la directriz ya redactada. En blanco, el generador usa la del dominio…',
    confirm: 'Generar imagen',
    foot: 'Esta pieza NO tiene imagen: el carril lo intentó y no la consiguió. Esto la pide por '
      + 'primera vez. NO es un veredicto: la pieza sigue en la bandeja y no entra al corpus. Cuesta '
      + 'una generación y actualiza los posts que sigan pendientes de publicar. La directriz es '
      + 'OPCIONAL acá — en blanco, la escena se arma con la del dominio, que es lo que el carril '
      + 'habría usado.',
    required: false,
  };
}

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
  research: 'border border-amber-500/30 text-amber-300/90 hover:bg-amber-500/10',
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
  research: <Search size={14} />,
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
  /**
   * EL TEXTO VIGENTE DE LA PIEZA, del lado de la tarjeta (2026-10-01). Hasta hoy el panel se
   * rellenaba siempre con `piece.body`, el texto con que la bandeja CARGÓ la tarjeta: tras guardar,
   * reabrir el editor mostraba el texto viejo y la vista previa no se rehacía. La edición SÍ se
   * guardaba (medido: `1f81a727` y `3c1fa264`), pero en pantalla «volvía como estaba». Sam lo
   * reportó dos veces el mismo día.
   */
  const [vigente, setVigente] = useState<{ title: string | null; body: string | null }>({ title: piece.title, body: piece.body });
  const [editTitle, setEditTitle] = useState('');
  const [editNote, setEditNote] = useState<null | { avisos: string[]; refrescado: boolean }>(null);
  const [regenNote, setRegenNote] = useState<null | { compuesta: boolean; refrescado: boolean; posts: number }>(null);
  // BRIEF-IMG-01 fase 4 — por defecto se CORRIGE sobre la imagen actual: da continuidad a lo pedido.
  const [regenMode, setRegenMode] = useState<'edit_from_current' | 'regenerate_full'>('edit_from_current');

  // SIN-IMAGEN-01 — el verbo de la acción de imagen depende de si hay una. Ver `imageActionLabel`.
  const buttons = actionButtons(piece.actions).map((b) =>
    b.key === 'recompose_image' ? { ...b, label: imageActionLabel(piece.has_image) } : b);
  /**
   * LOS DOS GRUPOS SALEN DEL NIVEL, no de una lista escrita aparte. Si mañana entra una
   * acción nueva, basta con declarar su `weight` en `ACTION_SPECS` y cae donde le toca.
   */
  const juicio = buttons.filter((b) => b.weight !== 'tertiary');
  const arreglo = buttons.filter((b) => b.weight === 'tertiary');
  const spec = panel ? buttons.find((b) => b.panel === panel) : null;
  const copy = panel ? panelCopyFor(panel, piece.has_image) : null;
  const warning = spec ? slotWarning(spec.seals, piece.slot) : null;
  const faltaTexto = !!copy?.required && !note.trim();

  const open = (p: PanelKey) => {
    setPanel(p); setError(null); setWarnings([]);
    // El panel de edición arranca con el texto ACTUAL: editar es corregir lo que hay, no
    // escribir de cero sobre un campo que no se ve.
    setNote(p === 'edit' ? (vigente.body ?? '') : '');
    setEditTitle(p === 'edit' ? (vigente.title ?? '') : '');
    setEditNote(null);
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
      // Fixable lleva su propuesta; Investigar, su pregunta. Investigar va a su propia ruta porque,
      // además del veredicto, abre el caso de investigación.
      const conTexto = verdict === 'fixable' || verdict === 'research';
      const r = verdict === 'research'
        ? await openResearchCase(token, { piece_id: piece.piece_id, question: note.trim(), criterion: buildCriterion(reason, null) })
        : await saveVerdict(token, {
          piece_id: piece.piece_id,
          verdict,
          criterion: conTexto ? buildCriterion(reason, null) : buildCriterion(reason, note),
          fix_proposal: conTexto ? note.trim() : null,
        });
      // `approved` pasa por el MISMO acuse que los demás. Que no libere franja no es motivo
      // para que no diga nada: `slot_release` viene null y el acuse lo omite, pero el
      // «Aprobada» se lee igual que el «Rechazada».
      finish(verdict === 'approved' ? 'approved' : verdict === 'fixable' ? 'fixable' : verdict === 'research' ? 'research' : 'rejected', r.slot_release);
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
      const r = await recomposeImage(token, {
        piece_id: piece.piece_id, visual_directive: note.trim(),
        mode: piece.has_image === false ? 'regenerate_full' : regenMode,
      });
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
    // Título y cuerpo, cada uno sólo si cambió: guardar sin tocar no es una edición (la EF lo poda).
    const cambios: Array<{ field: 'title' | 'body'; after: string }> = [];
    if (editTitle !== (vigente.title ?? '')) cambios.push({ field: 'title', after: editTitle });
    if (note !== (vigente.body ?? '')) cambios.push({ field: 'body', after: note });
    if (!cambios.length) { setError({ message: 'No hay cambios que guardar.', detail: null }); return; }

    setBusy('edit_text'); setError(null);
    try {
      const avisos: string[] = [];
      for (const c of cambios) {
        const r = await savePieceEdit(token, {
          piece_id: piece.piece_id, field: c.field, after_text: c.after,
          edit_reason: reason || null, acknowledge_warnings: acknowledge,
        }) as { guard?: { hits?: Array<{ code?: string; fragment?: string; field?: string }>; warnings?: Array<{ message?: string } | string> } };
        // La EF devuelve `guard.hits`; `warnings` era el nombre que esta pantalla esperaba y nunca
        // llegó, así que los avisos de la guarda no se veían. Se leen los dos.
        for (const h of r?.guard?.hits ?? []) avisos.push(`${h.code ?? 'regla'}: «${h.fragment ?? ''}» en ${h.field ?? c.field}`);
        for (const w of r?.guard?.warnings ?? []) avisos.push(typeof w === 'string' ? w : w?.message ?? '');
      }
      const nuevo = {
        title: cambios.find((c) => c.field === 'title')?.after ?? vigente.title,
        body: cambios.find((c) => c.field === 'body')?.after ?? vigente.body,
      };
      setVigente(nuevo);
      if (nuevo.body !== vigente.body) onEdited?.(nuevo.body ?? '');
      // LA VISTA PREVIA SE REHACE con lo guardado: el artefacto se reconstruye desde la pieza.
      let refrescado = false;
      try {
        const art = await renderArtifact(token, piece.piece_id);
        onRegenerated?.({ html: art.html, artifact_url: art.artifact_url, composed: true, refreshed: true, posts: 0 });
        refrescado = true;
      } catch { /* se dice abajo: guardado, pero la vista puede ser la anterior */ }
      // La guarda AVISA Y NO BLOQUEA, y la EF ya guardó cuando avisa: se informa, no se pide insistir.
      setEditNote({ avisos: avisos.filter(Boolean), refrescado });
      setWarnings([]); setPanel(null); setBusy(null);
    } catch (err) {
      setError(cardError(err, 'No se pudo guardar el texto.'));
      setBusy(null);
    }
  };

  const confirm = () => {
    if (panel === 'reject') return submitVerdict('rejected', 'reject');
    if (panel === 'fix') return submitVerdict('fixable', 'fixable');
    if (panel === 'research') return submitVerdict('research', 'research');
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
      {piece.research_hint && <ResearchCaseLine pieceId={piece.piece_id} token={token} />}
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

      {editNote && (
        <div className="text-[11px] font-mono leading-snug text-emerald-300/85 bg-emerald-500/[0.06] border border-emerald-500/25 rounded-xl px-3 py-2 space-y-0.5">
          <p>Texto guardado.{editNote.refrescado ? ' La vista previa ya muestra la versión nueva.' : ''}</p>
          {!editNote.refrescado && <p className="text-amber-300/80">Se guardó, pero la vista previa no se pudo rehacer: puede seguir mostrando la anterior.</p>}
          {editNote.avisos.length > 0 && (
            <div className="text-amber-200/90">
              <p>La guarda de la marca avisa (se guardó igual):</p>
              <ul className="list-disc pl-4">{editNote.avisos.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}
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

            {/* BRIEF-IMG-01 fase 4 — los dos modos. Sólo con imagen: sin ella no hay de qué partir. */}
            {panel === 'regen' && piece.has_image !== false && (
              <div className="flex items-center gap-1.5 flex-wrap" role="radiogroup" aria-label="Modo de regeneración">
                {REGEN_MODES.map((m) => (
                  <button
                    key={m.value}
                    role="radio"
                    aria-checked={regenMode === m.value}
                    onClick={() => setRegenMode(m.value)}
                    title={m.hint}
                    className={cn(
                      'text-[11px] px-2 py-1 rounded-lg border transition-colors',
                      regenMode === m.value
                        ? 'border-violet-500/60 bg-violet-500/15 text-violet-200'
                        : 'border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700',
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}

            {/* El TÍTULO también se edita (2026-10-01: «ni body, ni hashtags, ni title»). Los
                hashtags viven dentro del cuerpo, así que se corrigen en el cuadro de abajo. */}
            {panel === 'edit' && (
              <>
                <label className="block text-[11px] font-medium text-zinc-300">Título</label>
                <input
                  value={editTitle}
                  onChange={(e) => { setEditTitle(e.target.value); setError(null); }}
                  className="w-full bg-[#050508] border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50"
                />
              </>
            )}
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

// ── INVESTIGAR · EL ESTADO DEL CASO EN LA TARJETA (2026-10-05) ──────────────────────
/**
 * QUÉ SE DICE DEL CASO, como lógica pura para probarla sin montar React. Recibe el caso y la pieza
 * desde la que se mira: la misma investigación se lee distinto en la original («se está
 * reescribiendo», «la nueva es…») y en la pieza nueva («nace de la investigación…, reemplaza a…»).
 *
 * La pieza se nombra SIEMPRE por su `piece_id` completo (CC_PROTOCOL §17.8): Sam la busca por él.
 */
export function researchCaseSummary(c: ResearchCase, viewedPieceId: string): {
  tone: 'wait' | 'ok' | 'alert'; text: string; link: { href: string; label: string } | null;
  sources: Array<{ url: string; title: string }>;
} {
  const q = `«${(c.question ?? '').trim()}»`;
  const fuentes = (Array.isArray(c.sources) ? c.sources : [])
    .filter((x) => x && typeof x.url === 'string' && x.url.trim())
    .map((x) => ({ url: x.url.trim(), title: String(x.title ?? '').trim() || x.url.trim() }));
  const n = fuentes.length;
  const nf = `${n} fuente${n === 1 ? '' : 's'}`;
  const esLaNueva = !!c.new_piece_id && c.new_piece_id === viewedPieceId && c.piece_id !== viewedPieceId;
  if (esLaNueva) {
    return { tone: 'ok', text: `Pieza nueva de la investigación ${q}, con ${nf}. Reemplaza a la pieza ${c.piece_id}.`, link: null, sources: fuentes };
  }
  switch (c.status) {
    case 'pending':
      return { tone: 'wait', link: null, sources: [],
        text: `Investigación pendiente: ${q}. En cola del agente de investigación de la marca.`
          + (c.last_gate ? ` Última espera: ${c.last_gate}.` : '') };
    case 'researching':
      return { tone: 'wait', link: null, sources: [], text: `Investigando ${q}.` };
    case 'researched':
    case 'rewriting':
      return c.has_material
        ? { tone: 'wait', link: null, sources: fuentes, text: `Investigada ${q}: hay material (${nf}). La pieza nueva se está escribiendo por el carril.` }
        : { tone: 'wait', link: null, sources: [], text: `Investigada ${q}: sin material. Vuelve a Arreglos.` };
    case 'rewritten':
      return { tone: 'ok', sources: fuentes,
        text: `Reescrita con ${nf}: la pieza nueva es ${c.new_piece_id ?? '(sin id)'} y esta queda reemplazada.`,
        link: c.new_piece_artifact_url ? { href: c.new_piece_artifact_url, label: 'Ver la pieza nueva' } : null };
    case 'no_material':
      return { tone: 'alert', link: null, sources: [], text: `No se encontró material para ${q}. La pieza sigue en Arreglos.` };
    case 'failed':
    default:
      return { tone: 'alert', link: null, sources: [],
        text: `La investigación ${q} no terminó: ${c.closed_reason ?? 'sin motivo registrado'}.` };
  }
}

/**
 * La línea del caso. Lee `/api/research-cases` una vez, y sólo en las tarjetas con `research_hint`:
 * una bandeja de cien tarjetas no hace cien peticiones para saber que casi ninguna tiene caso. Sin
 * casos, o sin la tabla (migración sin aplicar), no pinta nada: una línea vacía no es un error.
 */
export function ResearchCaseLine({ pieceId, token }: { pieceId: string; token: string }) {
  const [c, setC] = useState<ResearchCase | null>(null);
  useEffect(() => {
    let vivo = true;
    fetchResearchCases(token, pieceId)
      .then((r) => { if (vivo) setC((r.cases ?? [])[0] ?? null); })
      .catch(() => { /* sin tabla o sin red: la tarjeta sigue sin la línea */ });
    return () => { vivo = false; };
  }, [pieceId, token]);
  if (!c) return null;
  const s = researchCaseSummary(c, pieceId);
  return (
    <div className={cn(
      'text-[11px] font-mono leading-snug rounded-xl px-3 py-2 border space-y-1',
      s.tone === 'ok' ? 'bg-emerald-500/[0.06] border-emerald-500/25 text-emerald-300/90'
        : s.tone === 'alert' ? 'bg-amber-500/[0.08] border-amber-500/40 text-amber-200'
          : 'bg-zinc-800/40 border-zinc-700/60 text-zinc-300',
    )}>
      <p className="flex items-start gap-1.5"><Search size={12} className="shrink-0 mt-0.5" /><span>{s.text}</span></p>
      {s.link && (
        <a href={s.link.href} target="_blank" rel="noreferrer" className="underline hover:text-white">{s.link.label}</a>
      )}
      {s.sources.length > 0 && (
        <ul className="list-disc pl-4 space-y-0.5">
          {s.sources.map((f) => (
            <li key={f.url}><a href={f.url} target="_blank" rel="noreferrer" className="underline break-all hover:text-white">{f.title}</a></li>
          ))}
        </ul>
      )}
    </div>
  );
}
