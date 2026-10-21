/**
 * DESHACER (Sam, 2026-10-21) y EL EJE «cambiada tras tu aprobación».
 *
 * Fixtures ficticias: ni marcas, ni canales, ni URLs reales.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { planUndo, lastImageChangeAt, lastTextEdit } from './_undo.js';
import { actionsFor, hayVersionAnterior, pendingStateOf, cambioTrasAprobacion } from './_calibrationShared.js';

const conHistorial = (replaced_at: string) => ({
  image: { url: 'https://ejemplo.invalid/b.png', history: [{ url: 'https://ejemplo.invalid/a.png', replaced_at }] },
});

describe('planUndo — deshace lo ÚLTIMO que cambió', () => {
  it('sin historia de imagen ni ediciones de texto: nada, con su motivo', () => {
    const p = planUndo({ image: { url: 'x' } }, []);
    expect(p.kind).toBe('nothing');
    if (p.kind === 'nothing') expect(p.reason).toMatch(/versión anterior/);
  });
  it('sólo imagen → imagen', () => {
    expect(planUndo(conHistorial('2026-10-21T14:43:00Z'), []).kind).toBe('image');
  });
  it('sólo texto → el texto anterior del campo', () => {
    const p = planUndo({}, [{ field: 'title', before_text: 'antes', created_at: '2026-10-21T10:00:00Z' }]);
    expect(p).toEqual({ kind: 'text', at: '2026-10-21T10:00:00Z', field: 'title', restore_to: 'antes' });
  });
  it('los dos → gana el más reciente', () => {
    const edits = [{ field: 'body', before_text: 'b0', created_at: '2026-10-21T15:00:00Z' }];
    expect(planUndo(conHistorial('2026-10-21T14:00:00Z'), edits).kind).toBe('text');
    expect(planUndo(conHistorial('2026-10-21T16:00:00Z'), edits).kind).toBe('image');
  });
  it('ignora campos que piece-edit no deshace y ediciones sin texto anterior', () => {
    const edits = [
      { field: 'image.url', before_text: 'x', created_at: '2026-10-21T18:00:00Z' },
      { field: 'title', before_text: null, created_at: '2026-10-21T17:00:00Z' },
      { field: 'body', before_text: 'ok', created_at: '2026-10-21T09:00:00Z' },
    ];
    expect(lastTextEdit(edits)?.field).toBe('body');
  });
  it('la imagen más reciente es la del TOPE del historial (el motor pone la última primero)', () => {
    expect(lastImageChangeAt({ image: { history: [{ replaced_at: '2026-10-21T14:43:00Z' }, { replaced_at: '2026-10-13T23:00:00Z' }] } }))
      .toBe('2026-10-21T14:43:00Z');
  });
});

describe('la acción «undo» en el contrato', () => {
  it('sin versión anterior está apagada y dice por qué', () => {
    const a = actionsFor({ status: 'scheduled', assets: { image: { url: 'x' } } });
    expect(a.undo.available).toBe(false);
    expect(a.undo.reason).toMatch(/versión anterior/);
  });
  it('con historial de imagen o con texto editado, disponible — también en una agendada', () => {
    expect(actionsFor({ status: 'scheduled', assets: conHistorial('2026-10-21T14:43:00Z') }).undo.available).toBe(true);
    expect(actionsFor({ status: 'awaiting_approval', edited_at: '2026-10-21T10:00:00Z', assets: {} }).undo.available).toBe(true);
    expect(hayVersionAnterior({ assets: { image: { history: [] } } })).toBe(false);
  });
  it('en una publicada no: lo que salió no se deshace desde la base', () => {
    expect(actionsFor({ status: 'published', assets: conHistorial('2026-10-21T14:43:00Z') }).undo.available).toBe(false);
  });
});

describe('el eje cambiada_tras_aprobar', () => {
  const ch = '2026-10-21T15:00:00.000Z';
  it('la señal es vigente cuando la marca del trigger y el reto coinciden', () => {
    expect(cambioTrasAprobacion({ challenged_at: ch, assets: { approval_change: { at: '2026-10-21T15:00:00.300Z' } } })).toBe(true);
    // Retada otra vez después (p. ej. un fixable): la causa ya no es el cambio tras aprobación.
    expect(cambioTrasAprobacion({ challenged_at: '2026-10-22T09:00:00Z', assets: { approval_change: { at: ch } } })).toBe(false);
    expect(cambioTrasAprobacion({ challenged_at: ch, assets: {} })).toBe(false);
  });
  it('va ANTES del corpus: una aprobada tiene fila en el corpus y no es un fixable', () => {
    expect(pendingStateOf('challenged', true, true, true, false, true)).toBe('cambiada_tras_aprobar');
    expect(pendingStateOf('challenged', true, true, true, false, false)).toBe('por_arreglar');
    // Sólo aplica a una retada.
    expect(pendingStateOf('awaiting_approval', true, true, true, false, true)).not.toBe('cambiada_tras_aprobar');
  });
  it('las dos colas pasan la señal (si una la olvida, la pieza sale en otra pestaña)', () => {
    for (const f of ['./calibration-queue.ts', './challenged-queue.ts']) {
      expect(readFileSync(new URL(f, import.meta.url), 'utf8')).toMatch(/cambioTrasAprobacion\(p\)/);
    }
  });
  it('Arreglos la incluye con su grupo', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(app).toMatch(/states: \[[^\]]*'cambiada_tras_aprobar'/);
    expect(app).toMatch(/\['cambiada_tras_aprobar', 'Cambiada tras tu aprobación'\]/);
  });
});
