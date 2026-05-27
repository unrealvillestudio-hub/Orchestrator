/**
 * UNRLVL — Orchestrator Engine v2.5
 *
 * v2.5 changelog (2026-05-27):
 * - loadBrandContext(): lee brand_cache_snapshots y memoiza por brandId.
 * - executeStage(): antes de copylab, inyecta brand context en meta y previousOutputs.
 *   Paridad con el PromptBuilder (Stage 1) del pipeline API-mode en lab-worker.
 *
 * v2.4 changelog (2026-05-26):
 * - executeStage(): imagelab stage → upload image_data_url a Supabase Storage
 *   via Meta MCP /api/upload → inyecta image_url en previousOutputs
 *   para que SocialLab lo reciba y lo guarde en scheduled_posts
 *
 * v2.3 changelog (2026-05-26):
 * - types.ts: LabId += 'meta', FlowObjective += 'publish_organic'
 * - executeStage(): labId === 'meta' → executeMetaStage handler
 *
 * v2.2 changelog (2026-05-18):
 * - types.ts: LabId += 'klaviyo', FlowObjective += 'email_sequence'
 * - executeStage(): labId === 'klaviyo' → executeKlaviyoStage handler
 */

import {
  executeEmailSequenceStage,
  getPreviousMechanism,
  type SequencePieceMeta,
} from './sequenceBridge';

import type {
  InterpretResult,
  FlowStage,
  PlatformId,
  FlowObjective,
  EmailSequenceType,
  SequenceContext,
  BrandContext,
} from '../core/types';

const SB_URL = (import.meta as any).env.VITE_SUPABASE_URL as string;
const SB_KEY = (import.meta as any).env.VITE_SUPABASE_ANON_KEY as string;
const META_MCP_URL = (import.meta as any).env.VITE_META_MCP_URL as string
  ?? 'https://unrlvl-meta-mcp.vercel.app';

// ── LAB CONFIG ────────────────────────────────────────────────────────────────

interface LabConfig {
  lab_key:        string;
  api_endpoint:   string;
  execute_path:   string;
  active:         boolean;
  default_params: Record<string, unknown>;
}

let _labConfigsCache: LabConfig[] | null = null;

async function getLabConfigs(): Promise<LabConfig[]> {
  if (_labConfigsCache) return _labConfigsCache;
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/lab_configs?select=lab_key,api_endpoint,execute_path,active,default_params&lab_key=not.is.null`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    if (!res.ok) throw new Error(`lab_configs fetch: ${res.status}`);
    _labConfigsCache = await res.json();
    return _labConfigsCache!;
  } catch (err) {
    console.error('[OrchestratorEngine] lab_configs error:', err);
    return [];
  }
}

// ── INTERPRET ─────────────────────────────────────────────────────────────────

export async function interpretPrompt(userPrompt: string): Promise<InterpretResult> {
  const res = await fetch('/api/interpret-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: userPrompt }),
  });

  if (!res.ok) return fallbackResult();

  try {
    const parsed = await res.json();
    return {
      brandId:           parsed.brandId          ?? null,
      platforms:         (parsed.platforms        ?? ['INSTAGRAM', 'FACEBOOK']) as PlatformId[],
      objective:         (parsed.objective        ?? 'social_post') as FlowObjective,
      interpretedIntent: parsed.interpretedIntent ?? 'Flujo de contenido personalizado',
      suggestedStages:   parsed.suggestedStages   ?? [],
      complianceFlags:   parsed.complianceFlags   ?? [],
      dbVariablesKeys:   parsed.dbVariablesKeys   ?? [],
      confidence:        parsed.confidence        ?? 0.8,
      sequence_type:     (parsed.sequence_type    ?? null) as EmailSequenceType | null,
      sequence_context:  (parsed.sequence_context ?? null) as SequenceContext | null,
    };
  } catch {
    return fallbackResult();
  }
}

function fallbackResult(): InterpretResult {
  return {
    brandId:           null,
    platforms:         ['INSTAGRAM', 'FACEBOOK'],
    objective:         'social_post' as FlowObjective,
    interpretedIntent: 'No se pudo interpretar el prompt.',
    suggestedStages:   [
      {
        order: 1, labId: 'copylab', label: 'Generar copy',
        description: 'Generar texto', requiresApproval: true,
        estimatedSeconds: 8, mockOutput: 'Copy generado.',
      },
      {
        order: 2, labId: 'imagelab', label: 'Generar imagen',
        description: 'Generar imagen del post', requiresApproval: false,
        estimatedSeconds: 30, mockOutput: 'Imagen generada.',
      },
      {
        order: 3, labId: 'sociallab', label: 'Encolar post',
        description: 'Encolar en SocialLab', requiresApproval: false,
        estimatedSeconds: 2, mockOutput: 'Post encolado.',
      },
      {
        order: 4, labId: 'meta', label: 'Publicar',
        description: 'Publicar via Meta MCP', requiresApproval: true,
        estimatedSeconds: 3, mockOutput: 'Publicado.',
      },
    ],
    complianceFlags:  [],
    dbVariablesKeys:  [],
    confidence:       0.4,
    sequence_type:    null,
    sequence_context: null,
  };
}

// ── BRAND CONTEXT LOADER ──────────────────────────────────────────────────────
// Lee public.brand_cache_snapshots y memoiza por brandId para evitar hits repetidos
// durante la ejecución de un mismo flow. La invalidación natural ocurre al recargar
// la app (cache vive en memoria del browser).

const _brandContextCache: Map<string, BrandContext | null> = new Map();

export async function loadBrandContext(brandId: string): Promise<BrandContext | null> {
  if (!brandId) return null;
  if (_brandContextCache.has(brandId)) return _brandContextCache.get(brandId) ?? null;

  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/brand_cache_snapshots?brand_id=eq.${encodeURIComponent(brandId)}&select=voice,persona,tone,benefits,icp,snapshot&order=created_at.desc&limit=1`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    if (!res.ok) {
      _brandContextCache.set(brandId, null);
      return null;
    }
    const rows = await res.json() as Array<Record<string, unknown>>;
    if (!rows.length) {
      _brandContextCache.set(brandId, null);
      return null;
    }
    const row = rows[0];
    // El snapshot puede venir aplanado (columnas individuales) o anidado en .snapshot
    const ctx: BrandContext = (typeof row.snapshot === 'object' && row.snapshot !== null)
      ? row.snapshot as BrandContext
      : {
          voice:    row.voice    as string  | undefined,
          persona:  row.persona  as string  | undefined,
          tone:     row.tone     as string  | undefined,
          benefits: row.benefits as string[] | undefined,
          icp:      row.icp      as string  | undefined,
        };
    _brandContextCache.set(brandId, ctx);
    return ctx;
  } catch (err) {
    console.warn('[OrchestratorEngine] loadBrandContext error:', err);
    _brandContextCache.set(brandId, null);
    return null;
  }
}

export function invalidateBrandContextCache(brandId?: string): void {
  if (brandId) _brandContextCache.delete(brandId);
  else _brandContextCache.clear();
}

// ── EXECUTE STAGE ─────────────────────────────────────────────────────────────

export interface ExecuteStageOptions {
  brandId?:         string | null;
  previousOutputs?: Record<string, string>;
  sequenceType?:    string;
  sequenceContext?: SequenceContext | null;
  stageMeta?:       Record<string, unknown>;
}

export async function executeStage(
  stage: FlowStage,
  options: ExecuteStageOptions = {},
): Promise<string> {

  if (stage.labId === 'klaviyo') return executeKlaviyoStage(stage, options);
  if (stage.labId === 'meta')    return executeMetaStage(stage, options);

  const configs = await getLabConfigs();
  const config  = configs.find(c => c.lab_key === stage.labId);

  if (!config) {
    return `[${stage.labId.toUpperCase()}] Lab no conectado. Configura el endpoint en Supabase lab_configs.`;
  }

  const endpoint = `${config.api_endpoint}${config.execute_path}`;
  const meta     = (options.stageMeta ?? {}) as Record<string, unknown>;
  const seqCtx   = options.sequenceContext ?? null;

  // Stage 1 paridad: para copylab cargamos brand_cache_snapshots y lo inyectamos
  // en meta + previousOutputs.brand_context. Otros labs (imagelab, sociallab, meta)
  // lo reciben implícito via previousOutputs si fue cargado en el copylab anterior.
  let brandContext: BrandContext | null = null;
  if (stage.labId === 'copylab' && options.brandId) {
    brandContext = await loadBrandContext(options.brandId);
    if (brandContext && options.previousOutputs) {
      options.previousOutputs['brand_context'] = JSON.stringify(brandContext);
    }
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brandId: options.brandId ?? null,
        stage: {
          labId:       stage.labId,
          label:       stage.label,
          description: stage.description,
          order:       stage.order,
        },
        params: {
          pack:               meta.pack_id ?? config.default_params?.pack,
          canal:              meta.canal ?? 'instagram_feed',
          aspect_ratio:       meta.aspect_ratio ?? '4:5',
          idioma:             meta.language,
          extra_instructions: stage.description,
          subject:            meta.subject ?? stage.description,
        },
        meta: {
          motor:             meta.motor ?? 'claude',
          sequence_type:     options.sequenceType ?? null,
          position:          meta.position ?? 1,
          language:          meta.language ?? 'ES',
          persona_key:       seqCtx?.persona_key ?? null,
          psycho_presets:    meta.psycho_presets ?? [],
          mechanism_primary: meta.mechanism_primary ?? null,
          utm_content:       seqCtx?.utm_content ?? null,
          brand_context:     brandContext ?? null,
        },
        previousOutputs: options.previousOutputs ?? {},
      }),
    });

    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    const data = await res.json() as {
      output?: string;
      error?: string;
      image_data_url?: string;  // ImageLab devuelve esto
      status?: string;
    };

    // Fail-fast: si el lab devolvió error, lanzar excepción para detener el pipeline
    if (data.status === 'error' || data.error) {
      throw new Error(`[${stage.labId}] ${data.error ?? data.output ?? 'Lab returned error'}`);
    }

    // ── GAP 1 FIX: ImageLab devuelve image_data_url → subir a Storage ──────
    if (stage.labId === 'imagelab' && data.image_data_url) {
      try {
        const uploadResult = await uploadImageToStorage(
          data.image_data_url,
          options.brandId ?? 'unrlvl',
        );
        if (uploadResult && options.previousOutputs) {
          // Inyectar la URL pública en previousOutputs para que SocialLab la reciba
          options.previousOutputs['image_url'] = uploadResult;
          console.log('[OrchestratorEngine] imagen subida a Storage:', uploadResult);
        }
      } catch (uploadErr) {
        console.error('[OrchestratorEngine] upload imagen falló:', uploadErr);
        // No bloqueamos el flujo si el upload falla — el post puede ir sin imagen
      }
    }

    return data.output ?? 'Stage completado sin output.';

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[OrchestratorEngine] executeStage (${stage.labId}):`, msg);
    return `Error ejecutando ${stage.labId}: ${msg}`;
  }
}

// ── IMAGE UPLOAD HELPER ────────────────────────────────────────────────────────
// Sube el base64 de ImageLab a Supabase Storage via Meta MCP /api/upload
// Devuelve la URL pública o null si falla

async function uploadImageToStorage(
  dataUrl: string,
  brandId: string,
): Promise<string | null> {
  const base64 = dataUrl.split(',')[1];
  if (!base64) return null;

  const uploadEndpoint = `${META_MCP_URL}/api/upload`;

  const res = await fetch(uploadEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      base64,
      mime_type: 'image/jpeg',
      folder: 'published',
      brand_id: brandId,
      filename: `${brandId}_post_${Date.now()}.jpg`,
    }),
  });

  if (!res.ok) throw new Error(`Upload HTTP ${res.status}`);
  const data = await res.json() as { public_url?: string; status?: string; error?: string };
  if (data.error) throw new Error(data.error);
  return data.public_url ?? null;
}

// ── META STAGE HANDLER ────────────────────────────────────────────────────────

async function executeMetaStage(
  stage: FlowStage,
  options: ExecuteStageOptions,
): Promise<string> {
  const brandId = options.brandId ?? '';
  if (!brandId) return '[META] Error: brandId requerido para publicar.';

  try {
    const configs = await getLabConfigs();
    const socialConfig = configs.find(c => c.lab_key === 'sociallab');
    const socialBase = socialConfig?.api_endpoint ?? 'https://social-lab-flame.vercel.app';

    const res = await fetch(`${socialBase}/api/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand_id: brandId }),
    });

    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    const data = await res.json() as { output?: string; published?: number; failed?: number };
    return data.output ?? `Publicados: ${data.published ?? 0} · Fallidos: ${data.failed ?? 0}`;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error publicando via Meta: ${msg}`;
  }
}

// ── KLAVIYO STAGE HANDLER ─────────────────────────────────────────────────────

async function executeKlaviyoStage(
  stage: FlowStage,
  options: ExecuteStageOptions,
): Promise<string> {
  const brandId     = options.brandId ?? '';
  const meta        = (options.stageMeta ?? {}) as Record<string, unknown>;
  const seqCtx      = options.sequenceContext ?? null;
  const prevOutputs = options.previousOutputs ?? {};

  const copyLabOutput =
    prevOutputs[`copylab_${meta.position}_${meta.language}`]
    ?? prevOutputs['copylab_output']
    ?? (Object.values(prevOutputs).find(v => typeof v === 'string' && v.includes('---SUBJECT---')))
    ?? '';

  if (!copyLabOutput) {
    return `[KLAVIYO] Error: output de CopyLab no encontrado. Keys: ${Object.keys(prevOutputs).join(', ')}`;
  }

  const sequenceIdFromPrev = prevOutputs['sequence_id'] ?? null;
  let previousMechanism = 'none';
  const position = typeof meta.position === 'number' ? meta.position : 1;

  if (position > 1 && sequenceIdFromPrev) {
    previousMechanism = await getPreviousMechanism(
      sequenceIdFromPrev,
      position,
      typeof meta.language === 'string' ? meta.language : 'ES',
    ) ?? 'unknown';
  }

  const templateIds = (seqCtx?.klaviyo_template_ids ?? {}) as Record<string, string>;
  const templateSlot = typeof meta.klaviyo_template_slot === 'string' ? meta.klaviyo_template_slot : '';

  const pieceMeta: SequencePieceMeta = {
    sequenceType:      options.sequenceType ?? 'generic',
    position,
    language:          typeof meta.language === 'string' ? meta.language : 'ES',
    brandId,
    klaviyoTemplateId: (typeof meta.klaviyo_template_id === 'string' ? meta.klaviyo_template_id : null)
                       ?? templateIds[templateSlot]
                       ?? undefined,
    personaKey:        seqCtx?.persona_key ?? undefined,
    mechanismPrimary:  typeof meta.mechanism_primary === 'string' ? meta.mechanism_primary : undefined,
    psychoPresets:     Array.isArray(meta.psycho_presets) ? meta.psycho_presets as string[] : [],
    creativeVectorId:  typeof prevOutputs['last_creative_vector'] === 'string'
                         ? prevOutputs['last_creative_vector'] : undefined,
    tensionId:         typeof prevOutputs['last_tension'] === 'string'
                         ? prevOutputs['last_tension'] : undefined,
    aggroId:           typeof prevOutputs['last_aggro'] === 'string'
                         ? prevOutputs['last_aggro'] : undefined,
    utmContent:        seqCtx?.utm_content ?? undefined,
  };

  const result = await executeEmailSequenceStage(
    copyLabOutput,
    pieceMeta,
    sequenceIdFromPrev ?? undefined,
  );

  if (result.sequenceId) {
    prevOutputs['sequence_id'] = result.sequenceId;
  }

  return result.summary;
}
