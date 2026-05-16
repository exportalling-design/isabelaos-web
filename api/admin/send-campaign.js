// api/admin/send-campaign.js
// Envía email a todos los usuarios con Jades sin usar
// Usar desde Vercel con: POST /api/admin/send-campaign
// Body: { adminSecret: "TU_SECRET", testEmail: "email@test.com" (opcional para prueba) }
import { supabaseAdmin } from "../../src/lib/supabaseAdmin.js";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
// Mientras el dominio no esté verificado, usar onboarding@resend.dev
// Cuando el dominio esté listo cambiar a: contacto@isabelaos.com
const FROM_EMAIL    = "IsabelaOS Studio <onboarding@resend.dev>";
const ADMIN_SECRET  = process.env.CAMPAIGN_ADMIN_SECRET || "isabelaos-campaign-2026";

function buildEmailHTML(email) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>You have 10 free Jades — IsabelaOS</title>
</head>
<body style="margin:0;padding:0;background:#080a0e;font-family:'Segoe UI',Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;background:#080a0e;">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#1a0800,#2e1300);padding:28px 32px;border-bottom:1px solid rgba(255,90,0,0.3);">
    <div style="display:flex;align-items:center;gap:12px;">
      <div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#ff5a00,#ffb300);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;color:#000;">io</div>
      <div>
        <div style="font-size:16px;font-weight:700;color:#fff;">isabelaOs Studio</div>
        <div style="font-size:11px;color:rgba(255,179,0,0.7);letter-spacing:1px;">AI VISUAL PLATFORM</div>
      </div>
    </div>
  </div>

  <!-- Hero video still -->
  <div style="position:relative;background:#0d1017;border-bottom:1px solid rgba(200,169,110,0.2);">
    <div style="background:linear-gradient(135deg,rgba(200,169,110,0.1),rgba(8,10,14,0.9));padding:36px 32px 28px;">
      <div style="display:inline-block;background:#C8A96E;color:#000;font-size:10px;font-weight:800;letter-spacing:2px;border-radius:6px;padding:4px 12px;text-transform:uppercase;margin-bottom:16px;">⚡ NOW AVAILABLE</div>
      <h1 style="margin:0 0 12px;font-size:28px;font-weight:800;color:#fff;line-height:1.2;">
        1 Million Views.<br>
        <span style="color:#C8A96E;">Now with your face.</span>
      </h1>
      <p style="margin:0;font-size:15px;color:rgba(240,236,228,0.7);line-height:1.7;max-width:480px;">
        The viral video that reached over <strong style="color:#fff;">1,000,000 views on Instagram</strong> is now available as a template. Upload just your photo — AI places you as the protagonist in seconds.
      </p>
    </div>

    <!-- Stats bar -->
    <div style="display:flex;border-top:1px solid rgba(255,255,255,0.06);">
      <div style="flex:1;padding:14px 20px;border-right:1px solid rgba(255,255,255,0.06);text-align:center;">
        <div style="font-size:22px;font-weight:800;color:#C8A96E;">1M+</div>
        <div style="font-size:10px;color:rgba(240,236,228,0.4);letter-spacing:1px;">VIEWS</div>
      </div>
      <div style="flex:1;padding:14px 20px;border-right:1px solid rgba(255,255,255,0.06);text-align:center;">
        <div style="font-size:22px;font-weight:800;color:#C8A96E;">111K</div>
        <div style="font-size:10px;color:rgba(240,236,228,0.4);letter-spacing:1px;">LIKES</div>
      </div>
      <div style="flex:1;padding:14px 20px;text-align:center;">
        <div style="font-size:22px;font-weight:800;color:#C8A96E;">11.5K</div>
        <div style="font-size:10px;color:rgba(240,236,228,0.4);letter-spacing:1px;">SHARES</div>
      </div>
    </div>
  </div>

  <!-- Jades reminder -->
  <div style="background:#0d1017;padding:28px 32px;border-bottom:1px solid rgba(255,179,0,0.15);">
    <div style="background:linear-gradient(135deg,rgba(255,179,0,0.08),rgba(8,10,14,0.5));border:1px solid rgba(255,179,0,0.2);border-radius:14px;padding:20px 22px;display:flex;align-items:center;gap:16px;">
      <div style="font-size:36px;flex-shrink:0;">💎</div>
      <div>
        <div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:4px;">You have <span style="color:#ffb300;">10 free Jades</span> waiting</div>
        <div style="font-size:13px;color:rgba(240,236,228,0.6);line-height:1.6;">
          You signed up but haven't used your credits yet. Your 10 Jades are enough to start creating AI images — no credit card needed.
        </div>
      </div>
    </div>
  </div>

  <!-- What you can do -->
  <div style="background:#080a0e;padding:28px 32px;border-bottom:1px solid rgba(255,255,255,0.06);">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#ff5a00;font-weight:700;margin-bottom:16px;">What you can create right now</div>
    <div style="display:grid;gap:10px;">
      ${[
        ["🖼️", "AI Images", "Generate cinematic photos with your face using FLUX — 1 Jade each"],
        ["⚡", "Epic Templates", "Place yourself in the viral scene — Divine Confrontation, The Last Fight, Victoria's Secret"],
        ["🎬", "CineAI Videos", "Hollywood-style scenes with your face as the protagonist"],
        ["📸", "AI Photoshoot", "Professional product photos in seconds"],
      ].map(([icon, title, desc]) => `
      <div style="display:flex;gap:14px;align-items:flex-start;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:14px 16px;">
        <span style="font-size:22px;flex-shrink:0;">${icon}</span>
        <div>
          <div style="font-size:14px;font-weight:600;color:#fff;margin-bottom:3px;">${title}</div>
          <div style="font-size:12px;color:rgba(240,236,228,0.5);line-height:1.5;">${desc}</div>
        </div>
      </div>`).join("")}
    </div>
  </div>

  <!-- CTA -->
  <div style="background:#0d1017;padding:36px 32px;text-align:center;border-bottom:1px solid rgba(255,90,0,0.15);">
    <div style="font-size:13px;color:rgba(240,236,228,0.5);margin-bottom:20px;">
      Your 10 Jades are ready. No credit card. No subscription.
    </div>
    <a href="https://isabelaos.com" style="display:inline-block;background:linear-gradient(135deg,#ff5a00,#ffb300);border-radius:14px;color:#000;font-size:16px;font-weight:800;padding:16px 44px;text-decoration:none;letter-spacing:0.5px;">
      🎬 Start Creating Now →
    </a>
    <div style="margin-top:14px;font-size:11px;color:rgba(240,236,228,0.3);">
      isabelaos.com · AI Visual Production Platform
    </div>
  </div>

  <!-- Footer -->
  <div style="background:#080a0e;padding:20px 32px;text-align:center;">
    <div style="font-size:11px;color:rgba(240,236,228,0.2);line-height:1.8;">
      You received this email because you signed up at isabelaos.com<br>
      Stalling Technologic · Cobán, Alta Verapaz, Guatemala 🇬🇹<br>
      <a href="https://isabelaos.com" style="color:rgba(255,90,0,0.5);text-decoration:none;">Unsubscribe</a>
    </div>
  </div>

</div>
</body>
</html>`;
}

export default async function handler(req, res) {
  res.setHeader("content-type", "application/json; charset=utf-8");

  if (req.method !== "POST")
    return res.status(405).json({ ok: false, error: "POST only" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

  // Verificar secreto admin
  if (body.adminSecret !== ADMIN_SECRET)
    return res.status(401).json({ ok: false, error: "Unauthorized" });

  if (!RESEND_API_KEY)
    return res.status(500).json({ ok: false, error: "Missing RESEND_API_KEY" });

  try {
    // Obtener usuarios con jades > 0 (los que tienen créditos sin usar)
    // Ajusta la tabla/columna según tu schema
    const { data: users, error: dbErr } = await supabaseAdmin
      .from("profiles")
      .select("id, email, jade_balance")
      .gt("jade_balance", 0)
      // Excluir cuentas propias y de prueba
      .not("email", "in", '("exportalling@gmail.com","contacto@isabelaos.com","isabelaos@outlook.com","pagador_sandbox@pagadito.com")')
      .order("created_at", { ascending: false });

    if (dbErr) throw new Error(`DB error: ${dbErr.message}`);
    if (!users?.length) return res.status(200).json({ ok: true, sent: 0, message: "No users found" });

    // Si es test, solo enviar a un email específico
    const targets = body.testEmail
      ? [{ email: body.testEmail, jades: 10 }]
      : users;

    console.log(`[campaign] Sending to ${targets.length} users`);

    const results = [];
    let sent = 0, failed = 0;

    // Enviar en batches de 10 para no saturar Resend
    for (let i = 0; i < targets.length; i += 10) {
      const batch = targets.slice(i, i + 10);

      await Promise.allSettled(batch.map(async (user) => {
        try {
          const r = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${RESEND_API_KEY}`,
            },
            body: JSON.stringify({
              from:    FROM_EMAIL,
              to:      [user.email],
              subject: "🎬 Your 10 free Jades are waiting — + 1M views template now available",
              html:    buildEmailHTML(user.email),
            }),
          });

          const data = await r.json();
          if (!r.ok) {
            console.error(`[campaign] Failed ${user.email}:`, data);
            failed++;
            results.push({ email: user.email, ok: false, error: data.message });
          } else {
            sent++;
            results.push({ email: user.email, ok: true, id: data.id });
          }
        } catch (e) {
          failed++;
          results.push({ email: user.email, ok: false, error: e.message });
        }
      }));

      // Pausa entre batches para respetar rate limits
      if (i + 10 < targets.length) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    console.log(`[campaign] Done: sent=${sent} failed=${failed}`);
    return res.status(200).json({ ok: true, total: targets.length, sent, failed, results });

  } catch (e) {
    console.error("[campaign] error:", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

export const config = { runtime: "nodejs" };
