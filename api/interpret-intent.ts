/**
 * api/interpret-intent.ts — Orchestrator v2.1
 * Cambios v2.1 (2026-05-18):
 * - Nuevo objective: 'email_sequence' con sub-types
 * - Lab 'klaviyo' reconocido como stage destino de email sequences
 * - sequence_context: datos de la secuencia para sequence awareness en CopyLab
 * - Motor: Claude API via fetch directo (sin SDK — consistente con el stack)
 */

const ANTHROPIC_API_KEY = (import.meta as any).env.ANTHROPIC_API_KEY as string;

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

  let body: { prompt?: string };
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

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: INTERPRET_SYSTEM_PROMPT,
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
