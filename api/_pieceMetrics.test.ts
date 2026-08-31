import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  indexPlatformLimits, indexSignatureClosers, voiceKey,
  countHashtags, channelTextOf, against, lastLineOf, signatureOf, metricsOf,
  type PlatformCatalog, type SignatureCatalog,
} from './_pieceMetrics.js';
import type { ContentPiece } from './_calibrationShared.js';

/** Sin comentarios: se mide el módulo, no el ejemplo de cabecera que lo documenta. */
const MODULE_CODE = readFileSync(new URL('./_pieceMetrics.ts', import.meta.url), 'utf8')
  .split('\n')
  .filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*'); })
  .join('\n');

/**
 * Pruebas de la cabecera de pieza — FIX-CARD-06.
 *
 * QUÉ CUIDAN: que un tope ausente NUNCA se pinte como cumplido, y que la firma sea una
 * COMPARACIÓN contra el genoma y no una inferencia sobre el texto. Las dos son la misma
 * clase de defecto —una ausencia con forma de aprobación— y es la que ya hizo rechazar
 * material bueno en esta bandeja (SIGN-01 corte D).
 *
 * TODOS los identificadores de las fixtures son FICTICIOS a propósito: marcas, canales y
 * voces que no existen en el ecosistema. Si la lógica dependiera del nombre de una marca
 * real, de un canal real o de una voz real, estas pruebas fallarían. Ese es el test de la
 * marca N+1, ejecutable en vez de declarado.
 */

// ── Fixtures (ninguna corresponde a una marca, canal o voz del ecosistema) ────────
const BRAND_A = 'BrandAlpha';
const BRAND_B = 'BrandBeta';
const VOICE_A = 'voice_one';
const VOICE_B = 'voice_two';
const SURFACE_FULL = 'surface_full';   // con los tres topes sembrados
const SURFACE_PART = 'surface_part';   // sólo el tope duro de caracteres
const SURFACE_BARE = 'surface_bare';   // fila presente, ninguna columna sembrada
const SURFACE_NONE = 'surface_none';   // sin fila en el catálogo
const CLOSER_A = '— alpha.example';
const CLOSER_A_EN = '— alpha.example/en';

const LIMITS: PlatformCatalog = indexPlatformLimits([
  { id: SURFACE_FULL, char_limit: 100, char_target: 50, hashtag_limit: 3 },
  { id: SURFACE_PART, char_limit: 100, char_target: null, hashtag_limit: null },
  { id: SURFACE_BARE, char_limit: null, char_target: null, hashtag_limit: null },
]);

const CLOSERS: SignatureCatalog = indexSignatureClosers([
  { brand_id: BRAND_A, voice_id: VOICE_A, application_constraints: { signature_closer: { text: CLOSER_A, text_en: CLOSER_A_EN } } },
  // Decisión declarada: esta voz NO firma.
  { brand_id: BRAND_A, voice_id: VOICE_B, application_constraints: { signature_closer: null } },
  // Genoma presente que nunca sembró la clave: distinto de la decisión anterior.
  { brand_id: BRAND_B, voice_id: VOICE_A, application_constraints: { scope: 'lo que sea' } },
]);

function piece(over: Partial<ContentPiece> = {}): ContentPiece {
  return { id: 'p-1', brand_id: BRAND_A, voice: VOICE_A, platform: SURFACE_FULL, ...over };
}
function withCopy(text: string, over: Partial<ContentPiece> = {}): ContentPiece {
  return piece({ assets: { copy: { aife_filtered: text } }, ...over });
}

// ── Índices ──────────────────────────────────────────────────────────────────────
describe('indexPlatformLimits', () => {
  it('indexa por el id del canal y conserva los nulls como nulls', () => {
    expect(LIMITS!.get(SURFACE_FULL)).toEqual({ char_limit: 100, char_target: 50, hashtag_limit: 3 });
    expect(LIMITS!.get(SURFACE_BARE)).toEqual({ char_limit: null, char_target: null, hashtag_limit: null });
  });

  it('descarta filas sin id en vez de indexarlas bajo una clave vacía', () => {
    expect(indexPlatformLimits([{ id: '  ', char_limit: 10 }]).size).toBe(0);
  });
});

describe('indexSignatureClosers', () => {
  it('distingue las tres ausencias: sin fila, clave nunca sembrada y null explícito', () => {
    expect(CLOSERS!.get(voiceKey(BRAND_B, VOICE_B))).toBeUndefined(); // sin genoma
    expect(CLOSERS!.get(voiceKey(BRAND_B, VOICE_A))).toBeNull();      // clave nunca sembrada
    expect(CLOSERS!.get(voiceKey(BRAND_A, VOICE_B))).toEqual([]);     // decisión: no firma
  });

  it('recoge las dos variantes declaradas, deduplicadas', () => {
    expect(CLOSERS!.get(voiceKey(BRAND_A, VOICE_A))).toEqual([CLOSER_A, CLOSER_A_EN]);
    const same = indexSignatureClosers([
      { brand_id: BRAND_A, voice_id: VOICE_A, application_constraints: { signature_closer: { text: CLOSER_A, text_en: CLOSER_A } } },
    ]);
    expect(same.get(voiceKey(BRAND_A, VOICE_A))).toEqual([CLOSER_A]);
  });
});

// ── Conteos ──────────────────────────────────────────────────────────────────────
describe('countHashtags', () => {
  it('cuenta los hashtags reales y no los `#` que no lo son', () => {
    expect(countHashtags('sin nada')).toBe(0);
    expect(countHashtags('#uno #dos #tres')).toBe(3);
    expect(countHashtags('escrito en C# y en F#')).toBe(0);
    expect(countHashtags('cierre.\n\n#uno\n#dos')).toBe(2);
  });

  it('cuenta hashtags fuera del ASCII: el sistema opera en más de un idioma', () => {
    expect(countHashtags('#Ñandú #Ökologie #日本語')).toBe(3);
  });
});

describe('channelTextOf', () => {
  it('prefiere el texto ADAPTADO al canal de la pieza y lo declara', () => {
    const p = piece({
      assets: {
        copy: { aife_filtered: 'x'.repeat(400) },
        social: { adapted: [{ platform: 'otro_canal', copy: 'no' }, { platform: SURFACE_FULL, copy: 'el que sale' }] },
      },
    });
    expect(channelTextOf(p)).toEqual({ text: 'el que sale', source: 'channel_adapted' });
  });

  it('cae al maestro cuando el canal no tiene adaptación, y lo dice', () => {
    const p = piece({ assets: { copy: { aife_filtered: 'maestro' }, social: { adapted: [{ platform: 'otro', copy: 'no' }] } } });
    expect(channelTextOf(p)).toEqual({ text: 'maestro', source: 'master_copy' });
  });

  it('una pieza sin texto se declara vacía, no se inventa', () => {
    expect(channelTextOf(piece())).toEqual({ text: '', source: 'empty' });
  });
});

// ── La regla del color ───────────────────────────────────────────────────────────
describe('against — «sin dato» NUNCA es verde', () => {
  const missing = { limit: 'falta el tope', target: 'falta el objetivo' };

  it('dentro del objetivo → ok', () => {
    expect(against(10, 50, 100, missing)).toMatchObject({ status: 'ok', reason: null });
  });

  it('pasa el objetivo pero no el tope duro → over_target', () => {
    expect(against(60, 50, 100, missing)).toMatchObject({ status: 'over_target', reason: null });
  });

  it('pasa el tope duro → over_limit', () => {
    expect(against(120, 50, 100, missing)).toMatchObject({ status: 'over_limit', reason: null });
  });

  it('sin tope sembrado → no_data CON motivo, jamás ok', () => {
    const r = against(10, null, null, missing);
    expect(r.status).toBe('no_data');
    expect(r.reason).toBe('falta el tope');
  });

  it('con tope pero sin objetivo → no_data CON motivo: no se afirma «dentro del objetivo»', () => {
    const r = against(10, null, 100, missing);
    expect(r.status).toBe('no_data');
    expect(r.reason).toBe('falta el objetivo');
  });

  it('el tope duro manda sobre la falta de objetivo: pasarse es rojo, no «sin dato»', () => {
    expect(against(120, null, 100, missing).status).toBe('over_limit');
  });
});

// ── La firma: comparación, no inferencia ─────────────────────────────────────────
describe('lastLineOf', () => {
  it('devuelve la última línea con contenido', () => {
    expect(lastLineOf('uno\n\n  dos  \n\n')).toBe('dos');
    expect(lastLineOf('   \n\n')).toBeNull();
  });
});

describe('signatureOf', () => {
  const check = (text: string, over: Partial<ContentPiece> = {}, cat: SignatureCatalog = CLOSERS) =>
    signatureOf(piece(over), text, cat);

  it('cierra con la firma declarada → match, con las dos visibles', () => {
    const r = check(`cuerpo\n\n${CLOSER_A}`);
    expect(r.status).toBe('match');
    expect(r.expected).toBe(CLOSER_A);
    expect(r.stamped).toBe(CLOSER_A);
  });

  it('cualquiera de las variantes declaradas cumple', () => {
    expect(check(`cuerpo\n\n${CLOSER_A_EN}`).status).toBe('match');
  });

  it('no cierra con la declarada → mismatch, mostrando con qué cierra de verdad', () => {
    const r = check('cuerpo\n\n— otra cosa');
    expect(r.status).toBe('mismatch');
    expect(r.expected).toBe(CLOSER_A);
    expect(r.stamped).toBe('— otra cosa');
  });

  it('la firma en medio del texto no cuenta: se estampa al cierre', () => {
    expect(check(`${CLOSER_A}\n\ncuerpo`).status).toBe('mismatch');
  });

  it('genoma con null explícito → not_declared: esta voz no firma (decisión, no defecto)', () => {
    const r = check('cuerpo', { voice: VOICE_B });
    expect(r.status).toBe('not_declared');
    expect(r.expected).toBeNull();
  });

  it('genoma que nunca sembró la clave → no_data, y el motivo lo nombra', () => {
    const r = check('cuerpo', { brand_id: BRAND_B, voice: VOICE_A });
    expect(r.status).toBe('no_data');
    expect(r.reason).toContain('signature_closer');
  });

  it('sin genoma activo para esa voz → no_data nombrando marca y voz', () => {
    const r = check('cuerpo', { brand_id: BRAND_B, voice: VOICE_B });
    expect(r.status).toBe('no_data');
    expect(r.reason).toContain(BRAND_B);
    expect(r.reason).toContain(VOICE_B);
  });

  it('pieza sin voz → no_voice: la firma se resuelve por voz, no se adivina', () => {
    expect(check('cuerpo', { voice: null }).status).toBe('no_voice');
  });

  it('catálogo no consultable → no_data, nunca un veredicto sobre la firma', () => {
    const r = check(`cuerpo\n\n${CLOSER_A}`, {}, null);
    expect(r.status).toBe('no_data');
    expect(r.expected).toBeNull();
  });
});

// ── La cabecera completa ─────────────────────────────────────────────────────────
describe('metricsOf', () => {
  it('canal con los tres topes sembrados y pieza que los cumple → todo verde', () => {
    const m = metricsOf(withCopy(`corto #uno\n\n${CLOSER_A}`), LIMITS, CLOSERS);
    expect(m.chars.status).toBe('ok');
    expect(m.chars.limit).toBe(100);
    expect(m.hashtags.status).toBe('ok');
    expect(m.hashtags.limit).toBe(3);
    expect(m.signature.status).toBe('match');
    expect(m.text_source).toBe('master_copy');
  });

  it('cuenta el texto ADAPTADO al canal, no el maestro: el tope es del canal', () => {
    const p = piece({
      assets: {
        copy: { aife_filtered: 'x'.repeat(400) },       // maestro largo (otro destino)
        social: { adapted: [{ platform: SURFACE_FULL, copy: 'x'.repeat(10) }] },
      },
    });
    const m = metricsOf(p, LIMITS, CLOSERS);
    expect(m.chars.count).toBe(10);
    expect(m.text_source).toBe('channel_adapted');
    expect(m.chars.status).toBe('ok');
  });

  it('pasarse del tope duro es rojo', () => {
    expect(metricsOf(withCopy('x'.repeat(120)), LIMITS, CLOSERS).chars.status).toBe('over_limit');
  });

  it('demasiados hashtags para el canal → rojo, con el tope a la vista', () => {
    const m = metricsOf(withCopy('#a #b #c #d'), LIMITS, CLOSERS);
    expect(m.hashtags.status).toBe('over_limit');
    expect(m.hashtags.count).toBe(4);
    expect(m.hashtags.limit).toBe(3);
  });

  it('canal con columnas sin sembrar → ámbar CON motivo que nombra la columna y el canal', () => {
    const m = metricsOf(withCopy('#a', { platform: SURFACE_PART }), LIMITS, CLOSERS);
    expect(m.chars.status).toBe('no_data');
    expect(m.chars.reason).toContain('char_target');
    expect(m.hashtags.status).toBe('no_data');
    expect(m.hashtags.reason).toContain('hashtag_limit');
    expect(m.hashtags.reason).toContain(SURFACE_PART);
  });

  it('canal sin fila en el catálogo → ámbar con motivo, nunca verde', () => {
    const m = metricsOf(withCopy('hola', { platform: SURFACE_NONE }), LIMITS, CLOSERS);
    expect(m.chars.status).toBe('no_data');
    expect(m.chars.reason).toContain(SURFACE_NONE);
    expect(m.hashtags.status).toBe('no_data');
  });

  it('pieza sin canal → ámbar con motivo: los topes viven por canal', () => {
    const m = metricsOf(withCopy('hola', { platform: null }), LIMITS, CLOSERS);
    expect(m.platform).toBeNull();
    expect(m.chars.status).toBe('no_data');
    expect(m.hashtags.status).toBe('no_data');
  });

  it('catálogo de topes no consultable → ámbar con motivo, y el conteo igual se informa', () => {
    const m = metricsOf(withCopy('hola'), null, CLOSERS);
    expect(m.chars.status).toBe('no_data');
    expect(m.chars.count).toBe(4);
    expect(m.chars.limit).toBeNull();
  });

  it('ningún estado de conteo puede ser `ok` sin tope sembrado', () => {
    for (const platform of [SURFACE_PART, SURFACE_BARE, SURFACE_NONE, null]) {
      const m = metricsOf(withCopy('x #a', { platform }), LIMITS, CLOSERS);
      if (m.chars.limit === null) expect(m.chars.status).not.toBe('ok');
      if (m.hashtags.limit === null) expect(m.hashtags.status).not.toBe('ok');
    }
  });
});

// ── Test de la marca N+1, ejecutable ─────────────────────────────────────────────
describe('la marca N+1 entra sin tocar este archivo', () => {
  it('una marca, un canal y una voz nunca vistos se resuelven por dato', () => {
    const NEW_BRAND = 'BrandGamma';
    const NEW_SURFACE = 'surface_new';
    const NEW_VOICE = 'voice_new';
    const NEW_CLOSER = '— gamma.example';

    const limits = indexPlatformLimits([{ id: NEW_SURFACE, char_limit: 40, char_target: 30, hashtag_limit: 1 }]);
    const closers = indexSignatureClosers([
      { brand_id: NEW_BRAND, voice_id: NEW_VOICE, application_constraints: { signature_closer: { text: NEW_CLOSER } } },
    ]);
    const m = metricsOf(
      { id: 'p-n', brand_id: NEW_BRAND, voice: NEW_VOICE, platform: NEW_SURFACE, assets: { copy: { raw: `#x\n${NEW_CLOSER}` } } },
      limits, closers,
    );
    expect(m.chars.status).toBe('ok');
    expect(m.hashtags.status).toBe('ok');
    expect(m.signature.status).toBe('match');
  });

  it('el módulo no nombra ninguna marca, canal ni voz del ecosistema', () => {
    for (const brand of ['NeuroneSCF', 'ForumPHs', 'LucienSael', 'UnrealvilleStudio', 'SamPublisher', 'D7Herbal'])
      expect(MODULE_CODE).not.toContain(brand);
    for (const surface of ['meta_ig', 'meta_fb', 'tiktok'])
      expect(MODULE_CODE).not.toContain(surface);
  });

  it('no hay ni un número de tope escrito en el módulo: todos salen de la tabla', () => {
    // Los valores hoy sembrados en `public.platform_configs` (medido 2026-08-31). Si alguno
    // apareciera como literal, la tabla habría dejado de ser la fuente.
    for (const seeded of ['2200', '1200', '63206', '280', '900', '1500'])
      expect(MODULE_CODE).not.toMatch(new RegExp(`(?<![\\w/-])${seeded}(?![\\w])`));
  });
});
