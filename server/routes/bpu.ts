// ── BPU / DQE ────────────────────────────────────────────────────────────────
// Même forme que server/routes/actData.ts : un document JSONB par projet,
// lu et écrit en bloc, via tenantScopedFrom pour que le filtre tenant ne
// puisse pas être oublié.
//
// Le document et les offres reçues sont deux colonnes distinctes servies par
// deux jeux d'endpoints, et ce n'est pas cosmétique : l'éditeur sauvegarde le
// document entier toutes les deux secondes, donc une offre logée dans le même
// blob serait effacée par la première sauvegarde suivant son import.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

/** Lit la ligne bpu_data du projet, ou null si le BPU n'existe pas encore. */
async function loadRow(supabaseAdmin: any, tenantId: string, projectId: string) {
  const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'bpu_data')
    .select('*').eq('project_id', projectId).single();
  if (error && error.code !== 'PGRST116') throw error;
  return data ?? null;
}

export function registerBpuRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {

  app.get('/api/projects/:projectId/bpu', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      res.json(await loadRow(supabaseAdmin, tenantId, req.params.projectId));
    } catch (e: any) {
      console.error('[GET /api/projects/:projectId/bpu]', e);
      res.status(500).json({ error: 'Failed to fetch BPU' });
    }
  });

  // N'écrit QUE `document`. Les offres passent par leurs propres routes.
  app.put('/api/projects/:projectId/bpu', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      // Déstructuration explicite : tenantScopedFrom.update protège du
      // re-parentage mais persisterait volontiers toute clé inattendue.
      const { document } = req.body;
      if (!document || typeof document !== 'object') {
        return res.status(400).json({ error: 'Champ `document` manquant ou invalide' });
      }
      const existing = await loadRow(supabaseAdmin, tenantId, projectId);
      const payload = { document, updated_at: new Date().toISOString() };

      if (existing) {
        const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'bpu_data')
          .update(payload).eq('id', existing.id).select().single();
        if (error) throw error;
        return res.json(data);
      }

      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'bpu_data')
        .insert({ id: crypto.randomUUID(), project_id: projectId, offres: [], ...payload })
        .select().single();
      if (error) throw error;

      const { data: project } = await supabaseAdmin.from('projects')
        .select('name').eq('id', projectId).eq('tenant_id', tenantId).maybeSingle();
      const projectName = (project as any)?.name || '';
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création du BPU du projet "${projectName}"`, projectName, data.id, 'bpu', 'BPU/DQE');

      res.status(201).json(data);
    } catch (e: any) {
      console.error('[PUT /api/projects/:projectId/bpu]', e);
      res.status(500).json({ error: 'Failed to save BPU: ' + e.message });
    }
  });

  // ── Offres reçues des entreprises ──────────────────────────────────────────

  app.get('/api/projects/:projectId/bpu/offres', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const row = await loadRow(supabaseAdmin, tenantId, req.params.projectId);
      res.json(row?.offres ?? []);
    } catch (e: any) {
      console.error('[GET /api/projects/:projectId/bpu/offres]', e);
      res.status(500).json({ error: 'Failed to fetch offres' });
    }
  });

  app.post('/api/projects/:projectId/bpu/offres', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const { offre } = req.body;
      if (!offre || typeof offre !== 'object') {
        return res.status(400).json({ error: 'Champ `offre` manquant ou invalide' });
      }
      const row = await loadRow(supabaseAdmin, tenantId, projectId);
      if (!row) return res.status(404).json({ error: "Ce projet n'a pas de BPU" });

      const saved = { ...offre, id: offre.id || crypto.randomUUID(), importedAt: new Date().toISOString() };
      const offres = [...(row.offres ?? []), saved];

      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'bpu_data')
        .update({ offres, updated_at: new Date().toISOString() }).eq('id', row.id);
      if (error) throw error;

      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Import de l'offre de "${saved.entrepriseNom}" sur le BPU`, saved.entrepriseNom || '', saved.id, 'bpu_offre', 'BPU/DQE');

      res.status(201).json(saved);
    } catch (e: any) {
      console.error('[POST /api/projects/:projectId/bpu/offres]', e);
      res.status(500).json({ error: "Failed to add offre: " + e.message });
    }
  });

  app.put('/api/projects/:projectId/bpu/offres/:offreId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const row = await loadRow(supabaseAdmin, tenantId, req.params.projectId);
      if (!row) return res.status(404).json({ error: "Ce projet n'a pas de BPU" });

      const current = (row.offres ?? []) as any[];
      const idx = current.findIndex(o => o.id === req.params.offreId);
      if (idx < 0) return res.status(404).json({ error: 'Offre introuvable' });

      // L'identifiant reste celui de l'URL : le corps ne peut pas le déplacer.
      const updated = { ...current[idx], ...req.body, id: current[idx].id };
      const offres = current.map((o, i) => (i === idx ? updated : o));

      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'bpu_data')
        .update({ offres, updated_at: new Date().toISOString() }).eq('id', row.id);
      if (error) throw error;
      res.json(updated);
    } catch (e: any) {
      console.error('[PUT /api/projects/:projectId/bpu/offres/:offreId]', e);
      res.status(500).json({ error: 'Failed to update offre: ' + e.message });
    }
  });

  app.delete('/api/projects/:projectId/bpu/offres/:offreId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const row = await loadRow(supabaseAdmin, tenantId, req.params.projectId);
      if (!row) return res.status(404).json({ error: "Ce projet n'a pas de BPU" });

      const current = (row.offres ?? []) as any[];
      const offres = current.filter(o => o.id !== req.params.offreId);
      if (offres.length === current.length) return res.status(404).json({ error: 'Offre introuvable' });

      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'bpu_data')
        .update({ offres, updated_at: new Date().toISOString() }).eq('id', row.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/projects/:projectId/bpu/offres/:offreId]', e);
      res.status(500).json({ error: 'Failed to delete offre' });
    }
  });
}
