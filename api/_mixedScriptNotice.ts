/**
 * UNRLVL Orchestrator — api/_mixedScriptNotice.ts (2026-11-18)
 *
 * LETRAS DE OTRO ALFABETO AL GUARDAR UN TEXTO. La EF `piece-edit` (repo `unrlvl-iid-functions`) corrige, antes de
 * guardar, las letras cirílicas o griegas con forma latina que aparezcan DENTRO de una palabra latina (un «pide» con la «e» final
 * U+0435 pasa a «pide» latino), y devuelve lo corregido en `mixed_script`. La corrección vive en la EF —un solo sitio para
 * todos los que guardan—; aquí sólo se lee la respuesta para AVISAR y para que el editor muestre lo que quedó guardado.
 * Funciones PURAS: sin red, sin estado. Ni una marca aquí.
 */

export interface MixedScriptFixView { field?: string; before?: string; after?: string }
export interface MixedScriptUnresolvedView { field?: string; word?: string }
export interface MixedScriptResponse {
  mixed_script?: { fixed?: MixedScriptFixView[] | null; unresolved?: MixedScriptUnresolvedView[] | null } | null;
}

/** Los avisos legibles de una respuesta de `piece-edit`. Sin `mixed_script` (EF anterior), ninguno. */
export function mixedScriptNoticesOf(r: MixedScriptResponse | null | undefined): string[] {
  const out: string[] = [];
  for (const f of r?.mixed_script?.fixed ?? []) {
    if (f?.before && f?.after) out.push(`Letra de otro alfabeto corregida en ${f.field ?? 'el texto'}: «${f.before}» → «${f.after}»`);
  }
  for (const u of r?.mixed_script?.unresolved ?? []) {
    if (u?.word) out.push(`Palabra con letras de dos alfabetos en ${u.field ?? 'el texto'}, sin corregir: «${u.word}»`);
  }
  return out;
}

/** El texto tal como quedó guardado: cada palabra corregida por la EF, sustituida en lo que se envió. */
export function textAfterMixedScript(sent: string, field: string, r: MixedScriptResponse | null | undefined): string {
  let t = sent;
  for (const f of r?.mixed_script?.fixed ?? []) {
    if (f?.before && typeof f.after === 'string' && (f.field ?? field) === field) t = t.split(f.before).join(f.after);
  }
  return t;
}
