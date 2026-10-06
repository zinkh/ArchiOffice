// Intervenants d'une affaire (table project_stakeholders) : une route
// dédiée plutôt que PUT /api/projects/:id. Celui-ci réécrit aussi les
// booléens de la fiche (`is_chantier`, `is_public_client`...) à partir d'un
// corps partiel : l'appeler avec la seule liste les ramènerait à false.
import type { Express } from 'express';
import { assertTenantEntity } from '../assertTenantEntity';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export const MAX_STAKEHOLDERS = 50;
const MAX_ROLE_CHARS = 100;
const MAX_NAME_CHARS = 200;

export interface StakeholderInput { id?: string; name: string; role: string; contact_id: string | null }

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Valide et normalise la liste reçue ; le rôle est exigé, le nom peut venir du contact. */
export function validateStakeholders(body: any): { value?: StakeholderInput[]; error?: string } {
  const list = body?.stakeholders;
  if (!Array.isArray(list)) return { error: 'La liste des intervenants est attendue.' };
  if (list.length > MAX_STAKEHOLDERS) return { error: `Au plus ${MAX_STAKEHOLDERS} intervenants.` };
  const out: StakeholderInput[] = [];
  for (const item of list) {
    const role = clean(item?.role);
    const name = clean(item?.name);
    const contactId = clean(item?.contact_id) || null;
    if (!role) return { error: 'Chaque intervenant doit avoir un rôle.' };
    if (!name && !contactId) return { error: 'Chaque intervenant doit avoir un nom ou un contact.' };
    if (role.length > MAX_ROLE_CHARS) return { error: `Un rôle dépasse ${MAX_ROLE_CHARS} caractères.` };
    if (name.length > MAX_NAME_CHARS) return { error: `Un nom dépasse ${MAX_NAME_CHARS} caractères.` };
    out.push({ id: clean(item?.id) || undefined, name, role, contact_id: contactId });
  }
  return { value: out };
}

export function registerProjectStakeholdersRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.put('/api/projects/:id/stakeholders', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      if (!(await assertTenantEntity(supabaseAdmin, 'projects', id, tenantId))) {
        return res.status(404).json({ error: 'Project not found' });
      }
      const parsed = validateStakeholders(req.body);
      if (!parsed.value) return res.status(400).json({ error: parsed.error });

      const contactIds = [...new Set(parsed.value.map(s => s.contact_id).filter(Boolean) as string[])];
      const contactNames = new Map<string, string>();
      for (const contactId of contactIds) {
        if (!(await assertTenantEntity(supabaseAdmin, 'contacts', contactId, tenantId))) {
          return res.status(400).json({ error: 'Contact introuvable pour ce cabinet.' });
        }
      }
      if (contactIds.length) {
        const { data: contacts } = await supabaseAdmin.from('contacts')
          .select('id, first_name, last_name, company_name').eq('tenant_id', tenantId).in('id', contactIds);
        for (const c of contacts || []) {
          contactNames.set(c.id, clean(c.company_name) || [clean(c.first_name), clean(c.last_name)].filter(Boolean).join(' '));
        }
      }

      const { data: existingRows } = await supabaseAdmin.from('project_stakeholders')
        .select('id').eq('project_id', id).eq('tenant_id', tenantId);
      const existingIds = new Set<string>((existingRows || []).map((r: any) => r.id));

      const { error: de } = await supabaseAdmin.from('project_stakeholders').delete().eq('project_id', id).eq('tenant_id', tenantId);
      if (de) throw de;
      const rows = parsed.value.map(s => ({
        // Un identifiant déjà connu de CETTE affaire est conservé : ce que la
        // base référence (présences de compte rendu) ne doit pas se détacher.
        id: s.id && existingIds.has(s.id) ? s.id : crypto.randomUUID(),
        tenant_id: tenantId, project_id: id,
        name: s.name || (s.contact_id ? contactNames.get(s.contact_id) : '') || '',
        role: s.role, contact_id: s.contact_id,
      }));
      if (rows.length) {
        const { error: ie } = await supabaseAdmin.from('project_stakeholders').insert(rows);
        if (ie) throw ie;
      }
      res.json({ stakeholders: rows.map(({ tenant_id: _t, ...r }) => r) });
    } catch (error: any) {
      console.error('Error updating project stakeholders:', error);
      res.status(500).json({ error: 'Failed to update stakeholders: ' + error.message });
    }
  });
}
