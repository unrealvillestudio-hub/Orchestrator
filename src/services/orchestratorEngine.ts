/**
 * UNRLVL — Orchestrator Engine v2.2
 *
 * v2.2 changelog (2026-05-18):
 * - executeStage(): cuando labId === 'klaviyo' → usa executeEmailSequenceStage de sequenceBridge
 * - Pasa sequenceId entre stages del mismo email_sequence flow
 * - meta del pack se propaga desde el stage al bridge
 * - Sequence awareness: Cart B recibe el sequenceId de Cart A en previousOutputs
 *
 * v2.1 changelog:
 * - Nuevo objective: 'email_sequence' con sub-types
 * - Lab 'klaviyo' reconocido como stage destino
 *
 * v2.0 changelog:
 * - interpretPrompt(): Gemini client-side → /api/interpret-intent (Claude server-side)
 * - executeStage(): mock → fetch real a lab endpoint desde Supabase lab_configs
 */

import {
  executeEmailSequenceStage,
  getPreviousMechanism,
  type SequencePieceMeta,
} from './sequenceBridge';
import { InterpretResult, FlowStage, PlatformId, FlowObjective } from '../core/types';

const SB_URL = (import.meta as any).env.VITE_SUPABASE_URL as string;
const SB_KEY = (import.meta as any).env.VITE_SUPABASE_ANON_KEY as string;

// ── LAB CONFIG (desde Supabase) ───────────────────────────────────────────────

interface LabConfig {
  lab_key: string;
  api_endpoint: string;
  execute_path: string;
  active: boolean;
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
    if (!res.ok) throw new Error(`lab_configs fetch failed: ${res.status}`);
    _labConfigsCache = await res.json();
    return _labConfigsCache!;
  } catch (err) {
    console.error('[OrchestratorEngine] lab_configs not available:', err);
    return [];
  }
}

// ── PUBLIC: INTERPRET ─────────────────────────────────────────────────────────

export async function interpretPrompt(userPrompt: string): Promise<InterpretResult> {
  const res = await fetch('/api/interpret-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: userPrompt }),
  });

  if (!res.ok) {
    console.error('[OrchestratorEngine] interpret-intent error:', res.status);
    return fallbackResult();
  }

  try {
    const parsed = await res.json();
    return {
      brandId:           parsed.brandId ?? null,
      platforms:         (parsed.platforms ?? ['INSTAGRAM', 'FACEBOOK']) as PlatformId[],
      objective:         (parsed.objective ?? 'social_post') as FlowObjective,
      interpretedIntent: parsed.interpretedIntent ?? 'Flujo de contenido personalizado',
      suggestedStages:   parsed.suggestedStages ?? [],
      complianceFlags:   parsed.complianceFlags ?? [],
      dbVariablesKeys:   parsed.dbVariablesKeys ?? [],
      confidence:        parsed.confidence ?? 0.8,
      // email_sequence campos adicionales
      sequence_type:     parsed.sequence_type ?? null,
      sequence_context:  parsed.sequence_context ?? null,
    };
  } catch {
    return fallbackResult();
  }
}

function fallbackResult(): InterpretResult {
  return {
    brandId: null,
    platforms: ['INSTAGRAM', 'FACEBOOK'],
    objective: 'social_post',
    interpretedIntent: 'No se pudo interpretar el prompt. Revisa la selección de marca.',
    suggestedStages: [
      { order: 1, labId: 'copylab', label: 'Generar copy', description: 'Generar texto', requiresApproval: true, estimatedSeconds: 8, mockOutput: 'Copy generado.' },
      { order: 2, labId: 'sociallab', label: 'Programar post', description: 'Encolar en SocialLab', requiresApproval: false, estimatedSeconds: 2, mockOutput: 'Post encolado.' },
    ],
    complianceFlags: [],
    dbVariablesKeys: [],
    confidence: 0.4,
    sequence_type: null,
    sequence_context: null,
  };
}

// ── PUBLIC: EXECUTE STAGE ─────────────────────────────────────────────────────

export interface ExecuteStageOptions {
  brandId?: string | null;
  previousOutputs?: Record<string, string>;
  // Campos adicionales para email_sequence
  sequenceType?: string;
  sequenceContext?: Record<string, any> | null;
  stageMeta?: Record<string, any>; // meta del pack (position, language, klaviyo IDs, etc.)
}

export async function executeStage(
  stage: FlowStage,
  options: ExecuteStageOptions = {}
): Promise<string> {

  // ── KLAVIYO STAGE: handler especial ───────────────────────────────────────
  if (stage.labId === 'klaviyo') {
    return executeKlaviyoStage(stage, options);
  }

  // ── LABS ESTÁNDAR: fetch al endpoint del lab ──────────────────────────────
  const configs = await getLabConfigs();
  const config  = configs.find(c => c.lab_key === stage.labId);

  if (!config) {
    return `[${stage.labId.toUpperCase()}] Lab no conectado. Configura el endpoint en Supabase lab_configs.`;
  }

  const endpoint = `${config.api_endpoint}${config.execute_path}`;
  const meta = options.stageMeta ?? {};

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brandId:         options.brandId ?? null,
        stage: {
          labId:       stage.labId,
          label:       stage.label,
          description: stage.description,
          order:       stage.order,
        },
        params: {
          pack:               meta.pack_id ?? config.default_params?.pack,
          canal:              meta.canal ?? 'email',
          idioma:             meta.language,
          extra_instructions: stage.description,
        },
        meta: {
          motor:            meta.motor ?? 'claude',
          sequence_type:    options.sequenceType ?? null,
          position:         meta.position ?? 1,
          language:         meta.language ?? 'ES',
          persona_key:      options.sequenceContext?.persona_key ?? null,
          psycho_presets:   meta.psycho_presets ?? [],
          mechanism_primary: meta.mechanism_primary ?? null,
          utm_content:      options.sequenceContext?.utm_content ?? null,
        },
        previousOutputs: {
          ...options.previousOutputs ?? {},
          // Pasar sequence_id al CopyLab para que pueda leer la pieza anterior
          sequence_id: options.previousOutputs?.sequence_id ?? undefined,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`${res.status}: ${errText}`);
    }

    const data: { output?: string; status?: string; error?: string } = await res.json();
    if (data.error) throw new Error(data.error);
    return data.output ?? 'Stage completado sin output.';

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[OrchestratorEngine] executeStage error (${stage.labId}):`, msg);
    return `Error ejecutando ${stage.labId}: ${msg}`;
  }
}

// ── KLAVIYO STAGE HANDLER ─────────────────────────────────────────────────────

async function executeKlaviyoStage(
  stage: FlowStage,
  options: ExecuteStageOptions,
): Promise<string> {
  const brandId = options.brandId ?? '';
  const meta = options.stageMeta ?? {};
  const seqCtx = options.sequenceContext ?? {};
  const prevOutputs = options.previousOutputs ?? {};

  // El output de CopyLab debe estar en previousOutputs con la key del stage anterior
  // Por convención: la key es el labId + '_' + position + '_' + language
  // O directamente 'copylab_output' si viene del stage inmediato anterior
  const copyLabOutput = prevOutputs[`copylab_${meta.position}_${meta.language}`]
    ?? prevOutputs['copylab_output']
    ?? Object.values(prevOutputs).find(v => v.includes('---SUBJECT---'))
    ?? '';

  if (!copyLabOutput) {
    return `[KLAVIYO] Error: no se encontró output de CopyLab en previousOutputs. Keys disponibles: ${Object.keys(prevOutputs).join(', ')}`;
  }

  // Sequence ID: viene de previousOutputs si fue creado en un stage anterior de este flow
  const sequenceIdFromPrev = prevOutputs['sequence_id'] ?? null;

  // Determinar el mechanism_primary de la pieza anterior si position > 1
  let previousMechanism = 'none';
  if (meta.position > 1 && sequenceIdFromPrev) {
    previousMechanism = await getPreviousMechanism(
      sequenceIdFromPrev,
      meta.position,
      meta.language
    ) ?? 'unknown';
  }

  const pieceMeta: SequencePieceMeta = {
    sequenceType:     options.sequenceType ?? 'generic',
    position:         meta.position ?? 1,
    language:         meta.language ?? 'ES',
    brandId,
    klaviyoTemplateId: meta.klaviyo_template_id ?? seqCtx.klaviyo_template_ids?.[meta.klaviyo_template_slot] ?? undefined,
    personaKey:       seqCtx.persona_key ?? null,
    mechanismPrimary: meta.mechanism_primary ?? null,
    psychoPresets:    meta.psycho_presets ?? [],
    creativeVectorId: prevOutputs['last_creative_vector'] ?? undefined,
    tensionId:        prevOutputs['last_tension'] ?? undefined,
    aggroId:          prevOutputs['last_aggro'] ?? undefined,
    utmContent:       seqCtx.utm_content ?? null,
  };

  const result = await executeEmailSequenceStage(
    copyLabOutput,
    pieceMeta,
    sequenceIdFromPrev ?? undefined,
  );

  // Guardar sequence_id en previousOutputs para el siguiente stage del mismo flow
  if (result.sequenceId) {
    prevOutputs['sequence_id'] = result.sequenceId;
  }

  return result.summary;
}
