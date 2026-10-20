import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { highlightPayload, resolveHighlights, HIGHLIGHT_NOTE_MAX } from './_highlights.js';
import { ACTION_SPECS, PANEL_COPY, HIGHLIGHT_SECTIONS, HIGHLIGHT_FOOT } from '../src/modules/iid/pieceActions';
import { formasVoseantes } from '../src/idioma/voseo';

/**
 * LA CALIFICACIÓN «DESTACADA» AL APROBAR (PR 6, 2026-10-19).
 *
 * Sam, 2026-10-18: un pulgar con comentario opcional, separando imagen de copy, antes de aprobar; sin marca =
 * pasable; sin pulgar negativo (eso es Fixable). Aprobado el 2026-10-19: un panel al aprobar con una sección
 * de copy y otra de imagen.
 */
const NADA = { copy: false, image: false, copyNote: '', imageNote: '' };

describe('lo que la pantalla manda', () => {
  it('sin marcar nada, no viaja nada: aprobar no depende de la migración', () => {
    expect(highlightPayload(NADA, true)).toEqual({});
    expect(highlightPayload({ ...NADA, copyNote: '   ' }, true)).toEqual({});
  });
  it('copy e imagen por separado, cada uno con su comentario', () => {
    expect(highlightPayload({ copy: true, image: false, copyNote: ' muy claro ', imageNote: '' }, true))
      .toEqual({ highlight_copy: true, copy_note: 'muy claro' });
    expect(highlightPayload({ copy: false, image: true, copyNote: '', imageNote: 'la luz' }, true))
      .toEqual({ highlight_image: true, image_note: 'la luz' });
  });
  it('un comentario sin pulgar también viaja: es «pasable, pero…»', () => {
    expect(highlightPayload({ ...NADA, imageNote: 'le falta contraste' }, true)).toEqual({ image_note: 'le falta contraste' });
  });
  it('una pieza sin imagen no califica la imagen', () => {
    expect(highlightPayload({ copy: true, image: true, copyNote: '', imageNote: 'x' }, false)).toEqual({ highlight_copy: true });
  });
});

describe('lo que el server acepta', () => {
  it('sólo `true` marca: no hay pulgar negativo', () => {
    expect(resolveHighlights({ highlight_copy: true, highlight_image: false })).toEqual({ ok: true, fields: { highlight_copy: true } });
    expect(resolveHighlights({ highlight_copy: 'true' })).toEqual({ ok: true, fields: {} });
  });
  it('los comentarios se recortan; vacíos no viajan', () => {
    expect(resolveHighlights({ copy_note: '  bien  ', image_note: '   ' })).toEqual({ ok: true, fields: { copy_note: 'bien' } });
  });
  it('un comentario que no es texto o que pasa del máximo es 400, con el motivo', () => {
    expect(resolveHighlights({ copy_note: 3 }).ok).toBe(false);
    const largo = resolveHighlights({ image_note: 'x'.repeat(HIGHLIGHT_NOTE_MAX + 1) });
    expect(largo.ok).toBe(false);
    if (!largo.ok) expect(largo.error).toBe('image_note too long');
  });
});

describe('el panel de Aprobar', () => {
  it('aprobar abre su panel; el panel no pide texto obligatorio', () => {
    expect(ACTION_SPECS.find((a) => a.key === 'approve')?.panel).toBe('approve');
    expect(PANEL_COPY.approve.required).toBe(false);
    expect(PANEL_COPY.approve.confirm).toBe('Aprobar');
  });
  it('dos secciones, copy e imagen, en ese orden', () => {
    expect(HIGHLIGHT_SECTIONS.map((s) => s.key)).toEqual(['copy', 'image']);
  });
  it('la ayuda dice que sin marca es pasable y que lo malo va por Fixable', () => {
    expect(HIGHLIGHT_FOOT).toMatch(/Sin marcar = pasable/);
    expect(HIGHLIGHT_FOOT).toMatch(/Fixable/);
  });
});

describe('el cableado', () => {
  const sinComentarios = (src: string) => src.split('\n')
    .filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('{/*'); }).join('\n');
  const VERDICT = sinComentarios(readFileSync(new URL('./calibration-verdict.ts', import.meta.url), 'utf8'));
  const SHARED = sinComentarios(readFileSync(new URL('./_calibrationShared.ts', import.meta.url), 'utf8'));
  const SVC = sinComentarios(readFileSync(new URL('../src/services/calibrationInbox.ts', import.meta.url), 'utf8'));
  const MOD = sinComentarios(readFileSync(new URL('../src/modules/iid/pieceActions.tsx', import.meta.url), 'utf8'));
  it('el endpoint valida la calificación sólo con approved y antes de tocar nada', () => {
    expect(VERDICT).toContain("if (verdict === 'approved') {");
    const valida = VERDICT.indexOf('resolveHighlights(body)');
    expect(valida).toBeGreaterThan(0);
    expect(valida).toBeLessThan(VERDICT.indexOf('ensureArtifact(pieceId)'));
    expect(VERDICT).toContain('...highlights,');
  });
  it('una columna ausente se dice por su nombre', () => {
    expect(SHARED).toContain("for (const col of ['highlight_copy', 'highlight_image', 'copy_note', 'image_note'])");
  });
  it('el cliente sólo manda la calificación con approved', () => {
    expect(SVC).toContain("...(input.verdict === 'approved' ? (input.highlights ?? {}) : {}),");
    expect(MOD).toContain("...(verdict === 'approved' ? { highlights: highlightPayload(hl, piece.has_image) } : {}),");
    expect(MOD).toContain("if (panel === 'approve') return submitVerdict('approved', 'approve');");
  });
  it('el panel de Aprobar no pinta el cuadro de texto general', () => {
    expect(MOD).toContain("{!enTextoImagen && panel !== 'approve' && <textarea");
  });
});

describe('marca N+1 y voseo', () => {
  const SRC = readFileSync(new URL('./_highlights.ts', import.meta.url), 'utf8');
  it('cero marcas en el módulo', () => {
    for (const m of ['NeuroneSCF', 'ForumPHs', 'LucienSael', 'UnrealvilleStudio', 'Patricia'])
      expect(SRC.split('\n').filter((l) => !l.trim().startsWith('*')).join('\n')).not.toContain(m);
  });
  it('los textos del panel sin voseo', () => {
    // Detector morfológico compartido: la lista cerrada de antes usaba `\b`, que no casa con una vocal
    // acentuada final, así que la mitad de sus formas no vigilaba nada.
    expect(formasVoseantes(HIGHLIGHT_FOOT)).toEqual([]);
    for (const s of HIGHLIGHT_SECTIONS) expect(formasVoseantes(`${s.title} ${s.thumb} ${s.placeholder}`)).toEqual([]);
    expect(formasVoseantes(ACTION_SPECS.find((a) => a.key === 'approve')!.hint)).toEqual([]);
  });
});
