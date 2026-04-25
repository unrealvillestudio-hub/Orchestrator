/**
 * UNRLVL Orchestrator — api/approve-job.ts
 *
 * 1-click email approval endpoint.
 * Sam clicks PUBLICAR/RECHAZAR in the email → this runs.
 *
 * Env vars required (add in Vercel project settings):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SOCIALLAB_URL   (default: https://social-lab-flame.vercel.app)
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SOCIALLAB_URL = process.env.SOCIALLAB_URL ?? "https://social-lab-flame.vercel.app";

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
  <div class="icon">${color === "#00FFD1" ? "✓" : "✗"}</div>
  <div class="label">UNRLVL · Content Queue</div>
  <h1>${title}</h1>
  <p>${message}</p>
</div>
</body></html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { token, action } = req.query;

  if (!token || typeof token !== "string")
    return res.status(400).send(htmlPage("Token inválido", "El link no contiene un token válido.", "#FF4444"));

  if (action !== "approve" && action !== "reject")
    return res.status(400).send(htmlPage("Acción inválida", "Solo se permiten: approve o reject.", "#FF4444"));

  // Find the job by approval token
  const { data: job, error: jobErr } = await sb
    .schema("content")
    .from("orchestrator_jobs")
    .select("id, piece_id, voice, brand_id, platforms, queue_id, iid_source_tag, approval_status, labs_status")
    .eq("approval_token", token)
    .single();

  if (jobErr || !job)
    return res.status(404).send(htmlPage("Link expirado", "Este link no existe o ya fue procesado.", "#FF4444"));

  if (job.approval_status !== "pending") {
    const msg = job.approval_status === "approved"
      ? "Esta pieza ya fue publicada."
      : "Esta pieza fue rechazada previamente.";
    return res.status(200).send(htmlPage("Ya procesado", msg, "#FFB020"));
  }

  // ── REJECT ──────────────────────────────────────────────
  if (action === "reject") {
    await sb.schema("content").from("orchestrator_jobs")
      .update({ approval_status: "rejected", status: "failed", approved_at: new Date().toISOString() })
      .eq("id", job.id);

    if (job.piece_id)
      await sb.schema("content").from("content_pieces")
        .update({ status: "rejected" }).eq("id", job.piece_id);

    await sb.schema("intel").from("iid_content_queue")
      .update({ approval_status: "rejected", orchestrator_status: "complete" })
      .eq("id", job.queue_id);

    return res.status(200).send(
      htmlPage("Rechazado", "La pieza fue rechazada. No se publicará.", "#FF4444")
    );
  }

  // ── APPROVE ─────────────────────────────────────────────
  await sb.schema("content").from("orchestrator_jobs")
    .update({ approval_status: "approved", approved_at: new Date().toISOString(), approved_by: "sam_email_link" })
    .eq("id", job.id);

  // SocialLab needs a valid Supabase brands.id
  const brandId = job.brand_id ?? "UnrealvilleStudio";

  // Get platforms from job (array stored by dispatcher)
  const platforms = (job.platforms as string[] | null)?.map((p: string) => p.toUpperCase())
    ?? ["INSTAGRAM", "LINKEDIN"];

  // Get the AIFE-filtered copy stored in labs_status by dispatcher
  const aifeCopy = (job.labs_status as any)?.aife_filtered_text ?? "";

  try {
    const publishRes = await fetch(`${SOCIALLAB_URL}/api/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brandId,
        stage: {
          labId: "sociallab",
          label: "Publish approved post",
          description: "Approved by Sam via email",
          order: 4,
        },
        params: { platforms },
        // SocialLab reads previousOutputs.copylab (priority 1)
        previousOutputs: { copylab: aifeCopy },
      }),
    });

    if (publishRes.ok) {
      await sb.schema("content").from("orchestrator_jobs")
        .update({ status: "complete" }).eq("id", job.id);

      if (job.piece_id)
        await sb.schema("content").from("content_pieces")
          .update({ status: "published", published_at: new Date().toISOString() })
          .eq("id", job.piece_id);

      await sb.schema("intel").from("iid_content_queue")
        .update({ approval_status: "approved", orchestrator_status: "complete" })
        .eq("id", job.queue_id);

      return res.status(200).send(
        htmlPage("Publicado ✓", "Aprobado y enviado a SocialLab para publicación.", "#00FFD1")
      );
    } else {
      await sb.schema("content").from("orchestrator_jobs")
        .update({ status: "failed" }).eq("id", job.id);

      return res.status(200).send(
        htmlPage(
          "Aprobado — error en publicación",
          "La pieza fue aprobada pero SocialLab devolvió un error. Revisa el Orchestrator.",
          "#FFB020"
        )
      );
    }
  } catch (e) {
    return res.status(200).send(
      htmlPage(
        "Aprobado — error de conexión",
        "La pieza fue aprobada pero no se pudo contactar SocialLab.",
        "#FFB020"
      )
    );
  }
}
