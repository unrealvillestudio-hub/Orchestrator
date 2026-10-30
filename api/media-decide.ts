/**
 * UNRLVL Orchestrator — api/media-decide.ts  (LA BANDEJA DE MEDIOS · LA DECISIÓN)
 *
 * La ÚNICA vía por la que un objeto sale de `staging/`, y pasa por una persona.
 *
 * NO HAY ENDPOINT EQUIVALENTE PARA UN AGENTE. Ni Edge Function, ni RPC, ni cron. Esta ruta exige
 * JWT de sesión con la vista `media_promotion`: la misma puerta de las demás bandejas. Si un agente
 * pudiera llamarla, subiría y promovería en el mismo gesto y la frontera de `staging/` sería
 * decorativa — UN CONTROL QUE UN AGENTE PUEDE LLAMAR NO ES UN CONTROL.
 *
 * EL ORDEN DE LOS PASOS ES EL CONTROL. Primero se escribe la decisión con su motivo; sólo después
 * se toca el bucket. Si el registro no se puede escribir, NO SE PROMUEVE: un control cuyo registro
 * se puede perder es decorativo. Y si el movimiento falla después, la fila queda en `failed` con su
 * causa y el objeto sigue en `staging/` — visible y repetible, nunca a medias y en silencio.
 *
 * SE COPIA, SE VERIFICA Y LUEGO SE BORRA. Es el patrón que ya usa el promotor del carril para
 * `temp/` → `permanent/`: un `move` que falle a mitad deja el objeto en ninguna parte.
 *
 * ── CAMBIOS (2026-10-30) · LA PROMOCIÓN CRUZA DE BUCKET ──────────────────────────────────────
 *
 * El objeto sale del bucket PRIVADO de entrada —el que declara la fila del principal, desde
 * `unrlvl-iid-functions#537`— y entra en el PÚBLICO, en `permanent/<marca>/promovidas/`. Dos cosas
 * que no son detalle:
 *
 *   · EL BUCKET DE ORIGEN SE BUSCA, NO SE SUPONE. Se recorren los buckets de aterrizaje y se usa
 *     el primero donde el objeto EXISTE. Suponerlo y errar borraría—o no encontraría— el objeto
 *     justo cuando alguien acaba de decidir sobre él.
 *   · EL BUCKET QUEDA ESCRITO EN `outcome_detail`. La tabla de decisiones guarda la ruta y no el
 *     bucket; mientras no tenga columna propia, el detalle del desenlace lo dice, porque una ruta
 *     sin bucket ya no identifica un objeto.
 *
 * POST /api/media-decide   { object_path, decision: 'promote'|'discard', motive }
 *   200 { ok, decision, object_path, destination_path?, outcome }
 *   400 lo pedido no se entiende · 403 fuera de alcance · 404 el objeto no está
 *   503 el registro de decisiones no existe todavía — y entonces no se toca el bucket
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, extractToken, SB_URL, SB_KEY } from './_calibrationShared.js';
import { requireReviewer, inReviewScope, denyOutOfScope, signerOf } from './_reviewScope.js';
import { fetchWithTimeout } from './_fetchWithTimeout.js';
import { BUCKET_PUBLICO, bucketsDeAterrizaje, existe, copiar, borrar } from './_mediaStore.js';
import { decisionPedida, filaDeDecision } from './_mediaTray.js';

const TABLA = 'media_promotion_decisions';

function cabeceras(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`,
    'Content-Type': 'application/json', 'Content-Profile': 'intel', ...extra,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const session = await requireReviewer(req, res, extractToken(req, body), ['media_promotion']);
  if (!session) return;

  // 1 · QUÉ SE PIDIÓ. El destino se deriva aquí dentro; lo que mande el cliente se ignora.
  const pedido = decisionPedida(body);
  if ('error' in pedido) return res.status(400).json({ error: pedido.error, detail: pedido.detail });
  if (!inReviewScope(session.review, pedido.brand_id)) return denyOutOfScope(res, pedido.brand_id);
  if (pedido.decision === 'promote' && !pedido.destino) {
    return res.status(400).json({ error: 'destino_no_derivable', detail: 'De esa ruta no se puede derivar un destino.' });
  }

  // 2 · ¿ESTÁ, Y EN QUÉ BUCKET? Un 404 limpio vale más que una copia que falla por un objeto que
  // no existe — y el bucket se BUSCA, porque suponerlo y errar toca el objeto equivocado.
  let bucketOrigen = '';
  try {
    for (const b of await bucketsDeAterrizaje()) {
      if (await existe(b, pedido.object_path)) { bucketOrigen = b; break; }
    }
    if (!bucketOrigen) {
      return res.status(404).json({
        error: 'objeto_no_encontrado',
        detail: 'Ese objeto ya no está en la zona de entrada. Puede que alguien lo haya decidido antes.',
      });
    }
  } catch (err) {
    return res.status(502).json({ error: 'storage_unreachable', message: err instanceof Error ? err.message : String(err) });
  }

  // 3 · EL REGISTRO, ANTES DE TOCAR NADA. Sin fila no hay promoción.
  const fila = filaDeDecision(pedido, signerOf(session, body.decided_by));
  let id: string;
  try {
    const r = await fetchWithTimeout('db', `${SB_URL()}/rest/v1/${TABLA}`, {
      method: 'POST', headers: cabeceras({ Prefer: 'return=representation' }), body: JSON.stringify(fila),
    });
    const txt = await r.text().catch(() => '');
    if (!r.ok) {
      // La tabla todavía no existe: esta ruta se despliega ANTES de su DDL. No se toca el bucket, y
      // se dice exactamente por qué en vez de devolver un 500 que nadie sabe leer.
      if (r.status === 404 || txt.includes('42P01')) {
        return res.status(503).json({
          error: 'bandeja_no_habilitada',
          detail: 'El registro de decisiones todavía no existe, así que esta decisión no se puede '
                + 'dejar escrita. Sin registro no se promueve nada: el bucket no se ha tocado.',
        });
      }
      // Un índice único sobre lo ya consumado: alguien promovió esto antes.
      if (r.status === 409) {
        return res.status(409).json({ error: 'ya_decidido', detail: 'Ese objeto ya tiene una decisión consumada.' });
      }
      throw new Error(`insert → ${r.status} ${txt.slice(0, 200)}`);
    }
    const filas = JSON.parse(txt || '[]') as Array<{ id?: string }>;
    id = String(filas?.[0]?.id ?? '');
    if (!id) throw new Error('el registro no devolvió identificador');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[media-decide] no se pudo registrar la decisión:', message);
    return res.status(502).json({ error: 'decision_no_registrada', message, detail: 'El bucket no se ha tocado.' });
  }

  // 4 · AHORA SÍ, EL BUCKET.
  let outcome = 'done';
  let detalle: string | null = null;
  try {
    if (pedido.decision === 'promote') {
      await copiar(bucketOrigen, pedido.object_path, BUCKET_PUBLICO, pedido.destino!);
      // VERIFICAR ANTES DE BORRAR, Y EN EL BUCKET DE DESTINO. Sin esta comprobación, un borrado
      // tras una copia que no llegó pierde el objeto — y lo pierde justo después de que alguien
      // decidiera conservarlo.
      if (!await existe(BUCKET_PUBLICO, pedido.destino!)) {
        throw new Error('la copia no apareció en el destino: no se borra el origen');
      }
    }
    await borrar(bucketOrigen, pedido.object_path);
  } catch (err) {
    outcome = 'failed';
    detalle = err instanceof Error ? err.message : String(err);
    console.error(`[media-decide] ${pedido.decision} falló para ${pedido.object_path}:`, detalle);
  }

  // 5 · SELLAR EL DESENLACE. Que el sellado falle no puede desdecir lo que ya pasó en el bucket, así
  // que se captura y se declara en la respuesta: capturar está bien, enmudecer no.
  let sellado = true;
  try {
    const r = await fetchWithTimeout('db', `${SB_URL()}/rest/v1/${TABLA}?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: cabeceras(),
      // El bucket de origen va SIEMPRE, también cuando todo fue bien: la tabla no tiene columna
      // para él y una ruta sin bucket ya no identifica un objeto.
      body: JSON.stringify({
        outcome,
        outcome_detail: [`bucket_origen=${bucketOrigen}`, detalle].filter(Boolean).join(' · '),
      }),
    });
    sellado = r.ok;
    if (!r.ok) console.error(`[media-decide] no se pudo sellar el desenlace de ${id}: ${r.status}`);
  } catch (err) {
    sellado = false;
    console.error('[media-decide] no se pudo sellar el desenlace:', err instanceof Error ? err.message : err);
  }

  const estado = outcome === 'done' ? 200 : 502;
  return res.status(estado).json({
    ok: outcome === 'done',
    decision: pedido.decision,
    object_path: pedido.object_path,
    bucket_origen: bucketOrigen,
    ...(pedido.decision === 'promote'
      ? { destination_path: pedido.destino, bucket_destino: BUCKET_PUBLICO }
      : {}),
    brand_id: pedido.brand_id,
    outcome,
    ...(detalle ? { detail: detalle } : {}),
    // Si esto es `false`, lo del bucket pasó y la fila no lo refleja: hay que mirarla a mano.
    desenlace_registrado: sellado,
  });
}
