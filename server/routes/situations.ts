// Phase 7 extraction — moved verbatim out of server.ts's "─── Situations
// CRUD ───" and "─── Detail Situations CRUD ───" sections (detail_situations
// rows are line items of a parent situation — kept together as one domain
// module, same convention as dpgf.ts). GET /api/situations/:projectId and
// GET /api/situations/:situationId/details join from the Projects section
// (server/routes/projects.ts) this same lot — read counterparts of the
// mutations already here, just never extracted alongside them.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => Promise<void>;
}

export function registerSituationRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  app.get('/api/situations/:projectId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'situations').select('*').eq('project_id', req.params.projectId);
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch situations" }); }
  });

  app.get('/api/situations/:situationId/details', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'detail_situations').select('*').eq('situation_id', req.params.situationId);
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch situation details" }); }
  });

  app.post('/api/situations', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, project_id, numero, date_situation, statut } = req.body;
      const id = bodyId || crypto.randomUUID();
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'situations')
        .insert({ id, project_id, numero, date_situation, statut })
        .select().single();
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création de la situation N° ${numero}`, String(numero ?? ''), id, 'situation', 'Situations/DPGF');
      res.status(201).json(data);
    } catch (e: any) {
      console.error('[POST /api/situations]', e);
      res.status(500).json({ error: 'Failed to create situation: ' + e.message });
    }
  });

  app.put('/api/situations/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { numero, date_situation, statut } = req.body;
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'situations')
        .update({ numero, date_situation, statut })
        .eq('id', req.params.id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error('[PUT /api/situations/:id]', e);
      res.status(500).json({ error: 'Failed to update situation: ' + e.message });
    }
  });

  app.delete('/api/situations/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: situation } = await tenantScopedFrom(supabaseAdmin, tenantId, 'situations').select('numero').eq('id', req.params.id).maybeSingle();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'situations').delete().eq('id', req.params.id);
      if (error) throw error;
      const numero = (situation as any)?.numero;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression de la situation N° ${numero}`, String(numero ?? ''), req.params.id, 'situation', 'Situations/DPGF');
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/situations/:id]', e);
      res.status(500).json({ error: 'Failed to delete situation' });
    }
  });

  app.post('/api/detail-situations', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, situation_id, dpgf_item_id, quantite_realisee, montant_situation } = req.body;
      const id = bodyId || crypto.randomUUID();
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'detail_situations')
        .insert({ id, situation_id, dpgf_item_id, quantite_realisee, montant_situation })
        .select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) {
      console.error('[POST /api/detail-situations]', e);
      res.status(500).json({ error: 'Failed to create detail situation: ' + e.message });
    }
  });

  app.put('/api/detail-situations/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { quantite_realisee, montant_situation } = req.body;
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'detail_situations')
        .update({ quantite_realisee, montant_situation })
        .eq('id', req.params.id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error('[PUT /api/detail-situations/:id]', e);
      res.status(500).json({ error: 'Failed to update detail situation: ' + e.message });
    }
  });

  app.delete('/api/detail-situations/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'detail_situations').delete().eq('id', req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/detail-situations/:id]', e);
      res.status(500).json({ error: 'Failed to delete detail situation' });
    }
  });
}
