/**
 * UNRLVL Orchestrator — api/trigger-job.ts
 *
 * Programmatic trigger endpoint for the IID Network.
 * Called by content-dispatcher (Supabase Edge Function).
 * Delegates to content-dispatcher which has the full pipeline logic.
 *
 * Env vars required (add in Vercel project settings):
 *   SUPABASE_URL
 *   IID_CRON_SECRET   (same value as in Supabase secrets)
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  // Optional auth
  const secret = process.env.IID_CRON_SECRET;
  if (secret) {
    const auth = (req.headers["x-trigger-secret"] ?? req.headers["authorization"] ?? "") as string;
    if (!auth.includes(secret))
      return res.status(401).json({ error: "Unauthorized" });
  }

  const { queue_id, job_id } = req.body ?? {};
  if (!queue_id && !job_id)
    return res.status(400).json({ error: "Required: queue_id or job_id" });

  // Delegate to Supabase content-dispatcher
  try {
    const dispatcherUrl = `${process.env.SUPABASE_URL}/functions/v1/content-dispatcher`;
    const dispatchRes = await fetch(dispatcherUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": process.env.IID_CRON_SECRET ?? "",
      },
      body: JSON.stringify({ queue_id, job_id }),
    });

    const data = await dispatchRes.json();
    return res.status(dispatchRes.ok ? 200 : 500).json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
