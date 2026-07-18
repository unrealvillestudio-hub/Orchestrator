/**
 * api/_craftModules.ts — Orchestrator · Sprint CRAFT-01 (inyección del arsenal al runtime)
 *
 * Función PURA y SÍNCRONA de solo lectura: dados los 3 selectores declarados de una sesión
 * de calibración (`voice_type`, `target_artifact`, `psy_family`), selecciona qué módulos de
 * runtime del arsenal de comunicación inyectar, los lee de disco, ensambla el bloque listo
 * para el system prompt de `calibrate.ts`, y devuelve por separado lo que INYECTÓ, lo que
 * OMITIÓ por falta de dato declarado, y lo que FALLÓ al leer.
 *
 * POR QUÉ EXISTE: el generador de `calibrate.ts` ENUMERABA el arsenal en un paréntesis
 * ("elige una técnica DISTINTA (escena, contraste, analogía, … etc.)") en vez de OPERARLO.
 * Once nombres y un "etc." producían texto "correcto pero tibio". Este módulo reemplaza esa
 * enumeración por módulos de runtime reales, pequeños, seleccionados por el contexto que el
 * operador DECLARA (canal/formato, objetivo psicológico, perfil de voz). Ver brief CRAFT-01.
 *
 * TÉCNICA DE CARGA (decisión de §4.1, documentada acá):
 *   Los módulos son archivos `.md` estáticos en `api/craft-modules/`. Se leen con
 *   `fs.readFileSync(path.join(process.cwd(), 'api/craft-modules', <archivo>))` — NO por
 *   `import` (los `.md` no son módulos ESM en este setup nodenext) ni por red (una copia
 *   estática evita una llamada HTTP por turno, ver §2 del brief). Para que Vercel INCLUYA
 *   los `.md` en el bundle de la función Node, `vercel.json` declara
 *   `functions["api/calibrate.ts"].includeFiles = "api/craft-modules/**"` — mismo mecanismo
 *   ya usado para `ffmpeg-static` en `extract-frames.ts`. En el runtime Node de Vercel
 *   `process.cwd()` es la raíz del despliegue; los includeFiles se colocan relativos a ella.
 *   `__dirname` NO existe bajo ESM → por eso `process.cwd()`, no `__dirname`.
 *
 * DEGRADACIÓN vs INFERENCIA (§5 — la parte más importante):
 *   Las 3 columnas van a estar NULL en la mayoría de las sesiones durante la transición.
 *   El camino NULL es el caso COMÚN, no el borde. Regla dura: degradación elegante, NUNCA
 *   inferencia. Columna NULL → se OMITE el módulo (a `skipped`), jamás se adivina el canal,
 *   la familia ni el tipo de voz. `core` + `structure` es el piso garantizado (siempre).
 *
 * skipped ≠ errors (§5.2 — requisito central):
 *   - `skipped`: ausencia DECLARADA de dato (la columna está NULL / el modo no vino). Es lo
 *     ESPERADO en modo degradado. Alimenta `craft_warnings` que ve el operador (§5.4).
 *   - `errors`: fallo de LECTURA (el archivo no se pudo leer, no existe, está corrupto). Es
 *     ANÓMALO. Un módulo ilegible va SIEMPRE a `errors`, nunca a `skipped`, nunca a silencio.
 *   No mezclar los dos fue lo que escondió el bug de `order=is_primary` en el GenomeBuilder
 *   por días: un fallo de lectura enmascarado como "no hay dato". Acá jamás se enmascara.
 *
 * ÁMBITO: SOLO LEE archivos locales. No toca la DB, no abre clientes, no lanza (los fallos
 * de lectura viajan en `errors`; el caller sigue). Si NINGÚN módulo se pudo leer → craftBlock
 * vacío → `buildSystemPrompt` cae al paréntesis enumerativo actual. Nunca un 502 por esto.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Interfaz exportada (contrato §4.2) ────────────────────────────────────────────
export interface CraftModules {
  craftBlock: string;        // el bloque ensamblado, listo para el prompt ('' si nada se leyó)
  injected: string[];        // p.ej. ['core','structure','profile_conversion']
  skipped: SkipRecord[];     // ausencia DECLARADA de dato — NO es error
  errors: string[];          // fallo de LECTURA — anómalo
}

/** Ausencia DECLARADA de dato (columna NULL). Esperado en modo degradado. Alimenta craft_warnings. */
export interface SkipRecord {
  module: string;            // 'written|oral' | 'psy' | 'profile'
  reason: string;            // 'ARTEFACTO NO DECLARADO' | 'FAMILIA NO DECLARADA' | 'TIPO DE VOZ NO DECLARADO' | 'MODO NO DECLARADO'
}

export interface CraftSelectors {
  voiceType: string | null;
  targetArtifact: Record<string, unknown> | null;
  psyFamily: string | null;
}

// ── Constantes de validación (defensa en profundidad; el endpoint ya valida en el INSERT) ──
// Las 4 familias reales de TAG_TO_FAMILY (unrlvl-iid-functions/.../iid-core/fanout.ts).
const PSY_FAMILIES = new Set(['CONVERSION', 'COMMUNITY', 'AUTHORITY', 'BRIDGE']);
// Los 4 tipos de voz. Hoy solo `conversion` tiene módulo escrito; los otros 3 degradan a
// fallo de lectura (ENOENT → errors) hasta que existan, sin tumbar el turno (§5.3, §7).
const VOICE_TYPES = new Set(['conversion', 'editorial', 'educative', 'professional']);

const MODULES_DIR = 'api/craft-modules';

// ── Helpers privados ──────────────────────────────────────────────────────────────

/**
 * Lee un módulo del disco. Devuelve su contenido (sin las cabeceras de comentario HTML de
 * provenencia canónica) o `null` si no se pudo leer. NUNCA lanza: el fallo se reporta por
 * el valor de retorno para que el caller lo enrute a `errors`. `file` se construye solo con
 * nombres validados/saneados (nunca texto crudo de la DB) → sin riesgo de path traversal.
 */
function readModule(file: string): { text: string } | { error: string } {
  try {
    const raw = readFileSync(join(process.cwd(), MODULES_DIR, file), 'utf8');
    const cleaned = stripProvenanceHeaders(raw).trim();
    if (!cleaned) return { error: `${file}: vacío tras limpiar cabeceras` };
    return { text: cleaned };
  } catch (err) {
    return { error: `${file}: ${String(err instanceof Error ? err.message : err)}` };
  }
}

/** Quita los comentarios HTML de provenencia (<!-- CANÓNICO … --> / <!-- PENDIENTE … -->). */
function stripProvenanceHeaders(md: string): string {
  return md.replace(/<!--[\s\S]*?-->/g, '');
}

/** Etiqueta legible del estado declarado, para el log de §5.2 (declared=[…]). */
export function declaredSummary(sel: CraftSelectors): string {
  const artifact = sel.targetArtifact
    ? (typeof sel.targetArtifact.mode === 'string' && sel.targetArtifact.mode
        ? String(sel.targetArtifact.mode)
        : 'present')
    : 'none';
  return `artifact:${artifact}, psy:${sel.psyFamily ?? 'none'}, voice_type:${sel.voiceType ?? 'none'}`;
}

// ── Núcleo ────────────────────────────────────────────────────────────────────────
/**
 * Selecciona, lee y ensambla los módulos del arsenal según los selectores declarados.
 * Reglas de selección (§4.1):
 *   - core.md, structure.md        → SIEMPRE (piso garantizado)
 *   - written.md | oral.md         → según target_artifact.mode ('written' | 'oral')
 *   - psy_<FAMILIA>.md             → si psy_family declarada (1 de 4 familias)
 *   - profile_<tipo>.md            → si voice_type declarado (hoy solo profile_conversion.md)
 */
export function buildCraftModules(selectors: CraftSelectors): CraftModules {
  const injected: string[] = [];
  const skipped: SkipRecord[] = [];
  const errors: string[] = [];
  const sections: string[] = [];

  // Intenta leer un módulo por su NOMBRE LÓGICO (sin .md) y enruta el resultado.
  const load = (name: string): void => {
    const res = readModule(`${name}.md`);
    if ('text' in res) {
      injected.push(name);
      sections.push(res.text);
    } else {
      // Fallo de LECTURA → errors (anómalo). Nunca a skipped, nunca a silencio (§5.2).
      errors.push(res.error);
    }
  };

  // ── Piso garantizado ────────────────────────────────────────────────────────────
  load('core');
  load('structure');

  // ── Módulo de canal (written | oral) — jamás adivinar el canal (§5.1) ─────────────
  const mode = selectors.targetArtifact && typeof selectors.targetArtifact.mode === 'string'
    ? String(selectors.targetArtifact.mode).trim().toLowerCase()
    : '';
  if (!selectors.targetArtifact) {
    skipped.push({ module: 'written|oral', reason: 'ARTEFACTO NO DECLARADO' });
  } else if (mode === 'written' || mode === 'oral') {
    load(mode);
  } else {
    // Artefacto declarado pero sin modo válido: NO se deriva por adivinación (§3, §5.1).
    skipped.push({ module: 'written|oral', reason: 'MODO NO DECLARADO' });
  }

  // ── Módulo psicológico (psy_<FAMILIA>) — no caer a AUTHORITY (§5.1) ───────────────
  if (!selectors.psyFamily) {
    skipped.push({ module: 'psy', reason: 'FAMILIA NO DECLARADA' });
  } else {
    const fam = selectors.psyFamily.trim().toUpperCase();
    if (PSY_FAMILIES.has(fam)) {
      load(`psy_${fam}`);
    } else {
      // Valor declarado pero fuera de las 4 familias (el endpoint debió rechazarlo). Anómalo,
      // no es ausencia de dato → errors, no skipped. Sin construir path con texto no saneado.
      errors.push(`psy_<familia>: familia no reconocida ('${selectors.psyFamily}')`);
    }
  }

  // ── Módulo de perfil de voz (profile_<tipo>) — no derivar de intent_label (§5.1) ──
  if (!selectors.voiceType) {
    skipped.push({ module: 'profile', reason: 'TIPO DE VOZ NO DECLARADO' });
  } else {
    const vt = selectors.voiceType.trim().toLowerCase();
    if (VOICE_TYPES.has(vt)) {
      // profile_editorial|educative|professional aún no existen → ENOENT cae a errors
      // (§5.3): no tumba el turno, no llega al operador. Solo profile_conversion existe hoy.
      load(`profile_${vt}`);
    } else {
      errors.push(`profile_<tipo>: tipo de voz no reconocido ('${selectors.voiceType}')`);
    }
  }

  // ── Ensamblado ────────────────────────────────────────────────────────────────────
  // Si no se leyó NINGÚN módulo, craftBlock queda vacío → buildSystemPrompt usa el
  // paréntesis enumerativo como fallback (§5.3). No es un error propagable.
  const craftBlock = sections.length
    ? `ARSENAL DE COMUNICACIÓN (módulos operativos — OPERALOS con intención, no los\n` +
      `enumeres ni los nombres; el operador juzga el resultado, no la etiqueta):\n\n` +
      sections.join('\n\n')
    : '';

  return { craftBlock, injected, skipped, errors };
}
