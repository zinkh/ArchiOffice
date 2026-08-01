// Phase 7 extraction — moved out of server.ts's "── Meeting Attendees ──"
// section. Self-contained CRUD on meeting_attendees (+ contacts lookups),
// no dependency on any other route module beyond the usual pair.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerMeetingAttendeeRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get("/api/meetings/:id/attendees", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: attendees, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'meeting_attendees')
        .select('id, contact_id, role')
        .eq('meeting_id', id);
      if (error) throw error;
      if (!attendees?.length) return res.json([]);
      const contactIds = attendees.map((a: any) => a.contact_id);
      const { data: contacts } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts')
        .select('id, first_name, last_name, company_name, job_title, phone_mobile, phone_work, phone, email, email_work, email_home')
        .in('id', contactIds);
      const contactMap: Record<string, any> = {};
      (contacts || []).forEach((c: any) => { contactMap[c.id] = c; });
      res.json(attendees.map((a: any) => ({ ...a, contact: contactMap[a.contact_id] || null })));
    } catch (e: any) {
      console.error("[GET /api/meetings/:id/attendees]", e); res.status(500).json({ error: e.message }); }
  });

  // Add existing contact as attendee
  app.post("/api/meetings/:id/attendees", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { contact_id, role } = req.body;
      if (!contact_id) return res.status(400).json({ error: "contact_id required" });
      // Check no duplicate
      const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, 'meeting_attendees')
        .select('id')
        .eq('meeting_id', id)
        .eq('contact_id', contact_id)
        .maybeSingle();
      if (existing) return res.status(409).json({ error: "Already added" });
      const attendeeId = crypto.randomUUID();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'meeting_attendees')
        .insert({ id: attendeeId, meeting_id: id, contact_id, role: role || null });
      if (error) throw error;
      const { data: contact } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts')
        .select('id, first_name, last_name, company_name, job_title, phone_mobile, phone_work, phone, email, email_work, email_home')
        .eq('id', contact_id)
        .single();
      res.status(201).json({ id: attendeeId, contact_id, role, contact });
    } catch (e: any) {
      console.error("[POST /api/meetings/:id/attendees]", e); res.status(500).json({ error: e.message }); }
  });

  // Create new contact and add as attendee
  app.post("/api/meetings/:id/attendees/new-contact", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { first_name, last_name, company_name, job_title, phone_mobile, email, role } = req.body;
      if (!first_name && !last_name) return res.status(400).json({ error: "Nom requis" });
      const contactId = crypto.randomUUID();
      const created_at = new Date().toISOString();
      const { error: ce } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').insert({
        id: contactId,
        first_name: first_name || '',
        last_name: last_name || '',
        company_name: company_name || null,
        job_title: job_title || null,
        phone_mobile: phone_mobile || null,
        phone: phone_mobile || '',
        email: email || '',
        address: '', zip: '', city: '', state: '', country: '',
        candidatures: '', affaires: '', logo: '', ca_amount: 0,
        electronic_signature: '', contact_references: '', tags: '',
        created_at, created_by: req.user.id
      });
      if (ce) throw ce;
      const attendeeId = crypto.randomUUID();
      const { error: ae } = await tenantScopedFrom(supabaseAdmin, tenantId, 'meeting_attendees')
        .insert({ id: attendeeId, meeting_id: id, contact_id: contactId, role: role || null });
      if (ae) throw ae;
      const contact = { id: contactId, first_name, last_name, company_name, job_title, phone_mobile, phone: phone_mobile || '', email, email_work: null, email_home: null, phone_work: null };
      res.status(201).json({ id: attendeeId, contact_id: contactId, role, contact });
    } catch (e: any) {
      console.error("[POST /api/meetings/:id/attendees/new-contact]", e); res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/meetings/:meetingId/attendees/:attendeeId", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { attendeeId } = req.params;
      const { role } = req.body;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'meeting_attendees').update({ role }).eq('id', attendeeId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error("[PATCH /api/meetings/:meetingId/attendees/:attendeeId]", e); res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/meetings/:meetingId/attendees/:attendeeId", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { attendeeId } = req.params;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'meeting_attendees').delete().eq('id', attendeeId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error("[DELETE /api/meetings/:meetingId/attendees/:attendeeId]", e); res.status(500).json({ error: e.message }); }
  });
}
