// Phase 7 extraction — moved verbatim out of server.ts's "─── DPGF Items
// CRUD ───" and "─── DPGFs CRUD ───" sections (dpgf_items are children of a
// parent dpgfs row — kept together as one domain module). GET
// /api/dpgf/:projectId joins from the Projects section (server/routes/projects.ts)
// this same lot — it's the read counterpart of the mutations already here,
// just never extracted alongside them. GET/POST /api/projects/:projectId/dpgf
// joins in a later lot: a different route shape (one JSON blob per project,
// upserted wholesale) than the per-field CRUD below, but the same `dpgfs`
// table.
//
// This is also, since the CCTP consolidation (see CLAUDE.md's "Le CCTP n'est
// pas un document séparé" section), the ONLY document endpoint the CCTP
// editor talks to: CCTPEditor.tsx writes `cctpDescription`/`cctpOnly` fields
// straight onto this same lots/chapitres/lignes tree (« le CCTP partage le
// même dpgf.lots ») rather than a separate document. There used to be a
// parallel `cctps` table with its own GET/POST /api/projects/:projectId/cctp
// route (server/routes/cctps.ts, now removed) that no production UI ever
// wrote to through the live CCTPEditor — see that CLAUDE.md section for why
// the table itself is left in place, unused, rather than dropped.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { assertTenantEntity } from '../assertTenantEntity';
import { remonterPrixOffre } from '../articlePrices';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

/**
 * Lit la ligne dpgfs du projet (document + offres), ou null si le DPGF
 * n'existe pas encore. Distinct de la lecture de GET /dpgf : celle-ci ne rend
 * que le document parsé, pour ne rien changer au contrat qu'useDPGF.ts et
 * ProTab.tsx lui connaissent déjà.
 */
async function loadRow(supabaseAdmin: any, tenantId: string, projectId: string) {
  const { data, error } = await supabaseAdmin.from('dpgfs').select('*')
    .eq('project_id', projectId).eq('tenant_id', tenantId).single();
  if (error && error.code !== 'PGRST116') throw error;
  return data ?? null;
}

export function registerDpgfRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  app.get('/api/projects/:projectId/dpgf', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const { data: dpgf, error } = await supabaseAdmin.from('dpgfs').select('*').eq('project_id', projectId).eq('tenant_id', tenantId).single();
      if (error && error.code !== 'PGRST116') throw error;
      if (dpgf) {
        res.json(typeof (dpgf as any).data === 'string' ? JSON.parse((dpgf as any).data) : (dpgf as any).data);
      } else {
        res.status(404).json({ error: "DPGF not found" });
      }
    } catch (error) {
      console.error("[GET /api/projects/:projectId/dpgf]", error);
      res.status(500).json({ error: "Failed to fetch DPGF" });
    }
  });

  app.post('/api/projects/:projectId/dpgf', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const data = req.body;
      const id = data.id === 'new' ? crypto.randomUUID() : (data.id || crypto.randomUUID());
      data.id = id;
      const { data: existing } = await supabaseAdmin.from('dpgfs').select('id').eq('project_id', projectId).eq('tenant_id', tenantId).single();
      if (existing) {
        await supabaseAdmin.from('dpgfs').update({ data: JSON.stringify(data) }).eq('project_id', projectId).eq('tenant_id', tenantId);
      } else {
        await supabaseAdmin.from('dpgfs').insert({ id, tenant_id: tenantId, project_id: projectId, data: JSON.stringify(data) });
        const { data: project } = await supabaseAdmin.from('projects').select('name').eq('id', projectId).eq('tenant_id', tenantId).maybeSingle();
        const projectName = (project as any)?.name || '';
        const userName = await getUserName(tenantId, req.user.id, req.user.email);
        logActivity(tenantId, req.user.id, userName, `Création du DPGF du projet "${projectName}"`, projectName, id, 'dpgf', 'Situations/DPGF');
      }
      res.json(data);
    } catch (error) {
      console.error("[POST /api/projects/:projectId/dpgf]", error);
      res.status(500).json({ error: "Failed to save DPGF" });
    }
  });

  // ── Offres reçues des entreprises ──────────────────────────────────────────
  // Même raisonnement que server/routes/bpu.ts : une colonne séparée du
  // document, servie par ses propres endpoints — l'autosauvegarde du DPGF
  // réécrit `data` en bloc, une offre logée dedans serait effacée par la
  // sauvegarde suivant son import. Un DPGF verse désormais lui aussi ses
  // offres au comparatif ACT (lib/documentToAct.ts), au même titre qu'un BPU.

  app.get('/api/projects/:projectId/dpgf/offres', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const row = await loadRow(supabaseAdmin, tenantId, req.params.projectId);
      res.json(row?.offres ?? []);
    } catch (e: any) {
      console.error('[GET /api/projects/:projectId/dpgf/offres]', e);
      res.status(500).json({ error: 'Failed to fetch offres' });
    }
  });

  app.post('/api/projects/:projectId/dpgf/offres', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const { offre } = req.body;
      if (!offre || typeof offre !== 'object') {
        return res.status(400).json({ error: 'Champ `offre` manquant ou invalide' });
      }
      const row = await loadRow(supabaseAdmin, tenantId, projectId);
      if (!row) return res.status(404).json({ error: "Ce projet n'a pas de DPGF" });

      const saved = { ...offre, id: offre.id || crypto.randomUUID(), importedAt: new Date().toISOString() };
      const offres = [...(row.offres ?? []), saved];

      const { error } = await supabaseAdmin.from('dpgfs')
        .update({ offres }).eq('id', row.id).eq('tenant_id', tenantId);
      if (error) throw error;

      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Import de l'offre de "${saved.entrepriseNom}" sur le DPGF`, saved.entrepriseNom || '', saved.id, 'dpgf_offre', 'Situations/DPGF');

      // Remontée vers la bibliothèque d'ouvrages, en meilleur effort : l'offre
      // est déjà enregistrée, un échec ici ne doit pas la faire perdre.
      const documentDpgf = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      let prixRemontes = 0;
      try {
        prixRemontes = await remonterPrixOffre(supabaseAdmin, tenantId, {
          projectId, sourceKind: 'dpgf', document: documentDpgf, offre: saved, userId: req.user.id,
        });
      } catch (e: any) {
        console.error('[POST dpgf/offres] remontée des prix', e);
      }

      res.status(201).json({ ...saved, prixRemontes });
    } catch (e: any) {
      console.error('[POST /api/projects/:projectId/dpgf/offres]', e);
      res.status(500).json({ error: "Failed to add offre: " + e.message });
    }
  });

  app.put('/api/projects/:projectId/dpgf/offres/:offreId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const row = await loadRow(supabaseAdmin, tenantId, req.params.projectId);
      if (!row) return res.status(404).json({ error: "Ce projet n'a pas de DPGF" });

      const current = (row.offres ?? []) as any[];
      const idx = current.findIndex(o => o.id === req.params.offreId);
      if (idx < 0) return res.status(404).json({ error: 'Offre introuvable' });

      // L'identifiant reste celui de l'URL : le corps ne peut pas le déplacer.
      const updated = { ...current[idx], ...req.body, id: current[idx].id };
      const offres = current.map((o, i) => (i === idx ? updated : o));

      const { error } = await supabaseAdmin.from('dpgfs')
        .update({ offres }).eq('id', row.id).eq('tenant_id', tenantId);
      if (error) throw error;

      // Une correction de prix ou un changement de statut change ce que
      // l'offre dit : on rejoue la remontée, dont l'upsert sur `source_ref`
      // rectifie les observations déjà écrites au lieu de les doubler.
      const documentDpgf = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      let prixRemontes = 0;
      try {
        prixRemontes = await remonterPrixOffre(supabaseAdmin, tenantId, {
          projectId: req.params.projectId, sourceKind: 'dpgf', document: documentDpgf,
          offre: updated, userId: req.user.id,
        });
      } catch (e: any) {
        console.error('[PUT dpgf/offres] remontée des prix', e);
      }

      res.json({ ...updated, prixRemontes });
    } catch (e: any) {
      console.error('[PUT /api/projects/:projectId/dpgf/offres/:offreId]', e);
      res.status(500).json({ error: 'Failed to update offre: ' + e.message });
    }
  });

  app.delete('/api/projects/:projectId/dpgf/offres/:offreId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const row = await loadRow(supabaseAdmin, tenantId, req.params.projectId);
      if (!row) return res.status(404).json({ error: "Ce projet n'a pas de DPGF" });

      const current = (row.offres ?? []) as any[];
      const offres = current.filter(o => o.id !== req.params.offreId);
      if (offres.length === current.length) return res.status(404).json({ error: 'Offre introuvable' });

      const { error } = await supabaseAdmin.from('dpgfs')
        .update({ offres }).eq('id', row.id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/projects/:projectId/dpgf/offres/:offreId]', e);
      res.status(500).json({ error: 'Failed to delete offre' });
    }
  });

  app.get('/api/dpgf/:projectId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'dpgf_items').select('*').eq('project_id', req.params.projectId);
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch dpgf items" }); }
  });

  app.post('/api/dpgf', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, project_id, dpgf_id, lot_number, lot_title, item_number, description, unit, quantity, unit_price } = req.body;
      if (project_id && !(await assertTenantEntity(supabaseAdmin, 'projects', project_id, tenantId))) {
        return res.status(400).json({ error: "Projet introuvable pour ce cabinet." });
      }
      if (dpgf_id && !(await assertTenantEntity(supabaseAdmin, 'dpgfs', dpgf_id, tenantId))) {
        return res.status(400).json({ error: "DPGF introuvable pour ce cabinet." });
      }
      const id = bodyId || crypto.randomUUID();
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'dpgf_items')
        .insert({ id, project_id, dpgf_id, lot_number, lot_title, item_number, description, unit, quantity, unit_price })
        .select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) {
      console.error('[POST /api/dpgf]', e);
      res.status(500).json({ error: 'Failed to create DPGF item: ' + e.message });
    }
  });

  app.put('/api/dpgf/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { lot_number, lot_title, item_number, description, unit, quantity, unit_price } = req.body;
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'dpgf_items')
        .update({ lot_number, lot_title, item_number, description, unit, quantity, unit_price })
        .eq('id', req.params.id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error('[PUT /api/dpgf/:id]', e);
      res.status(500).json({ error: 'Failed to update DPGF item: ' + e.message });
    }
  });

  app.delete('/api/dpgf/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'dpgf_items').delete().eq('id', req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/dpgf/:id]', e);
      res.status(500).json({ error: 'Failed to delete DPGF item' });
    }
  });

  app.post('/api/dpgfs', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, project_id, title, version } = req.body;
      if (project_id && !(await assertTenantEntity(supabaseAdmin, 'projects', project_id, tenantId))) {
        return res.status(400).json({ error: "Projet introuvable pour ce cabinet." });
      }
      const id = bodyId || crypto.randomUUID();
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'dpgfs').insert({ id, project_id, title, version }).select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) {
      console.error('[POST /api/dpgfs]', e);
      res.status(500).json({ error: 'Failed to create DPGF: ' + e.message });
    }
  });

  app.put('/api/dpgfs/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { title, version } = req.body;
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'dpgfs').update({ title, version }).eq('id', req.params.id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error('[PUT /api/dpgfs/:id]', e);
      res.status(500).json({ error: 'Failed to update DPGF: ' + e.message });
    }
  });

  app.delete('/api/dpgfs/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'dpgfs').delete().eq('id', req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/dpgfs/:id]', e);
      res.status(500).json({ error: 'Failed to delete DPGF' });
    }
  });
}
