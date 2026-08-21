// In-app support channel — tenant-facing side. A cabinet's members can open
// a ticket and exchange messages with the ArchiOffice platform team; the
// platform-facing side (global inbox, replies) lives in
// server/routes/adminSupport.ts. See supabase/migrate_support_tickets.sql
// for why this isn't built on the existing conversations/messages tables.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { notifyPlatformAdmins } from '../mailer';
import { handleDocumentUpload } from '../documentUpload';
import { sanitizeFilename } from '../sanitizeFilename';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  uploadToStorage: (bucket: string, storagePath: string, buffer: Buffer, mimetype: string) => Promise<string>;
}

export function registerSupportRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, uploadToStorage }: RouteDeps) {
  app.get('/api/support/tickets', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'support_tickets')
        .select('id, subject, status, created_at, last_message_at')
        .order('last_message_at', { ascending: false });
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) {
      console.error("[GET /api/support/tickets]", e); res.status(500).json({ error: e.message }); }
  });

  app.post('/api/support/tickets', handleDocumentUpload('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { subject, message } = req.body;
      const file = req.file;
      if (!subject?.trim() || (!message?.trim() && !file)) {
        return res.status(400).json({ error: 'Sujet et message (ou pièce jointe) requis' });
      }
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      const { data: tenant } = await supabaseAdmin.from('tenants').select('name').eq('id', tenantId).single();

      const { data: ticket, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'support_tickets')
        .insert({ created_by: req.user.id, created_by_name: userName, subject: subject.trim() })
        .select()
        .single();
      if (error) throw error;

      let attachment_url: string | null = null, attachment_name: string | null = null, attachment_type: string | null = null;
      if (file) {
        const storagePath = `${tenantId}/${(ticket as any).id}/${Date.now()}-${sanitizeFilename(file.originalname)}`;
        attachment_url = await uploadToStorage('support-attachments', storagePath, file.buffer, file.mimetype);
        attachment_name = file.originalname;
        attachment_type = file.mimetype;
      }

      await tenantScopedFrom(supabaseAdmin, tenantId, 'support_messages').insert({
        ticket_id: (ticket as any).id, author_type: 'tenant', author_name: userName,
        body: message?.trim() || '', attachment_url, attachment_name, attachment_type,
      });

      notifyPlatformAdmins(
        supabaseAdmin,
        `[Support ArchiOffice] Nouveau ticket — ${(tenant as any)?.name || 'Cabinet'}`,
        `<p><strong>${userName}</strong> (${(tenant as any)?.name || 'Cabinet'}) a ouvert un ticket :</p>
         <p><strong>${subject.trim()}</strong></p>
         <p>${(message?.trim() || '(pièce jointe seule)').replace(/\n/g, '<br>')}</p>`
      ).catch(() => {});

      res.status(201).json(ticket);
    } catch (e: any) {
      console.error("[POST /api/support/tickets]", e); res.status(500).json({ error: e.message }); }
  });

  app.get('/api/support/tickets/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: ticket, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'support_tickets')
        .select('*').eq('id', req.params.id).maybeSingle();
      if (error) throw error;
      if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
      const { data: messages } = await tenantScopedFrom(supabaseAdmin, tenantId, 'support_messages')
        .select('id, author_type, author_name, body, attachment_url, attachment_name, attachment_type, created_at').eq('ticket_id', req.params.id).order('created_at', { ascending: true });
      res.json({ ...ticket, messages: messages || [] });
    } catch (e: any) {
      console.error("[GET /api/support/tickets/:id]", e); res.status(500).json({ error: e.message }); }
  });

  app.post('/api/support/tickets/:id/messages', handleDocumentUpload('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { body } = req.body;
      const file = req.file;
      if (!body?.trim() && !file) return res.status(400).json({ error: 'Message ou pièce jointe requis' });
      const { data: ticket } = await tenantScopedFrom(supabaseAdmin, tenantId, 'support_tickets').select('id, subject').eq('id', req.params.id).maybeSingle();
      if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
      const userName = await getUserName(tenantId, req.user.id, req.user.email);

      let attachment_url: string | null = null, attachment_name: string | null = null, attachment_type: string | null = null;
      if (file) {
        const storagePath = `${tenantId}/${req.params.id}/${Date.now()}-${sanitizeFilename(file.originalname)}`;
        attachment_url = await uploadToStorage('support-attachments', storagePath, file.buffer, file.mimetype);
        attachment_name = file.originalname;
        attachment_type = file.mimetype;
      }

      const { data: message, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'support_messages')
        .insert({ ticket_id: req.params.id, author_type: 'tenant', author_name: userName, body: body?.trim() || '', attachment_url, attachment_name, attachment_type })
        .select().single();
      if (error) throw error;
      await tenantScopedFrom(supabaseAdmin, tenantId, 'support_tickets')
        .update({ status: 'open', last_message_at: new Date().toISOString() }).eq('id', req.params.id);

      notifyPlatformAdmins(
        supabaseAdmin,
        `[Support ArchiOffice] Réponse — ${(ticket as any).subject}`,
        `<p><strong>${userName}</strong> a répondu :</p><p>${(body?.trim() || '(pièce jointe seule)').replace(/\n/g, '<br>')}</p>`
      ).catch(() => {});

      res.status(201).json(message);
    } catch (e: any) {
      console.error("[POST /api/support/tickets/:id/messages]", e); res.status(500).json({ error: e.message }); }
  });

  app.patch('/api/support/tickets/:id/status', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { status } = req.body;
      if (!['open', 'closed'].includes(status)) return res.status(400).json({ error: 'Statut invalide' });
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'support_tickets').update({ status }).eq('id', req.params.id);
      if (error) throw error;
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[PATCH /api/support/tickets/:id/status]", e); res.status(500).json({ error: e.message }); }
  });
}
