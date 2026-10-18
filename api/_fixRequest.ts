/**
 * EL FIXABLE DICE QUÉ CORREGIR (2026-10-19) — las pills del panel Fixable.
 *
 * Sam (2026-10-18): «no puedo corregir ni imágenes ni textos». Propuso pills de selección múltiple que
 * digan QUÉ tipo de corrección se pide, en texto y en imagen, y una pill «SIN TOCAR EL RESTO». La lista
 * la aprobó el 2026-10-18 y vive como DATO en `intel.fix_request_codes` (migración
 * `unrlvl-iid-functions` 20261019000000): esta pantalla no conoce ningún código, los lee.
 *
 * Este módulo es PURO: valida lo que llega del panel contra el catálogo. Sin red, sin DB.
 *
 * MULTIMARCA: el catálogo no tiene marca; son tipos de corrección del carril, comunes a toda marca.
 */

export const IMAGE_MODES_FIX = ['edit_from_current', 'regenerate_full'] as const;
export type FixImageMode = typeof IMAGE_MODES_FIX[number];

export interface FixRequestCode {
  code: string;
  channel: 'text' | 'image';
  label: string;
  help: string | null;
  sort: number;
  forces_image_mode: FixImageMode | null;
}

/** El catálogo tal como llega de la base, filtrado a lo que la pantalla puede pintar. */
export function normalizeFixCatalog(rows: unknown): FixRequestCode[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r: any) => ({
      code: String(r?.code ?? '').trim(),
      channel: r?.channel === 'image' ? 'image' as const : r?.channel === 'text' ? 'text' as const : null,
      label: String(r?.label ?? '').trim(),
      help: typeof r?.help === 'string' && r.help.trim() ? r.help.trim() : null,
      sort: Number.isFinite(Number(r?.sort)) ? Number(r.sort) : 0,
      forces_image_mode: (IMAGE_MODES_FIX as readonly string[]).includes(r?.forces_image_mode) ? r.forces_image_mode as FixImageMode : null,
    }))
    .filter((r): r is FixRequestCode => !!r.code && !!r.label && r.channel !== null)
    .sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code));
}

/**
 * El modo de imagen que rige: el que impone una pill marcada (p. ej. «SIN TOCAR EL RESTO»), si no el
 * que se eligió, y si no ninguno. Dos pills que impongan modos distintos es un catálogo contradictorio:
 * gana el más conservador (corregir sobre la actual), que es el que no pierde lo que ya está bien.
 */
export function effectiveFixImageMode(
  codes: readonly string[], catalog: readonly FixRequestCode[], chosen: FixImageMode | null,
): { mode: FixImageMode | null; forcedBy: string | null } {
  const byCode = new Map(catalog.map((c) => [c.code, c]));
  const forcing = codes.map((c) => byCode.get(c)).filter((c): c is FixRequestCode => !!c?.forces_image_mode);
  if (forcing.length) {
    const conservador = forcing.find((c) => c.forces_image_mode === 'edit_from_current') ?? forcing[0];
    return { mode: conservador.forces_image_mode, forcedBy: conservador.code };
  }
  return { mode: chosen, forcedBy: null };
}

/**
 * Lo que el server acepta. `fix_codes` ausente o vacío = sin pills (como antes de este cambio). Un código
 * que no está en el catálogo activo es 400: la pantalla sólo ofrece los activos, así que uno desconocido
 * es un cliente viejo o un error, y escribirlo dejaría en el corpus algo que el carril no sabe leer.
 */
export function resolveFixRequest(
  raw: { fix_codes?: unknown; image_mode?: unknown }, catalog: readonly FixRequestCode[],
): { ok: true; fix_codes: string[] | null; image_mode: FixImageMode | null; forced_by: string | null }
  | { ok: false; error: string; detail: string } {
  let codes: string[] = [];
  if (raw.fix_codes != null) {
    if (!Array.isArray(raw.fix_codes) || raw.fix_codes.some((c) => typeof c !== 'string')) {
      return { ok: false, error: 'invalid fix_codes', detail: 'fix_codes debe ser una lista de códigos (texto).' };
    }
    codes = [...new Set((raw.fix_codes as string[]).map((c) => c.trim()).filter(Boolean))];
  }
  const known = new Set(catalog.map((c) => c.code));
  const unknown = codes.filter((c) => !known.has(c));
  if (unknown.length) {
    return { ok: false, error: 'unknown fix_codes', detail: `No están en el catálogo activo: ${unknown.join(', ')}. Recargue la bandeja.` };
  }
  let chosen: FixImageMode | null = null;
  if (raw.image_mode != null && raw.image_mode !== '') {
    if (!(IMAGE_MODES_FIX as readonly unknown[]).includes(raw.image_mode)) {
      return { ok: false, error: 'invalid image_mode', detail: `image_mode debe ser ${IMAGE_MODES_FIX.join(' o ')}.` };
    }
    chosen = raw.image_mode as FixImageMode;
  }
  const eff = effectiveFixImageMode(codes, catalog, chosen);
  return { ok: true, fix_codes: codes.length ? codes : null, image_mode: eff.mode, forced_by: eff.forcedBy };
}
