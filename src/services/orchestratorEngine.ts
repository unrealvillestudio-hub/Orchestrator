/**
 * UNRLVL — Orchestrator Engine v2.2
 *
 * v2.2 changelog (2026-05-18):
 * - types.ts: LabId += 'klaviyo', FlowObjective += 'email_sequence', InterpretResult += sequence_type/context
 * - executeStage(): labId === 'klaviyo' → usesequenceBridge handler
 * - sequenceId propagado entre stages del mismo email_sequence flow
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
} from '../core/types';

const SB_URL = (import.meta as any).env.VITE_SUPABASE_URL as string;
const SB_KEY = (import.meta as any).env.VITE_SUPABASE_ANON_KEY as string;

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
        order: 2, labId: 'sociallab', label: 'Programar post',
        description: 'Encolar en SocialLab', requiresApproval: false,
        estimatedSeconds: 2, mockOutput: 'Post encolado.',
      },
    ],
    complianceFlags:  [],
    dbVariablesKeys:  [],
    confidence:       0.4,
    sequence_type:    null,
    sequence_context: null,
  };
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

  // Klaviyo: handler especial — parse + Supabase write + EF deploy
  if (stage.labId === 'klaviyo') {
    return executeKlaviyoStage(stage, options);
  }

  // Labs estándar: fetch al endpoint del lab
  const configs = await getLabConfigs();
  const config  = configs.find(c => c.lab_key === stage.labId);

  if (!config) {
    return `[${stage.labId.toUpperCase()}] Lab no conectado. Configura el endpoint en Supabase lab_configs.`;
  }

  const endpoint = `${config.api_endpoint}${config.execute_path}`;
  const meta     = (options.stageMeta ?? {}) as Record<string, unknown>;
  const seqCtx   = options.sequenceContext ?? null;

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
          canal:              meta.canal ?? 'email',
          idioma:             meta.language,
          extra_instructions: stage.description,
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
        },
        previousOutputs: options.previousOutputs ?? {},
      }),
    });

    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    const data = await res.json() as { output?: string; error?: string };
    if (data.error) throw new Error(data.error);
    return data.output ?? 'Stage completado sin output.';

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[OrchestratorEngine] executeStage (${stage.labId}):`, msg);
    return `Error ejecutando ${stage.labId}: ${msg}`;
  }
}

// ── KLAVIYO STAGE HANDLER ─────────────────────────────────────────────────────

async function executeKlaviyoStage(
  stage: FlowStage,
  options: ExecuteStageOptions,
): Promise<string> {
  const brandId    = options.brandId ?? '';
  const meta       = (options.stageMeta ?? {}) as Record<string, unknown>;
  const seqCtx     = options.sequenceContext ?? null;
  const prevOutputs = options.previousOutputs ?? {};

  // Output de CopyLab: buscar en previousOutputs
  const copyLabOutput =
    prevOutputs[`copylab_${meta.position}_${meta.language}`]
    ?? prevOutputs['copylab_output']
    ?? (Object.values(prevOutputs).find(v => typeof v === 'string' && v.includes('---SUBJECT---')))
    ?? '';

  if (!copyLabOutput) {
    return `[KLAVIYO] Error: output de CopyLab no encontrado. Keys: ${Object.keys(prevOutputs).join(', ')}`;
  }

  const sequenceIdFromPrev = prevOutputs['sequence_id'] ?? null;

  // Sequence awareness: leer mechanism de la pieza anterior
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

  // Propagar sequence_id para el siguiente stage
  if (result.sequenceId) {
    prevOutputs['sequence_id'] = result.sequenceId;
  }

  return result.summary;
}
