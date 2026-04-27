/**
 * UNRLVL Orchestrator — api/approve-job.ts v2.0
 * Edge runtime — delegates to Supabase EF approve-piece (no direct PostgREST)
 * Fix v2.0: content schema not exposed via PostgREST → route through EF instead
 */

declare const process: { env: Record<string, string | undefined> };
export const config = { runtime: 'edge' };

const SB_URL  = () => process.env.SUPABASE_URL ?? '';
const SB_KEY  = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// ── HTML pages ──────────────────────────────────────────────────────────────
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

// ── Handler ──────────────────────────────────────────────────────────────────
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

  // Delegate to Supabase EF approve-piece
  const efUrl = `${SB_URL()}/functions/v1/approve-piece?token=${encodeURIComponent(token)}&action=${action}`;

  let result: { error?: string; status?: string; ok?: boolean; published?: boolean; note?: string } = {};
  try {
    const res = await fetch(efUrl, {
      headers: {
        'Authorization': `Bearer ${SB_KEY()}`,
        'Content-Type': 'application/json',
      },
    });
    result = await res.json();
  } catch (e) {
    return new Response(
      htmlPage('Error de conexión', 'No se pudo contactar el servidor. Intenta de nuevo.', '#FFB020'),
      { status: 200, headers: { 'Content-Type': 'text/html' } }
    );
  }

  // Map EF response to HTML page
  if (result.error === 'not_found')
    return new Response(htmlPage('Link expirado', 'Este link no existe o ya fue procesado.', '#FF4444'),
      { status: 404, headers: { 'Content-Type': 'text/html' } });

  if (result.error === 'already_processed') {
    const msg = result.status === 'approved'
      ? 'Esta pieza ya fue publicada.'
      : 'Esta pieza fue rechazada previamente.';
    return new Response(htmlPage('Ya procesado', msg, '#FFB020'),
      { status: 200, headers: { 'Content-Type': 'text/html' } });
  }

  if (action === 'reject')
    return new Response(
      htmlPage('Rechazado', 'La pieza fue rechazada. No se publicará.', '#FF4444'),
      { status: 200, headers: { 'Content-Type': 'text/html' } }
    );

  // Approved
  if (result.published)
    return new Response(
      htmlPage('Publicado ✓', 'Aprobado y enviado a SocialLab para publicación.', '#00FFD1'),
      { status: 200, headers: { 'Content-Type': 'text/html' } }
    );

  // Approved but SocialLab unreachable — posts are queued as pending_oauth
  return new Response(
    htmlPage('Aprobado — publicación pendiente',
      'La pieza fue aprobada. La publicación se procesará cuando OAuth esté configurado.', '#FFB020'),
    { status: 200, headers: { 'Content-Type': 'text/html' } }
  );
}
