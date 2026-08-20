// Phase 7 extraction — moved out of server.ts's "---- Inscription SaaS
// (route publique) ----" section, plus the neighboring public tenant-branding
// lookup. All four routes are under the AUTH_EXEMPT "/api/public" prefix —
// reachable without a session, by design (sign-up, password reset).
import type { Express } from 'express';
import { publicAuthLimiter } from '../rateLimit';
import { sendPlatformMail } from '../mailer';

export interface RouteDeps {
  supabaseAdmin: any;
}

export function registerRegistrationRoutes(app: Express, { supabaseAdmin }: RouteDeps) {
  // ---- Inscription SaaS (route publique) ----
  app.post("/api/public/register", publicAuthLimiter, async (req, res) => {
    try {
      const { cabinet_name, slug, admin_name, email, password, consent } = req.body;
      if (!cabinet_name || !slug || !admin_name || !email || !password) {
        return res.status(400).json({ error: "Tous les champs sont requis." });
      }
      if (String(password).length < 8) {
        return res.status(400).json({ error: "Le mot de passe doit contenir au moins 8 caractères." });
      }
      // Server-side enforcement of the consent checkbox — the frontend's
      // `required` attribute alone isn't proof of consent for a CNIL audit,
      // and a direct API call could otherwise skip it entirely.
      if (consent !== true) {
        return res.status(400).json({ error: "Vous devez accepter la politique de confidentialité et les CGU." });
      }
      const consentedAt = new Date().toISOString();
      // Vérifier unicité du slug
      const { data: existing } = await supabaseAdmin
        .from("tenants")
        .select("id")
        .eq("slug", slug)
        .single();
      if (existing) {
        return res.status(409).json({ error: "Cet identifiant est déjà pris." });
      }

      // Créer l'utilisateur Supabase Auth SANS confirmer l'email — la confirmation
      // se fait via le lien envoyé ci-dessous (email_confirm: true bypassait
      // totalement la vérification d'adresse).
      const appUrl = process.env.APP_URL || 'http://localhost:3000';
      const { data: linkData, error: signUpError } = await supabaseAdmin.auth.admin.generateLink({
        type: 'signup',
        email,
        password,
        options: { data: { name: admin_name }, redirectTo: `${appUrl}/login?confirmed=1` },
      });
      if (signUpError || !linkData?.user) {
        return res.status(400).json({ error: signUpError?.message || "Erreur création compte." });
      }
      const userId = linkData.user.id;

      // Créer le tenant
      const { data: tenant, error: tenantError } = await supabaseAdmin
        .from("tenants")
        .insert({ slug, name: cabinet_name })
        .select()
        .single();
      if (tenantError || !tenant) {
        await supabaseAdmin.auth.admin.deleteUser(userId);
        return res.status(500).json({ error: "Erreur création cabinet." });
      }
      // Lier le profil au tenant
      await supabaseAdmin
        .from("profiles")
        .upsert({ id: userId, tenant_id: tenant.id, name: admin_name, email, system_role: "admin", role: "admin", terms_accepted_at: consentedAt });

      const emailSent = linkData.properties?.action_link
        ? await sendPlatformMail(
            email,
            "Confirmez votre adresse email — ArchiOffice",
            `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
               <h2 style="color: #2563eb;">Bienvenue sur ArchiOffice</h2>
               <p>Bonjour ${admin_name},</p>
               <p>Le cabinet <strong>${cabinet_name}</strong> dispose de 14 jours d'essai gratuit pour découvrir ArchiOffice : projets, devis, CCTP, planning, et bien plus.</p>
               <p style="margin: 24px 0;"><a href="${linkData.properties.action_link}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Confirmer mon adresse email</a></p>
               <p style="color: #64748b; font-size: 14px;">Si le bouton ne fonctionne pas, copiez ce lien : ${linkData.properties.action_link}</p>
             </div>`
          )
        : false;

      res.json({ success: true, tenant_id: tenant.id, emailSent });
    } catch (e: any) {
      console.error('[register] Unexpected error:', e);
      res.status(500).json({ error: e.message || "Erreur lors de l'inscription." });
    }
  });

  // Renvoyer l'email de confirmation (ne révèle jamais si le compte existe).
  app.post("/api/public/resend-confirmation", publicAuthLimiter, async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim();
      if (!email) return res.status(400).json({ error: "Email requis" });

      const { data: profile } = await supabaseAdmin.from('profiles').select('id').eq('email', email).maybeSingle();
      if (profile) {
        const appUrl = process.env.APP_URL || 'http://localhost:3000';
        const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
          type: 'magiclink',
          email,
          options: { redirectTo: `${appUrl}/login?confirmed=1` },
        });
        if (linkData?.properties?.action_link) {
          await sendPlatformMail(
            email,
            "Confirmez votre adresse email — ArchiOffice",
            `<p>Confirmez votre adresse email : <a href="${linkData.properties.action_link}">${linkData.properties.action_link}</a></p>`
          );
        }
      }
      res.json({ success: true });
    } catch (e: any) {
      console.error("[POST /api/public/resend-confirmation]", e); res.status(500).json({ error: e.message }); }
  });

  // Envoyer un email de réinitialisation de mot de passe (ne révèle jamais si le compte existe).
  app.post("/api/public/forgot-password", publicAuthLimiter, async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim();
      if (!email) return res.status(400).json({ error: "Email requis" });

      const { data: profile } = await supabaseAdmin.from('profiles').select('id').eq('email', email).maybeSingle();
      if (profile) {
        const appUrl = process.env.APP_URL || 'http://localhost:3000';
        const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
          type: 'recovery',
          email,
          options: { redirectTo: `${appUrl}/reset-password` },
        });
        if (linkData?.properties?.action_link) {
          await sendPlatformMail(
            email,
            "Réinitialisation de votre mot de passe — ArchiOffice",
            `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
               <h2 style="color: #2563eb;">Réinitialisation de mot de passe</h2>
               <p>Vous avez demandé la réinitialisation du mot de passe de votre compte ArchiOffice.</p>
               <p style="margin: 24px 0;"><a href="${linkData.properties.action_link}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Réinitialiser mon mot de passe</a></p>
               <p style="color: #64748b; font-size: 14px;">Si le bouton ne fonctionne pas, copiez ce lien : ${linkData.properties.action_link}</p>
               <p style="color: #64748b; font-size: 14px;">Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email.</p>
             </div>`
          );
        }
      }
      res.json({ success: true });
    } catch (e: any) {
      console.error("[POST /api/public/forgot-password]", e); res.status(500).json({ error: e.message }); }
  });

  // Public: get tenant branding info by slug (used on subdomain login page)
  app.get("/api/public/tenant/:slug", async (req: any, res: any) => {
    try {
      const { slug } = req.params;
      const { data: tenant } = await supabaseAdmin.from('tenants').select('id, name, slug').eq('slug', slug).single();
      if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
      const { data: settings } = await supabaseAdmin.from('settings').select('logo_url, agency_name').eq('tenant_id', tenant.id).single();
      res.json({
        slug: tenant.slug,
        name: (settings as any)?.agency_name || tenant.name,
        logoUrl: (settings as any)?.logo_url || null,
      });
    } catch (e: any) {
      console.error("[GET /api/public/tenant/:slug]", e);
      res.status(500).json({ error: e.message });
    }
  });
}
