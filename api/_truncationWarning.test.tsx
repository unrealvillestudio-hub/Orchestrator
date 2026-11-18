import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { truncationWarningOf, toContext, type ContentPiece } from './_calibrationShared.js';
import { TruncationNotice } from '../src/modules/iid/pieceUi';

/**
 * TRUNC-AVISO (2026-11-18) — decisión de Sam: el detector de cuerpo truncado de `content-run-stage`
 * «no bloquea sino que permite pasar pero con su warn en la tarjeta de calibración». El carril deja el
 * veredicto en `assets.copylab.truncation`; aquí se fija que la tarjeta lo lee y lo pinta, y que sin
 * sospecha no pinta nada. Marca y textos inventados: el test no conoce ninguna marca real.
 */
const piece = (assets: Record<string, unknown> | null): ContentPiece =>
  ({ id: 'p1', brand_id: 'MarcaN1', status: 'awaiting_approval', assets } as unknown as ContentPiece);

const SOSPECHA = {
  truncated: true, signal: 'heuristic', action: 'warn', stop_reason: null,
  reason: 'no termina en signo de cierre — la pieza acaba en «…de los productos de la marca»',
  tail: 'Texto anterior.\n\nLa responsable de los productos de la marca', body_chars: 5229, max_tokens: 4000,
};

describe('el aviso de cuerpo posiblemente cortado', () => {
  it('truncated:true ⇒ aviso con señal, motivo, cola y tamaños', () => {
    expect(truncationWarningOf(piece({ copylab: { truncation: SOSPECHA } }))).toEqual({
      signal: 'heuristic', reason: SOSPECHA.reason, tail: SOSPECHA.tail, body_chars: 5229, max_tokens: 4000,
    });
  });
  it('una pieza escrita antes de `action` también avisa: el criterio es truncated:true', () => {
    const { action: _a, ...sinAccion } = SOSPECHA;
    expect(truncationWarningOf(piece({ copylab: { truncation: sinAccion } }))?.signal).toBe('heuristic');
  });
  it('sin sospecha no hay aviso: entera, indeterminada o sin dato', () => {
    expect(truncationWarningOf(piece({ copylab: { truncation: { truncated: false, signal: 'none' } } }))).toBeNull();
    expect(truncationWarningOf(piece({ copylab: { truncation: { truncated: false, signal: 'undetermined' } } }))).toBeNull();
    expect(truncationWarningOf(piece({ copylab: {} }))).toBeNull();
    expect(truncationWarningOf(piece(null))).toBeNull();
  });
  it('viaja en el contexto de la tarjeta', () => {
    expect(toContext(piece({ copylab: { truncation: SOSPECHA } })).truncation_warning?.tail).toBe(SOSPECHA.tail);
    expect(toContext(piece({})).truncation_warning).toBeNull();
  });
  it('la tarjeta lo pinta con la cola; sin aviso no pinta nada', () => {
    const h = renderToStaticMarkup(<TruncationNotice warning={truncationWarningOf(piece({ copylab: { truncation: SOSPECHA } }))} />);
    expect(h).toContain('Posible texto cortado');
    expect(h).toContain('La responsable de los productos de la marca');
    expect(h).toContain('señal: heuristic');
    expect(renderToStaticMarkup(<TruncationNotice warning={null} />)).toBe('');
  });
});
