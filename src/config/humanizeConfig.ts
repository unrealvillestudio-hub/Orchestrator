/**
 * UNRLVL — Humanize Layer v1.0 (F2.5)
 *
 * Filosofía: Todo output de UNRLVL debe sentirse hecho por humanos para humanos.
 * Esta capa se inyecta automáticamente en todos los engines. No es opcional.
 *
 * Flujo de resolución (fallback chain):
 *   BP_PERSON.humanize.[medio]  →  BRAND_HUMANIZE_OVERRIDES[brandId]  →  HUMANIZE_DEFAULTS
 *
 * Fuente de verdad: DB_VARIABLES pestaña HUMANIZE
 * Sync: cuando DB_VARIABLES cambie, actualizar BRAND_HUMANIZE_OVERRIDES abajo.
 */

// ── TYPES ─────────────────────────────────────────────────────────────────────

export type HumanizeMedium = 'copy' | 'image' | 'video' | 'voice' | 'web';

export interface HumanizeProfile {
  copy:  string;
  image: string;
  video: string;
  voice: string;
  web:   string;
}

export interface HumanizeBrandOverride {
  brandId: string;
  copy?:   string;
  image?:  string;
  video?:  string;
  voice?:  string;
  web?:    string;
}

// ── DEFAULTS (aplican a todas las marcas salvo override) ──────────────────────

export const HUMANIZE_DEFAULTS: HumanizeProfile = {

  copy: `
[HUMANIZE — COPY]
AUTENTICIDAD DE VOZ:
- Escribe como habla una persona real, no como un documento corporativo.
- Usa contracciones y coloquialismos naturales del mercado objetivo.
- Varía el ritmo: alterna frases cortas con frases más largas. No todas las frases tienen la misma cadencia.
- Usa puntuación expresiva cuando corresponde: puntos suspensivos para pausa, em-dash para énfasis, signos de exclamación solo cuando hay emoción real.
- Primera persona cuando sea posible. "Nosotros lo usamos" en vez de "Los usuarios utilizan".
PROHIBIDO (tells de AI):
- "En conclusión", "Es importante destacar", "Ciertamente", "Sin duda alguna", "En el dinámico mundo de"
- Listas de exactamente 3 puntos con el mismo largo. Listas de características en formato bullet cuando el copy debería fluir.
- Frases que empiezan con "Nuestro producto/servicio es..."
- Adjetivos vacíos: innovador, revolucionario, transformador, robusto, sinérgico.
- Párrafos perfectamente simétricos en longitud.
NATURALIDAD:
- Si algo tiene una desventaja real que el lector ya conoce, reconócela brevemente. Aumenta credibilidad.
- El CTA puede ser indirecto a veces. "Cuando estés listo, estamos aquí" es más humano que "¡Compra ahora!".
- Usa humor sutil si el tono de marca lo permite. No fuerces la seriedad.
`.trim(),

  image: `
[HUMANIZE — IMAGE / AVATAR]
PIEL Y RASGOS:
- Piel con textura real: poros visibles en primer plano, variación tonal sutil, ningún área uniformemente lisa.
- Asimetría facial natural: ninguna persona tiene el rostro perfectamente simétrico. Aplica micro-variaciones.
- Imperfecciones honestas: líneas de expresión donde corresponde por edad, marcas de sol leves en zonas de exposición.
- Ojos con catchlights naturales (no perfectamente centrados), venas sutiles en esclerótica si el primer plano es extremo.
CABELLO:
- Flyaways y mechones sueltos en la dirección del viento o movimiento.
- Variación de volumen: la raíz no tiene el mismo grosor que las puntas.
- Brillo en puntos de luz reales, no aplicado uniformemente.
EXPRESIÓN Y POSE:
- Micro-expresiones: el 0.1s antes y después de una sonrisa plena, no la sonrisa perfecta congelada.
- Pose con peso: el cuerpo cede a la gravedad. Hombros ligeramente asimétricos.
- Contacto visual no siempre directo al lente. Un 20% de tomas con mirada levemente descentrada o pensativa.
- Manos con postura natural: dedos ligeramente curvados en reposo, no extendidos perfectamente.
ROPA Y ENTORNO:
- Ropa con caída real: arrugas en codos, axilas, cintura donde el cuerpo las genera.
- Interacción con el entorno: cabello moviéndose con la brisa, sombras de objetos reales.
- Fondo con profundidad: elementos detrás del sujeto ligeramente fuera de foco, no perfectamente limpios.
PROHIBIDO:
- Piel de plástico o cera. Piel uniformemente lisa.
- Simetría facial perfecta.
- Poses de stock: brazos cruzados perfectos, sonrisa de dentífico congelada.
- Iluminación de estudio sin sombras naturales cuando el contexto es lifestyle o exterior.
- Ropa sin arrugas en poses donde las habría.
`.trim(),

  video: `
[HUMANIZE — VIDEO / MOTION]
MOVIMIENTO DE CÁMARA:
- Handheld implica micro-vibración orgánica, no movimiento de gimbal perfecto. 
- Dolly con leve aceleración al inicio y desaceleración al final, no lineal puro.
- El encuadre puede tener leve recomposición espontánea como si el camarógrafo ajustara.
PERSONAJES EN FRAME:
- Micro-movimientos entre tomas: una respiración visible en el pecho, un parpadeo, un ajuste sutil de postura.
- Ritmo de parpadeo natural: no sincronizado, aprox. 1 parpadeo cada 4-6 segundos.
- Gestos que acompañan la narrativa: la mano que se mueve antes de que la voz enfatice.
- Eyeline: no siempre directo al lente. En conversación, la mirada puede ir al interlocutor fuera de frame.
- Entre frases: micro-pausa con expresión de "estoy pensando qué sigue", no cara neutral congelada.
COMPOSICIÓN:
- Regla de tercios pero con intención: el sujeto no siempre centrado perfectamente.
- Elementos en primer plano ocasionales que enmarcan la escena (rama, borde de objeto).
- Profundidad de campo con transición suave, no corte duro entre nítido y fuera de foco.
CONTINUIDAD:
- Variación de ángulo entre cortes: al menos 30° de diferencia para evitar jump-cut antinatural.
- Iluminación que cambia levemente entre tomas del mismo espacio (nube que pasa, reflexión cambiante).
PROHIBIDO:
- Estabilización perfecta en contexto handheld/UGC.
- Personajes inmóviles como maniquíes entre líneas de diálogo.
- Encuadres de stock perfectamente centrados en todos los planos.
`.trim(),

  voice: `
[HUMANIZE — VOICE / AUDIO]
RESPIRACIÓN Y RITMO:
- Pausas de respiración naturales antes de frases largas y después de signos de puntuación.
- Micro-hesitaciones controladas (100-150ms) en transiciones de idea, como cuando el hablante recuerda el siguiente punto.
- Velocidad variable: más rápido en información secundaria, más lento en el mensaje clave.
ÉNFASIS Y EMOCIÓN:
- Coloración emocional genuina: la voz sube levemente en el hook, se asienta en el desarrollo, cierra con convicción.
- Énfasis prosódico en palabras clave, no en todas las palabras.
- Sonrisa audible en frases de cierre cuando el tono de marca lo permite.
IMPERFECCIONES CONTROLADAS:
- Leve variación de pitch entre frases (±5% natural, no monotonal robótico).
- Micro-textura en consonantes explosivas (p, t, k) — naturaleza del habla humana.
- Si el estilo es conversacional: alguna contracción de sílabas naturales del idioma.
PROHIBIDO:
- Cadencia uniforme de texto a voz sin variación.
- Pausas mecánicas de exactamente la misma duración.
- Énfasis en todas las frases por igual (todo importante = nada importante).
- Velocidad constante de inicio a fin.
`.trim(),

  web: `
[HUMANIZE — WEB ASSETS]
FOTOGRAFÍA E IMAGEN:
- Candid sobre staged cuando sea posible: personas en acción real, no posando.
- Luz natural imperfecta es preferible a iluminación de estudio uniforme para marcas lifestyle.
- Profundidad de escena: elementos de contexto real en el fondo (no fondos blancos infinitos salvo e-commerce de producto).
- Escala humana: manos, objetos del día a día en frame que dan proporción.
COPY EN WEB:
- Headlines conversacionales, no declaraciones corporativas.
- Párrafos cortos: máximo 3-4 líneas. El eye-scan en web es rápido.
- Segunda persona directa: "tú" o "usted" según la marca, no "los clientes" o "los usuarios".
- Microcopy de UI con personalidad: botones que dicen algo más que "Enviar" o "Comprar".
LAYOUT Y COMPOSICIÓN:
- Espaciado que respira: no llenar todos los espacios en blanco.
- Jerarquía tipográfica clara pero no rígida — variación de peso y tamaño con intención.
- Elementos asimétricos deliberados que rompen la retícula cuando hay algo importante que destacar.
TONO GENERAL:
- La marca tiene personalidad, no solo información. Cada sección web refleja el carácter de la marca.
- Errores honestos reconocidos cuando aplica (FAQ, política de devoluciones) en tono humano, no legal.
PROHIBIDO:
- Fotos de stock de personas mirando a cámara con sonrisa perfecta en entornos clínicamente limpios.
- Copy corporativo en tercera persona impersonal.
- UI microcopy genérico ("Submit", "Learn More", "Click Here").
- Grids perfectamente uniformes cuando la jerarquía de contenido requiere variación.
`.trim(),

};

// ── BRAND OVERRIDES (sincronizar con DB_VARIABLES pestaña HUMANIZE) ───────────
// Si una marca requiere parámetros específicos que sobreescriben el default,
// añadirlos aquí. Solo incluir los medios que difieren del default.

export const BRAND_HUMANIZE_OVERRIDES: HumanizeBrandOverride[] = [
  {
    brandId: "neuroneCosmetics",
    copy: `${HUMANIZE_DEFAULTS.copy}
NEURONECOSMÉTICA ESPECÍFICO:
- Tono científico-accesible: usa terminología técnica real pero explícala en la siguiente frase.
- Bilingüe natural ES/EN en mercado Miami: Spanglish controlado, no forzado.
- Compliance: nunca "cura", "trata", "elimina" — usa "ayuda a", "contribuye a", "favorece".
- B2C: emocional + técnico. B2B: técnico + ROI. Mismo producto, voz diferente.`,
  },
  {
    brandId: "patriciaOsorioVizosSalon",
    copy: `${HUMANIZE_DEFAULTS.copy}
VIZOS SALÓN ESPECÍFICO:
- Voz de autoridad cálida: Patricia habla como experta que también es tu amiga de confianza.
- Spanglish natural Miami: mezcla ES/EN como habla el mercado objetivo.
- Referencias a experiencia real de salón: el olor, el tacto, la transformación visible.`,
    image: `${HUMANIZE_DEFAULTS.image}
VIZOS VISUAL ESPECÍFICO:
- Entorno de salón real con imperfecciones de trabajo: toallas, productos abiertos, herramientas en uso.
- Patricia con manos activas: siempre haciendo algo, no posando estática.
- Clientas con expresiones de reacción auténtica (no posar post-transformación).`,
  },
  {
    brandId: "diamondDetails",
    copy: `${HUMANIZE_DEFAULTS.copy}
DIAMOND DETAILS ESPECÍFICO:
- Lenguaje de taller premium: técnico sin ser pedante, apasionado sin ser fanático.
- El auto no es un producto — es la extensión de la identidad del cliente. Trátalo así.
- Antes/después siempre implícito. El cliente visualiza su coche, no un coche genérico.`,
    image: `${HUMANIZE_DEFAULTS.image}
DIAMOND DETAILS VISUAL ESPECÍFICO:
- Reflejos en carrocería que muestren el entorno real del taller (no fondos perfectamente limpios).
- Manos del técnico en frame: guantes con rastros de trabajo real.
- Ángulos bajos que dan drama y escala al vehículo.`,
  },
  {
    brandId: "d7Herbal",
    copy: `${HUMANIZE_DEFAULTS.copy}
D7HERBAL ESPECÍFICO:
- Proximidad botánica: ingredientes con nombre real y origen (Açaí de Brasil, Espirulina de cultivo controlado).
- Compliance estricto: cosmético solo. Cero lenguaje médico. "Favorece", "contribuye", "ayuda a mantener".
- Tono wellness: cálido, natural, sin exageración.`,
  },
  {
    brandId: "vizosCosmetics",
    copy: `${HUMANIZE_DEFAULTS.copy}
VIZOS COSMETICS ESPECÍFICO:
- Registro profesional de laboratorio: el cliente es el estilista profesional, no el consumidor final.
- Hair Healing Systems como marco conceptual central.
- Evidencia técnica antes que beneficio emocional (al revés que en B2C).`,
  },
];

// ── RESOLVER ──────────────────────────────────────────────────────────────────

/**
 * Devuelve el bloque de instrucciones Humanize para un medio específico.
 * Aplica la cadena de fallback: bpPersonHumanize → brandOverride → default.
 *
 * @param medium       - Tipo de medio: 'copy' | 'image' | 'video' | 'voice' | 'web'
 * @param brandId      - ID de la marca (opcional, para brand overrides)
 * @param bpPersonOverride - Bloque humanize del BP_PERSON (opcional, máxima prioridad)
 */
export function getHumanizeBlock(
  medium: HumanizeMedium,
  brandId?: string,
  bpPersonOverride?: string,
): string {
  // 1. BP_PERSON override (máxima prioridad)
  if (bpPersonOverride?.trim()) return bpPersonOverride.trim();

  // 2. Brand override
  if (brandId) {
    const brandOverride = BRAND_HUMANIZE_OVERRIDES.find(b => b.brandId === brandId);
    if (brandOverride?.[medium]?.trim()) return brandOverride[medium]!.trim();
  }

  // 3. Default global
  return HUMANIZE_DEFAULTS[medium];
}

/**
 * Devuelve el perfil Humanize completo para una marca.
 * Útil para inyectar todos los medios de una vez (ej. en el Orchestrator).
 */
export function getHumanizeProfile(brandId?: string): HumanizeProfile {
  return {
    copy:  getHumanizeBlock('copy',  brandId),
    image: getHumanizeBlock('image', brandId),
    video: getHumanizeBlock('video', brandId),
    voice: getHumanizeBlock('voice', brandId),
    web:   getHumanizeBlock('web',   brandId),
  };
}
