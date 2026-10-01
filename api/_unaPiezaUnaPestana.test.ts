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

describe('Calibración sólo trae sus ejes', () => {
  it('los ejes de la pestaña son esperando, recalibrar, aplazada y retenida', () => {
    expect([...CALIBRATION_TAB_STATES]).toEqual(['esperando', 'recalibrar', 'aplazada', 'retenida']);
    for (const e of CALIBRATION_TAB_STATES) expect(PENDING_STATES).toContain(e);
  });

  it('sin `state`, el server aplica los ejes de la pestaña, no la bandeja entera', () => {
    expect(src('calibration-queue.ts')).toMatch(/if \(!raw\) return \[\.\.\.CALIBRATION_TAB_STATES\];/);
  });

  it('el espejo del cliente dice lo mismo que el server', () => {
    const cliente = readFileSync(new URL('../src/services/calibrationInbox.ts', import.meta.url), 'utf8');
    expect(cliente).toMatch(/CALIBRATION_TAB_STATES: readonly PendingState\[\] = \['esperando', 'recalibrar', 'aplazada', 'retenida'\]/);
  });

  // 2026-09-30 — la pieza SIN IMAGEN queda `challenged` sin arbitraje: sin esto no sale en ninguna
  // pestaña (17 medidas). Calibración la muestra y sólo cede a Retenidas la que tiene arbitraje abierto.
  it('la retenida sin arbitraje se queda en Calibración; la que tiene arbitraje abierto, no', () => {
    const q = src('calibration-queue.ts');
    expect(q).toMatch(/fetchPendingChallenges\(\)/);
    expect(q).toMatch(/ejeDelJuez\(stateById\.get\(p\.id\)\) && enArbitraje\.has\(p\.id\)/);
    expect(q).toMatch(/e === 'retenida' \|\| e === 'sin_imagen'/);
    // Antes de contar marcas y de paginar: si no, las pastillas contarían piezas que no se ven.
    expect(q.indexOf('enArbitraje.has')).toBeLessThan(q.indexOf('const by_brand'));
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

// ── Decisiones de Sam del 2026-10-01 sobre las bandejas ─────────────────────────────────────
describe('las bandejas tras la decisión del 2026-10-01', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

  it('4 · Arreglos incluye `sin_imagen`: no espera un veredicto, espera «Generar imagen»', () => {
    expect(app).toMatch(/states: \['por_arreglar', 'corregida', 'sin_imagen'\]/);
  });

  it('5 · Retenidas sale de la barra del teléfono, y Calibración avisa si hay arbitrajes', () => {
    expect(app).toMatch(/const BANDEJAS: View\[\] = \['calibration', 'fixes', 'publish', 'history'\];/);
    expect(src('calibration-queue.ts')).toMatch(/open_challenges,/);
    const mod = readFileSync(new URL('../src/modules/iid/ApprovalCalibrationModule.tsx', import.meta.url), 'utf8');
    expect(mod).toMatch(/<OpenChallengesNotice count=\{data\?\.open_challenges\} \/>/);
  });

  it('6 · el orden por defecto es la próxima franja del canal', () => {
    const q = src('calibration-queue.ts');
    expect(q).toMatch(/enumParam<Order>\(req\.query\.order, ORDERS, 'slot'\)/);
    const mod = readFileSync(new URL('../src/modules/iid/ApprovalCalibrationModule.tsx', import.meta.url), 'utf8');
    expect(mod).toMatch(/useState<QueueOrder>\('slot'\)/);
  });
});
