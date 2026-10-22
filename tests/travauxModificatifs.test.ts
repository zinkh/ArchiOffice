// OS adressés à plusieurs entreprises (numérotation automatique), devis de travaux
// modificatifs et fiches de travaux modificatifs (FTM).
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { marcheIdsVises } from '../server/routes/ordresDeService';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

function setup(projectId: string) {
  const tenantId = makeTenant();
  const { token } = makeUser(tenantId);
  fakeSupabaseAdmin.seed('projects', [{ id: projectId, tenant_id: tenantId }]);
  fakeSupabaseAdmin.seed('marches_entreprises', [
    { id: `${projectId}-m1`, tenant_id: tenantId, project_id: projectId, entreprise_nom: 'Maçonnerie Durand', lot_numero: '04', lot_titre: 'Gros-œuvre' },
    { id: `${projectId}-m2`, tenant_id: tenantId, project_id: projectId, entreprise_nom: 'Charpente Petit', lot_numero: '05', lot_titre: 'Charpente' },
  ]);
  return { tenantId, token };
}

describe('Ordres de service multi-entreprises', () => {
  it('numérote automatiquement par entreprise, sans tenir compte du numéro envoyé', async () => {
    const { token } = setup('tm-p1');
    const post = (marche: string, title: string, extra: any = {}) => request(app).post('/api/ordres_de_service').set(authHeader(token)).send({ project_id: 'tm-p1', marche_id: marche, title, date: '2026-10-01', ...extra });
    const a = await post('tm-p1-m1', 'OS A', { os_number: '999' });
    const b = await post('tm-p1-m2', 'OS B');
    const c = await post('tm-p1-m1', 'OS C');
    expect(a.status).toBe(201);
    // Chaque entreprise a sa suite, préfixée du lot : Petit démarre à 05-001 alors que Durand en est à 04-002.
    expect(a.body.os_number).toBe('04-001');
    expect(b.body.os_number).toBe('05-001');
    expect(c.body.os_number).toBe('04-002');
    const durand = await request(app).get('/api/ordres_de_service/next-number').query({ project_id: 'tm-p1', marche_ids: 'tm-p1-m1' }).set(authHeader(token));
    const petit = await request(app).get('/api/ordres_de_service/next-number').query({ project_id: 'tm-p1', marche_ids: 'tm-p1-m2' }).set(authHeader(token));
    const global = await request(app).get('/api/ordres_de_service/next-number').query({ project_id: 'tm-p1' }).set(authHeader(token));
    expect(durand.body.next).toBe('04-003');
    expect(petit.body.next).toBe('05-002');
    expect(global.body.next).toBe('003');
  });

  it('adresse un OS à plusieurs entreprises : un numéro dans la suite de chacune', async () => {
    const { token } = setup('tm-p2');
    await request(app).post('/api/ordres_de_service').set(authHeader(token)).send({ project_id: 'tm-p2', marche_id: 'tm-p2-m1', title: 'Premier', date: '2026-10-01' });
    const res = await request(app).post('/api/ordres_de_service').set(authHeader(token)).send({
      project_id: 'tm-p2', marche_ids: ['tm-p2-m1', 'tm-p2-m2'], title: 'Reprise de la dalle', date: '2026-10-02',
    });
    expect(res.status).toBe(201);
    expect(res.body.os_number).toBe('04-002 / 05-001');
    expect(res.body.marche_id).toBe('tm-p2-m1');
    expect(res.body.marche_ids).toEqual(['tm-p2-m1', 'tm-p2-m2']);
    expect(res.body.numeros_entreprises.map((n: any) => n.numero)).toEqual([2, 1]);
    expect(res.body.entreprise).toBe('Maçonnerie Durand ; Charpente Petit');
    expect(res.body.destinataire_os).toBe('Maçonnerie Durand ; Charpente Petit');
  });

  it('refuse un marché étranger à l\'affaire dans la liste', async () => {
    const { token } = setup('tm-p3');
    const autre = setup('tm-p3b');
    void autre;
    const res = await request(app).post('/api/ordres_de_service').set(authHeader(token)).send({
      project_id: 'tm-p3', marche_ids: ['tm-p3-m1', 'tm-p3b-m1'], title: 'x', date: '2026-10-01',
    });
    expect(res.status).toBe(400);
  });

  it('marcheIdsVises retire les doublons et garde marche_id en tête', () => {
    expect(marcheIdsVises('a', ['b', 'a', 'c', 3, ''])).toEqual(['a', 'b', 'c']);
    expect(marcheIdsVises(undefined, undefined)).toEqual([]);
  });
});

describe('FTM et devis de travaux modificatifs', () => {
  it('numérote les FTM par entreprise et par lot et rattache les devis', async () => {
    const { token } = setup('tm-p4');
    const creer = (corps: any) => request(app).post('/api/projects/tm-p4/ftm').set(authHeader(token)).send(corps);
    const f1 = await creer({ title: 'Reprise en sous-oeuvre', marche_ids: ['tm-p4-m1'], origine: 'aleas' });
    const f2 = await creer({ title: 'Renfort charpente', marche_ids: ['tm-p4-m2'], numero: 'FTM-99' });
    const f3 = await creer({ title: 'Seconde pour Durand', marche_ids: ['tm-p4-m1'] });
    const f4 = await creer({ title: 'Commune aux deux', marche_ids: ['tm-p4-m1', 'tm-p4-m2'] });
    const f5 = await creer({ title: 'Sans entreprise' });
    expect(f1.status).toBe(201);
    expect(f1.body.status).toBe('brouillon');
    expect([f1, f2, f3, f4, f5].map(f => f.body.numero)).toEqual(['FTM-04-01', 'FTM-05-01', 'FTM-04-02', 'FTM-04-03 / FTM-05-02', 'FTM-00-01']);

    const devis = await request(app).post('/api/projects/tm-p4/devis-travaux-modificatifs').set(authHeader(token)).send({
      objet: 'Micropieux supplémentaires', marche_id: 'tm-p4-m1', montant_ht: 12500, date_reception: '2026-10-15', ftm_id: f1.body.id,
    });
    expect(devis.status).toBe(201);
    expect(devis.body.entreprise).toBe('Maçonnerie Durand');
    expect(devis.body.statut).toBe('recu');

    const maj = await request(app).put(`/api/devis-travaux-modificatifs/${devis.body.id}`).set(authHeader(token)).send({ statut: 'accepte' });
    expect(maj.status).toBe(200);
    expect(maj.body.statut).toBe('accepte');

    const supprimee = await request(app).delete(`/api/ftm/${f1.body.id}`).set(authHeader(token));
    expect(supprimee.status).toBe(200);
    const liste = await request(app).get('/api/projects/tm-p4/devis-travaux-modificatifs').set(authHeader(token));
    expect(liste.body).toHaveLength(1);
    expect(liste.body[0].ftm_id).toBeNull();
  });

  it('émet un OS prérempli depuis une FTM validée, numéroté dans la suite de chaque entreprise', async () => {
    const { token } = setup('tm-p6');
    // Un OS déjà émis à Durand : le suivant sera le 002 de Durand et le 001 de Petit.
    await request(app).post('/api/ordres_de_service').set(authHeader(token)).send({ project_id: 'tm-p6', marche_id: 'tm-p6-m1', title: 'Déjà émis', date: '2026-10-01' });
    const ftm = await request(app).post('/api/projects/tm-p6/ftm').set(authHeader(token)).send({
      title: 'Reprise de la dalle', objet: 'Reprise de la dalle du R+1', motif: 'Défaut de planéité', description: 'Ragréage fibré',
      marche_ids: ['tm-p6-m1', 'tm-p6-m2'], origine: 'entreprise', incidence_delai_jours: 5, montant_estime_ht: 9000,
    });
    await request(app).post('/api/projects/tm-p6/devis-travaux-modificatifs').set(authHeader(token)).send({ objet: 'Devis A', marche_id: 'tm-p6-m1', montant_ht: 4000, statut: 'accepte', ftm_id: ftm.body.id });
    await request(app).post('/api/projects/tm-p6/devis-travaux-modificatifs').set(authHeader(token)).send({ objet: 'Devis B', marche_id: 'tm-p6-m2', montant_ht: 3500, statut: 'accepte', ftm_id: ftm.body.id });

    // Brouillon : pas encore d'OS.
    const trop_tot = await request(app).post(`/api/ftm/${ftm.body.id}/ordre-service`).set(authHeader(token));
    expect(trop_tot.status).toBe(409);

    await request(app).put(`/api/ftm/${ftm.body.id}`).set(authHeader(token)).send({ status: 'validee' });
    const emis = await request(app).post(`/api/ftm/${ftm.body.id}/ordre-service`).set(authHeader(token));
    expect(emis.status).toBe(201);
    const os = emis.body.ordre;
    expect(os.os_number).toBe('04-002 / 05-001');
    expect(os.title).toBe('Reprise de la dalle');
    expect(os.objet).toBe('Reprise de la dalle du R+1');
    expect(os.status).toBe('draft');
    expect(os.marche_ids).toEqual(['tm-p6-m1', 'tm-p6-m2']);
    expect(os.origine_demande).toBe('autres');
    expect(os.incidences_delais_type).toBe('oui');
    // Aucun montant décidé sur la fiche : somme des devis acceptés.
    expect(Number(os.montant_devis_presente)).toBe(7500);
    expect(os.description).toContain('Défaut de planéité');
    expect(emis.body.ftm.ordre_service_id).toBe(os.id);

    const deuxieme = await request(app).post(`/api/ftm/${ftm.body.id}/ordre-service`).set(authHeader(token));
    expect(deuxieme.status).toBe(409);
  });

  it('refuse l\'émission d\'un OS pour une FTM sans entreprise', async () => {
    const { token } = setup('tm-p7');
    const ftm = await request(app).post('/api/projects/tm-p7/ftm').set(authHeader(token)).send({ title: 'Sans entreprise' });
    await request(app).put(`/api/ftm/${ftm.body.id}`).set(authHeader(token)).send({ status: 'validee' });
    const res = await request(app).post(`/api/ftm/${ftm.body.id}/ordre-service`).set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it('refuse un devis sans objet, un statut inconnu et un marché d\'une autre affaire', async () => {
    const { token } = setup('tm-p5');
    setup('tm-p5b');
    const sansObjet = await request(app).post('/api/projects/tm-p5/devis-travaux-modificatifs').set(authHeader(token)).send({ montant_ht: 10 });
    expect(sansObjet.status).toBe(400);
    const etranger = await request(app).post('/api/projects/tm-p5/devis-travaux-modificatifs').set(authHeader(token)).send({ objet: 'x', marche_id: 'tm-p5b-m1' });
    expect(etranger.status).toBe(400);
    const ftm = await request(app).post('/api/projects/tm-p5/ftm').set(authHeader(token)).send({ title: 'F' });
    const statut = await request(app).put(`/api/ftm/${ftm.body.id}`).set(authHeader(token)).send({ status: 'inconnu' });
    expect(statut.status).toBe(400);
  });

});
