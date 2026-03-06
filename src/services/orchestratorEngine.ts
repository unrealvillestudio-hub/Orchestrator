/**
 * UNRLVL — Orchestrator Engine v1.2
 *
 * v1.2 changelog:
 * - Humanize layer (F2.5): getHumanizeProfile() inyectado en INTERPRET_SYSTEM_PROMPT
 *   El Orchestrator transmite la filosofía Humanize a los stages que planifica.
 *
 * v1.1 changelog:
 * - Fix: BRANDS is Record<BrandId,Brand> — use Object.values(BRANDS)
 * - Fix: b.displayName → b.name, b.industry → b.description
 */
import { InterpretResult, FlowStage, PlatformId, FlowObjective } from '../core/types';
import { BRANDS } from '../config/brands';
import { getHumanizeProfile } from '../config/humanizeConfig';

const GEMINI_MODEL = "gemini-2.0-flash";

// BRANDS is Record<BrandId, Brand> — must use Object.values()
const BRAND_LIST = Object.values(BRANDS)
  .map(b => `${b.id} (${b.name}, ${b.description}, ${b.market})`)
  .join("\n");

// ── HUMANIZE PHILOSOPHY SUMMARY (F2.5) ───────────────────────────────────────
// Usa perfil DEFAULT — cada Lab aplica su override de marca en su propio engine.
const _hp = getHumanizeProfile();
const HUMANIZE_PHILOSOPHY = `FILOSOFÍA DE PRODUCCIÓN UNRLVL — HUMANIZE (F2.5):
Todo output del ecosistema debe sentirse hecho por humanos para humanos.
Al planificar cada stage, los mockOutputs y descripciones deben reflejar esta filosofía:
- Copy: ${_hp.copy.split('\n')[0]}
- Imagen/Video: ${_hp.image.split('\n')[0]}
- Voz: ${_hp.voice.split('\n')[0]}
Los Labs individuales aplican las instrucciones completas de Humanize en sus engines.`;

// ── INTERPRET SYSTEM PROMPT ───────────────────────────────────────────────────
const INTERPRET_SYSTEM_PROMPT = `Eres el motor de interpretación del Orchestrator de UNRLVL Studio.
Tu trabajo es analizar el prompt del usuario y devolver un JSON estructurado con el plan de flujo.

MARCAS DISPONIBLES:
${BRAND_LIST}

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
  "platforms": ["INSTAGRAM", ...],
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
  "dbVariablesKeys": ["persona_X", "copy_tone_X"],
  "confidence": 0.92
}

REGLAS:
- requiresApproval: true para copy final, imágenes, video. false para pasos técnicos previos.
- Incluye blueprintlab como primer paso si se menciona una persona o marca con persona real.
- Si hay compliance relevante (productos ingeribles, cosméticos, claims de salud) añádelo a complianceFlags.
- dbVariablesKeys: menciona las claves de DB_VARIABLES que se usarían (persona blueprint id, copy tone, brand voice, etc).
- estimatedSeconds: estimación realista por etapa (copylab ~8s, imagelab ~15s, videolab ~20s).
- Máximo 6 etapas por flujo.`;

// ── GEMINI CALLER ─────────────────────────────────────────────────────────────
async function callGemini(prompt: string): Promise<string> {
  const apiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY ?? "";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          { role: "user",  parts: [{ text: INTERPRET_SYSTEM_PROMPT }] },
          { role: "model", parts: [{ text: "{" }] },
          { role: "user",  parts: [{ text: `PROMPT DEL USUARIO: "${prompt}"\n\nDevuelve el JSON completo:` }] },
        ],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1500 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
}

// ── PUBLIC: INTERPRET ─────────────────────────────────────────────────────────
export async function interpretPrompt(userPrompt: string): Promise<InterpretResult> {
  const raw       = await callGemini(userPrompt);
  const clean     = raw.replace(/```json|```/g, "").trim();
  const fullClean = clean.startsWith("{") ? clean : "{" + clean;

  try {
    const parsed = JSON.parse(fullClean);
    return {
      brandId:           parsed.brandId ?? null,
      platforms:         (parsed.platforms ?? ["INSTAGRAM", "FACEBOOK"]) as PlatformId[],
      objective:         (parsed.objective ?? "social_post") as FlowObjective,
      interpretedIntent: parsed.interpretedIntent ?? "Flujo de contenido personalizado",
      suggestedStages:   parsed.suggestedStages ?? [],
      complianceFlags:   parsed.complianceFlags ?? [],
      dbVariablesKeys:   parsed.dbVariablesKeys ?? [],
      confidence:        parsed.confidence ?? 0.8,
    };
  } catch {
    return {
      brandId: null,
      platforms: ["INSTAGRAM", "FACEBOOK"],
      objective: "social_post",
      interpretedIntent: "No se pudo interpretar el prompt con precisión. Revisa la selección de marca y plataformas.",
      suggestedStages: [
        { order: 1, labId: "copylab",   label: "Generar copy",   description: "Generar texto para el post", requiresApproval: true,  estimatedSeconds: 8,  mockOutput: "Copy de ejemplo generado." },
        { order: 2, labId: "imagelab",  label: "Generar imagen", description: "Crear imagen para el post",  requiresApproval: true,  estimatedSeconds: 15, mockOutput: "https://placehold.co/600x600/1a1a1a/FFAB00?text=Image+Preview" },
        { order: 3, labId: "sociallab", label: "Programar post", description: "Encolar en SocialLab",       requiresApproval: false, estimatedSeconds: 2,  mockOutput: "Post encolado para publicación." },
      ],
      complianceFlags: [],
      dbVariablesKeys: [],
      confidence: 0.4,
    };
  }
}

// ── STAGE EXECUTOR ────────────────────────────────────────────────────────────
const MOCK_OUTPUTS: Record<string, string[]> = {
  blueprintlab: [
    "Blueprint cargado: Patricia Osorio — Miami Personal Brand v1.2\nVoz: cálida, directa, bilingüe ES/EN\nCompliance: No claims médicos",
  ],
  copylab: [
    "✦ Hook: \"Lo que nadie te dice sobre el cuidado capilar en Miami...\"\n\n✦ Body: El calor, la humedad y el cloro de la piscina atacan tu cabello cada día. D7Herbal fue formulado específicamente para climas tropicales. Ingredientes botánicos que protegen sin pesar.\n\n✦ CTA: \"Pruébalo 30 días o te devolvemos tu dinero. Link en bio.\"",
    "✦ Hook: \"Tu carro merece el mismo cuidado que tú.\"\n\n✦ Body: En Diamond Details no solo limpiamos — protegemos. Recubrimiento cerámico certificado que repele agua, polvo y rayos UV por hasta 3 años.\n\n✦ CTA: \"Agenda tu cita esta semana. Plazas limitadas.\"",
  ],
  imagelab: [
    "Prompt enviado a Midjourney:\n\"Botanical hair product D7Herbal, miami tropical lifestyle, soft natural light, editorial photography, green and gold tones, premium feel --ar 1:1 --v 6\"\n\nImagen generada: preview disponible en output",
  ],
  videolab: [
    "Guión visual (15s Reel):\n00:00-00:03 — Close-up producto con gota de agua\n00:03-00:08 — Manos aplicando en cabello, cámara lenta\n00:08-00:13 — Resultado: cabello brillante, luz natural Miami\n00:13-00:15 — Logo + CTA overlay\n\nExportado a VideoLab queue.",
  ],
  voicelab: [
    "Script TTS generado (23 palabras):\n\"D7Herbal. Formulado para tu clima, diseñado para tu cabello. Botánica real, resultados reales.\"\n\nVoz: Patricia Osorio clone — sintetizado a 1.0x velocidad.",
  ],
  sociallab: [
    "Post encolado:\n📅 Programado: mañana 10:00 AM\n📍 Plataformas: Instagram, Facebook, TikTok\n🏷 Hashtags: #D7Herbal #CuidadoCapilar #MiamiHair\n✅ Status: scheduled",
  ],
  weblab: [
    "## Hero\nProtección botánica para el cabello que vive en Miami.\n\nEl sol, la sal y la humedad de Florida atacan tu cabello cada día. D7Herbal lo protege desde adentro con una fórmula 100% de origen vegetal.\n\n**[Compra ahora — envío gratis a partir de $35]**",
  ],
};

export async function executeStage(stage: FlowStage): Promise<string> {
  await new Promise(r => setTimeout(r, (stage.estimatedSeconds * 1000) * 0.6 + 800));
  const outputs = MOCK_OUTPUTS[stage.labId] ?? ["Paso completado correctamente."];
  return stage.mockOutput ?? outputs[Math.floor(Math.random() * outputs.length)];
}