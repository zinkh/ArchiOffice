// In-app support channel — platform-facing side (global inbox across every
// tenant, replies). Tenant-facing side lives in server/routes/support.ts.
// Gated the same way as server/routes/superAdmin.ts (kept separate to avoid
// bloating that file further); every reply/status change is audit-logged.
import type { Express } from 'express';
import { isSuperAdmin } from '../superAdminAuth';
import { logAdminAction } from '../adminAudit';
import { notifyTenantAdmins } from '../mailer';
import { handleDocumentUpload } from '../documentUpload';
import { sanitizeFilename } from '../sanitizeFilename';

export interface RouteDeps {
  supabaseAdmin: any;
  uploadToStorage: (bucket: string, storagePath: string, buffer: Buffer, mimetype: string) => Promise<string>;
}

export function registerAdminSupportRoutes(app: Express, { supabaseAdmin, uploadToStorage }: RouteDeps) {
  async function requireSuperAdmin(req: any, res: any, next: any) {
    if (!(await isSuperAdmin(supabaseAdmin, req.user))) {
      return res.status(403).json({ error: 'Accès réservé au super-administrateur' });
    }
    next();
  }

  // Global inbox, optionally filtered to one tenant (used by the tenant
  // detail drill-down, src/pages/AdminTenantDetail.tsx).
  app.get('/api/admin/support/tickets', requireSuperAdmin, async (req: any, res: any) => {
    try {
      let query = supabaseAdmin.from('support_tickets').select('id, tenant_id, subject, status, created_by_name, created_at, last_message_at').order('last_message_at', { ascending: false });
      if (req.query.tenant_id) query = query.eq('tenant_id', req.query.tenant_id);
      const { data: tickets, error } = await query;
      if (error) throw error;
      const tenantIds = [...new Set((tickets || []).map((t: any) => t.tenant_id))];
      const { data: tenants } = tenantIds.length
        ? await supabaseAdmin.from('tenants').select('id, name').in('id', tenantIds)
        : { data: [] };
      const nameById = new Map((tenants || []).map((t: any) => [t.id, t.name]));
      res.json((tickets || []).map((t: any) => ({ ...t, tenant_name: nameById.get(t.tenant_id) || null })));
    } catch (e: any) {
      console.error("[GET /api/admin/support/tickets]", e); res.status(500).json({ error: e.message }); }
  });

  app.get('/api/admin/support/tickets/:id', requireSuperAdmin, async (req: any, res: any) => {
    try {
      const { data: ticket, error } = await supabaseAdmin.from('support_tickets').select('*').eq('id', req.params.id).maybeSingle();
      if (error) throw error;
      if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
      const { data: tenant } = await supabaseAdmin.from('tenants').select('name').eq('id', (ticket as any).tenant_id).maybeSingle();
      const { data: messages } = await supabaseAdmin.from('support_messages')
        .select('id, author_type, author_name, body, attachment_url, attachment_name, attachment_type, created_at').eq('ticket_id', req.params.id).order('created_at', { ascending: true });
      res.json({ ...ticket, tenant_name: (tenant as any)?.name || null, messages: messages || [] });
    } catch (e: any) {
      console.error("[GET /api/admin/support/tickets/:id]", e); res.status(500).json({ error: e.message }); }
  });

  app.post('/api/admin/support/tickets/:id/messages', requireSuperAdmin, handleDocumentUpload('file'), async (req: any, res: any) => {
    try {
      const { body } = req.body;
      const file = req.file;
      if (!body?.trim() && !file) return res.status(400).json({ error: 'Message ou pièce jointe requis' });
      const { data: ticket } = await supabaseAdmin.from('support_tickets').select('id, tenant_id, subject').eq('id', req.params.id).maybeSingle();
      if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
      const authorName = req.user.email || 'Support ArchiOffice';

      let attachment_url: string | null = null, attachment_name: string | null = null, attachment_type: string | null = null;
      if (file) {
        // No tenant of their own to namespace under — use the ticket's
        // actual tenant, matching the storage-path convention every other
        // upload route follows (server/routes/storageAccess.ts's
        // ownership check relies on that `${tenantId}/...` prefix).
        const storagePath = `${(ticket as any).tenant_id}/${req.params.id}/${Date.now()}-${sanitizeFilename(file.originalname)}`;
        attachment_url = await uploadToStorage('support-attachments', storagePath, file.buffer, file.mimetype);
        attachment_name = file.originalname;
        attachment_type = file.mimetype;
      }

      const { data: message, error } = await supabaseAdmin.from('support_messages')
        .insert({ ticket_id: req.params.id, tenant_id: (ticket as any).tenant_id, author_type: 'platform', author_name: authorName, body: body?.trim() || '', attachment_url, attachment_name, attachment_type })
        .select().single();
      if (error) throw error;
      await supabaseAdmin.from('support_tickets')
        .update({ status: 'answered', last_message_at: new Date().toISOString() }).eq('id', req.params.id);

      await logAdminAction(supabaseAdmin, req.user, 'support.replied', (ticket as any).tenant_id, { ticket_id: req.params.id });

      notifyTenantAdmins(
        supabaseAdmin, (ticket as any).tenant_id,
        `[Support ArchiOffice] Réponse à votre ticket — ${(ticket as any).subject}`,
        `<p>L'équipe ArchiOffice a répondu à votre ticket :</p><p>${(body?.trim() || '(pièce jointe seule)').replace(/\n/g, '<br>')}</p>`
      ).catch(() => {});

      res.status(201).json(message);
    } catch (e: any) {
      console.error("[POST /api/admin/support/tickets/:id/messages]", e); res.status(500).json({ error: e.message }); }
  });

  app.patch('/api/admin/support/tickets/:id/status', requireSuperAdmin, async (req: any, res: any) => {
    try {
      const { status } = req.body;
      if (!['open', 'answered', 'closed'].includes(status)) return res.status(400).json({ error: 'Statut invalide' });
      const { data: ticket, error } = await supabaseAdmin.from('support_tickets').update({ status }).eq('id', req.params.id).select('tenant_id').single();
      if (error) throw error;
      await logAdminAction(supabaseAdmin, req.user, 'support.status_changed', (ticket as any)?.tenant_id ?? null, { ticket_id: req.params.id, status });
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[PATCH /api/admin/support/tickets/:id/status]", e); res.status(500).json({ error: e.message }); }
  });
}
