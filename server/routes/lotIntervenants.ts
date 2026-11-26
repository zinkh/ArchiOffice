// Intervenants des entreprises d'un lot (onglet DET > Entreprises) : plusieurs personnes par
// entreprise, chacune avec un rôle. Une instance sans la table lit une liste vide et refuse
// l'écriture en 503.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

const TABLE = 'lot_intervenants';
const MAX_PAR_LOT = 100;
const texte = (v: unknown, max: number): string | null => {
  const s = typeof v === 'string' ? v.trim().slice(0, max) : '';
  return s || null;
};
const manquante = (e: any): boolean => !!e && (e.code === '42P01' || e.code === 'PGRST205');
const MSG_503 = 'La table des intervenants n’est pas encore créée sur cette instance (migration migrate_lot_intervenants.sql).';

export function registerLotIntervenantsRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get('/api/projects/:projectId/lot-intervenants', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE)
        .select('*').eq('project_id', req.params.projectId).order('created_at', { ascending: true });
      if (error) return manquante(error) ? res.json([]) : res.status(500).json({ error: 'Lecture impossible.' });
      res.json(data ?? []);
    } catch (e: any) {
      console.error('[GET /api/projects/:id/lot-intervenants]', e);
      res.status(500).json({ error: 'Lecture impossible.' });
    }
  });

  app.post('/api/lots/:lotId/intervenants', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const nom = texte(req.body?.nom, 200);
      const entreprise = texte(req.body?.entreprise, 200);
      if (!nom) return res.status(400).json({ error: 'Le nom de l’intervenant est obligatoire.' });
      if (!entreprise) return res.status(400).json({ error: 'L’entreprise est obligatoire.' });
      const { data: lot } = await supabaseAdmin.from('project_lots').select('id, project_id')
        .eq('id', req.params.lotId).eq('tenant_id', tenantId).maybeSingle();
      if (!lot) return res.status(404).json({ error: 'Lot introuvable.' });
      const { count, error: errCount } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE)
        .select('id', { count: 'exact', head: true }).eq('lot_id', lot.id);
      if (errCount && manquante(errCount)) return res.status(503).json({ error: MSG_503 });
      if ((count ?? 0) >= MAX_PAR_LOT) return res.status(400).json({ error: `Pas plus de ${MAX_PAR_LOT} intervenants par lot.` });
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE).insert({
        id: crypto.randomUUID(), project_id: lot.project_id, lot_id: lot.id, entreprise, nom,
        role: texte(req.body?.role, 120), telephone: texte(req.body?.telephone, 40), email: texte(req.body?.email, 200),
      }).select().single();
      if (error) return manquante(error) ? res.status(503).json({ error: MSG_503 }) : res.status(500).json({ error: 'Enregistrement impossible.' });
      res.status(201).json(data);
    } catch (e: any) {
      console.error('[POST /api/lots/:id/intervenants]', e);
      res.status(500).json({ error: 'Enregistrement impossible.' });
    }
  });

  app.put('/api/lot-intervenants/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const nom = texte(req.body?.nom, 200);
      if (!nom) return res.status(400).json({ error: 'Le nom de l’intervenant est obligatoire.' });
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE).update({
        nom, role: texte(req.body?.role, 120), telephone: texte(req.body?.telephone, 40), email: texte(req.body?.email, 200),
      }).eq('id', req.params.id).select().maybeSingle();
      if (error) return manquante(error) ? res.status(503).json({ error: MSG_503 }) : res.status(500).json({ error: 'Enregistrement impossible.' });
      if (!data) return res.status(404).json({ error: 'Intervenant introuvable.' });
      res.json(data);
    } catch (e: any) {
      console.error('[PUT /api/lot-intervenants/:id]', e);
      res.status(500).json({ error: 'Enregistrement impossible.' });
    }
  });

  app.delete('/api/lot-intervenants/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE).delete().eq('id', req.params.id);
      if (error) return manquante(error) ? res.status(503).json({ error: MSG_503 }) : res.status(500).json({ error: 'Suppression impossible.' });
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/lot-intervenants/:id]', e);
      res.status(500).json({ error: 'Suppression impossible.' });
    }
  });
}
