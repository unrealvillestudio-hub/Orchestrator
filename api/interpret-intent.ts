/**
 * UNRLVL — Orchestrator /api/interpret-intent
 *
 * Reemplaza callGemini() client-side.
 * Recibe un prompt de usuario → devuelve InterpretResult JSON via Claude server-side.
 *
 * Env vars requeridas:
 *   ANTHROPIC_API_KEY
 *   VITE_SUPABASE_URL  (para cargar brand list desde Supabase)
 *   VITE_SUPABASE_ANON_KEY
 */

// Edge Runtime: declarar process para acceso a env vars sin @types/node
declare const process: { env: Record<string, string | undefined> };

export const config = { runtime: 'edge' };

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

// Humanize philosophy (inline — en producción leer desde Supabase humanize_profiles DEFAULT)
const HUMANIZE_PHILOSOPHY = `FILOSOFÍA DE PRODUCCIÓN UNRLVL — HUMANIZE (F2.5):
Todo output debe sentirse hecho por humanos para humanos.
Copy: conversacional, directo, sin jerga corporativa ni anglicismos innecesarios.
Imagen/Video: composición real, no stock genérico.
Voz: natural, con pausas, sin ritmo de síntesis.`;

const SYSTEM_PROMPT = (brandList: string) => `Eres el motor de interpretación del Orchestrator de UNRLVL Studio.
Tu trabajo es analizar el prompt del usuario y devolver un JSON estructurado con el plan de flujo.

MARCAS DISPONIBLES:
${brandList}

PLATAFORMAS DISPONIBLES: INSTAGRAM, FACEBOOK, TIKTOK, YOUTUBE, LINKEDIN, THREADS

LABS DISPONIBLES (en orden lógico de flujo):
- blueprintlab: crear o seleccionar blueprints de persona/locación
- copylab: generar copy (captions, scripts, ads, emails)
- imagelab: generar imágenes
- videolab: generar video o guión visual
- voicelab: generar audio/voz
- sociallab: programar y publicar en redes
- weblab: generar copy para web/landing/ecommerce

OBJETIVOS POSIBLES: social_post, ad_campaign, product_launch, landing_page, brand_content, ecommerce_listing

${HUMANIZE_PHILOSOPHY}

Devuelve SOLO JSON válido, sin markdown, sin explicaciones. Formato exacto:
{
  "brandId": "string | null",
  "platforms": ["INSTAGRAM"],
  "objective": "social_post",
  "interpretedIntent": "Descripción clara en español de lo que el usuario quiere lograr (2-3 frases)",
  "suggestedStages": [
    {
      "order": 1,
      "labId": "copylab",
      "label": "Generar copy del post",
      "description": "Descripción específica de qué hace este paso",
      "requiresApproval": true,
      "estimatedSeconds": 8,
      "mockOutput": "Ejemplo corto de output que este paso generaría"
    }
  ],
  "complianceFlags": ["string"],
  "dbVariablesKeys": ["persona_X"],
  "confidence": 0.92
}

REGLAS:
- requiresApproval: true para copy final, imágenes, video. false para pasos técnicos previos.
- Incluye blueprintlab como primer paso si se menciona una persona o marca con persona real (PO, Patricia).
- Si hay compliance relevante (productos ingeribles, cosméticos, claims de salud) añádelo a complianceFlags.
- dbVariablesKeys: menciona los brand_id relevantes y configuraciones que se usarían.
- estimatedSeconds: estimación realista por etapa (copylab ~8s, imagelab ~15s, videolab ~20s).
- Máximo 6 etapas por flujo.
- brandId debe ser el ID canónico de Supabase (camelCase, ej: NeuroneSCF, DiamondDetails).`;

async function fetchBrands(supabaseUrl: string, supabaseKey: string): Promise<string> {
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/brands?select=id,name,market,status&status=eq.active`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    if (!res.ok) throw new Error('Supabase brands fetch failed');
    const brands: Array<{ id: string; name: string; market: string }> = await res.json();
    return brands.map(b => `${b.id} (${b.name}, ${b.market})`).join('\n');
  } catch {
    // Fallback lista canónica
    return [
      'NeuroneSCF (Neurone South & Central Florida, Miami FL)',
      'PatriciaOsorioPersonal (Patricia Osorio · Personal, Miami FL)',
      'PatriciaOsorioComunidad (Patricia Osorio · Comunidad, Miami FL)',
      'PatriciaOsorioVizosSalon (Patricia Osorio · Vizos Salon, Miami FL)',
      'DiamondDetails (Diamond Details, Alicante España)',
      'D7Herbal (D7 Herbal, Alicante España)',
      'VivoseMask (Vivose Mask, España)',
      'VizosCosmetics (Vizos Cosmetics, Miami + España)',
      'ForumPHs (ForumPHs, Panamá)',
      'UnrealvilleStudio (Unrealville Studio, Florida USA)',
      'UnrealvilleStores (Unrealville Stores, Florida USA)',
    ].join('\n');
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? '';
  const supabaseUrl  = process.env.VITE_SUPABASE_URL ?? '';
  const supabaseKey  = process.env.VITE_SUPABASE_ANON_KEY ?? '';

  if (!anthropicKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }), { status: 500 });
  }

  let body: { prompt?: string };
  try { body = await req.json(); } catch { body = {}; }

  const userPrompt = body.prompt?.trim();
  if (!userPrompt) {
    return new Response(JSON.stringify({ error: 'prompt is required' }), { status: 400 });
  }

  const brandList = await fetchBrands(supabaseUrl, supabaseKey);

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      temperature: 0.3,
      system: SYSTEM_PROMPT(brandList),
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!anthropicRes.ok) {
    const err = await anthropicRes.text();
    return new Response(JSON.stringify({ error: `Anthropic API error: ${anthropicRes.status}`, detail: err }), { status: 500 });
  }

  const data = await anthropicRes.json();
  const raw  = data.content?.[0]?.text ?? '{}';
  const clean = raw.replace(/```json|```/g, '').trim();

  return new Response(clean, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
