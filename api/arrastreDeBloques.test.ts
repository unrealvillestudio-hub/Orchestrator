/**
 * ARRASTRAR UN BLOQUE SOBRE LA VISTA GRANDE (Sam, 2026-11-17: segunda vuelta de la ventana visual).
 *
 * Cubre: que cada bloque de la escena se una a SU bloque del borrador (por capa y hora de inicio); que soltar un
 * bloque escriba el mismo `place` que leería VideoLab (`placeManual`: centro en % de la zona segura); que un toque no
 * mueva nada; que soltar un bloque deje los demás como estaban; y que el archivo nuevo no nombre marcas.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dragTargetsOf, placeAfterDrag, isDrag, visibleAt, safeOf } from '../src/modules/iid/arrastre';
import { draftBlocksOf, withPlace, textLayersFromDraft, type VideoTextDraft } from '../src/modules/iid/OnScreenTextEditor';

const SAFE = { x: 65, y: 269, w: 777, h: 940, x1: 842, y1: 1209 };
const ESTILO = { align: null, emphasis_role: null, marks: {} } as any;
const PROPUESTAS = { hooks: [], key_phrases: [], share_ctas: [] } as any;

const draft = (): VideoTextDraft => ({
  hook: { choice: 'own' as const, own: 'Gancho', preset_key: 'h1', dur_s: 2.8, place: null, style: ESTILO },
  roles: [
    { person_id: 'p-1', name: 'Uno', show: false, text: 'Uno — Cargo', at_s: 1, dur_s: 3, preset_key: 'r1', place: null },
    { person_id: 'p-2', name: 'Dos', show: true, text: 'Dos — Cargo', at_s: 9, dur_s: 3, preset_key: 'r1', place: null },
  ],
  captions: { enabled: false, preset_key: 'cap', accent_role: '', zoom: null, keywords: [] },
  key_titles: [
    { text: 'Apagado', on: false, at_s: 2, dur_s: 2, preset_key: 'k1', own: false, place: null, style: ESTILO },
    { text: 'Segundo', on: true, at_s: 7, dur_s: 2, preset_key: 'k1', own: false, place: null, style: ESTILO },
    { text: 'Primero', on: true, at_s: 3.2, dur_s: 2, preset_key: 'k1', own: false, place: { x_pct: 40, y_pct: 30, zoom: 1.2 }, style: ESTILO },
  ],
  cta: { choice: 'own' as const, own: 'Comparte', preset_key: 'c1', at_s: 6.2, place: null, style: ESTILO },
  strip: { on: false, role: '' },
});

/** Una escena como la que devuelve VideoLab: bloques en el orden en que los dibuja, con su rectángulo en px del lienzo. */
const escena = {
  canvas: { width: 1080, height: 1920 }, safe: SAFE,
  blocks: [
    { id: 'b0', layer: 'hook', rect: { x: 65, y: 269, w: 772, h: 432 }, start_ms: 0, end_ms: 2800 },
    // A propósito en otro orden que el borrador: la unión es por hora, no por posición.
    { id: 'b2', layer: 'key_title', rect: { x: 200, y: 400, w: 300, h: 120 }, start_ms: 3200, end_ms: 5200 },
    { id: 'b1', layer: 'key_title', rect: { x: 111, y: 572, w: 686, h: 335 }, start_ms: 7000, end_ms: 9000 },
    { id: 'b3', layer: 'cta', rect: { x: 142, y: 1063, w: 624, h: 146 }, start_ms: 6200, end_ms: 9000 },
    { id: 'b4', layer: 'role', rect: { x: 80, y: 900, w: 400, h: 90 }, start_ms: 9000, end_ms: 12000 },
    { id: 'b5', layer: 'caption_band', rect: { x: 65, y: 1300, w: 777, h: 200 }, start_ms: 0, end_ms: 12000 },
  ],
};

describe('cada bloque de la escena se une a su bloque del borrador', () => {
  const d = draft();
  // El borrador manda el CTA con su propio texto: lo elegido es «propio».
  const bloques = draftBlocksOf(d, PROPUESTAS, 12000);

  it('sólo los que se mandan a VideoLab, con su índice en el borrador', () => {
    expect(bloques.key_titles.map((k) => k.index)).toEqual([1, 2]);
    expect(bloques.roles.map((r) => r.index)).toEqual([1]);
    // Misma fuente que lo que se manda: las horas de inicio son las de `textLayersFromDraft`.
    const capas = textLayersFromDraft(d, PROPUESTAS, 12000);
    expect(bloques.key_titles.map((k) => k.at_ms)).toEqual(capas.key_titles.map((k) => k.at_ms));
  });

  it('por capa y por hora de inicio, no por el orden', () => {
    const t = dragTargetsOf(escena, bloques);
    const de = (b: string, i?: number) => t.find((x) => x.ref.block === b && (i === undefined || (x.ref as any).index === i));
    expect(de('key_titles', 2)?.rect).toEqual(escena.blocks[1].rect); // «Primero» empieza a los 3,2 s
    expect(de('key_titles', 1)?.rect).toEqual(escena.blocks[2].rect);
    expect(de('roles', 1)?.rect).toEqual(escena.blocks[4].rect);
    expect(de('hook')?.rect).toEqual(escena.blocks[0].rect);
    expect(t.some((x) => (x.ref.block as string) === 'captions')).toBe(false); // la banda de subtítulos no se mueve
    expect(de('key_titles', 2)?.zoom).toBe(1.2); // arrastrar conserva el tamaño
  });

  it('si en una capa no cuadran las cuentas, esa capa no se arrastra', () => {
    const sinUno = { ...escena, blocks: escena.blocks.filter((b) => b.id !== 'b2') };
    const t = dragTargetsOf(sinUno, bloques);
    expect(t.some((x) => x.ref.block === 'key_titles')).toBe(false);
    expect(t.some((x) => x.ref.block === 'hook')).toBe(true);
  });

  it('sin zona segura o sin bloques, nada', () => {
    expect(safeOf({})).toBeNull();
    expect(dragTargetsOf({}, bloques)).toEqual([]);
  });

  it('sólo se puede agarrar lo que se ve en ese momento', () => {
    const t = dragTargetsOf(escena, bloques).find((x) => x.ref.block === 'cta')!;
    expect(visibleAt(t, 6199)).toBe(false);
    expect(visibleAt(t, 6200)).toBe(true);
    expect(visibleAt(t, 9000)).toBe(false);
  });
});

describe('soltar un bloque escribe el place que lee VideoLab', () => {
  /** La fórmula de VideoLab (`render/src/textlayers.mjs`, `placeManual`): el centro sale de x_pct/y_pct sobre la zona segura. */
  const centroVideoLab = (p: { x_pct: number; y_pct: number }) => ({ cx: SAFE.x + SAFE.w * p.x_pct / 100, cy: SAFE.y + SAFE.h * p.y_pct / 100 });

  it('el centro soltado es el centro que dibuja VideoLab (a 1 % de redondeo)', () => {
    const rect = { x: 200, y: 400, w: 300, h: 120 };
    const p = placeAfterDrag(rect, SAFE, 120, 300, 1);
    const { cx, cy } = centroVideoLab(p);
    expect(Math.abs(cx - (rect.x + rect.w / 2 + 120))).toBeLessThanOrEqual(SAFE.w / 100);
    expect(Math.abs(cy - (rect.y + rect.h / 2 + 300))).toBeLessThanOrEqual(SAFE.h / 100);
  });

  it('sin moverlo, queda donde estaba', () => {
    expect(placeAfterDrag({ x: 65, y: 269, w: 777, h: 940 }, SAFE, 0, 0, 1)).toEqual({ x_pct: 50, y_pct: 50, zoom: 1 });
  });

  it('fuera de la zona segura se acota a 0–100 %', () => {
    expect(placeAfterDrag({ x: 100, y: 300, w: 100, h: 100 }, SAFE, -5000, 5000, 1.2)).toEqual({ x_pct: 0, y_pct: 100, zoom: 1.2 });
  });

  it('un toque no es un arrastre', () => {
    expect(isDrag(2, 2)).toBe(false);
    expect(isDrag(3, 4)).toBe(true);
  });

  it('soltar un bloque cambia sólo ese bloque, y viaja al aplicar', () => {
    const d = draft();
    const p = { x_pct: 70, y_pct: 20, zoom: 1 };
    const d2 = withPlace(d, { block: 'key_titles', index: 1 }, p);
    expect(d2.key_titles[1].place).toEqual(p);
    expect(d2.key_titles[2].place).toEqual(d.key_titles[2].place);
    expect(d2.hook).toBe(d.hook);
    expect(textLayersFromDraft(d2, PROPUESTAS, 12000).key_titles.find((k) => k.text === 'Segundo')?.place).toEqual(p);
    expect(withPlace(d, { block: 'roles', index: 1 }, p).roles[1].place).toEqual(p);
    expect(withPlace(d, { block: 'cta' }, p).cta.place).toEqual(p);
    expect(withPlace(d, { block: 'hook' }, p).hook.place).toEqual(p);
  });
});

describe('multimarca', () => {
  it('el archivo nuevo no nombra ninguna marca', () => {
    const MARCAS = /NeuroneSCF|ForumPHs|LucienSael|SamPublisher|D7Herbal|VivoseMask|VizosCosmetics|DiamondDetails|PatriciaOsorio/i;
    expect(readFileSync('src/modules/iid/arrastre.ts', 'utf8')).not.toMatch(MARCAS);
  });
});
