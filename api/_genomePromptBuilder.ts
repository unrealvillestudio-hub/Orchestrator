/**
 * api/_genomePromptBuilder.ts — Orchestrator · IID #47 E7 (GenomePromptBuilder)
 *
 * Función PURA de solo lectura: dado un `brand_id`, lee todo el contexto disponible de
 * la marca desde Supabase (schema `public`), degrada con elegancia lo que falte, y
 * devuelve un bloque de texto listo para inyectar en el system prompt del generador de
 * `calibrate.ts`. Agnóstica al tipo de marca.
 *
 * POR QUÉ EXISTE: el generador construía el prompt de cada turno con SOLO `founder_axis`
 * + `intent_label` + historia. No leía ninguna tabla de marca → cuando el operador pedía
 * "concéntrate en los ingredientes reales", el modelo ALUCINABA botánicos plausibles de
 * la categoría (p.ej. "Serenoa repens") que NO son de la marca. Los datos reales viven en
 * `public.product_blueprints`, `brand_copy_profiles`, `brands`, `brand_services` y el
 * generador nunca los veía. Este módulo los ensambla como CONOCIMIENTO REAL verificado.
 *
 * ÁMBITO: SOLO LEE. Nunca escribe a tablas de marca. El "parche de marca" desde la
 * evidencia del bucle es protocolo posterior (chat, HRD de Sam), NO código de calibrate.
 *
 * NO abre su propio cliente Supabase: recibe un `sbSelectPublic` inyectado (el de
 * calibrate.ts adaptado a schema `public`). Así se testea con un mock y no duplica
 * credenciales.
 *
 * Las 5 capas (§1.1 del brief):
 *   1. Identidad          — `public.brands` (siempre; PK = `id`, NO `brand_id`)
 *   2. Voz estructurada   — `public.brand_copy_profiles` (active)
 *   3. Producto/fórmula   — `public.product_blueprints` (active) ← mata la alucinación
 *   4. Servicios          — `public.brand_services` (active)
 *   5. (la añade calibrate.ts: founder_axis + intent_label — NO se toca aquí)
 *
 * Cada capa 2-4 es opcional: si no hay datos, se omite ENTERA (sin encabezado vacío).
 * La capa 1 (brand_context) es el piso garantizado.
 */

export interface BrandKnowledge {
  contextBlock: string;      // el bloque ensamblado, listo para el prompt
  hasFormula: boolean;       // hubo product_blueprints con ingredientes
  hasCopyProfile: boolean;   // hubo brand_copy_profiles
  sourcesUsed: string[];     // ['brands','brand_copy_profiles',...] para trazabilidad/log
}

/** Lector de schema PUBLIC inyectado por calibrate.ts (mismo patrón que su sbSelect). */
export type SbSelectPublic = <T>(path: string) => Promise<T[]>;

// ── Helpers de normalización (jsonb de PostgREST llega ya parseado) ───────────────
function textVal(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  return String(v);
}

/** Normaliza un valor (jsonb array | string | null) a lista de strings limpios. */
function listVals(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === 'string' ? x : JSON.stringify(x)))
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (typeof v === 'string') {
    const s = v.trim();
    return s ? [s] : [];
  }
  return [String(v)];
}

function joinList(v: unknown, sep = ', '): string {
  return listVals(v).join(sep);
}

/** Ingredientes jsonb [{inci, common?, role?}] → texto legible. Solo los que existen. */
function renderIngredients(ingredients: unknown): string {
  if (!Array.isArray(ingredients)) return '';
  const parts = ingredients
    .map((ing) => {
      if (typeof ing === 'string') return ing.trim();
      if (!ing || typeof ing !== 'object') return '';
      const o = ing as Record<string, unknown>;
      const common = textVal(o.common);
      const inci = textVal(o.inci);
      const role = textVal(o.role);
      const name = common || inci;
      if (!name) return '';
      // Si hay common, mostrar el INCI entre paréntesis; si no, solo el rol.
      const detail = [common && inci ? inci : '', role ? `rol: ${role}` : ''].filter(Boolean).join(', ');
      return detail ? `${name} (${detail})` : name;
    })
    .filter(Boolean);
  return parts.join('; ');
}

// ── Filas crudas (solo las columnas que leemos) ──────────────────────────────────
interface BrandRow {
  display_name: string | null;
  type: string | null;
  industry: string | null;
  brand_context: string | null;
  positioning: string | null;
  disclaimer_base: string | null;
  differentiators: unknown;
  key_messages: unknown;
  icp: string | null;
}
interface CopyProfileRow {
  voice_tone_primary: string | null;
  voice_writing_style: string | null;
  style_hooks: unknown;
  style_signature_phrases: unknown;
  style_avoid_phrases: unknown;
  compliance_prohibited_words: unknown;
  compliance_required_disclaimers: unknown;
}
interface BlueprintRow {
  name: string | null;
  category: string | null;
  ingredients: unknown;
  claims: unknown;
  claims_forbidden: unknown;
  description_short: string | null;
  hair_type: unknown;
}
interface ServiceRow {
  producto: string | null;
  servicio: string | null;
  item_type: string | null;
  is_primary: boolean | null;
}

/**
 * Lee las 4 capas de conocimiento real de la marca y ensambla el bloque de contexto.
 * Degradación elegante: cada lectura de capa opcional se envuelve para que un fallo
 * puntual no tumbe el resto (devuelve [] y se omite la capa). El caller (calibrate.ts)
 * además envuelve la llamada entera: si TODO falla, cae a contextBlock=''.
 */
export async function buildBrandKnowledge(
  brandId: string,
  sbSelectPublic: SbSelectPublic,
): Promise<BrandKnowledge> {
  const id = encodeURIComponent(brandId);
  const sourcesUsed: string[] = [];
  const sections: string[] = [];

  // Lectura resiliente por capa: si una capa falla, se omite (no rompe las demás).
  const safeRead = async <T>(path: string, label: string): Promise<T[]> => {
    try {
      return await sbSelectPublic<T>(path);
    } catch (err) {
      console.error(`[genomePromptBuilder] fallo leyendo ${label}`, String(err));
      return [];
    }
  };

  // ── Capa 1 · Identidad (siempre; PK = id) ──────────────────────────────────────
  const brands = await safeRead<BrandRow>(
    `brands?id=eq.${id}` +
      `&select=display_name,type,industry,brand_context,positioning,disclaimer_base,differentiators,key_messages,icp` +
      `&limit=1`,
    'brands',
  );
  const brand = brands[0];
  if (brand) {
    sourcesUsed.push('brands');
    const idLines: string[] = ['## Identidad'];
    const header = [textVal(brand.display_name), textVal(brand.type), textVal(brand.industry)]
      .filter(Boolean)
      .join(' · ');
    if (header) idLines.push(header);
    if (textVal(brand.brand_context)) idLines.push(textVal(brand.brand_context));
    if (textVal(brand.positioning)) idLines.push(`Posicionamiento: ${textVal(brand.positioning)}`);
    if (listVals(brand.differentiators).length) idLines.push(`Diferenciadores: ${joinList(brand.differentiators)}`);
    if (listVals(brand.key_messages).length) idLines.push(`Mensajes clave: ${joinList(brand.key_messages)}`);
    if (textVal(brand.icp)) idLines.push(`Cliente ideal (ICP): ${textVal(brand.icp)}`);
    if (textVal(brand.disclaimer_base)) idLines.push(`Disclaimer base: ${textVal(brand.disclaimer_base)}`);
    // Solo emitir la sección si tiene algo más que el encabezado.
    if (idLines.length > 1) sections.push(idLines.join('\n'));
  }

  // ── Capa 2 · Voz estructurada (brand_copy_profiles active) ──────────────────────
  const profiles = await safeRead<CopyProfileRow>(
    `brand_copy_profiles?brand_id=eq.${id}&active=eq.true` +
      `&select=voice_tone_primary,voice_writing_style,style_hooks,style_signature_phrases,style_avoid_phrases,compliance_prohibited_words,compliance_required_disclaimers` +
      `&limit=1`,
    'brand_copy_profiles',
  );
  const profile = profiles[0];
  const hasCopyProfile = !!profile;
  if (profile) {
    sourcesUsed.push('brand_copy_profiles');
    const vLines: string[] = ['## Voz de marca (perfil establecido)'];
    const toneStyle = [
      textVal(profile.voice_tone_primary) ? `Tono: ${textVal(profile.voice_tone_primary)}` : '',
      textVal(profile.voice_writing_style) ? `Estilo: ${textVal(profile.voice_writing_style)}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    if (toneStyle) vLines.push(toneStyle);
    if (listVals(profile.style_hooks).length) vLines.push(`Ganchos que funcionan: ${joinList(profile.style_hooks)}`);
    if (listVals(profile.style_signature_phrases).length)
      vLines.push(`Frases firma: ${joinList(profile.style_signature_phrases)}`);
    if (listVals(profile.style_avoid_phrases).length)
      vLines.push(`Frases a EVITAR: ${joinList(profile.style_avoid_phrases)}`);
    if (listVals(profile.compliance_prohibited_words).length)
      vLines.push(`Palabras PROHIBIDAS (compliance): ${joinList(profile.compliance_prohibited_words)}`);
    if (listVals(profile.compliance_required_disclaimers).length)
      vLines.push(`Disclaimers obligatorios: ${joinList(profile.compliance_required_disclaimers)}`);
    if (vLines.length > 1) sections.push(vLines.join('\n'));
  }

  // ── Capa 3 · Producto/fórmula (product_blueprints active) — mata la alucinación ─
  // OJO: product_blueprints NO tiene columna is_primary (sí la tiene brand_services, capa 4).
  // Ordenar por ella hacía que PostgREST devolviera 400 → safeRead lo tragaba → formula=false
  // y el generador nunca veía los ingredientes reales. Se ordena por name (existe, determinista).
  const blueprints = await safeRead<BlueprintRow>(
    `product_blueprints?brand_id=eq.${id}&active=eq.true` +
      `&select=name,category,ingredients,claims,claims_forbidden,description_short,hair_type` +
      `&order=name.asc`,
    'product_blueprints',
  );
  let hasFormula = false;
  if (blueprints.length) {
    const pLines: string[] = ['## Fórmula / Producto'];
    for (const bp of blueprints) {
      const head = [textVal(bp.name), textVal(bp.category)].filter(Boolean).join(' — ');
      if (head) pLines.push(head);
      if (textVal(bp.description_short)) pLines.push(textVal(bp.description_short));
      const ingredientsText = renderIngredients(bp.ingredients);
      if (ingredientsText) {
        hasFormula = true;
        pLines.push(`Ingredientes REALES (los únicos que existen; no inventes otros): ${ingredientsText}`);
      }
      if (listVals(bp.hair_type).length) pLines.push(`Tipo de cabello: ${joinList(bp.hair_type)}`);
      if (listVals(bp.claims).length) pLines.push(`Claims permitidos: ${joinList(bp.claims, ' | ')}`);
      if (listVals(bp.claims_forbidden).length)
        pLines.push(`Claims PROHIBIDOS: ${joinList(bp.claims_forbidden, ' | ')}`);
    }
    if (pLines.length > 1) {
      sourcesUsed.push('product_blueprints');
      sections.push(pLines.join('\n'));
    }
  }

  // ── Capa 4 · Servicios (brand_services active) — el "cuerpo" de marcas sin SKU ──
  const services = await safeRead<ServiceRow>(
    `brand_services?brand_id=eq.${id}&active=eq.true` +
      `&select=producto,servicio,item_type,is_primary` +
      `&order=is_primary.desc.nullslast`,
    'brand_services',
  );
  if (services.length) {
    const items = services
      .map((s) => {
        const label = [textVal(s.producto), textVal(s.servicio)].filter(Boolean).join(' — ');
        return label;
      })
      .filter(Boolean);
    if (items.length) {
      sourcesUsed.push('brand_services');
      sections.push(['## Servicios', items.join('\n')].join('\n'));
    }
  }

  // ── Ensamblado final ────────────────────────────────────────────────────────────
  // Si no hubo NADA (ni identidad), devolvemos bloque vacío → calibrate cae a solo-eje.
  if (!sections.length) {
    return { contextBlock: '', hasFormula: false, hasCopyProfile: false, sourcesUsed };
  }

  const contextBlock =
    `CONOCIMIENTO REAL DE LA MARCA (fuente de verdad verificada — está PROHIBIDO\n` +
    `inventar ingredientes, propiedades, claims o datos que no figuren aquí):\n\n` +
    sections.join('\n\n');

  return { contextBlock, hasFormula, hasCopyProfile, sourcesUsed };
}
