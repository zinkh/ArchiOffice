// Sous-traitants d'un marché de travaux (onglet RDT). Lus par le panneau de
// chantier pour la liste publique des entreprises (QR code), jamais imprimés sur
// le panneau lui-même. Une instance sans la table lit une liste vide et refuse
// l'écriture en 503.
import type { Express } from 'express';
import { assertTenantEntity } from '../assertTenantEntity';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

const TABLE = 'marche_sous_traitants';
const MAX_PAR_MARCHE = 50;
const texte = (v: unknown, max: number): string | null => {
  const s = typeof v === 'string' ? v.trim().slice(0, max) : '';
  return s || null;
};
const manquante = (e: any): boolean => !!e && (e.code === '42P01' || e.code === 'PGRST205');
const MSG_503 = 'La table des sous-traitants n’est pas encore créée sur cette instance (migration migrate_marche_sous_traitants.sql).';

export function registerMarcheSousTraitantsRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get('/api/projects/:projectId/sous-traitants', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE)
        .select('*').eq('project_id', req.params.projectId).order('created_at', { ascending: true });
      if (error) return manquante(error) ? res.json([]) : res.status(500).json({ error: 'Lecture impossible.' });
      res.json(data ?? []);
    } catch (e: any) {
      console.error('[GET /api/projects/:id/sous-traitants]', e);
      res.status(500).json({ error: 'Lecture impossible.' });
    }
  });

  app.post('/api/marches-entreprises/:marcheId/sous-traitants', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const nom = texte(req.body?.nom, 200);
      if (!nom) return res.status(400).json({ error: 'Le nom du sous-traitant est obligatoire.' });
      const { data: marche } = await supabaseAdmin.from('marches_entreprises').select('id, project_id, type_marche')
        .eq('id', req.params.marcheId).eq('tenant_id', tenantId).maybeSingle();
      if (!marche || !(await assertTenantEntity(supabaseAdmin, 'marches_entreprises', marche.id, tenantId))) {
        return res.status(404).json({ error: 'Marché introuvable.' });
      }
      if (marche.type_marche === 'accord_cadre') return res.status(400).json({ error: 'Un accord-cadre n’a pas de sous-traitant : ajoutez-le au marché subséquent.' });
      const { count, error: errCount } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE)
        .select('id', { count: 'exact', head: true }).eq('marche_id', marche.id);
      if (errCount && manquante(errCount)) return res.status(503).json({ error: MSG_503 });
      if ((count ?? 0) >= MAX_PAR_MARCHE) return res.status(400).json({ error: `Pas plus de ${MAX_PAR_MARCHE} sous-traitants par marché.` });
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE).insert({
        id: crypto.randomUUID(), project_id: marche.project_id, marche_id: marche.id, nom,
        siret: texte(req.body?.siret, 20), adresse: texte(req.body?.adresse, 300), objet: texte(req.body?.objet, 200),
      }).select().single();
      if (error) return manquante(error) ? res.status(503).json({ error: MSG_503 }) : res.status(500).json({ error: 'Enregistrement impossible.' });
      res.status(201).json(data);
    } catch (e: any) {
      console.error('[POST /api/marches-entreprises/:id/sous-traitants]', e);
      res.status(500).json({ error: 'Enregistrement impossible.' });
    }
  });

  app.put('/api/sous-traitants/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const nom = texte(req.body?.nom, 200);
      if (!nom) return res.status(400).json({ error: 'Le nom du sous-traitant est obligatoire.' });
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE).update({
        nom, siret: texte(req.body?.siret, 20), adresse: texte(req.body?.adresse, 300), objet: texte(req.body?.objet, 200),
      }).eq('id', req.params.id).select().maybeSingle();
      if (error) return manquante(error) ? res.status(503).json({ error: MSG_503 }) : res.status(500).json({ error: 'Enregistrement impossible.' });
      if (!data) return res.status(404).json({ error: 'Sous-traitant introuvable.' });
      res.json(data);
    } catch (e: any) {
      console.error('[PUT /api/sous-traitants/:id]', e);
      res.status(500).json({ error: 'Enregistrement impossible.' });
    }
  });

  app.delete('/api/sous-traitants/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE).delete().eq('id', req.params.id);
      if (error) return manquante(error) ? res.status(503).json({ error: MSG_503 }) : res.status(500).json({ error: 'Suppression impossible.' });
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/sous-traitants/:id]', e);
      res.status(500).json({ error: 'Suppression impossible.' });
    }
  });
}
