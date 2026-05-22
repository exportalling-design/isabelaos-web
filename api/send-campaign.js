// api/send-campaign.js
// POST /api/send-campaign
// Envía correo a TODOS los usuarios registrados via Resend
// Solo puede ejecutarlo un admin
import { supabaseAdmin }          from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

const RESEND_API = "https://api.resend.com/emails";

const ADMIN_EMAILS = ["exportalling@gmail.com"];

async function sendEmail(to, subject, html) {
  const r = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from:    "IsabelaOS Studio <onboarding@resend.dev>", // ← sin verificar dominio
      to:      [to],
      subject,
      html,
    }),
  });
  const data = await r.json();
  return { ok: r.ok, id: data?.id, error: data?.message || null };
}

function buildEmailHTML(userEmail) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Your free Jades are waiting — IsabelaOS</title>
</head>
<body style="margin:0;padding:0;background:#080a0e;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#080a0e;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#0d1017;border-radius:20px;border:1px solid rgba(255,90,0,0.2);overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,rgba(255,90,0,0.15),rgba(255,179,0,0.08));padding:32px 32px 24px;text-align:center;border-bottom:1px solid rgba(255,90,0,0.15);">
              <div style="display:inline-flex;align-items:center;gap:10px;margin-bottom:16px;">
                <div style="width:36px;height:36px;background:linear-gradient(135deg,#ff5a00,#ffb300);border-radius:9px;display:inline-block;line-height:36px;text-align:center;font-weight:800;color:#000;font-size:14px;">io</div>
                <span style="color:#fff;font-size:18px;font-weight:700;vertical-align:middle;">isabelaOs Studio</span>
              </div>
              <div style="font-size:40px;margin-bottom:12px;">💎</div>
              <h1 style="color:#fff;font-size:26px;font-weight:800;margin:0 0 8px;line-height:1.2;">
                Your 10 free Jades<br>are waiting for you
              </h1>
              <p style="color:#ffb300;font-size:14px;margin:0;letter-spacing:1px;text-transform:uppercase;font-weight:600;">
                Use them right now — 100% free
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="color:rgba(240,236,228,0.75);font-size:15px;line-height:1.7;margin:0 0 24px;">
                Hi! You registered on <strong style="color:#fff;">IsabelaOS Studio</strong> and we want to make sure you know about your free credits.
              </p>
              <p style="color:rgba(240,236,228,0.75);font-size:15px;line-height:1.7;margin:0 0 28px;">
                You have <strong style="color:#ffb300;">10 Jades</strong> in your account — completely free, no credit card needed. Here's what you can do with them:
              </p>

              <!-- Options -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="padding:0 0 12px;">
                    <div style="background:rgba(255,90,0,0.06);border:1px solid rgba(255,90,0,0.15);border-radius:12px;padding:16px 20px;">
                      <div style="font-size:22px;margin-bottom:8px;">🖼️</div>
                      <div style="color:#fff;font-size:15px;font-weight:700;margin-bottom:4px;">Generate AI Images for free</div>
                      <div style="color:rgba(240,236,228,0.6);font-size:13px;line-height:1.6;">
                        Create cinematic photos, product images, portraits — powered by FLUX AI. Each image costs just 1 Jade.
                      </div>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td>
                    <div style="background:rgba(168,85,247,0.06);border:1px solid rgba(168,85,247,0.15);border-radius:12px;padding:16px 20px;">
                      <div style="font-size:22px;margin-bottom:8px;">👤</div>
                      <div style="color:#fff;font-size:15px;font-weight:700;margin-bottom:4px;">Create your Virtual Avatar</div>
                      <div style="color:rgba(240,236,228,0.6);font-size:13px;line-height:1.6;">
                        Upload 3-5 photos of yourself and build your own AI model or virtual influencer. Use it in any scene you imagine.
                      </div>
                    </div>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td align="center">
                    <a href="https://isabelaos.com" style="display:inline-block;background:linear-gradient(135deg,#ff5a00,#ffb300);color:#000;text-decoration:none;font-size:16px;font-weight:800;padding:16px 40px;border-radius:12px;letter-spacing:0.5px;">
                      🚀 Start creating now →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="color:rgba(240,236,228,0.45);font-size:12px;line-height:1.6;margin:0;text-align:center;">
                Your Jades never expire. They're yours whenever you're ready.<br>
                Questions? Write us at <a href="mailto:contacto@isabelaos.com" style="color:#ffb300;">contacto@isabelaos.com</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
              <p style="color:rgba(240,236,228,0.25);font-size:11px;margin:0;">
                © 2025 IsabelaOS Studio · Stalling Technologic · Cobán, Guatemala 🇬🇹<br>
                <a href="https://isabelaos.com/terms" style="color:rgba(240,236,228,0.35);">Terms</a> ·
                <a href="https://isabelaos.com/privacy" style="color:rgba(240,236,228,0.35);">Privacy</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export default async function handler(req, res) {
  res.setHeader("content-type", "application/json; charset=utf-8");

  if (req.method !== "POST")
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const userId = await getUserIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .single();

  if (!ADMIN_EMAILS.includes(profile?.email))
    return res.status(403).json({ ok: false, error: "FORBIDDEN — solo admins" });

  const { data: users, error: usersErr } = await supabaseAdmin.auth.admin.listUsers({
    perPage: 1000,
  });

  if (usersErr) return res.status(500).json({ ok: false, error: usersErr.message });

  const emails = users.users
    .filter(u => u.email && u.email_confirmed_at)
    .map(u => u.email);

  console.log(`[send-campaign] Enviando a ${emails.length} usuarios`);

  const subject = "💎 Your 10 free Jades are waiting — Create AI images now";

  const results = { sent: 0, failed: 0, errors: [] };

  // Lotes de 3 para respetar rate limit de Resend (5/seg)
  for (let i = 0; i < emails.length; i += 3) {
    const batch = emails.slice(i, i + 3);
    await Promise.all(batch.map(async (email) => {
      try {
        const r = await sendEmail(email, subject, buildEmailHTML(email));
        if (r.ok) results.sent++;
        else { results.failed++; results.errors.push({ email, error: r.error }); }
      } catch (e) {
        results.failed++;
        results.errors.push({ email, error: e.message });
      }
    }));
    // 800ms entre lotes — seguro bajo el rate limit
    if (i + 3 < emails.length) await new Promise(r => setTimeout(r, 800));
  }

  console.log(`[send-campaign] Resultado: ${results.sent} enviados, ${results.failed} fallidos`);

  return res.status(200).json({
    ok: true,
    total: emails.length,
    sent: results.sent,
    failed: results.failed,
    errors: results.errors.slice(0, 10),
  });
}

export const config = { runtime: "nodejs" };
