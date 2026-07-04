/**
 * api/interpret-intent.ts — Orchestrator v2.2
 * Cambios v2.2 (2026-07-04):
 * - model ID retirado (claude-sonnet-4-20250514, retirado abr-2026) → claude-sonnet-5.
 *   El endpoint fallaba en cada llamada (404 de modelo retirado) y caía siempre al
 *   fallback confidence:0.3. Fix quirúrgico: solo el model ID; system prompt y lógica intactos.
 * Cambios v2.1 (2026-05-18):
 * - Nuevo objective: 'email_sequence' con sub-types
 * - Lab 'klaviyo' reconocido como stage destino de email sequences
 * - sequence_context: datos de la secuencia para sequence awareness en CopyLab
 * - Motor: Claude API via fetch directo (sin SDK — consistente con el stack)
 */

declare const process: { env: Record<string, string | undefined> };

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';

// Normalize SUPABASE_URL — tolerates bare project ref, bare hostname, or
// full URL. See trigger-job.ts for the full explanation.
function normalizeSupabaseUrl(raw: string | undefined): string {
  if (!raw) return '';
  const s = raw.trim().replace(/\/+$/, '');
  if (!s) return '';
  if (s.startsWith('https://') || s.startsWith('http://')) return s;
  if (s.includes('.supabase.co')) return `https://${s}`;
  if (/^[a-z]{20}$/.test(s)) return `https://${s}.supabase.co`;
  return s;
}
const SB_URL = () => normalizeSupabaseUrl(process.env.SUPABASE_URL);
const SB_KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const INTERPRET_SYSTEM_PROMPT = `Eres el motor de interpretación del Orchestrator de Unreal>ille Studio.

Tu trabajo: analizar el prompt del usuario y devolver un JSON estructurado que describa el flujo de labs a ejecutar.

OBJECTIVES DISPONIBLES:
- social_post: post orgánico para redes sociales
- ad_copy: copy para ads (Meta, TikTok, Google)
- product_description: ficha de producto para Shopify
- blog_article: artículo SEO
- landing_page: landing page de campaña
- youtube_script: script para YouTube
- email_sequence: secuencia de emails para Klaviyo (abandoned_cart | welcome | post_purchase | review_request | win_back)
- brand_kit: kit completo de copy de marca

LABS DISPONIBLES (en orden de pipeline):
- copylab: genera copy. Para email_sequence usar pack email_sequence_[type] con motor Claude
- imagelab: genera imágenes
- sociallab: programa posts en redes sociales
- klaviyo: deposita emails en Klaviyo (SOLO para email_sequence)
- weblab: genera páginas web

REGLAS:
1. Para email_sequence: flow siempre es copylab → klaviyo
2. sequence_type es obligatorio cuando objective = email_sequence
3. Si el prompt menciona persona/segmento o UTM, incluirlo en sequence_context

FORMATO DE RESPUESTA (JSON puro, sin markdown):
{
  "brandId": "NeuroneSCF" | null,
  "platforms": ["EMAIL"] | ["INSTAGRAM", "FACEBOOK"] | etc,
  "objective": "email_sequence" | "social_post" | etc,
  "sequence_type": "abandoned_cart" | "welcome" | "post_purchase" | "review_request" | null,
  "sequence_context": {
    "persona_key": "b2c_color_fade" | "b2c_default" | null,
    "language": ["ES", "EN"] | ["ES"] | ["EN"],
    "utm_content": "color-fade" | null,
    "klaviyo_template_ids": null
  },
  "interpretedIntent": "descripción en una línea de lo que se va a generar",
  "suggestedStages": [
    {
      "order": 1,
      "labId": "copylab",
      "label": "Generar email sequence",
      "description": "Pack email_sequence_abandoned_cart — motor Claude",
      "requiresApproval": true,
      "estimatedSeconds": 30,
      "pack_id": "email_sequence_abandoned_cart"
    },
    {
      "order": 2,
      "labId": "klaviyo",
      "label": "Depositar en Klaviyo",
      "description": "Actualizar templates via EF klaviyo-templates-v2",
      "requiresApproval": false,
      "estimatedSeconds": 5
    }
  ],
  "complianceFlags": [],
  "dbVariablesKeys": ["brand_personas", "humanize_profiles", "compliance_rules"],
  "confidence": 0.9
}`;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { prompt?: string; brand_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const userPrompt = body.prompt?.trim();
  if (!userPrompt) {
    return new Response(JSON.stringify({ error: 'prompt is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Cargar brand IDs válidos desde Supabase
  let brandList = '';
  try {
    const sbRes = await fetch(
      `${SB_URL()}/rest/v1/brands?select=id,display_name&status=eq.active`,
      { headers: { apikey: SB_KEY() } }
    );
    if (sbRes.ok) {
      const brands = await sbRes.json() as Array<{id: string; display_name: string}>;
      brandList = brands.map(b => `${b.id} (${b.display_name})`).join(', ');
    }
  } catch { /* no bloqueamos si falla */ }

  // Si llega brand_id, intentamos enriquecer con brand_cache_snapshots para que
  // Haiku/Sonnet genere descriptions de stages más alineados con la marca.
  // Fallback silencioso si no existe snapshot — el flujo sigue funcionando igual.
  let brandContextHint = '';
  if (body.brand_id) {
    try {
      const sbCacheRes = await fetch(
        `${SB_URL()}/rest/v1/brand_cache_snapshots?brand_id=eq.${encodeURIComponent(body.brand_id)}&select=voice,persona,tone,benefits,icp,snapshot&order=created_at.desc&limit=1`,
        { headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}` } }
      );
      if (sbCacheRes.ok) {
        const rows = await sbCacheRes.json() as Array<Record<string, unknown>>;
        if (rows.length) {
          const row = rows[0];
          const snap = row.snapshot ?? row;
          brandContextHint = `\n\nCONTEXTO DE MARCA (${body.brand_id}) — usar para precisar descriptions de stages:\n${JSON.stringify(snap).slice(0, 1200)}`;
        }
      }
    } catch { /* fallback silencioso */ }
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1024,
        system: INTERPRET_SYSTEM_PROMPT
          + (brandList ? `\n\nBRANDS VÁLIDAS — ÚNICOS IDs permitidos para brandId: ${brandList}. Si el prompt no menciona ninguna explícitamente, usa brandId: null. NUNCA inventes un brand_id que no esté en esta lista.` : '')
          + brandContextHint,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`);

    const data = await response.json();
    const rawText = data.content?.[0]?.type === 'text' ? data.content[0].text : '';

    const cleaned = rawText
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    const parsed = JSON.parse(cleaned);

    // Inyectar userPrompt como description en el stage de copylab
    if (Array.isArray(parsed.suggestedStages)) {
      for (const stage of parsed.suggestedStages) {
        if (stage.labId === 'copylab') {
          stage.description = userPrompt;
        }
      }
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[interpret-intent] error:', err);
    return new Response(
      JSON.stringify({
        brandId: null,
        platforms: ['INSTAGRAM', 'FACEBOOK'],
        objective: 'social_post',
        sequence_type: null,
        sequence_context: null,
        interpretedIntent: 'No se pudo interpretar el prompt. Revisa la selección de marca y objetivo.',
        suggestedStages: [],
        complianceFlags: [],
        dbVariablesKeys: [],
        confidence: 0.3,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
