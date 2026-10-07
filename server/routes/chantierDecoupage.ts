// Registre bâtiments / phases du chantier (projects.chantier_decoupage,
// supabase/migrate_chantier_decoupage.sql). Route dédiée : l'enregistrement
// automatique de la fiche (PUT /api/projects/:id) ne le connaît pas et ne peut
// donc jamais l'écraser avec une version périmée. Voir CLAUDE.md, « Chantier en
// plusieurs bâtiments et phases ».
import type { Express } from 'express';
import { sanitizeDecoupage, DECOUPAGE_VIDE } from '../../src/lib/chantierDecoupage';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

const MIGRATION_MISSING = 'Les bâtiments et phases du chantier ne sont pas encore disponibles sur cette instance (migration chantier_decoupage à appliquer).';

const isMissingColumn = (error: any) => /chantier_decoupage/.test(String(error?.message || ''));

export function registerChantierDecoupageRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get('/api/projects/:projectId/chantier-decoupage', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin.from('projects').select('chantier_decoupage')
        .eq('id', req.params.projectId).eq('tenant_id', tenantId).maybeSingle();
      // Colonne absente : un chantier sans registre, pas une panne.
      if (error) return isMissingColumn(error) ? res.json(DECOUPAGE_VIDE) : res.status(500).json({ error: 'Lecture impossible.' });
      if (!data) return res.status(404).json({ error: 'Opération introuvable.' });
      res.json(sanitizeDecoupage((data as any).chantier_decoupage));
    } catch (error) {
      console.error('[GET /api/projects/:projectId/chantier-decoupage]', error);
      res.status(500).json({ error: 'Lecture impossible.' });
    }
  });

  app.put('/api/projects/:projectId/chantier-decoupage', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const registre = sanitizeDecoupage(req.body);
      const { data, error } = await supabaseAdmin.from('projects').update({ chantier_decoupage: registre })
        .eq('id', req.params.projectId).eq('tenant_id', tenantId).select('id');
      if (error) return isMissingColumn(error) ? res.status(503).json({ error: MIGRATION_MISSING }) : res.status(500).json({ error: 'Enregistrement impossible.' });
      if (!data || data.length === 0) return res.status(404).json({ error: 'Opération introuvable.' });
      res.json(registre);
    } catch (error) {
      console.error('[PUT /api/projects/:projectId/chantier-decoupage]', error);
      res.status(500).json({ error: 'Enregistrement impossible.' });
    }
  });
}
