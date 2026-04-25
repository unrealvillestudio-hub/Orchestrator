/**
 * UNRLVL Orchestrator — api/approve-job.ts
 * Edge runtime — no external imports, uses raw fetch like interpret-intent.ts
 */

declare const process: { env: Record<string, string | undefined> };
export const config = { runtime: 'edge' };

const SB_URL = () => process.env.SUPABASE_URL ?? '';
const SB_KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const SOCIALLAB_URL = () => process.env.SOCIALLAB_URL ?? 'https://social-lab-flame.vercel.app';

// ── Supabase helpers (raw fetch, schema-aware) ─────────────────────
async function sbGet(schema: string, table: string, filter: string): Promise<any | null> {
  const res = await fetch(`${SB_URL()}/rest/v1/${table}?${filter}&limit=1`, {
    headers: {
      apikey: SB_KEY(),
      Authorization: `Bearer ${SB_KEY()}`,
      'Accept-Profile': schema,
    },
  });
  if (!res.ok) return null;
  const data: any[] = await res.json();
  return data[0] ?? null;
}

async function sbUpdate(schema: string, table: string, filter: string, payload: object): Promise<boolean> {
  const res = await fetch(`${SB_URL()}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: {
      apikey: SB_KEY(),
      Authorization: `Bearer ${SB_KEY()}`,
      'Content-Type': 'application/json',
      'Content-Profile': schema,
    },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

// ── HTML pages ─────────────────────────────────────────────────────
function htmlPage(title: string, message: string, color: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — UNRLVL</title>
<style>
  body { background:#06080A; color:#CDD5E0; font-family:'Segoe UI',Arial,sans-serif;
         display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0 }
  .card { max-width:480px; padding:48px 40px; text-align:center }
  .icon { font-size:48px; margin-bottom:20px }
  .label { font-family:monospace; font-size:10px; letter-spacing:0.2em;
           text-transform:uppercase; color:${color}; margin-bottom:12px }
  h1 { font-size:22px; font-weight:700; color:#F2F0EC; margin:0 0 12px }
  p  { font-size:13px; color:#4A5E70; line-height:1.6; margin:0 }
</style>
</head><body>
<div class="card">
  <div class="icon">${color === '#00FFD1' ? '✓' : '✗'}</div>
  <div class="label">UNRLVL · Content Queue</div>
  <h1>${title}</h1>
  <p>${message}</p>
</div>
</body></html>`;
}

// ── Handler ────────────────────────────────────────────────────────
export default async function handler(req: Request): Promise<Response> {
  const url    = new URL(req.url);
  const token  = url.searchParams.get('token');
  const action = url.searchParams.get('action');

  if (!token)
    return new Response(htmlPage('Token inválido', 'El link no contiene un token válido.', '#FF4444'),
      { status: 400, headers: { 'Content-Type': 'text/html' } });

  if (action !== 'approve' && action !== 'reject')
    return new Response(htmlPage('Acción inválida', 'Solo se permiten: approve o reject.', '#FF4444'),
      { status: 400, headers: { 'Content-Type': 'text/html' } });

  // Find job by token
  const job = await sbGet('content', 'orchestrator_jobs',
    `approval_token=eq.${encodeURIComponent(token)}&select=id,piece_id,voice,brand_id,platforms,queue_id,iid_source_tag,approval_status,labs_status`);

  if (!job)
    return new Response(htmlPage('Link expirado', 'Este link no existe o ya fue procesado.', '#FF4444'),
      { status: 404, headers: { 'Content-Type': 'text/html' } });

  if (job.approval_status !== 'pending') {
    const msg = job.approval_status === 'approved'
      ? 'Esta pieza ya fue publicada.'
      : 'Esta pieza fue rechazada previamente.';
    return new Response(htmlPage('Ya procesado', msg, '#FFB020'),
      { status: 200, headers: { 'Content-Type': 'text/html' } });
  }

  const now = new Date().toISOString();

  // ── REJECT ────────────────────────────────────────────────────────
  if (action === 'reject') {
    await sbUpdate('content', 'orchestrator_jobs', `id=eq.${job.id}`,
      { approval_status: 'rejected', status: 'failed', approved_at: now });
    if (job.piece_id)
      await sbUpdate('content', 'content_pieces', `id=eq.${job.piece_id}`, { status: 'rejected' });
    await sbUpdate('intel', 'iid_content_queue', `id=eq.${job.queue_id}`,
      { approval_status: 'rejected', orchestrator_status: 'complete' });
    return new Response(
      htmlPage('Rechazado', 'La pieza fue rechazada. No se publicará.', '#FF4444'),
      { status: 200, headers: { 'Content-Type': 'text/html' } }
    );
  }

  // ── APPROVE ───────────────────────────────────────────────────────
  await sbUpdate('content', 'orchestrator_jobs', `id=eq.${job.id}`,
    { approval_status: 'approved', approved_at: now, approved_by: 'sam_email_link' });

  const brandId   = job.brand_id ?? 'UnrealvilleStudio';
  const platforms = (job.platforms as string[] | null)?.map((p: string) => p.toUpperCase()) ?? ['INSTAGRAM', 'LINKEDIN'];
  const aifeCopy  = (job.labs_status as any)?.aife_filtered_text ?? '';

  try {
    const publishRes = await fetch(`${SOCIALLAB_URL()}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brandId,
        stage: { labId: 'sociallab', label: 'Publish approved post', description: 'Approved by Sam via email', order: 4 },
        params: { platforms },
        previousOutputs: { copylab: aifeCopy },
      }),
    });

    if (publishRes.ok) {
      await sbUpdate('content', 'orchestrator_jobs', `id=eq.${job.id}`, { status: 'complete' });
      if (job.piece_id)
        await sbUpdate('content', 'content_pieces', `id=eq.${job.piece_id}`,
          { status: 'published', published_at: now });
      await sbUpdate('intel', 'iid_content_queue', `id=eq.${job.queue_id}`,
        { approval_status: 'approved', orchestrator_status: 'complete' });
      return new Response(
        htmlPage('Publicado ✓', 'Aprobado y enviado a SocialLab para publicación.', '#00FFD1'),
        { status: 200, headers: { 'Content-Type': 'text/html' } }
      );
    } else {
      await sbUpdate('content', 'orchestrator_jobs', `id=eq.${job.id}`, { status: 'failed' });
      return new Response(
        htmlPage('Aprobado — error publicación',
          'La pieza fue aprobada pero SocialLab devolvió un error. Revisa el Orchestrator.', '#FFB020'),
        { status: 200, headers: { 'Content-Type': 'text/html' } }
      );
    }
  } catch {
    return new Response(
      htmlPage('Aprobado — error conexión',
        'La pieza fue aprobada pero no se pudo contactar SocialLab.', '#FFB020'),
      { status: 200, headers: { 'Content-Type': 'text/html' } }
    );
  }
}
