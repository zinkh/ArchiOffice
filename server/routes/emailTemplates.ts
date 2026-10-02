// Customizable email templates (Réglages > Communication), one row per
// `kind` of email the app actually sends (see seedEmailTemplates.ts for the
// list and the text each kind seeds from). Mirrors the CRUD shape of
// documentTemplates.ts but simpler: no categories, no is_default — a `kind`
// already identifies its one template, so there's nothing to choose between.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { SEED_EMAIL_TEMPLATES } from '../seedEmailTemplates';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerEmailTemplateRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get("/api/email_templates", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: existing, error: readErr } = await tenantScopedFrom(supabaseAdmin, tenantId, 'email_templates').select('*');
      if (readErr) throw readErr;
      const existingKinds = new Set((existing || []).map((t: any) => t.kind));
      // Per-kind, not count-gated like document_templates: a `kind` added to
      // SEED_EMAIL_TEMPLATES after a tenant's first read must still show up,
      // rather than only ever seeding on a brand-new tenant.
      const missing = SEED_EMAIL_TEMPLATES.filter(t => !existingKinds.has(t.kind));
      if (missing.length > 0) {
        const now = new Date().toISOString();
        const seedRows = missing.map(t => ({
          id: crypto.randomUUID(), tenant_id: tenantId, kind: t.kind,
          subject: t.subject, body: t.body, created_at: now, updated_at: now,
        }));
        const { error: seedErr } = await tenantScopedFrom(supabaseAdmin, tenantId, 'email_templates').insert(seedRows);
        if (seedErr) throw seedErr;
      }
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'email_templates').select('*').order('kind');
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to fetch email templates" }); }
  });

  app.put("/api/email_templates/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { subject, body } = req.body;
      if (!subject || !body) return res.status(400).json({ error: 'subject et body requis' });
      const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, 'email_templates').select('id').eq('id', id).maybeSingle();
      if (!existing) return res.status(404).json({ error: 'Modèle introuvable' });
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'email_templates').update({
        subject, body, updated_at: new Date().toISOString(),
      }).eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to update email template" }); }
  });

  // Restores the seeded auto-text for this template's kind — the "texte
  // automatique" a cabinet can always fall back to after personalizing it.
  app.post("/api/email_templates/:id/reset", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, 'email_templates').select('kind').eq('id', id).maybeSingle();
      if (!existing) return res.status(404).json({ error: 'Modèle introuvable' });
      const seed = SEED_EMAIL_TEMPLATES.find(t => t.kind === existing.kind);
      if (!seed) return res.status(400).json({ error: "Aucun texte automatique pour ce modèle" });
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'email_templates').update({
        subject: seed.subject, body: seed.body, updated_at: new Date().toISOString(),
      }).eq('id', id);
      if (error) throw error;
      res.json({ success: true, subject: seed.subject, body: seed.body });
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to reset email template" }); }
  });
}
