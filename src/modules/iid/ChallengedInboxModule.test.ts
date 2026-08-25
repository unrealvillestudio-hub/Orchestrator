import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * CALIB-01-E · corte 2 — LO QUE DECIDE SI ESTA BANDEJA SIRVE.
 *
 * Los dos botones son la acción primaria; editar es la salida. Si la edición se convirtiera
 * en el camino por defecto, el arbitraje dejaría de tomar segundos y el mecanismo no
 * escalaría al volumen que llega con las marcas nuevas — la bandeja seguiría existiendo y
 * habría dejado de servir, que es la peor forma de fallar porque no se ve.
 *
 * Esas propiedades son de JERARQUÍA y de FLUJO, no de cálculo: no hay función pura que
 * extraer. Se fijan sobre la fuente que se compila, que es donde un cambio bienintencionado
 * las rompería.
 */

const SRC = readFileSync(new URL('./ChallengedInboxModule.tsx', import.meta.url), 'utf8');
/** Sin comentarios: se mide el código, no la documentación que explica el código. */
const CODE = SRC.split('\n')
  .filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*'); })
  .join('\n');

/**
 * La FILA DE ACCIÓN de la tarjeta: desde el bloque que decide entre «ya decidido» y los dos
 * botones, hasta el error de fila. Es donde vive la jerarquía que este test cuida.
 */
const ACTION_ROW = (() => {
  const a = CODE.indexOf('{decided ? (');
  const b = CODE.indexOf('{error && (', a);
  if (a < 0 || b < 0) throw new Error('no se pudo ubicar la fila de acción de la tarjeta');
  return CODE.slice(a, b);
})();

describe('la decisión binaria es la acción primaria', () => {
  it('los dos botones aparecen ANTES que la salida de edición', () => {
    // Se mide DENTRO de la fila de acción. Fuera de ella hay lápices de edición por campo
    // —afordancias sobre el texto, no acciones de la tarjeta—, y contarlos mediría otra cosa.
    const juez = ACTION_ROW.indexOf("onDecide('judge_was_right')");
    const regla = ACTION_ROW.indexOf("onDecide('rule_failed')");
    const editar = ACTION_ROW.indexOf('Editar');
    expect(juez).toBeGreaterThan(-1);
    expect(regla).toBeGreaterThan(juez);
    expect(editar).toBeGreaterThan(regla);
  });

  it('los dos veredictos tienen botón propio con su consecuencia a la vista', () => {
    expect(CODE).toContain("judge_was_right: 'El juez tenía razón'");
    expect(CODE).toContain("rule_failed: 'La regla falló'");
    expect(CODE).toContain('la pieza se descarta');
    expect(CODE).toContain('la pieza sigue a aprobación');
  });

  it('editar es TERCIARIO: sin color propio y empujado al margen', () => {
    // `ml-auto` + gris es lo que lo manda al costado. Un botón de edición con el mismo peso
    // visual que los veredictos convertiría la salida en el camino.
    const editBtn = ACTION_ROW.slice(ACTION_ROW.indexOf('{piece && editing === null && ('));
    expect(editBtn).toContain('ml-auto');
    expect(editBtn).toContain('text-zinc-600');
    expect(editBtn).not.toMatch(/bg-(accent|amber|emerald)/);
  });
});

describe('un toque = una decisión', () => {
  it('no hay diálogo de confirmación ni segundo paso', () => {
    expect(CODE).not.toMatch(/confirm\s*\(/);
    expect(CODE).not.toMatch(/window\.confirm/);
    expect(CODE).not.toMatch(/¿Seguro|Confirmar arbitraje/);
  });

  it('el veredicto se marca en el acto, antes de que responda el server', () => {
    const decide = CODE.slice(CODE.indexOf('const decide = async'), CODE.indexOf('const undo ='));
    expect(decide.indexOf('setDecided(')).toBeLessThan(decide.indexOf('await saveChallengeVerdict'));
  });

  it('si el server rechaza, la marca se REVIERTE', () => {
    // Dejar la fila como decidida cuando el server la rechazó le mentiría a quien arbitra
    // sobre el estado real — y la próxima decisión se tomaría sobre esa mentira.
    const decide = CODE.slice(CODE.indexOf('const decide = async'), CODE.indexOf('const undo ='));
    expect(decide).toContain('catch');
    expect(decide).toMatch(/setDecided\(\(d\) => \{ const n = \{ \.\.\.d \}/);
  });

  it('la fila decidida SIGUE en pantalla, con deshacer', () => {
    expect(CODE).toContain('Deshacer');
    expect(CODE).toContain('onUndo');
  });

  it('deshacer NO promete un borrado que no ocurre', () => {
    // El endpoint es idempotente y no se pisa: eso es deliberado, para que la serie de
    // decisiones no se pueda reescribir. Prometer lo contrario sería peor que no ofrecer undo.
    const undo = CODE.slice(CODE.indexOf('const undo ='), CODE.indexOf('return ('));
    expect(undo).toContain('ya quedó registrado');
    expect(undo).not.toContain('saveChallengeVerdict');
  });
});

describe('la guarda avisa y no bloquea', () => {
  it('el aviso llega DESPUÉS de guardar, nunca antes', () => {
    const save = CODE.slice(CODE.indexOf('const save = async'), CODE.indexOf('if (!editing)'));
    expect(save.indexOf('await savePieceEdit')).toBeLessThan(save.indexOf('setHits('));
    // Y el aviso se REDACTA como lo que es: algo ya guardado, no una pregunta.
    expect(CODE).toContain('Guardado, con aviso');
    expect(CODE).not.toMatch(/¿Guardar de todos modos\?|Cancelar guardado/);
  });

  it('el aviso deja de mostrarse si el texto que lo causó cambió', () => {
    expect(CODE).toContain('warnedFor');
  });

  it('la insistencia se manda como acknowledge, no como un segundo guardado distinto', () => {
    expect(CODE).toContain('acknowledge_warnings: acknowledge');
    expect(CODE).toContain('save(true)');
  });
});

describe('el estado vacío y el contrato ausente son distintos', () => {
  it('sin retenidas dice "Sin retenidas", no un spinner', () => {
    expect(CODE).toContain('Sin retenidas.');
    expect(CODE).toContain('rows.length === 0');
  });

  it('sin tabla lo dice con la razón del server, y no como un fallo de la pantalla', () => {
    // Una bandeja vacía porque no hay retenidas y una vacía porque falta el DDL son dos
    // cosas distintas; confundirlas es cómo se depura una hora un fallo que no existe.
    expect(CODE).toContain('contract.available');
    expect(CODE).toContain('esperando su tabla');
    expect(CODE).toContain('data.contract.reason');
  });
});

describe('multimarca (test de la marca N+1)', () => {
  it('ninguna marca, plataforma ni código de regla vive en la UI', () => {
    for (const marca of ['ForumPHs', 'LucienSael', 'UnrealvilleStudio', 'NeuroneSCF'])
      expect(CODE).not.toContain(marca);
    for (const plat of ['meta_ig', 'meta_fb', 'linkedin', 'tiktok'])
      expect(CODE).not.toContain(plat);
    expect(CODE).not.toMatch(/HR-[A-Z0-9]+-\d+/);
  });

  it('las pastillas se DESCUBREN del dato, no de una lista', () => {
    expect(CODE).toContain('Object.keys(byBrand)');
    expect(CODE).toContain('Object.keys(byRule)');
  });

  it('la razón de la retención la redacta el server, no la pantalla', () => {
    // Una sola fuente para la explicación: si mañana hay un segundo motivo de retención,
    // cambia una función del server y no cinco componentes.
    expect(CODE).toContain('{row.reason}');
    expect(CODE).not.toContain('patrón verificable no aparece');
  });
});

describe('se reutiliza pieceUi, no se duplica el render', () => {
  it('importa las piezas compartidas en vez de re-implementarlas', () => {
    expect(SRC).toMatch(/from '\.\/pieceUi'/);
    for (const comp of ['CountPill', 'Pager', 'CopyableId', 'fmtDate'])
      expect(SRC).toContain(comp);
  });
});
