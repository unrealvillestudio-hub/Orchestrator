import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// PR-C — el formateador con huso SÍ se ejercita, no sólo se lee: es cálculo, no presentación.
import { fmtInZone, zoneLabel } from './pieceUi';

/**
 * FIX-CARD-06 — lo que la CABECERA de una pieza tiene que decir sin que nadie pase el cursor.
 *
 * Las tres propiedades que este test fija no son de cálculo, son de PRESENTACIÓN, y por eso
 * se fijan sobre la fuente que se compila (mismo patrón que `ChallengedInboxModule.test.ts`):
 *
 *   1. Ningún tope escrito en la UI. Los topes son dato (`public.platform_configs`); una
 *      constante acá los duplicaría, y la copia diverge en el primer cambio de la tabla.
 *   2. El nombre del corte se ve en la etiqueta, no sólo en el `title`. Un dato que sólo
 *      existe en el tooltip obliga a recorrer la bandeja tarjeta por tarjeta.
 *   3. Cero voseo. El imperativo voseante y el pretérito son homógrafos («sembrá» / «sembró»),
 *      así que en una interfaz que da instrucciones la ambigüedad es operativa, no estética.
 *      Fuente: `unrlvl-context/protocols/DELIVERY_AND_VERIFICATION_RULE.md` §2-BIS.
 */

const SRC = readFileSync(new URL('./pieceUi.tsx', import.meta.url), 'utf8');
/** Sin comentarios: se mide el código, no la documentación que lo explica. */
const CODE = SRC.split('\n')
  .filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*'); })
  .join('\n');

// ── 1 · Los topes son dato, no constante de pantalla ─────────────────────────────
describe('la cabecera no conoce ningún tope', () => {
  it('no hay un solo número de tope sembrado escrito en la UI', () => {
    // Los valores hoy sembrados en `public.platform_configs` (medido 2026-08-31). El
    // `lookbehind` deja fuera los tokens de Tailwind (`bg-zinc-900`), que no son topes.
    for (const seeded of ['2200', '1200', '63206', '280', '900', '1500'])
      expect(CODE).not.toMatch(new RegExp(`(?<![\\w/-])${seeded}(?![\\w])`));
  });

  it('no hay ningún nombre de canal ni de marca del ecosistema', () => {
    for (const name of ['meta_ig', 'meta_fb', 'tiktok', 'NeuroneSCF', 'ForumPHs', 'LucienSael', 'UnrealvilleStudio'])
      expect(CODE).not.toContain(name);
  });

  it('los conteos y sus estados llegan como dato, tipados desde el contrato del server', () => {
    expect(SRC).toMatch(/type \{[\s\S]*PieceMetrics[\s\S]*\} from '\.\.\/\.\.\/services\/calibrationInbox'/);
    expect(CODE).toContain('export function PieceHeader');
  });
});

// ── 2 · «sin dato» no se pinta verde ─────────────────────────────────────────────
describe('la regla del color', () => {
  it('cada estado tiene su color, y `no_data` NO comparte el de `ok`', () => {
    const ok = CODE.match(/ok:\s*'([^']+)'/)?.[1] ?? '';
    const noData = CODE.match(/no_data:\s*'([^']+)'/)?.[1] ?? '';
    expect(ok).toContain('emerald');
    expect(noData).not.toContain('emerald');
    expect(noData).toContain('amber');
  });

  it('«sin dato» se escribe con esas palabras, no con un cero ni con un guion', () => {
    expect(CODE).toContain("'sin dato'");
  });

  it('el motivo del ámbar se lee sin pasar el cursor: sale del propio conteo', () => {
    expect(CODE).toContain('m.chars.reason');
    expect(CODE).toContain('m.hashtags.reason');
  });
});

// ── 3 · La firma se compara, no se infiere ───────────────────────────────────────
describe('la firma se muestra comparada', () => {
  it('la esperada y la estampada se ven las dos, en la línea', () => {
    const line = CODE.slice(CODE.indexOf('function SignatureLine'), CODE.indexOf('export function PieceHeader'));
    expect(line).toContain('esperada');
    expect(line).toContain('estampada');
    expect(line).toContain('s.expected');
    expect(line).toContain('s.stamped');
  });

  it('una voz que declara no firmar no se pinta ni verde ni roja', () => {
    const chip = CODE.slice(CODE.indexOf('SIGNATURE_CHIP'), CODE.indexOf('function SignatureLine'));
    const notDeclared = chip.match(/not_declared:\s*\{[^}]*\}/)?.[0] ?? '';
    expect(notDeclared).not.toContain('emerald');
    expect(notDeclared).not.toContain('rose');
  });
});

// ── 4 · El corte se nombra en la etiqueta ────────────────────────────────────────
describe('GenerationBadge', () => {
  const BADGE = CODE.slice(CODE.indexOf('export function GenerationBadge'), CODE.indexOf('export function CutoffsNotice'));

  it('el label del corte se renderiza fuera del `title`', () => {
    // Dos veces: una por cada generación con corte aplicable (anterior y corregido).
    const visible = BADGE.match(/\{label && <span/g) ?? [];
    expect(visible.length).toBe(2);
  });

  it('el `title` conserva la fecha y la explicación, que sí son secundarias', () => {
    expect(BADGE).toContain('fmtDate(at)');
  });
});

// ── 5 · PR-C · La fecha se sitúa en el huso de la MARCA ─────────────────────────
//
// Lo que se fija acá no es el formato: es que la hora salga del huso que llega como dato.
// Que la fecha «aparezca» no prueba nada — un desfase cableado también la haría aparecer, y
// acertaría hasta el cambio de horario.
describe('fmtInZone — el único formateador con huso', () => {
  // Instante de invierno y de verano del mismo año: si el huso se resolviera con un desfase
  // fijo, los dos darían la misma diferencia y una de las dos horas sería falsa.
  const VERANO   = '2026-07-08T17:30:00.000Z';
  const INVIERNO = '2026-01-08T17:30:00.000Z';

  it('dos husos distintos dan dos horas distintas para el MISMO instante', () => {
    const uno = fmtInZone(VERANO, 'America/Panama');
    const otro = fmtInZone(VERANO, 'America/New_York');
    expect(uno).not.toBeNull();
    expect(otro).not.toBeNull();
    expect(uno!.when).not.toBe(otro!.when);
  });

  it('el huso se resuelve por NOMBRE, no por desfase: el cambio de horario se nota', () => {
    // El mismo par de husos separa una hora en verano y ninguna en invierno. Un `-05:00`
    // cableado no podría producir las dos cosas.
    const difVerano   = fmtInZone(VERANO, 'America/Panama')!.when   !== fmtInZone(VERANO, 'America/New_York')!.when;
    const difInvierno = fmtInZone(INVIERNO, 'America/Panama')!.when !== fmtInZone(INVIERNO, 'America/New_York')!.when;
    expect(difVerano).toBe(true);
    expect(difInvierno).toBe(false);
  });

  it('la etiqueta del huso se DERIVA del nombre IANA, sin mapa ni enumeración', () => {
    expect(zoneLabel('America/Panama')).toBe('Panama');
    expect(zoneLabel('America/New_York')).toBe('New York');
    // Un huso de otro continente se lee bien sin tocar el código.
    expect(zoneLabel('Europe/Madrid')).toBe('Madrid');
    expect(zoneLabel('Asia/Ho_Chi_Minh')).toBe('Ho Chi Minh');
  });

  it('el nombre IANA y el instante crudo quedan a mano, en el título', () => {
    const z = fmtInZone(VERANO, 'America/Panama')!;
    expect(z.title).toContain('America/Panama');
    expect(z.title).toContain(VERANO);
  });

  it('sin huso, sin instante o con un huso que el motor no reconoce → null, nunca una hora aproximada', () => {
    expect(fmtInZone(VERANO, null)).toBeNull();
    expect(fmtInZone(null, 'America/Panama')).toBeNull();
    expect(fmtInZone('no-es-una-fecha', 'America/Panama')).toBeNull();
    expect(fmtInZone(VERANO, 'Region/Inventada')).toBeNull();
  });
});

// ── 6 · Las dos bandejas no dicen lo mismo con las mismas palabras ──────────────
describe('compromiso y previsión se nombran distinto', () => {
  it('la cola de publicación dice «Publica:» y la calibración «Fecha prevista de publicación:»', () => {
    expect(CODE).toContain('Publica:');
    expect(CODE).toContain('Fecha prevista de publicación:');
  });

  it('la previsión se declara previsión en la propia línea, no sólo en el tooltip', () => {
    const bloque = CODE.slice(CODE.indexOf('export function ForecastLine'), CODE.indexOf('/** Id corto'));
    expect(bloque).toContain('previsión, no reserva');
  });

  it('el aviso de «sin franja» se condiciona a que la pieza esté aprobada', () => {
    const bloque = CODE.slice(CODE.indexOf('export function SlotLine'), CODE.indexOf('export function ForecastLine'));
    expect(bloque).toContain('if (!approvedAt) return null');
    expect(bloque).toContain('Aprobada sin franja asignada');
  });

  it('cuando falta el huso se nombra la columna que hay que sembrar, y no se sitúa la hora', () => {
    expect(CODE).toContain('public.brands.publish_timezone');
  });

  it('ningún huso ni desfase escrito en la pantalla', () => {
    expect(CODE).not.toMatch(/\b(America|Europe|Asia|Africa|Australia|Pacific|Atlantic|Indian)\//);
    expect(CODE).not.toMatch(/[+-]\d{2}:\d{2}/);
  });
});

// ── 7 · Idioma: ES neutro internacional, sin voseo ───────────────────────────────
describe('la interfaz habla ES neutro internacional', () => {
  it('no queda ni una forma voseante en el texto de pantalla', () => {
    const VOSEO = /\b(sembrá|creés|tenés|podés|querés|sabés|mirá|hacé|poné|elegí|escribí|revisá|verificá|aprobala|rechazala|fijate|andá|dejá|mandá|probá|agregá|cargá)\b/i;
    expect(SRC).not.toMatch(VOSEO);
  });

  it('el aviso de cortes usa el infinitivo, que no es homógrafo del pretérito', () => {
    expect(CODE).toContain('sembrar los cortes');
  });
});

// ── 8 · El circuito de arreglos, dicho en la tarjeta · LO-CORREGIDO-01 ───────────
//
// LO QUE CIERRA. Sam describió el circuito y remató: «luego apruebo si está bien». «Si está bien»
// es una COMPARACIÓN, y lo que la pieza tiene que cumplir es lo que él mismo escribió al retarla.
// Ese texto vivía en `content_pieces.challenged_reason` desde el 2026-09-20 y no se enseñaba en
// ninguna pantalla — evidencia escrita que nadie ve, que es exactamente el defecto que la bandeja
// de retenidas documentó en su cabecera y que costó cinco piezas.
describe('la tarjeta enseña la propuesta con la que se retó la pieza', () => {
  it('el aviso lee `challenge_reason`, y no lo recorta', () => {
    expect(SRC).toContain('fix.challenge_reason');
    // Un `slice` sobre la propuesta la convertiría en un resumen, y un criterio a medias no sirve
    // para comparar contra él. Lo que SÍ se recorta es el texto anterior, y eso pasa en el server.
    expect(SRC).not.toMatch(/challenge_reason[^\n]*\.slice\(/);
  });

  it('sólo sale en las dos mitades del circuito: un recuadro vacío enseña a saltárselo', () => {
    expect(SRC).toMatch(/state !== 'corregida' && state !== 'por_arreglar'/);
  });

  it('VERSIÓN DESCONOCIDA NO SE PINTA COMO v1', () => {
    // Medido el 2026-09-22: 32 piezas tienen `edited_at` y cero filas en `intel.piece_edits`. Un
    // «v1» en ese caso afirmaría «está como nació» — falso, y con la tipografía de un dato. El
    // componente tiene que ramificar por `null` ANTES de escribir ninguna v.
    expect(SRC).toContain('fix.version === null');
    expect(SRC).toContain('no dejó rastro');
  });

  it('cuando hay versión anterior, se dice que se conserva', () => {
    // Es la política que Sam eligió —«nueva versión, se conserva la anterior»— y la tarjeta es
    // donde se comprueba que se cumplió, no una nota en un protocolo.
    expect(SRC).toContain('se conserva la anterior');
  });

  it('no enumera campos editables: `field` llega como dato y se muestra tal cual', () => {
    const bloque = SRC.slice(SRC.indexOf('function FixVersionLine'));
    expect(bloque).not.toMatch(/'(title|body)'/);
  });
});
