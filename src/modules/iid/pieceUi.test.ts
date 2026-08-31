import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

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

// ── 5 · Idioma: ES neutro internacional, sin voseo ───────────────────────────────
describe('la interfaz habla ES neutro internacional', () => {
  it('no queda ni una forma voseante en el texto de pantalla', () => {
    const VOSEO = /\b(sembrá|creés|tenés|podés|querés|sabés|mirá|hacé|poné|elegí|escribí|revisá|verificá|aprobala|rechazala|fijate|andá|dejá|mandá|probá|agregá|cargá)\b/i;
    expect(SRC).not.toMatch(VOSEO);
  });

  it('el aviso de cortes usa el infinitivo, que no es homógrafo del pretérito', () => {
    expect(CODE).toContain('sembrar los cortes');
  });
});
