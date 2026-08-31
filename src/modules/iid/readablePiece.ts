import type { ReadablePiece } from '../../ui/SpeechReader';

/**
 * readablePiece — los adaptadores que llevan el texto de una pieza a la forma que el lector
 * en voz alta entiende: `{title, body}` en texto plano.
 *
 * Existen porque las bandejas obtienen el texto de la pieza por caminos distintos, medido
 * sobre el código:
 *
 *   · calibración y publicación → `POST /api/preview-render` → campo `html` (el artefacto
 *     autocontenido que escribe `api/_calibrationShared.ts → buildHtml()`).
 *   · retenidas                → `ChallengedRow.piece.title` / `.body`, ya en texto plano.
 *
 * El lector no conoce ninguno de los dos caminos, y ese es el punto: una superficie que
 * mañana traiga el texto de una cuarta forma suma un adaptador aquí y no toca el lector.
 * Funciones puras, sin estado y sin red.
 */

/** Texto de un selector, con `null` cuando no hay nodo o cuando lo que hay está vacío. */
function textOf(doc: Document, selector: string): string | null {
  const raw = doc.querySelector(selector)?.textContent;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Extrae `{title, body}` del artefacto HTML que devuelve `/api/preview-render`.
 *
 * Las clases `.title` y `.text` las escribe `buildHtml()`. **Si alguna no aparece se
 * devuelve `null` en ese campo, nunca se lanza**: una pieza sin título es válida —
 * `buildHtml()` omite el `<h1>` cuando no hay título— y un lector que reventara ante eso
 * rompería la tarjeta entera por un campo opcional.
 */
export function readableFromArtifactHtml(html: string): ReadablePiece {
  const empty: ReadablePiece = { title: null, body: null };
  if (typeof html !== 'string' || html.trim().length === 0) return empty;
  if (typeof DOMParser === 'undefined') return empty;

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return empty;
  }

  return { title: textOf(doc, '.title'), body: textOf(doc, '.text') };
}

/**
 * Pasa a la forma común lo que la bandeja de retenidas ya trae en texto plano. La fila
 * puede no apuntar a ninguna pieza —el arbitraje se decide igual, sobre la regla—, y en ese
 * caso los dos campos salen en `null` y el lector lo dice en pantalla.
 */
export function readableFromChallengedPiece(
  piece: { title: string | null; body: string | null } | null,
): ReadablePiece {
  if (!piece) return { title: null, body: null };
  const clean = (v: string | null | undefined): string | null => {
    if (typeof v !== 'string') return null;
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed : null;
  };
  return { title: clean(piece.title), body: clean(piece.body) };
}
