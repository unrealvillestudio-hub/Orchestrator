/**
 * LA IMAGEN DE LA PIEZA SE VE ENTERA (Sam, 2026-10-22: «en la computadora necesito poder ver las imágenes
 * completas desde la UI del Orchestrator… ten en cuenta las verticales»).
 *
 * Medido ese día: el marco del artefacto medía 480 px (420 en Historial) y la imagen se pintaba a todo el
 * ancho sin tope de alto, así que una 4:5 o una 9:16 nunca cabía, a ningún zoom. Lo que este test fija:
 *   1 · en el artefacto, la imagen (suelta o lámina) tiene el alto topado al del marco y no se recorta;
 *   2 · en escritorio, los tres marcos que muestran el artefacto miden en proporción a la ventana.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const shared = readFileSync(new URL('./_calibrationShared.ts', import.meta.url), 'utf8');
const regla = shared.match(/\.media img \{[^}]*\}/)?.[0] ?? '';

describe('el artefacto', () => {
  it('la imagen se topa al alto del marco, sin recortar y centrada', () => {
    expect(regla).toMatch(/max-height: calc\(100vh - \d+px\)/);
    expect(regla).toMatch(/width: auto/);
    expect(regla).toMatch(/max-width: 100%/);
    expect(regla).toMatch(/object-fit: contain/);
    expect(regla).toMatch(/margin: 0 auto/);
    expect(regla).not.toMatch(/[^-]width: 100%;/);
  });
});

describe('los marcos', () => {
  // 2026-10-28 — en Calibración y Publicación la tarjeta va por zonas (Sam): la imagen se pinta fuera del artefacto y el
  // texto queda en su propio marco (`VistaPartida.tsx`), que sigue midiendo en proporción a la ventana.
  it('VistaPartida.tsx: el marco del texto y la imagen miden en proporción a la ventana, no un alto fijo', () => {
    const ui = readFileSync(new URL('../src/modules/iid/VistaPartida.tsx', import.meta.url), 'utf8');
    expect(ui).toMatch(/<iframe[\s\S]{0,200}className="w-full h-\[55vh\] md:h-\[65vh\]"/);
    expect(ui).toMatch(/max-h-\[75vh\]/);
    expect(ui).not.toMatch(/md:h-\[(420|480)px\]/);
    for (const archivo of ['ApprovalCalibrationModule.tsx', 'PublishQueueModule.tsx']) {
      const m = readFileSync(new URL(`../src/modules/iid/${archivo}`, import.meta.url), 'utf8');
      expect(m, archivo).toContain('<VistaPrevia artHtml={artHtml} artErr={artErr} vista={vista} pieceId={piece.piece_id} />');
    }
  });
  for (const archivo of ['EvaluatedHistoryModule.tsx']) {
    it(`${archivo}: en escritorio el marco mide en proporción a la ventana, no un alto fijo`, () => {
      const ui = readFileSync(new URL(`../src/modules/iid/${archivo}`, import.meta.url), 'utf8');
      expect(ui).toMatch(/<iframe[\s\S]{0,200}className="w-full h-\[70vh\] md:h-\[85vh\]"/);
      expect(ui).not.toMatch(/md:h-\[(420|480)px\]/);
    });
  }
});
