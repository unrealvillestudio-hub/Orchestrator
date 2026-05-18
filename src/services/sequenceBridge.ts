/**
 * sequenceBridge.ts — Orchestrator v2.2
 * 
 * Task 1: Parsea el output de CopyLab (markers ---SUBJECT--- etc.) y lo envía a Klaviyo
 * Task 2: Escribe cada pieza generada en content_sequence_pieces antes de deployar
 * 
 * Flujo:
 *   CopyLab output (raw text con markers)
 *     → parseEmailOutput()       → { subject, preview, body, cta }
 *     → initSequenceRun()        → sequence_id (crea/rota en content_sequences)
 *     → writeSequencePiece()     → guarda en content_sequence_pieces (status: ready)
 *     → deployToKlaviyo()        → llama EF klaviyo-templates-v2
 *     → markPieceDeployed()      → actualiza status a 'deployed'
 */

const SB_URL = (import.meta as any).env.VITE_SUPABASE_URL as string;
const SB_KEY = (import.meta as any).env.VITE_SUPABASE_ANON_KEY as string;

const SB_HEADERS = {
  'Content-Type': 'application/json',
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
};

// ── TIPOS ──────────────────────────────────────────────────────────────────

export interface ParsedEmailPiece {
  subject: string;
  preview: string;
  body: string;
  cta: string;
  raw: string;
}

export interface SequencePieceMeta {
  sequenceType: string;    // 'abandoned_cart' | 'welcome' | etc.
  position: number;        // 1 = Cart A, 2 = Cart B
  language: string;        // 'ES' | 'EN'
  brandId: string;
  klaviyoTemplateId?: string;
  personaKey?: string;
  mechanismPrimary?: string;
  psychoPresets?: string[];
  creativeVectorId?: string;
  tensionId?: string;
  aggroId?: string;
  utmContent?: string;
}

// ── PARSER ─────────────────────────────────────────────────────────────────

export function parseEmailOutput(raw: string): ParsedEmailPiece {
  const extract = (marker: string, nextMarker: string): string => {
    const start = raw.indexOf(`---${marker}---`);
    if (start === -1) return '';
    const contentStart = start + `---${marker}---`.length;
    const end = nextMarker ? raw.indexOf(`---${nextMarker}---`, contentStart) : raw.length;
    return (end === -1 ? raw.slice(contentStart) : raw.slice(contentStart, end)).trim();
  };

  return {
    subject:  extract('SUBJECT', 'PREVIEW'),
    preview:  extract('PREVIEW', 'BODY'),
    body:     extract('BODY', 'CTA'),
    cta:      extract('CTA', 'END'),
    raw,
  };
}

// ── SEQUENCE MANAGEMENT ────────────────────────────────────────────────────

/**
 * Inicia un nuevo run de secuencia.
 * Rota la secuencia anterior a is_current=false.
 * Devuelve el nuevo sequence_id.
 */
export async function initSequenceRun(
  brandId: string,
  sequenceType: string,
  language: string,
): Promise<string | null> {
  try {
    // Llamar a la función Postgres que rota y crea la nueva secuencia
    const res = await fetch(
      `${SB_URL}/rest/v1/rpc/rotate_sequence_current`,
      {
        method: 'POST',
        headers: SB_HEADERS,
        body: JSON.stringify({
          p_brand_id: brandId,
          p_sequence_type: sequenceType,
          p_language: language,
        }),
      }
    );
    if (!res.ok) {
      console.error('[sequenceBridge] initSequenceRun failed:', await res.text());
      return null;
    }
    const uuid = await res.json(); // la función RETURNS UUID directamente
    return typeof uuid === 'string' ? uuid : null;
  } catch (err) {
    console.error('[sequenceBridge] initSequenceRun error:', err);
    return null;
  }
}

/**
 * Lee el mechanism_primary de la pieza anterior en la secuencia actual.
 * Usado por Cart B para verificar que su mecanismo es diferente al de Cart A.
 */
export async function getPreviousMechanism(
  sequenceId: string,
  position: number,
  language: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/content_sequence_pieces?sequence_id=eq.${sequenceId}&position=eq.${position - 1}&language=eq.${language}&select=mechanism_primary&limit=1`,
      { headers: SB_HEADERS }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data[0]?.mechanism_primary ?? null;
  } catch {
    return null;
  }
}

/**
 * Escribe una pieza generada en content_sequence_pieces.
 * Llamar ANTES de deployar a Klaviyo.
 */
export async function writeSequencePiece(
  sequenceId: string,
  piece: ParsedEmailPiece,
  meta: SequencePieceMeta,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/content_sequence_pieces`,
      {
        method: 'POST',
        headers: { ...SB_HEADERS, Prefer: 'return=representation' },
        body: JSON.stringify({
          sequence_id:          sequenceId,
          position:             meta.position,
          language:             meta.language,
          klaviyo_template_id:  meta.klaviyoTemplateId ?? null,
          subject:              piece.subject,
          preview_text:         piece.preview,
          body_html:            piece.body,
          cta_text:             piece.cta,
          psycho_presets:       meta.psychoPresets ?? [],
          mechanism_primary:    meta.mechanismPrimary ?? null,
          creative_vector_id:   meta.creativeVectorId ?? null,
          tension_id:           meta.tensionId ?? null,
          aggro_id:             meta.aggroId ?? null,
          qa_passed:            false, // se marca true después de QA
          status:               'ready',
          generated_by:         'claude_orchestrator',
        }),
      }
    );
    if (!res.ok) {
      console.error('[sequenceBridge] writeSequencePiece failed:', await res.text());
      return null;
    }
    const data = await res.json();
    return Array.isArray(data) ? data[0]?.id : data?.id ?? null;
  } catch (err) {
    console.error('[sequenceBridge] writeSequencePiece error:', err);
    return null;
  }
}

/**
 * Deploya una pieza a Klaviyo vía la EF klaviyo-templates-v2.
 */
export async function deployToKlaviyo(
  templateId: string,
  piece: ParsedEmailPiece,
  brandId: string,
): Promise<boolean> {
  try {
    // EF klaviyo-templates-v2 en Supabase
    const efUrl = `${SB_URL}/functions/v1/klaviyo-templates-v2`;
    const res = await fetch(efUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SB_KEY}`,
      },
      body: JSON.stringify({
        brand_id:    brandId,
        template_id: templateId,
        subject:     piece.subject,
        preview_text: piece.preview,
        html_body:   piece.body,
        cta_text:    piece.cta,
      }),
    });
    if (!res.ok) {
      console.error('[sequenceBridge] deployToKlaviyo failed:', await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('[sequenceBridge] deployToKlaviyo error:', err);
    return false;
  }
}

/**
 * Marca una pieza como deployed en Supabase.
 */
export async function markPieceDeployed(pieceId: string): Promise<void> {
  try {
    await fetch(
      `${SB_URL}/rest/v1/content_sequence_pieces?id=eq.${pieceId}`,
      {
        method: 'PATCH',
        headers: SB_HEADERS,
        body: JSON.stringify({
          status:       'deployed',
          qa_passed:    true,
          deployed_at:  new Date().toISOString(),
        }),
      }
    );
  } catch (err) {
    console.error('[sequenceBridge] markPieceDeployed error:', err);
  }
}

/**
 * Marca la sequence completa como deployed.
 */
export async function markSequenceDeployed(sequenceId: string): Promise<void> {
  try {
    await fetch(
      `${SB_URL}/rest/v1/content_sequences?id=eq.${sequenceId}`,
      {
        method: 'PATCH',
        headers: SB_HEADERS,
        body: JSON.stringify({ status: 'deployed' }),
      }
    );
  } catch (err) {
    console.error('[sequenceBridge] markSequenceDeployed error:', err);
  }
}

// ── ORQUESTADOR PRINCIPAL ──────────────────────────────────────────────────

/**
 * executeEmailSequenceStage
 * 
 * Reemplaza executeStage() cuando labId === 'klaviyo' en un flow de email_sequence.
 * 
 * Recibe:
 *   - copyLabOutput: el output raw de CopyLab (con markers)
 *   - meta: contexto de la pieza (tipo, posición, idioma, klaviyo IDs, etc.)
 * 
 * Ejecuta:
 *   1. Parse del output
 *   2. Init/get sequence_id (si es position 1, inicia nuevo run)
 *   3. Write a content_sequence_pieces
 *   4. Deploy a Klaviyo
 *   5. Mark as deployed
 * 
 * Devuelve: resumen del resultado para el flow del Orchestrator
 */
export async function executeEmailSequenceStage(
  copyLabOutput: string,
  meta: SequencePieceMeta,
  sequenceIdOverride?: string, // para pasar el mismo ID entre piezas del mismo run
): Promise<{
  success: boolean;
  sequenceId: string | null;
  pieceId: string | null;
  parsed: ParsedEmailPiece | null;
  summary: string;
}> {
  // 1. Parse
  const parsed = parseEmailOutput(copyLabOutput);

  if (!parsed.subject || !parsed.body) {
    return {
      success: false,
      sequenceId: null,
      pieceId: null,
      parsed: null,
      summary: `Parse fallido — no se encontraron markers en el output de CopyLab. Output: ${copyLabOutput.slice(0, 200)}`,
    };
  }

  // 2. Sequence ID
  let sequenceId = sequenceIdOverride ?? null;
  if (!sequenceId && meta.position === 1) {
    sequenceId = await initSequenceRun(meta.brandId, meta.sequenceType, meta.language);
    if (!sequenceId) {
      return {
        success: false, sequenceId: null, pieceId: null, parsed,
        summary: 'No se pudo crear la secuencia en Supabase.',
      };
    }
  }

  if (!sequenceId) {
    return {
      success: false, sequenceId: null, pieceId: null, parsed,
      summary: 'position > 1 pero no se recibió sequenceId. Necesario para sequence_awareness.',
    };
  }

  // 3. Write a content_sequence_pieces
  const pieceId = await writeSequencePiece(sequenceId, parsed, meta);
  if (!pieceId) {
    console.warn('[sequenceBridge] Pieza no escrita en Supabase — continuando con deploy');
  }

  // 4. Deploy a Klaviyo (si tiene template ID)
  let deployed = false;
  if (meta.klaviyoTemplateId) {
    deployed = await deployToKlaviyo(meta.klaviyoTemplateId, parsed, meta.brandId);
  }

  // 5. Mark deployed
  if (pieceId && deployed) {
    await markPieceDeployed(pieceId);
  }

  return {
    success: deployed || !!pieceId,
    sequenceId,
    pieceId,
    parsed,
    summary: [
      `Pieza ${meta.position} ${meta.language} — ${meta.sequenceType}`,
      `Subject: "${parsed.subject}"`,
      pieceId ? `✅ Guardada en Supabase (${pieceId.slice(0, 8)}...)` : '⚠️ No guardada en Supabase',
      deployed ? `✅ Deployada en Klaviyo (${meta.klaviyoTemplateId})` : `⚠️ No deployada — template ID: ${meta.klaviyoTemplateId ?? 'no definido'}`,
    ].join(' | '),
  };
}
