import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * 2026-10-01 — dos reportes de Sam del mismo día:
 *   · «Luego de "editar el texto" y aplicar, vuelve como estaba». La edición SÍ se guardaba
 *     (medido en `intel.piece_edits` y `assets.copy.raw` de `1f81a727` y `3c1fa264`), pero el panel
 *     se rellenaba con el texto con que la bandeja cargó la tarjeta y la vista previa no se rehacía.
 *   · El lector en voz alta: fuera de «Detalles», con 1,5× y 2×, sin bloque de texto.
 * Estos tests leen las fuentes, como el resto de la suite.
 */
const ACTIONS = readFileSync(new URL('./pieceActions.tsx', import.meta.url), 'utf8');
const READER = readFileSync(new URL('../../ui/SpeechReader.tsx', import.meta.url), 'utf8');
const CALIB = readFileSync(new URL('./ApprovalCalibrationModule.tsx', import.meta.url), 'utf8');
const PUBLISH = readFileSync(new URL('./PublishQueueModule.tsx', import.meta.url), 'utf8');

describe('el editor muestra lo que guardó', () => {
  it('reabre con el texto VIGENTE, no con el que cargó la bandeja', () => {
    expect(ACTIONS).toMatch(/setNote\(p === 'edit' \? \(vigente\.body \?\? ''\) : ''\)/);
    expect(ACTIONS).not.toMatch(/setNote\(p === 'edit' \? \(piece\.body/);
  });
  it('tras guardar rehace la vista previa con el artefacto reconstruido', () => {
    const i = ACTIONS.indexOf('const submitEdit');
    const cuerpo = ACTIONS.slice(i, ACTIONS.indexOf('const confirm = ()', i));
    expect(cuerpo).toMatch(/renderArtifact\(token, piece\.piece_id\)/);
    expect(cuerpo).toMatch(/onRegenerated\?\.\(/);
  });
  it('edita también el título', () => {
    expect(ACTIONS).toMatch(/field: 'title'/);
    expect(ACTIONS).toMatch(/value=\{editTitle\}/);
  });
  it('lee los avisos de la guarda donde la EF los manda (`guard.hits`)', () => {
    expect(ACTIONS).toMatch(/r\?\.guard\?\.hits/);
  });
});

describe('el lector en voz alta', () => {
  it('ofrece 1×, 1,5× y 2× y aplica la velocidad a cada tramo', () => {
    expect(READER).toMatch(/SPEECH_RATES = \[1, 1\.5, 2\] as const/);
    expect(READER).toMatch(/utterance\.rate = rateRef\.current/);
  });
  it('lee siempre la pieza entera: sin lectura por selección', () => {
    expect(READER).toMatch(/splitForSpeech\(fullText\)/);
    expect(READER).not.toMatch(/getSelection\(\)\s*;/);
  });
  it('sale fuera de «Detalles» en Calibración/Arreglos y en Publicación', () => {
    // Una sola vez y sin envoltorio que lo esconda en el teléfono.
    expect(CALIB.match(/<SpeechReader /g)?.length).toBe(1);
    expect(CALIB).toMatch(/\{readable && <SpeechReader piece=\{readable\} suggestedLang=\{piece\.reading_language\} \/>\}\n\s*<PieceActionsBar/);
    expect(PUBLISH.match(/<SpeechReader /g)?.length).toBe(1);
    expect(PUBLISH).not.toMatch(/hidden md:block"><SpeechReader/);
  });
});
