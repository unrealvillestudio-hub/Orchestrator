/**
 * UNRLVL Orchestrator — api/manual-published.ts  (PUBLICACIÓN MANUAL · «Publicada»)
 *
 * Sam publicó a mano la pieza de una franja y lo dice aquí, con el link del post como prueba.
 * Deja el mismo rastro que deja el drenaje cuando publica:
 *   1. la franja → `published` (sólo si seguía `manual_pending` o `reserved`: no se pisa nada);
 *   2. la pieza  → `published`, con `published_at` y `post_url`;
 *   3. una fila `PUBLISHED` en `intel.brand_publish_drain_log` con el link en `platform_post_id`
 *      (es la que lee el resto del carril, y dispara el acuse `PUBLISH_OK`);
 *   4. el aviso `MANUAL_PUBLICATION_PENDING` de esa franja se cierra: «es lo único que lo cierra»
 *      decía su remediación, y marcar la pieza publicada es exactamente ese gesto;
 *   5. una fila en `public.scheduled_posts` — EL LIBRO QUE MANDA sobre estado final
 *      (`CAPABILITIES` v1.14) y la fuente contra la que resuelve `publication-reconciler`.
 *
 * EL PASO 5 FALTABA, y es el agujero que cierra (2026-10-25). Medido ese día sobre 30 días: de 129
 * piezas publicadas, 95 tenían su fila —las del empuje a meta— y 34 no: 31 de blog y 3 de aquí. Las
 * 34 SÍ tenían franja, así que el reconciliador no las declaraba inexplicadas: NO LAS VEÍA, y
 * respondía `OK` sobre dos tercios de lo que ocurre. Un punto ciego que contesta `OK` es peor que un
 * `HALT`, porque nadie va a mirar. La causa no fue un error de lógica: la fila se escribía sólo donde
 * alguien la iba a LEER —SocialLab drena `status=eq.pending_publish`—, y aquí no hay publicador que
 * la lea. Eso convierte el libro mayor en un buzón. La fila no es el recado: es el asiento.
 *
 * Sólo canales cuyo `publication_path` es manual. Una franja de un canal del drenaje no se marca
 * desde aquí: el drenaje la publicaría igual y saldría dos veces.
 *
 * POST /api/manual-published   { slot_id, link }
 *   Auth: admin JWT. 200 { ok, slot_id, piece_id, published_at, warnings[] }
 *   400 link inválido · 404 franja inexistente · 409 la franja ya no está pendiente o no es manual.
 */

import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, extractToken, SB_URL, SB_KEY } from './_calibrationShared.js';
// Quién puede usar este endpoint y sobre qué marcas: admin todo; un revisor, sólo las suyas.
import { requireReviewer, inReviewScope, denyOutOfScope } from './_reviewScope.js';
import { fetchWithTimeout } from './_fetchWithTimeout.js';
import { bookPlatformOf, cleanPostLink, manualBookRow, manualDrainRow, MARKABLE_SLOT_STATUSES } from './_manualShared.js';
import type { ManualPieceInput } from './_manualShared.js';

type Schema = 'intel' | 'content' | 'alerting' | 'public';

async function rest<T>(schema: Schema, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetchWithTimeout('db', `${SB_URL()}/rest/v1/${path}`, {
    method: init.method ?? 'GET',
    headers: {
      apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`,
      'Accept-Profile': schema, 'Content-Profile': schema,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const txt = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`${schema}/${path.split('?')[0]} ${res.status}: ${txt.slice(0, 200)}`);
  return (txt ? JSON.parse(txt) : []) as T;
}

interface SlotRow { id: string; brand_id: string; platform_key: string; slot_at: string; status: string; piece_id: string | null }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body: { slot_id?: string; link?: string; session_token?: string } = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); } catch { /* vacío */ }

  const session = await requireReviewer(req, res, extractToken(req, body), ['publish_manual']);
  if (!session) return;

  const slotId = typeof body.slot_id === 'string' ? body.slot_id.trim() : '';
  if (!/^[0-9a-f-]{36}$/i.test(slotId)) return res.status(400).json({ error: 'slot_id required' });
  const link = cleanPostLink(body.link);
  if (!link) {
    return res.status(400).json({ error: 'link_required', detail: 'Pega el link del post publicado (https://…). Es la prueba de que salió.' });
  }

  try {
    const [slot] = await rest<SlotRow[]>('intel', `brand_publish_slots?id=eq.${slotId}&select=id,brand_id,platform_key,slot_at,status,piece_id&limit=1`);
    if (!slot) return res.status(404).json({ error: 'slot_not_found' });
    // ALCANCE DE REVISIÓN — la franja tiene que ser de una de sus marcas.
    if (!inReviewScope(session.review, slot.brand_id)) return denyOutOfScope(res, slot.brand_id);
    if (!slot.piece_id || !(MARKABLE_SLOT_STATUSES as readonly string[]).includes(slot.status)) {
      return res.status(409).json({ error: 'slot_not_pending', detail: `La franja está en estado «${slot.status}»: ya no espera publicación.` });
    }
    // `config` viaja porque el vocabulario de `scheduled_posts.platform` lo declara el CANAL
    // (`provider_platform`), igual que en el drenaje: no es una transformación de este código.
    const manual = await rest<Array<{ brand_id: string; config: unknown }>>('intel',
      `brand_publish_channels?brand_id=eq.${encodeURIComponent(slot.brand_id)}&platform_key=eq.${encodeURIComponent(slot.platform_key)}`
      + `&publication_path=eq.manual&select=brand_id,config&limit=1`);
    if (!manual.length) {
      return res.status(409).json({ error: 'channel_not_manual', detail: 'Este canal lo publica el drenaje; marcarlo a mano lo publicaría dos veces.' });
    }

    const at = new Date().toISOString();
    const pieceId = slot.piece_id;

    // LA PIEZA, UNA SOLA LECTURA, ANTES DE ESCRIBIR NADA. El asiento del libro necesita su título y
    // su portada, y leerla después del PATCH daría el valor ya pisado. Su fallo no corta: el libro
    // tiene escalón hasta el `piece_id` y el resto de los rastros no la necesitan.
    let piece: ManualPieceInput | null = null;
    try {
      const [row] = await rest<ManualPieceInput[]>('content',
        `content_pieces?id=eq.${pieceId}&select=id,brand_id,platform,format,assets&limit=1`);
      piece = row ?? null;
    } catch { /* se asienta con el escalón; el aviso lo da el paso 5 si hace falta */ }

    // 1 · La franja. El filtro de estado es la guarda: si otra pestaña ya la marcó, no hay fila.
    const sealed = await rest<SlotRow[]>('intel',
      `brand_publish_slots?id=eq.${slotId}&piece_id=eq.${pieceId}&status=in.(${MARKABLE_SLOT_STATUSES.join(',')})`,
      { method: 'PATCH', body: { status: 'published', published_at: at, failed_reason: null, updated_at: at } });
    if (!sealed.length) return res.status(409).json({ error: 'slot_not_pending', detail: 'La franja cambió mientras tanto: ya no espera publicación.' });

    const warnings: string[] = [];

    // 2 · La pieza.
    try {
      const p = await rest<unknown[]>('content', `content_pieces?id=eq.${pieceId}&status=eq.scheduled`,
        { method: 'PATCH', body: { status: 'published', published_at: at, post_url: link } });
      if (!p.length) warnings.push('La pieza no estaba en `scheduled`: su estado no se cambió.');
    } catch (e) { warnings.push(`PIECE_NOT_SEALED: ${String(e instanceof Error ? e.message : e)}`); }

    // 3 · La bitácora.
    try {
      await rest('intel', 'brand_publish_drain_log', {
        method: 'POST',
        body: manualDrainRow({ ...slot, piece_id: pieceId }, link, randomUUID(), at),
      });
    } catch (e) { warnings.push(`DRAIN_LOG_NOT_WRITTEN: ${String(e instanceof Error ? e.message : e)}`); }

    // 4 · El aviso de esa franja.
    try {
      const closed = await rest<Array<{ id: string; public_ref: string | null }>>('alerting',
        `alert_events?rule_code=eq.MANUAL_PUBLICATION_PENDING&dedupe_key=eq.${slotId}&state=not.in.(resolved,expired)`,
        { method: 'PATCH', body: { state: 'resolved', resolved_at: at, next_notify_at: null } });
      for (const ev of closed) {
        await rest('alerting', 'alert_action_log', {
          method: 'POST',
          body: { event_id: ev.id, action: 'admin', accepted: true, from_ref: 'orchestrator',
            reason: `Publicada a mano y marcada desde el Orchestrator (${ev.public_ref ?? ev.id})` },
        }).catch(() => {});
      }
    } catch (e) { warnings.push(`ALERT_NOT_CLOSED: ${String(e instanceof Error ? e.message : e)}`); }

    // 5 · EL LIBRO. Va con la MISMA prueba y el MISMO instante que la bitácora del paso 3: si los dos
    // registros no salieran del mismo par de valores, «cuándo se publicó» tendría dos respuestas.
    //
    // IDEMPOTENTE POR LECTURA PREVIA, no por índice: `scheduled_posts` no tiene único sobre
    // `piece_id` —una pieza de redes tiene una fila POR PLATAFORMA—, así que la relectura es la única
    // guarda. Dos asientos de la misma publicación le darían al reconciliador dos publicaciones
    // donde hubo una.
    //
    // SU FALLO NO CORTA, como los otros tres: cuando esto corre, Sam ya publicó a mano y la franja ya
    // está sellada. Abortar aquí no deshace nada y dejaría el rastro peor que incompleto.
    try {
      const previas = await rest<Array<{ id: string }>>('public',
        `scheduled_posts?select=id&piece_id=eq.${pieceId}&limit=1`);
      if (previas.length) {
        warnings.push('BOOK_ALREADY_WRITTEN: la pieza ya tenía fila en el libro; no se escribió otra.');
      } else {
        const fila = manualBookRow({ ...slot, piece_id: pieceId }, piece, manual[0].config, link, at);
        await rest('public', 'scheduled_posts', { method: 'POST', body: fila });
        // LA CLAVE SIN SEMBRAR SE DICE EN EL ASIENTO QUE LA USA. Un respaldo que sólo se ve la
        // primera vez es un respaldo que se vuelve permanente sin que nadie lo decida.
        if (!bookPlatformOf(manual[0].config, slot.platform_key).declared) {
          warnings.push(`BOOK_PLATFORM_UNDECLARED: el canal no declara config.provider_platform; se asentó «${fila.platform}».`);
        }
      }
    } catch (e) { warnings.push(`BOOK_NOT_WRITTEN: ${String(e instanceof Error ? e.message : e)}`); }


    if (warnings.length) console.warn(`[manual-published] slot=${slotId} ${warnings.join(' | ')}`);
    return res.status(200).json({ ok: true, slot_id: slotId, piece_id: pieceId, published_at: at, warnings });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[manual-published]', message);
    return res.status(500).json({ error: 'manual_published_failed', message });
  }
}
