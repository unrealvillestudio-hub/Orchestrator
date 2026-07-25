import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// iid-approval-digest — B4 · Fase 1, Pieza 4 (el despertador de las 7am EST)
//
// UN email diario mínimo: NO lleva enlaces a piezas. Lleva el conteo de pendientes
// (material de calibración de content.orchestrator_jobs SIN fila en el corpus
// intel.approval_calibration: aprobadas por watcher + rechazadas por criterio de marca),
// su desglose por marca, y UN botón → la bandeja del Orchestrator. Despertador, no carga.
//
// Si hay 0 pendientes → NO envía (no molestar con bandeja vacía).
//
// ── Invocación / auth ──────────────────────────────────────────────────────────
// Disparada por el cron `iid-approval-digest-daily` vía el patrón canónico
// intel.trigger_iid_agent('iid-approval-digest'), que hace net.http_post con el
// header x-cron-secret = iid_cron_secret. Validamos igual que content-watcher:
// x-cron-secret (o Authorization) debe contener IID_CRON_SECRET o el service_role.
// verify_jwt:false (auth propia por secreto compartido).
//
// ── DST-proof ──────────────────────────────────────────────────────────────────
// El cron corre a las 11:00 y 12:00 UTC. En EDT (verano, UTC-4) las 11:00 UTC son
// las 7am NY; en EST (invierno, UTC-5) las 12:00 UTC son las 7am NY. La guarda
// "hora local America/New_York == 7" hace que la EF actúe UNA sola vez por día en
// cualquier estación. Body { force:true } salta la guarda (para pruebas manuales).
//
// Env (project-wide, ya seteadas por otras EFs salvo donde se indica):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   → leer el diff awaiting − corpus
//   IID_CRON_SECRET                            → validar el x-cron-secret del cron
//   RESEND_UNRLVL_KEY                          → enviar el email (cuenta UNRLVL)
//   DIGEST_TO      (opcional, default content-approval@unrealvillestudio.com)
//   DIGEST_FROM    (opcional, default "Content Queue <content@unrealvillestudio.com>" — sender verificado)
//   ORCHESTRATOR_URL (opcional, default https://orchestrator-unrlvl.vercel.app)

const SB_URL      = Deno.env.get("SUPABASE_URL")!;
const SB_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("IID_CRON_SECRET") ?? "";
const RESEND      = Deno.env.get("RESEND_UNRLVL_KEY") ?? "";
const DIGEST_TO   = Deno.env.get("DIGEST_TO") ?? "content-approval@unrealvillestudio.com";
const DIGEST_FROM = Deno.env.get("DIGEST_FROM") ?? "Content Queue <content@unrealvillestudio.com>";
const ORCH_URL    = (Deno.env.get("ORCHESTRATOR_URL") ?? "https://orchestrator-unrlvl.vercel.app").replace(/\/+$/, "");

const INBOX_URL = `${ORCH_URL}?view=calibration`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-cron-secret, content-type",
  "Content-Type": "application/json",
};

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Hora local (0–23) en America/New_York, DST-aware vía Intl. */
function nyHour(): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(new Date());
  return parseInt(h, 10);
}

// Mismo criterio que api/_calibrationShared.ts (la bandeja ve TODO): material de
// calibración = aprobada por watcher (awaiting_approval) o rechazada por criterio de
// marca (failed + assets.watcher.result='REJECT' + copy.aife_filtered presente).
type OJ = {
  id: string;
  brand_id: string;
  status?: string | null;
  assets?: { copy?: { aife_filtered?: string }; watcher?: { result?: string } } | null;
};
function isCalibrationMaterial(p: OJ): boolean {
  if (p.status === "awaiting_approval") return true;
  if (p.status === "failed") {
    const rej = String(p.assets?.watcher?.result ?? "").toUpperCase() === "REJECT";
    const hasAife = typeof p.assets?.copy?.aife_filtered === "string" && p.assets.copy.aife_filtered.length > 0;
    return rej && hasAife;
  }
  return false;
}

/** Diff (material de calibración − corpus) sobre orchestrator_jobs, agrupado por marca. */
async function pendingByBrand(): Promise<{ total: number; by_brand: Record<string, number> }> {
  const [materialRes, corpusRes] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/orchestrator_jobs?status=in.(awaiting_approval,failed)&select=id,brand_id,status,assets&limit=100000`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Accept-Profile": "content" },
    }),
    fetch(`${SB_URL}/rest/v1/approval_calibration?select=piece_id&limit=100000`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Accept-Profile": "intel" },
    }),
  ]);
  if (!materialRes.ok) throw new Error(`orchestrator_jobs read failed: ${materialRes.status} ${(await materialRes.text().catch(() => "")).slice(0, 200)}`);
  if (!corpusRes.ok) throw new Error(`corpus read failed: ${corpusRes.status} ${(await corpusRes.text().catch(() => "")).slice(0, 200)}`);

  const rows = (await materialRes.json()) as OJ[];
  const corpus = (await corpusRes.json()) as Array<{ piece_id: string }>;
  const evaluated = new Set(corpus.map((r) => r.piece_id));

  const by_brand: Record<string, number> = {};
  let total = 0;
  for (const p of rows) {
    if (!isCalibrationMaterial(p)) continue;
    if (evaluated.has(p.id)) continue;
    by_brand[p.brand_id] = (by_brand[p.brand_id] ?? 0) + 1;
    total++;
  }
  return { total, by_brand };
}

function digestHtml(total: number, by_brand: Record<string, number>): string {
  const rows = Object.entries(by_brand)
    .sort((a, b) => b[1] - a[1])
    .map(([brand, n]) =>
      `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #1e2030;color:#c8cfe0;font-size:0.92rem;">${esc(brand)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #1e2030;text-align:right;color:#FFAB00;font-weight:700;font-size:0.95rem;">${n}</td>
      </tr>`)
    .join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#08090d;margin:0;padding:24px;">
<div style="max-width:480px;margin:0 auto;">
  <div style="background:#0E1018;padding:26px 28px;border-radius:12px;border-top:2px solid #FFAB00;">
    <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.14em;color:#555;margin-bottom:8px;">UNRLVL · Calibración</div>
    <h2 style="margin:0 0 6px;font-size:1.25rem;color:#f8fafb;font-weight:800;">☕ Bandeja de calibración</h2>
    <p style="margin:0 0 20px;color:#9aa0ab;font-size:0.9rem;line-height:1.6;">
      Tenés <strong style="color:#FFAB00;">${total}</strong> pieza${total === 1 ? "" : "s"} esperando tu criterio.
    </p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:22px;">
      <thead><tr>
        <th style="text-align:left;font-size:0.62rem;text-transform:uppercase;letter-spacing:0.1em;color:#555;padding-bottom:6px;border-bottom:1px solid #1e2030;">Marca</th>
        <th style="text-align:right;font-size:0.62rem;text-transform:uppercase;letter-spacing:0.1em;color:#555;padding-bottom:6px;border-bottom:1px solid #1e2030;">Pendientes</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <a href="${INBOX_URL}" target="_blank"
       style="display:inline-block;background:#FFAB00;color:#0a0c10;padding:13px 26px;border-radius:9px;
              text-decoration:none;font-size:0.82rem;letter-spacing:0.04em;font-weight:800;text-transform:uppercase;">
      Abrir bandeja de calibración →
    </a>
    <p style="margin:22px 0 0;font-size:0.72rem;color:#3a3a3a;line-height:1.6;">
      Despertador diario · 7:00 AM ET. No responde a este correo.
    </p>
  </div>
</div></body></html>`;
}

async function sendDigest(total: number, by_brand: Record<string, number>): Promise<unknown> {
  if (!RESEND) throw new Error("RESEND_UNRLVL_KEY no configurada");
  const subject = `☕ [UNRLVL] Bandeja de calibración — ${total} pieza${total === 1 ? "" : "s"} pendiente${total === 1 ? "" : "s"}`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: DIGEST_FROM, to: DIGEST_TO, subject, html: digestHtml(total, by_brand) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Auth (mismo patrón que content-watcher).
  const auth = req.headers.get("authorization") ?? req.headers.get("x-cron-secret") ?? "";
  if (CRON_SECRET && !auth.includes(CRON_SECRET) && !auth.includes(SB_KEY)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
  }

  let body: { force?: boolean } = {};
  try { body = await req.json(); } catch { /* body vacío del cron */ }

  // Guarda DST-proof: solo a las 7am NY (salvo force para pruebas manuales).
  const hour = nyHour();
  if (!body.force && hour !== 7) {
    return new Response(JSON.stringify({ skipped: true, reason: "not_7am_ny", ny_hour: hour }), { status: 200, headers: CORS });
  }

  try {
    const { total, by_brand } = await pendingByBrand();
    if (total === 0) {
      return new Response(JSON.stringify({ sent: false, reason: "no_pending", total: 0 }), { status: 200, headers: CORS });
    }
    const result = await sendDigest(total, by_brand);
    return new Response(JSON.stringify({ sent: true, total, by_brand, to: DIGEST_TO, resend: result }), { status: 200, headers: CORS });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("iid-approval-digest error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: CORS });
  }
});
