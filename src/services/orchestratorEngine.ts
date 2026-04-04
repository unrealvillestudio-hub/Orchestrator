/**
 * UNRLVL — Orchestrator Engine v2.0
 *
 * v2.0 changelog (Sprint Orchestrator Launch):
 * - interpretPrompt(): Gemini client-side → /api/interpret-intent (Claude server-side)
 * - executeStage(): mock → fetch real a lab endpoint leído de Supabase lab_configs
 * - Sin VITE_GEMINI_API_KEY — eliminada
 *
 * v1.2 changelog:
 * - Humanize layer (F2.5): getHumanizeProfile() inyectado en INTERPRET_SYSTEM_PROMPT
 *
 * Env vars requeridas:
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY
 */

import { InterpretResult, FlowStage, PlatformId, FlowObjective } from '../core/types';

const SB_URL = (import.meta as any).env.VITE_SUPABASE_URL as string;
const SB_KEY = (import.meta as any).env.VITE_SUPABASE_ANON_KEY as string;

// ── LAB CONFIG (desde Supabase) ───────────────────────────────────────────────

interface LabConfig {
  lab_key: string;        // camelCase shortcode — coincide con stage.labId (copylab, imagelab...)
  api_endpoint: string;   // base URL del lab, ej: https://unrlvl-copy-lab.vercel.app
  execute_path: string;   // path del endpoint, ej: /api/execute
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
    interpretedIntent: 'No se pudo interpretar el prompt con precisión. Revisa la selección de marca y plataformas.',
    suggestedStages: [
      { order: 1, labId: 'copylab',   label: 'Generar copy',   description: 'Generar texto para el post', requiresApproval: true,  estimatedSeconds: 8,  mockOutput: 'Copy generado por CopyLab.' },
      { order: 2, labId: 'imagelab',  label: 'Generar imagen', description: 'Crear imagen para el post',  requiresApproval: true,  estimatedSeconds: 15, mockOutput: 'Imagen generada por ImageLab.' },
      { order: 3, labId: 'sociallab', label: 'Programar post', description: 'Encolar en SocialLab',       requiresApproval: false, estimatedSeconds: 2,  mockOutput: 'Post encolado.' },
    ],
    complianceFlags: [],
    dbVariablesKeys: [],
    confidence: 0.4,
  };
}

// ── PUBLIC: EXECUTE STAGE ─────────────────────────────────────────────────────

export interface ExecuteStageOptions {
  brandId?: string | null;
  previousOutputs?: Record<string, string>;  // stageId → output (para contexto encadenado)
}

export async function executeStage(
  stage: FlowStage,
  options: ExecuteStageOptions = {}
): Promise<string> {
  const configs = await getLabConfigs();
  const config  = configs.find(c => c.lab_key === stage.labId);

  if (!config) {
    // Lab no tiene endpoint configurado todavía
    return `[${stage.labId.toUpperCase()}] Lab no conectado aún. Configura el endpoint en Supabase lab_configs.`;
  }

  const endpoint = `${config.api_endpoint}${config.execute_path}`;

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
        params:          config.default_params ?? {},
        previousOutputs: options.previousOutputs ?? {},
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
