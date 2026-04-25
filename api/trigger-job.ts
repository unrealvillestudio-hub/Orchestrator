/**
 * UNRLVL Orchestrator — api/trigger-job.ts
 * Edge runtime — no external imports, delegates to content-dispatcher.
 */

declare const process: { env: Record<string, string | undefined> };
export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST')
    return new Response(JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } });

  // Optional auth
  const secret = process.env.IID_CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('x-trigger-secret') ?? req.headers.get('authorization') ?? '';
    if (!auth.includes(secret))
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  let body: { queue_id?: string; job_id?: string } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  if (!body.queue_id && !body.job_id)
    return new Response(JSON.stringify({ error: 'Required: queue_id or job_id' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } });

  // Delegate to Supabase content-dispatcher
  const dispatcherUrl = `${process.env.SUPABASE_URL}/functions/v1/content-dispatcher`;
  try {
    const res = await fetch(dispatcherUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': process.env.IID_CRON_SECRET ?? '',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return new Response(JSON.stringify(data),
      { status: res.ok ? 200 : 500, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
