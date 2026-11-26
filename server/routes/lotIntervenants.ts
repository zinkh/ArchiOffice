// Intervenants des entreprises d'un lot (onglet DET > Entreprises) : plusieurs personnes par
// entreprise, chacune avec un rôle. Chaque intervenant est une fiche contact de l'agence,
// sélectionnée ou créée sur place (comme les intervenants d'une réunion) : nom, téléphone et
// e-mail se lisent sur la fiche (server/lotIntervenantsRead.ts). Une instance sans la table lit
// une liste vide et refuse l'écriture en 503.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { assertTenantEntity } from '../assertTenantEntity';
import { contactEmail, isValidEmail } from '../../src/lib/crDiffusion';
import { hydraterIntervenants, LOT_INTERVENANT_CONTACT_COLUMNS } from '../lotIntervenantsRead';

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
      res.json(await hydraterIntervenants(supabaseAdmin, tenantId, data ?? []));
    } catch (e: any) {
      console.error('[GET /api/projects/:id/lot-intervenants]', e);
      res.status(500).json({ error: 'Lecture impossible.' });
    }
  });

  // Corps : `entreprise`, `role` facultatif, puis soit `contact_id` (fiche existante), soit
  // `new_contact` (prénom ou nom obligatoire ; la fiche est créée dans l'agence, rattachée à
  // l'entreprise par son nom de société).
  app.post('/api/lots/:lotId/intervenants', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const entreprise = texte(req.body?.entreprise, 200);
      if (!entreprise) return res.status(400).json({ error: 'L’entreprise est obligatoire.' });
      const { data: lot } = await supabaseAdmin.from('project_lots').select('id, project_id')
        .eq('id', req.params.lotId).eq('tenant_id', tenantId).maybeSingle();
      if (!lot) return res.status(404).json({ error: 'Lot introuvable.' });

      const { count, error: errCount } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE)
        .select('id', { count: 'exact', head: true }).eq('lot_id', lot.id);
      if (errCount && manquante(errCount)) return res.status(503).json({ error: MSG_503 });
      if ((count ?? 0) >= MAX_PAR_LOT) return res.status(400).json({ error: `Pas plus de ${MAX_PAR_LOT} intervenants par lot.` });

      let contactId = texte(req.body?.contact_id, 64);
      let createdContactId: string | null = null;
      if (contactId) {
        if (!(await assertTenantEntity(supabaseAdmin, 'contacts', contactId, tenantId))) {
          return res.status(400).json({ error: 'Contact introuvable pour ce cabinet.' });
        }
        const { data: deja } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE)
          .select('id').eq('lot_id', lot.id).eq('contact_id', contactId).maybeSingle();
        if (deja) return res.status(409).json({ error: 'Cette personne est déjà intervenante sur ce lot.' });
      } else {
        const nc = req.body?.new_contact;
        const first = texte(nc?.first_name, 100) ?? '';
        const last = texte(nc?.last_name, 100) ?? '';
        if (!first && !last) return res.status(400).json({ error: 'Choisissez un contact existant ou renseignez le nom du nouveau contact.' });
        const email = texte(nc?.email, 254) ?? '';
        if (email && !isValidEmail(email)) return res.status(400).json({ error: 'Adresse e-mail invalide.' });
        const phone = texte(nc?.phone_mobile, 40);
        createdContactId = crypto.randomUUID();
        const { error: ce } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').insert({
          id: createdContactId, first_name: first, last_name: last,
          company_name: texte(nc?.company_name, 200) ?? entreprise,
          job_title: texte(nc?.job_title, 120), phone_mobile: phone, phone: phone || '', email,
          address: '', zip: '', city: '', state: '', country: '',
          candidatures: '', affaires: '', logo: '', ca_amount: 0,
          electronic_signature: '', contact_references: '', tags: '',
          created_at: new Date().toISOString(), created_by: req.user.id,
        });
        if (ce) return res.status(500).json({ error: 'Création du contact impossible.' });
        contactId = createdContactId;
      }

      const { data: contact } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts')
        .select(LOT_INTERVENANT_CONTACT_COLUMNS).eq('id', contactId).maybeSingle();
      const nom = [contact?.first_name, contact?.last_name].filter(Boolean).join(' ').trim() || contact?.company_name || entreprise;
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE).insert({
        id: crypto.randomUUID(), project_id: lot.project_id, lot_id: lot.id, entreprise, contact_id: contactId,
        nom, role: texte(req.body?.role, 120),
        telephone: contact?.phone_mobile || contact?.phone_work || contact?.phone || null,
        email: contact ? contactEmail(contact) || null : null,
      }).select().single();
      if (error) {
        // Une fiche créée pour cet intervenant ne reste pas orpheline si l'intervenant n'a pas pu s'enregistrer.
        if (createdContactId) await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').delete().eq('id', createdContactId);
        return manquante(error) ? res.status(503).json({ error: MSG_503 }) : res.status(500).json({ error: 'Enregistrement impossible.' });
      }
      const [lu] = await hydraterIntervenants(supabaseAdmin, tenantId, [data]);
      res.status(201).json(lu);
    } catch (e: any) {
      console.error('[POST /api/lots/:id/intervenants]', e);
      res.status(500).json({ error: 'Enregistrement impossible.' });
    }
  });

  // Seul le rôle se modifie ici : le reste est la fiche contact, qui se corrige dans les contacts.
  app.put('/api/lot-intervenants/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE)
        .update({ role: texte(req.body?.role, 120) }).eq('id', req.params.id).select().maybeSingle();
      if (error) return manquante(error) ? res.status(503).json({ error: MSG_503 }) : res.status(500).json({ error: 'Enregistrement impossible.' });
      if (!data) return res.status(404).json({ error: 'Intervenant introuvable.' });
      const [lu] = await hydraterIntervenants(supabaseAdmin, tenantId, [data]);
      res.json(lu);
    } catch (e: any) {
      console.error('[PUT /api/lot-intervenants/:id]', e);
      res.status(500).json({ error: 'Enregistrement impossible.' });
    }
  });

  // Retire l'intervenant du lot ; sa fiche contact reste dans le carnet d'adresses.
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
