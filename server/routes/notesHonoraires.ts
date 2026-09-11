// Phase 7 extraction — moved out of server.ts's "── Notes d'honoraires ──"
// section. getNextDocNumber (auto-numbering, shared with Proposals) stays
// defined in server.ts and is passed in rather than duplicated, since
// Proposals itself is deliberately not extracted yet (deferred to last with
// invoices/auth/billing per the Phase 7 plan).
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  captureWithContext: (error: any, context: { route: string; tenantId?: string; userId?: string }) => void;
  getNextDocNumber: (tenantId: string, settingCol: string, countTable: string, defaultPrefix: string) => Promise<string>;
  getNextAffaireInvoiceNumber: (tenantId: string, projectId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

export function registerNotesHonorairesRoutes(app: Express, { supabaseAdmin, getTenantId, captureWithContext, getNextDocNumber, getNextAffaireInvoiceNumber, getUserName, logActivity }: RouteDeps) {
  app.get("/api/notes_honoraires", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const projectId = req.query.project_id as string | undefined;
      let query = tenantScopedFrom(supabaseAdmin, tenantId, 'notes_honoraires').select('*').order('created_at', { ascending: false });
      if (projectId) query = query.eq('project_id', projectId);
      const { data, error } = await query;
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) { console.error(e); res.status(500).json({ error: 'Failed to fetch notes honoraires' }); }
  });

  app.post("/api/notes_honoraires", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const body = req.body;
      const id = body.id || crypto.randomUUID();
      const { id: _id, tenant_id: _tid, created_at: _ca, updated_at: _ua, ...insertData } = body;
      // Auto-generate numero if not provided
      if (!insertData.numero) {
        insertData.numero = await getNextDocNumber(tenantId, 'num_prefix_honoraires', 'notes_honoraires', 'NH');
      }
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'notes_honoraires').insert({ ...insertData, id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      if (error) throw error;
      const { data: created } = await tenantScopedFrom(supabaseAdmin, tenantId, 'notes_honoraires').select('*').eq('id', id).single();
      res.status(201).json(created);
    } catch (e: any) { console.error(e); res.status(500).json({ error: 'Failed to create note honoraires: ' + e.message }); }
  });

  app.put("/api/notes_honoraires/:id", async (req: any, res: any) => {
    let tenantId: string | undefined;
    try {
      tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { id: _id, tenant_id: _tid, created_at: _ca, ...updateData } = req.body;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'notes_honoraires').update({ ...updateData, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      const { data: updated } = await tenantScopedFrom(supabaseAdmin, tenantId, 'notes_honoraires').select('*').eq('id', id).single();
      res.json(updated);
    } catch (e: any) { captureWithContext(e, { route: 'PUT /api/notes_honoraires/:id', tenantId, userId: req.user?.id }); res.status(500).json({ error: 'Failed to update note honoraires: ' + e.message }); }
  });

  app.delete("/api/notes_honoraires/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'notes_honoraires').delete().eq('id', req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: 'Failed to delete note honoraires' }); }
  });

  // Génère (ou renvoie, si déjà faite) la facture brouillon d'une note
  // d'honoraires — agence uniquement : les montants cotraitants/sous-traitants
  // de la note restent hors comptabilité agence (cf. le commentaire du schéma
  // sur notes_honoraires.cotraitants_facturation) et ne partent donc jamais
  // dans cette facture. Idempotent via notes_honoraires.invoice_id : rappeler
  // la route sur une note déjà facturée renvoie la facture existante au lieu
  // d'en recréer une.
  app.post("/api/notes_honoraires/:id/facture", async (req: any, res: any) => {
    let tenantId: string | undefined;
    try {
      tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: note } = await tenantScopedFrom(supabaseAdmin, tenantId, 'notes_honoraires').select('*').eq('id', id).maybeSingle();
      if (!note) return res.status(404).json({ error: 'Note honoraires introuvable' });

      if ((note as any).invoice_id) {
        const { data: existing } = await supabaseAdmin.from('invoices').select('*').eq('id', (note as any).invoice_id).eq('tenant_id', tenantId).maybeSingle();
        if (existing) return res.json({ invoice: existing, already_existed: true });
        // La facture référencée a disparu (suppression manuelle) : on en régénère une.
      }

      const { data: settings } = await supabaseAdmin.from('settings').select('agencyName, address, siret, vatNumber').eq('tenant_id', tenantId).single();

      const invoiceId = crypto.randomUUID();
      const created_at = new Date().toISOString();
      const invoiceNumber = await getNextDocNumber(tenantId, 'num_prefix_facture', 'invoices', 'FAC');
      const affaireInvoiceNumber = (note as any).project_id ? await getNextAffaireInvoiceNumber(tenantId, (note as any).project_id) : null;
      const description = `Note d'honoraires ${(note as any).numero || ''}${(note as any).objet ? ' — ' + (note as any).objet : ''}`.trim();

      const { error: insErr } = await supabaseAdmin.from('invoices').insert({
        id: invoiceId, tenant_id: tenantId, invoice_number: invoiceNumber, project_id: (note as any).project_id,
        amount: (note as any).montant_ht || 0, tax_amount: (note as any).montant_tva || 0, total_amount: (note as any).montant_ttc || 0,
        status: 'Draft', due_date: null, issue_date: (note as any).date || created_at.split('T')[0],
        description, created_at,
        seller_name: (settings as any)?.agencyName || null, seller_address: (settings as any)?.address || null,
        seller_siret: (settings as any)?.siret || null, seller_vat_number: (settings as any)?.vatNumber || null,
        seller_iban: null, seller_bic: null, vat_rate: (note as any).tva_rate || 20,
        invoice_type: 'acompte', mission_id: null, mission_name: "Note d'honoraires",
        advancement_pct: (note as any).pct_facturation_cumule || 0,
        affaire_invoice_number: affaireInvoiceNumber, phases: (note as any).phases || [],
      });
      if (insErr) throw insErr;

      const { error: updErr } = await tenantScopedFrom(supabaseAdmin, tenantId, 'notes_honoraires').update({ invoice_id: invoiceId, updated_at: new Date().toISOString() }).eq('id', id);
      if (updErr) throw updErr;

      const { data: invoice } = await supabaseAdmin.from('invoices').select('*').eq('id', invoiceId).single();
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Facture brouillon créée depuis la note d'honoraires "${(note as any).numero || id.slice(0, 8)}"`, description, invoiceId, 'invoice', 'Factures');

      res.status(201).json({ invoice, already_existed: false });
    } catch (e: any) {
      captureWithContext(e, { route: 'POST /api/notes_honoraires/:id/facture', tenantId, userId: req.user?.id });
      res.status(500).json({ error: 'Failed to create draft invoice: ' + e.message });
    }
  });
}
