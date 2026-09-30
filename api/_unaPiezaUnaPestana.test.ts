import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CALIBRATION_TAB_STATES, PENDING_STATES, CALIBRATION_STATUSES, actionsFor } from './_calibrationShared';
import { PUBLISH_STATUSES } from './_publishShared';

/**
 * UNA PIEZA, UNA PESTAÑA — 2026-09-30.
 *
 * Sam: «Calibración, Arreglos, Retenidas, Publicación e Historial: las mismas piezas —awaiting_approval,
 * arreglos, retadas, aprobadas y publicadas— salen en cualquiera de esos tabs. Corrígelo para que lo
 * que muestre sea lo correcto.» Y aparte: «tengo la sensación de haber aprobado varias veces las
 * mismas piezas».
 *
 * Medido en el código ese día:
 *   · Calibración se montaba sin alcance y el server, sin alcance, devolvía los SEIS ejes de pendiente
 *     —retenidas y arreglos incluidos—.
 *   · Publicación leía «todo lo no resuelto», así que lo pendiente de aprobar salía también ahí.
 *   · Retenidas enseñaba el arbitraje abierto aunque la pieza ya estuviera aprobada o publicada.
 *   · Historial repetía la pieza por cada veredicto y enseñaba piezas todavía vivas en otra bandeja.
 *   · Aprobar sólo lo frenaba la pantalla: el endpoint aceptaba aprobar lo aprobado y devolvía a
 *     `scheduled` lo ya publicado.
 *
 * Estos tests leen las fuentes (misma técnica que el resto de la suite) y fijan la regla.
 */
const src = (f: string) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');

describe('Calibración sólo trae sus tres ejes', () => {
  it('los ejes de la pestaña son esperando, recalibrar y aplazada', () => {
    expect([...CALIBRATION_TAB_STATES]).toEqual(['esperando', 'recalibrar', 'aplazada']);
    for (const e of CALIBRATION_TAB_STATES) expect(PENDING_STATES).toContain(e);
  });

  it('sin `state`, el server aplica los ejes de la pestaña, no la bandeja entera', () => {
    expect(src('calibration-queue.ts')).toMatch(/if \(!raw\) return \[\.\.\.CALIBRATION_TAB_STATES\];/);
  });

  it('el espejo del cliente dice lo mismo que el server', () => {
    const cliente = readFileSync(new URL('../src/services/calibrationInbox.ts', import.meta.url), 'utf8');
    expect(cliente).toMatch(/CALIBRATION_TAB_STATES: readonly PendingState\[\] = \['esperando', 'recalibrar', 'aplazada'\]/);
  });
});

describe('Publicación es lo aprobado que espera salir', () => {
  it('sólo `scheduled`', () => {
    expect(PUBLISH_STATUSES).toEqual(['scheduled']);
    expect(src('publish-queue.ts')).toMatch(/fetchLivePieces\(\{ onlyStatuses: PUBLISH_STATUSES \}\)/);
  });
});

describe('Retenidas es la pieza que HOY está retenida', () => {
  it('filtra el arbitraje abierto por el eje `retenida` de la pieza viva, antes de contar', () => {
    const q = src('challenged-queue.ts');
    expect(q).toMatch(/fetchLivePieces\(\{ onlyStatuses: \['challenged'\] \}\)/);
    expect(q).toMatch(/=== 'retenida'/);
    expect(q.indexOf("=== 'retenida'")).toBeLessThan(q.indexOf('by_brand[r.brand_id]'));
  });
});

describe('Historial es lo que ya terminó, una vez por pieza', () => {
  it('excluye lo vivo en otra bandeja y deja una fila por pieza', () => {
    const h = src('evaluated-history.ts');
    expect(h).toMatch(/onlyStatuses: \[\.\.\.CALIBRATION_STATUSES, \.\.\.PUBLISH_STATUSES\]/);
    expect(h).toMatch(/vivasEnOtraBandeja\.has\(r\.piece_id\)/);
    expect(h).toMatch(/porPieza\.has\(r\.piece_id\)/);
  });
});

describe('aprobar dos veces no es posible, tampoco desde el server', () => {
  it('el contrato niega aprobar lo aprobado y lo publicado', () => {
    expect(actionsFor({ status: 'scheduled' }).approve.available).toBe(false);
    expect(actionsFor({ status: 'published' }).approve.available).toBe(false);
    expect(actionsFor({ status: 'awaiting_approval' }).approve.available).toBe(true);
  });

  it('el endpoint cumple el contrato y responde 409 con el motivo', () => {
    const v = src('calibration-verdict.ts');
    expect(v).toMatch(/actionsFor\(piece\)\[accion\]/);
    expect(v).toMatch(/status\(409\)/);
    // La comprobación va ANTES de escribir el corpus: un 409 no deja rastro a medias.
    expect(v.indexOf('status(409)')).toBeLessThan(v.indexOf('await upsertVerdict('));
  });

  it('la escritura de la aprobación se ancla a los estados pendientes', () => {
    expect(src('_calibrationShared.ts')).toMatch(/verdict === 'approved'\s*\n\s*\? `&status=in\.\(\$\{CALIBRATION_STATUSES/);
    expect(CALIBRATION_STATUSES).not.toContain('scheduled');
    expect(CALIBRATION_STATUSES).not.toContain('published');
  });
});
