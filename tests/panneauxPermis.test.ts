// Panneau d'affichage du permis : textes réglementaires verrouillés, formats
// réglementaires (plus de 80 cm de côté), brouillon / définitif, champs obligatoires,
// isolation entre cabinets, et routes (sans lancer Chromium).
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { isRegulatorySize, pageSpec } from '../server/panneaux/pageSpec';
import { buildPermisHtml, permisWatermarks } from '../server/panneaux/permisTemplate';
import { loadPermisPanel } from '../server/panneaux/permisData';
import {
  AFFICHAGE_LISIBLE, DROIT_DE_RECOURS_TEXTE, DROIT_DE_RECOURS_TITRE, MENTIONS_REFERENCES, TITRES_PERMIS,
} from '../server/panneaux/mentionsLegales';
import { panneauExtras } from '../server/routes/permits';
import { sanitizePanelSettings } from '../server/routes/panneaux';
import type { PermisPanelData } from '../server/panneaux/types';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

const agency = {
  name: 'AAZS', acronym: 'AAZS', manager: 'Khaldoun SEKTAOUI', address: '23 Bd de l’Europe', phone: '0684016633', email: 'contact@aazs.fr',
  siret: '102 663 416 00018', oaNumber: 'S26332', vatNumber: 'FR31102663416', logoDataUrl: null,
};
const complete = (over: Partial<PermisPanelData> = {}): PermisPanelData => ({
  agency, permitType: 'PC', etat: 'definitif', beneficiaire: 'REVI', architecte: 'K. S., architecte', numero: 'PC 054 000 26 N0001',
  dateDelivrance: '12/03/2026', natureProjet: 'École', adresseTerrain: 'Pixérécourt', superficieTerrainM2: 12500, surfacePlancherM2: 3200,
  nombreLogements: null, hauteurM: 9.5, mairieNom: 'Mairie de Nancy', mairieAdresse: '1 place Stanislas', missingRequired: [], warnings: [], ...over,
});

describe('textes réglementaires verrouillés', () => {
  // Toute modification doit être relue contre le texte officiel en vigueur (Légifrance).
  it('droit de recours : délais et articles cités', () => {
    expect(DROIT_DE_RECOURS_TITRE).toBe('Droit de recours');
    expect(DROIT_DE_RECOURS_TEXTE).toContain('deux mois à compter du premier jour d’une période continue de deux mois d’affichage');
    expect(DROIT_DE_RECOURS_TEXTE).toContain('art. R. 600-2');
    expect(DROIT_DE_RECOURS_TEXTE).toContain('quinze jours francs');
    expect(DROIT_DE_RECOURS_TEXTE).toContain('art. R. 600-1');
    expect(AFFICHAGE_LISIBLE).toContain('lisible depuis la voie publique');
    expect(MENTIONS_REFERENCES).toContain('A424-15');
    expect(TITRES_PERMIS).toEqual({ PC: 'PERMIS DE CONSTRUIRE', DP: 'DÉCLARATION PRÉALABLE' });
  });
});

describe('formats réglementaires', () => {
  it('les deux côtés doivent faire au moins 80 cm : A0, 80 x 120 et 100 x 150 oui, A1 non', () => {
    expect(isRegulatorySize('A0')).toBe(true);
    expect(isRegulatorySize('80x120')).toBe(true); // panneau standard du commerce
    expect(isRegulatorySize('100x150')).toBe(true);
    expect(isRegulatorySize('A1')).toBe(false);
    expect(isRegulatorySize('A4')).toBe(false);
  });
  it('un format non réglementaire reçoit un filigrane d’aperçu', () => {
    expect(permisWatermarks(complete(), pageSpec('A4', 'portrait'))).toEqual(['Aperçu non réglementaire']);
    expect(permisWatermarks(complete(), pageSpec('A0', 'portrait'))).toEqual([]);
  });
});

describe('gabarit du panneau de permis', () => {
  it('version définitive : toutes les mentions, droit de recours, aucun bandeau brouillon', () => {
    const html = buildPermisHtml(complete(), pageSpec('A0', 'portrait'));
    for (const t of ['PERMIS DE CONSTRUIRE', 'REVI', 'PC 054 000 26 N0001', '12/03/2026', '9,5 m', 'Mairie de Nancy', 'Droit de recours']) {
      expect(html).toContain(t);
    }
    expect(html).toMatch(/12\s500\sm²/); // séparateur de milliers insécable
    expect(html).toMatch(/3\s200\sm²/);
    expect(html).not.toContain('Brouillon');
    expect(html).not.toContain('class="wm"');
    expect(html).toContain('P1|1');
  });
  it('brouillon : champs obligatoires vides en pointillés, bandeau, jamais de valeur inventée', () => {
    const html = buildPermisHtml(complete({ etat: 'brouillon', dateDelivrance: null, mairieNom: null, mairieAdresse: null }), pageSpec('A0', 'portrait'));
    expect(html).toContain('Brouillon, à compléter à la délivrance');
    expect((html.match(/class="blank"/g) || []).length).toBe(2); // date et mairie
  });
  it('un champ facultatif vide n’est pas imprimé', () => {
    const html = buildPermisHtml(complete({ nombreLogements: null, surfacePlancherM2: null, hauteurM: null }), pageSpec('A0', 'portrait'));
    expect(html).not.toContain('Nombre maximum de logements');
    expect(html).not.toContain('Surface de plancher autorisée');
    expect(html).not.toContain('Hauteur de la construction');
  });
  it('déclaration préalable : titre et numéro de décision', () => {
    const html = buildPermisHtml(complete({ permitType: 'DP' }), pageSpec('A0', 'portrait'));
    expect(html).toContain('DÉCLARATION PRÉALABLE');
    expect(html).toContain('Décision n°');
  });
  it('échappe le texte saisi', () => {
    const html = buildPermisHtml(complete({ natureProjet: '<script>x</script>' }), pageSpec('A0', 'paysage'));
    expect(html).not.toContain('<script>x');
    expect(html).toContain('&lt;script&gt;');
  });
});

function seedPermit(tenantId: string, over: Record<string, any> = {}) {
  const id = `permit-${Math.random().toString(36).slice(2, 8)}`;
  fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, agency_name: 'AAZS', architect_name: 'Khaldoun SEKTAOUI', oa_number: 'S26332' }]);
  fakeSupabaseAdmin.seed('projects', [{ id: `proj-${id}`, tenant_id: tenantId, name: 'École', client: 'REVI', programme: 'Programme de l’école', surface_parcelle: '8 000', surface_plancher: '2 500', adresse_terrain: '1 rue X', cp_ville_terrain: '54000 Nancy' }]);
  fakeSupabaseAdmin.seed('permits', [{ id, tenant_id: tenantId, project_id: `proj-${id}`, type: 'PC', reference: 'PC 054 000 26 N0001', status: 'en_instruction', ...over }]);
  return id;
}

describe('résolution des données du permis', () => {
  it('reprend l’affaire sans inventer : brouillon tant que le permis n’est pas accordé et daté', async () => {
    const tenant = makeTenant();
    const id = seedPermit(tenant);
    const res: any = await loadPermisPanel(fakeSupabaseAdmin, tenant, id);
    expect(res.data).toMatchObject({
      etat: 'brouillon', beneficiaire: 'REVI', numero: 'PC 054 000 26 N0001', natureProjet: 'Programme de l’école',
      superficieTerrainM2: 8000, surfacePlancherM2: 2500, dateDelivrance: null,
    });
    expect(res.data.architecte).toContain('Khaldoun SEKTAOUI');
    expect(res.data.missingRequired).toEqual(expect.arrayContaining(['Date de délivrance', 'Mairie (adresse de consultation du dossier)']));
    expect(res.data.warnings.join(' ')).toContain('Hauteur');
  });
  it('accordé et daté : version définitive ; une hauteur saisie lève l’avertissement', async () => {
    const tenant = makeTenant();
    const id = seedPermit(tenant, { status: 'accorde', decision_date: '2026-03-12', mairie_adresse: '1 place Stanislas', hauteur_m: 9.5, numero_decision: 'PC 054 000 26 N0001' });
    const res: any = await loadPermisPanel(fakeSupabaseAdmin, tenant, id);
    expect(res.data.etat).toBe('definitif');
    expect(res.data.dateDelivrance).toBe('12/03/2026');
    expect(res.data.missingRequired).toEqual([]);
    expect(res.data.warnings.join(' ')).not.toContain('Hauteur');
  });
  it('un permis d’un autre cabinet est introuvable ; une autorisation de travaux n’est pas gérée', async () => {
    const tenant = makeTenant();
    const other = makeTenant();
    const foreign = seedPermit(other);
    expect(await loadPermisPanel(fakeSupabaseAdmin, tenant, foreign)).toEqual({ error: 'not_found' });
    const at = seedPermit(tenant, { type: 'AT' });
    expect(await loadPermisPanel(fakeSupabaseAdmin, tenant, at)).toEqual({ error: 'unsupported_type' });
  });
  it('n’utilise jamais la description de l’affaire (peut porter des honoraires)', async () => {
    const tenant = makeTenant();
    const id = seedPermit(tenant);
    fakeSupabaseAdmin.seed('projects', [{ id: 'projD', tenant_id: tenant, name: 'D', client: 'C', programme: null, description: 'Honoraires 120 000 €' }]);
    fakeSupabaseAdmin.seed('permits', [{ id: 'permD', tenant_id: tenant, project_id: 'projD', type: 'PC', status: 'en_instruction' }]);
    const res: any = await loadPermisPanel(fakeSupabaseAdmin, tenant, 'permD');
    expect(res.data.natureProjet).toBeNull();
    expect(id).toBeTruthy();
  });
});

describe('champs de la fiche permis et réglages', () => {
  it('panneauExtras : seulement les champs présents, valeurs validées', () => {
    expect(panneauExtras({})).toEqual({});
    expect(panneauExtras({ hauteur_m: '9,5', nombre_logements: '12.4', surface_plancher_m2: '', mairie_nom: '  ', nature_projet: ' École ' }))
      .toEqual({ hauteur_m: 9.5, nombre_logements: 12, surface_plancher_m2: null, mairie_nom: null, nature_projet: 'École' });
    expect(panneauExtras({ hauteur_m: -3 })).toEqual({ hauteur_m: null });
  });
  it('sanitizePanelSettings : liste blanche, format du panneau de chantier, clés bornées', () => {
    const s: any = sanitizePanelSettings({ format: '100x150', orientation: 'paysage', hidden: ['lot:1', '<script>', 5], hiddenLogos: ['x'], logos: false, extra: 'x', startDate: '2026-13', title: ' T ' });
    expect(s.format).toBe('A0'); // 100x150 n'est pas un format de panneau de chantier
    expect(s.orientation).toBe('paysage');
    expect(s.hidden).toEqual(['lot:1']);
    expect(s.logos).toBe(false);
    expect(s.startDate).toBeNull();
    expect(s.title).toBe('T');
    expect(s).not.toHaveProperty('extra');
  });
});

describe('routes', () => {
  it('GET /api/permits/:id/panneau : données, champs manquants, formats ; isolation entre cabinets', async () => {
    const tenant = makeTenant(); const { token } = makeUser(tenant);
    const id = seedPermit(tenant);
    const ok = await request(app).get(`/api/permits/${id}/panneau`).set(authHeader(token));
    expect(ok.status).toBe(200);
    expect(ok.body.etat).toBe('brouillon');
    expect(ok.body.missingRequired.length).toBeGreaterThan(0);
    expect(ok.body).not.toHaveProperty('agency');
    expect(ok.body.formats.find((f: any) => f.format === 'A1')).toBeUndefined();
    expect(ok.body.formats.find((f: any) => f.format === 'A0').regulatory).toBe(true);

    const other = makeTenant(); const intruder = makeUser(other);
    const denied = await request(app).get(`/api/permits/${id}/panneau`).set(authHeader(intruder.token));
    expect(denied.status).toBe(404);
  });
  it('POST pdf définitif : refusé sans champs obligatoires (400) ou si le permis est refusé (409), avant tout rendu', async () => {
    const tenant = makeTenant(); const { token } = makeUser(tenant);
    const id = seedPermit(tenant);
    const incomplete = await request(app).post(`/api/permits/${id}/panneau/pdf`).set(authHeader(token)).send({ etat: 'definitif' });
    expect(incomplete.status).toBe(400);
    expect(incomplete.body.missing).toEqual(expect.arrayContaining(['Date de délivrance']));
    const refused = seedPermit(tenant, { status: 'refuse', decision_date: '2026-03-12', mairie_adresse: 'x', numero_decision: 'N', nature_projet: 'N' });
    const res = await request(app).post(`/api/permits/${refused}/panneau/pdf`).set(authHeader(token)).send({ etat: 'definitif' });
    expect(res.status).toBe(409);
  });
  it('PUT /api/permits/:id enregistre les mentions et les relit', async () => {
    const tenant = makeTenant(); const { token } = makeUser(tenant);
    const id = seedPermit(tenant);
    const res = await request(app).put(`/api/permits/${id}`).set(authHeader(token)).send({ type: 'PC', status: 'accorde', reference: 'PC 1', decision_date: '2026-03-12', hauteur_m: '9,5', nombre_logements: 12, mairie_nom: 'Mairie de Nancy' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ hauteur_m: 9.5, nombre_logements: 12, mairie_nom: 'Mairie de Nancy', status: 'accorde' });
  });
  it('panneau de chantier : réglages enregistrés puis relus, affaire d’un autre cabinet refusée', async () => {
    const tenant = makeTenant(); const { token } = makeUser(tenant);
    fakeSupabaseAdmin.seed('projects', [{ id: 'projRoute', tenant_id: tenant, name: 'Route', client: 'C' }]);
    const put = await request(app).put('/api/projects/projRoute/panneau-chantier').set(authHeader(token)).send({ format: 'A1', orientation: 'paysage', hidden: ['lot:9'], colorLogos: true });
    expect(put.status).toBe(200);
    const got = await request(app).get('/api/projects/projRoute/panneau-chantier').set(authHeader(token));
    expect(got.status).toBe(200);
    expect(got.body.settings).toMatchObject({ format: 'A1', orientation: 'paysage', hidden: ['lot:9'], colorLogos: true });
    expect(got.body.maitriseOeuvre[0]).toMatchObject({ key: 'moe' });

    const other = makeTenant(); const intruder = makeUser(other);
    expect((await request(app).get('/api/projects/projRoute/panneau-chantier').set(authHeader(intruder.token))).status).toBe(404);
    expect((await request(app).put('/api/projects/projRoute/panneau-chantier').set(authHeader(intruder.token)).send({})).status).toBe(404);
    expect((await request(app).post('/api/projects/projRoute/panneau-chantier/pdf').set(authHeader(intruder.token)).send({})).status).toBe(404);
  });
});
