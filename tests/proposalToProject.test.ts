// L'affaire créée à l'acceptation d'une proposition reprend toutes ses informations,
// y compris celles que le formulaire n'a pas renvoyées, et la proposition est archivée.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { COPIED_FIELDS, natureTravauxMaf, projectRowFromProposal } from '../src/lib/proposalToProject';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

const TODAY = new Date('2026-11-14T10:00:00Z');
const ctx = { projectId: 'proj-1', tenantId: 'tenant-1', clientName: 'Gilles RENOULT', today: TODAY };

describe('projectRowFromProposal', () => {
  it('reprend les champs communs, dont le client, la nature de l\'opération, les surfaces et les parcelles', () => {
    const row = projectRowFromProposal({
      id: 'prop-1', title: 'Mezzanine', description: 'Création de mezzanine', amount: 8000, construction_cost: 277500,
      surface_plancher: '550', surface_existante: '425', surface_plancher_ext: '125', operation_nature: 'rehabilitation',
      client_id: 'c-1', client_email: 'a@b.fr', project_code: '2611', parcelles_selection: '[{"id":"X"}]', is_erp: true,
      adresse_terrain: '2 Rue Edith Piaf', cp_ville_terrain: '54270 Essey-lès-Nancy', illustrations: '{"plan":1}',
    }, ctx);

    expect(row).toMatchObject({
      id: 'proj-1', tenant_id: 'tenant-1', name: 'Mezzanine', client: 'Gilles RENOULT', status: 'Planning',
      budget: 277500, construction_cost: 277500, remuneration: 8000, surface: '550',
      client_id: 'c-1', client_email: 'a@b.fr', project_code: '2611', operation_nature: 'rehabilitation',
      surface_existante: '425', surface_plancher_ext: '125', parcelles_selection: '[{"id":"X"}]', is_erp: true,
      illustrations: '{"plan":1}', nature_travaux_maf: 'Réhabilitation', source_proposal_id: 'prop-1',
      address: '2 Rue Edith Piaf, 54270 Essey-lès-Nancy', start_date: '2026-11-14', end_date: '2026-12-14',
    });
  });

  it('omet une valeur absente ou vide plutôt que d\'écrire undefined ou une chaîne vide', () => {
    const row = projectRowFromProposal({ id: 'prop-2', title: 'Villa', rcs: '', zone_plu: null }, ctx);
    expect(row).not.toHaveProperty('rcs');
    expect(row).not.toHaveProperty('zone_plu');
    expect(Object.values(row)).not.toContain(undefined);
  });

  it('écrit chaque champ de la liste commune quand la proposition le porte', () => {
    const everything = Object.fromEntries(COPIED_FIELDS.map(f => [f, 'x']));
    const keys = Object.keys(projectRowFromProposal({ id: 'p', title: 't', ...everything }, ctx));
    for (const field of COPIED_FIELDS) expect(keys).toContain(field);
  });

  it('déduit la nature des travaux MAF de la nature de l\'opération', () => {
    expect(natureTravauxMaf({ operation_nature: 'neuf' })).toBe('Neuf');
    expect(natureTravauxMaf({ operation_nature: 'rehabilitation' })).toBe('Réhabilitation');
    expect(natureTravauxMaf({ type_projet: 'Extension' })).toBe('Réhabilitation');
  });
});

describe('PUT /api/proposals/:id (acceptation)', () => {
  it('crée l\'affaire avec les champs enregistrés même absents du corps, rattache les réunions et archive la proposition', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('contacts', [{ id: 'c-essey', tenant_id: tenantId, first_name: 'Gilles', last_name: 'RENOULT' }]);
    fakeSupabaseAdmin.seed('proposals', [{
      id: 'p-essey', tenant_id: tenantId, title: 'Mezzanine Essey', status: 'Sent', amount: 8000, construction_cost: 277500,
      surface_plancher: '550', surface_existante: '425', operation_nature: 'rehabilitation', parcelles_selection: '[{"id":"AB1"}]',
      client_id: 'c-essey', reference: 'DEVIS-2026-030',
    }]);
    fakeSupabaseAdmin.seed('meetings', [{ id: 'm1', tenant_id: tenantId, proposal_id: 'p-essey', project_id: null, title: 'Réunion de cadrage' }]);

    // Le formulaire ne renvoie pas parcelles_selection ni surface_existante.
    const res = await request(app).put('/api/proposals/p-essey').set(authHeader(token)).send({
      title: 'Mezzanine Essey', status: 'Accepted', amount: 8000, client_id: 'c-essey', construction_cost: 277500, surface_plancher: '550',
    });
    expect(res.status).toBe(200);

    const project = fakeSupabaseAdmin.getTable('projects').find(p => p.tenant_id === tenantId && p.name === 'Mezzanine Essey')!;
    expect(project).toMatchObject({
      client: 'Gilles RENOULT', client_id: 'c-essey', budget: 277500, construction_cost: 277500, remuneration: 8000, surface: '550',
      surface_existante: '425', parcelles_selection: '[{"id":"AB1"}]', nature_travaux_maf: 'Réhabilitation', source_proposal_id: 'p-essey',
    });
    expect(fakeSupabaseAdmin.getTable('meetings').find(m => m.id === 'm1')?.project_id).toBe(project.id);

    const proposal = fakeSupabaseAdmin.getTable('proposals').find(p => p.id === 'p-essey')!;
    expect(proposal.archived_at).toBeTruthy();
    expect(proposal.archive_reason).toBe('converted');
  });
});
