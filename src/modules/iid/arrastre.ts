/**
 * arrastre.ts — MOVER UN BLOQUE ARRASTRÁNDOLO SOBRE LA VISTA GRANDE (2026-11-17). Lógica pura, sin React.
 *
 * Quien edita arrastra el bloque que ve sobre el video y lo suelta donde lo quiere. Lo que se escribe es lo mismo que
 * escriben los deslizadores X e Y: `place = { x_pct, y_pct, zoom }`, el CENTRO del bloque en % de la zona segura
 * (contrato de VideoLab v1.3.3; `render/src/textlayers.mjs`, `placeManual`). La geometría sale de la escena que dibuja
 * VideoLab, no de una estimación: el rectángulo que se arrastra es el que se ve.
 *
 * Ni una marca, ni un color, ni un estilo con nombre propio en este archivo.
 */
import { clampPlace, type Place } from '../../../api/_onScreenText';

/** A qué bloque del borrador corresponde un bloque de la escena. */
export type BlockRef =
  | { block: 'hook' }
  | { block: 'cta' }
  | { block: 'key_titles'; index: number }
  | { block: 'roles'; index: number };

export interface Rect { x: number; y: number; w: number; h: number }
export interface SafeRect { x: number; y: number; w: number; h: number }

export interface DragTarget {
  ref: BlockRef;
  label: string;
  rect: Rect;
  start_ms: number;
  end_ms: number;
  /** El zoom que ya tiene el bloque: arrastrar mueve, no cambia el tamaño. */
  zoom: number;
}

/** Lo que el arrastre necesita saber del borrador: qué bloques se mandaron, en qué orden y a qué hora empiezan. */
export interface DraftBlocks {
  hook: { sent: boolean; place: Place | null } | null;
  cta: { sent: boolean; at_ms: number; place: Place | null } | null;
  /** Índice en el borrador, sólo los que se mandan a VideoLab. */
  key_titles: Array<{ index: number; at_ms: number; place: Place | null; label: string }>;
  roles: Array<{ index: number; at_ms: number; place: Place | null; label: string }>;
}

const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const rectOf = (r: any): Rect | null => {
  if (!r || typeof r !== 'object') return null;
  const out = { x: num(r.x, NaN), y: num(r.y, NaN), w: num(r.w, NaN), h: num(r.h, NaN) };
  return [out.x, out.y, out.w, out.h].every(Number.isFinite) && out.w > 0 && out.h > 0 ? out : null;
};

/** La zona segura de la escena, o null si no viene bien formada. PURO. */
export function safeOf(scene: any): SafeRect | null {
  const s = rectOf(scene?.safe);
  return s;
}

/**
 * Los bloques que se pueden arrastrar, cada uno unido a su bloque del borrador. Por capa, cada bloque del borrador se
 * une al bloque de la escena de esa capa cuya hora de inicio está más cerca de la suya (en empate, el orden). Si en una
 * capa no cuadran las cuentas, esa capa no se puede arrastrar: mover el bloque equivocado es peor que no moverlo. PURO.
 */
export function dragTargetsOf(scene: any, d: DraftBlocks): DragTarget[] {
  const blocks: any[] = Array.isArray(scene?.blocks) ? scene.blocks : [];
  const deCapa = (layer: string) => blocks
    .map((b, orden) => ({ b, orden, rect: rectOf(b?.rect), start: num(b?.start_ms), end: num(b?.end_ms) }))
    .filter((x) => x.b?.layer === layer && x.rect);
  const unir = (layer: string, items: Array<{ ref: BlockRef; at_ms: number; place: Place | null; label: string }>): DragTarget[] => {
    const cand = deCapa(layer);
    if (!items.length || cand.length !== items.length) return [];
    const usados = new Set<number>();
    const out: DragTarget[] = [];
    for (const it of items) {
      let mejor = -1;
      cand.forEach((c, i) => {
        if (usados.has(i)) return;
        if (mejor < 0 || Math.abs(c.start - it.at_ms) < Math.abs(cand[mejor].start - it.at_ms)) mejor = i;
      });
      usados.add(mejor);
      const c = cand[mejor];
      out.push({ ref: it.ref, label: it.label, rect: c.rect!, start_ms: c.start, end_ms: c.end, zoom: it.place?.zoom ?? 1 });
    }
    return out;
  };
  return [
    ...(d.hook?.sent ? unir('hook', [{ ref: { block: 'hook' }, at_ms: 0, place: d.hook.place, label: 'Gancho' }]) : []),
    ...unir('key_title', d.key_titles.map((k) => ({ ref: { block: 'key_titles', index: k.index } as BlockRef, at_ms: k.at_ms, place: k.place, label: k.label }))),
    ...(d.cta?.sent ? unir('cta', [{ ref: { block: 'cta' }, at_ms: d.cta.at_ms, place: d.cta.place, label: 'CTA' }]) : []),
    ...unir('role', d.roles.map((r) => ({ ref: { block: 'roles', index: r.index } as BlockRef, at_ms: r.at_ms, place: r.place, label: r.label }))),
  ];
}

/** ¿Se ve el bloque en este momento del video? PURO. */
export function visibleAt(t: DragTarget, ms: number): boolean {
  return ms >= t.start_ms && ms < t.end_ms;
}

/**
 * El `place` de un bloque arrastrado: su centro de antes más lo que se movió, en % de la zona segura, acotado a 0–100.
 * `dx` y `dy` van en píxeles del lienzo de la escena (no de la pantalla). PURO.
 */
export function placeAfterDrag(rect: Rect, safe: SafeRect, dx: number, dy: number, zoom: number): Place {
  const cx = rect.x + rect.w / 2 + dx;
  const cy = rect.y + rect.h / 2 + dy;
  return clampPlace({
    x_pct: Math.round(((cx - safe.x) / safe.w) * 100),
    y_pct: Math.round(((cy - safe.y) / safe.h) * 100),
    zoom,
  });
}

/** Un arrastre de menos de unos píxeles es un toque, no un movimiento: no cambia nada. PURO. */
export const DRAG_MIN_PX = 4;
export function isDrag(dxScreen: number, dyScreen: number): boolean {
  return Math.hypot(dxScreen, dyScreen) >= DRAG_MIN_PX;
}
