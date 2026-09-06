import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DIRECTIVE_MAX_CHARS } from './recompose-image.js';

/**
 * BRIEF-N05 — REGENERAR LA IMAGEN NO ES UN VEREDICTO. Las cinco propiedades que sostienen eso.
 *
 * El defecto que este carril evita: `fixable` SELLA la pieza (`verdictEffect` le escribe
 * `status:'rejected'` + `discarded_at`, y la bandeja lista `discarded_at IS NULL`). Una corrección
 * que pasara por el veredicto entregaría la imagen nueva sobre una pieza que ya nadie va a
 * publicar. Por eso la regeneración corre ANTES de votar, y por eso estas propiedades importan:
 * si alguna se rompe, la corrección vuelve a caer del lado del veredicto sin que nadie se entere.
 *
 * Se fijan sobre la fuente que se compila, mismo patrón que `evaluated-history.test.ts`.
 */

const API = readFileSync(new URL('./recompose-image.ts', import.meta.url), 'utf8');
const MOD = readFileSync(new URL('../src/modules/iid/ApprovalCalibrationModule.tsx', import.meta.url), 'utf8');
const SERVICE = readFileSync(new URL('../src/services/calibrationInbox.ts', import.meta.url), 'utf8');

/** Sin comentarios: se mide el código, no la documentación que lo explica. */
const sinComentarios = (src: string) => src
  .split('\n')
  .filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('{/*'); })
  .join('\n');

const apiCodigo = sinComentarios(API);
const modCodigo = sinComentarios(MOD);

// ── 1 · no es un veredicto ───────────────────────────────────────────────────────
describe('la regeneración no toca el veredicto', () => {
  it('la ruta no escribe el corpus ni sella la pieza', () => {
    for (const prohibido of ['upsertVerdict', 'applyVerdictToPiece', 'verdictEffect', 'discardPiece']) {
      expect(apiCodigo, `la ruta usa \`${prohibido}\`: eso la convertiría en un cuarto veredicto`)
        .not.toContain(prohibido);
    }
    // LEER `discarded_at` es la guarda; ESCRIBIRLO sería sellar. La primera versión de este test
    // prohibía la cadena `discarded_at:` y marcaba el cuerpo del 409, que es justamente donde la
    // guarda REPORTA lo que encontró: una lista negra por subcadena no distingue leer de escribir.
    // Lo que de verdad no puede aparecer es una escritura sobre la fila de la pieza.
    expect(apiCodigo, 'la ruta no hace PATCH sobre ninguna fila: no mueve la pieza').not.toContain('PATCH');
  });

  it('el handler de la tarjeta no llama a saveVerdict ni marca la pieza como resuelta', () => {
    const i = modCodigo.indexOf('const submitRegen');
    const j = modCodigo.indexOf('const submitDiscard');
    expect(i, 'submitRegen no existe').toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    const cuerpo = modCodigo.slice(i, j);
    expect(cuerpo).not.toContain('saveVerdict');
    expect(cuerpo).not.toContain('setDone');
    expect(cuerpo, 'la pieza NO sale de la bandeja: `onResolved` la quitaría').not.toContain('onResolved');
  });

  it('la pieza ya sellada se rechaza ANTES de gastar una generación', () => {
    const guarda = apiCodigo.indexOf('piece.discarded_at');
    const llamada = apiCodigo.indexOf("callEdgeFunction('content-run-stage'");
    expect(guarda).toBeGreaterThan(-1);
    expect(llamada).toBeGreaterThan(-1);
    expect(guarda, 'la guarda va antes de llamar al motor, o se paga una imagen para nada')
      .toBeLessThan(llamada);
    expect(apiCodigo).toContain('piece_already_sealed');
  });
});

// ── 2 · la directriz es la operación, no su explicación ──────────────────────────
describe('la directriz', () => {
  it('es obligatoria: sin ella no se llama al motor', () => {
    expect(apiCodigo).toContain("error: 'visual_directive required'");
    const guarda = apiCodigo.indexOf("visual_directive required");
    const llamada = apiCodigo.indexOf("callEdgeFunction('content-run-stage'");
    expect(guarda).toBeLessThan(llamada);
  });

  it('tiene techo, y se rechaza entera en vez de recortarse', () => {
    expect(DIRECTIVE_MAX_CHARS).toBeGreaterThan(0);
    expect(apiCodigo).toContain('visual_directive too long');
    for (const recorte of ['.slice(0, DIRECTIVE_MAX_CHARS', '.substring(0, DIRECTIVE_MAX_CHARS']) {
      expect(apiCodigo, 'media directriz corrige media cosa y lo parecería todo').not.toContain(recorte);
    }
  });

  it('el botón no se puede pulsar sin ella', () => {
    expect(modCodigo).toContain("const faltaTexto = (panel === 'fix' || panel === 'regen') && !note.trim()");
    expect(modCodigo).toContain('disabled={!!busy || faltaTexto}');
  });
});

// ── 3 · lo que se ve y lo que pasó son la misma cosa ─────────────────────────────
describe('el artefacto vuelve a renderizarse', () => {
  it('la ruta lo rehace desde la pieza ya actualizada', () => {
    const llamada = apiCodigo.indexOf("callEdgeFunction('content-run-stage'");
    const render = apiCodigo.indexOf('ensureArtifact(pieceId)');
    expect(render).toBeGreaterThan(llamada);
  });

  it('«no se pudo rehacer el artefacto» se distingue de «la imagen no cambió»', () => {
    expect(apiCodigo).toContain('artifact_refreshed');
    expect(modCodigo, 'la tarjeta lo dice en pantalla, no sólo en el JSON').toContain('regen.refrescado');
    expect(modCodigo, 'y distingue la composición fallida de la escena no regenerada').toContain('regen.compuesta');
  });

  it('la tarjeta reemplaza el HTML embebido con el que vuelve', () => {
    const i = modCodigo.indexOf('const submitRegen');
    const cuerpo = modCodigo.slice(i, modCodigo.indexOf('const submitDiscard'));
    expect(cuerpo).toContain('setArtHtml(r.html)');
  });
});

// ── 4 · la cicatriz de trigger-job.ts ────────────────────────────────────────────
describe('la firma del handler', () => {
  it('es Node-native, no Web API', () => {
    expect(API).toContain('VercelRequest, VercelResponse');
    expect(apiCodigo, 'la firma Web API cuelga hasta el timeout de 300 s en el runtime Node de Vercel')
      .not.toContain('async function handler(req: Request)');
  });

  it('el token viaja por cabecera, nunca por query string', () => {
    expect(SERVICE).toContain("req('/api/recompose-image', token");
    expect(SERVICE).not.toContain('recompose-image?token=');
  });
});

// ── 5 · marca N+1 ────────────────────────────────────────────────────────────────
describe('ninguna marca en el carril', () => {
  it('la ruta no nombra marca, dominio ni defecto concreto', () => {
    const bajo = API.toLowerCase();
    for (const p of ['neurone', 'nscf', 'forumph', 'fphs', 'color-fade', 'chlorine', 'miami']) {
      expect(bajo, `la ruta nombra \`${p}\`: es instancia, y la instancia va en el dato`).not.toContain(p);
    }
  });
});
