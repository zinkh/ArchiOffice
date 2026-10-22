// OS adressés à plusieurs entreprises (numérotation automatique), devis de travaux
// modificatifs et fiches de travaux modificatifs (FTM).
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { prochainNumeroFtm } from '../server/routes/travauxModificatifs';
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
  it('numérote automatiquement, sans tenir compte du numéro envoyé', async () => {
    const { token } = setup('tm-p1');
    const a = await request(app).post('/api/ordres_de_service').set(authHeader(token)).send({ project_id: 'tm-p1', marche_id: 'tm-p1-m1', os_number: '999', title: 'OS A', date: '2026-10-01' });
    const b = await request(app).post('/api/ordres_de_service').set(authHeader(token)).send({ project_id: 'tm-p1', marche_id: 'tm-p1-m2', title: 'OS B', date: '2026-10-02' });
    expect(a.status).toBe(201);
    expect(a.body.os_number).toBe('001');
    expect(b.body.os_number).toBe('002');
    const next = await request(app).get('/api/ordres_de_service/next-number').query({ project_id: 'tm-p1' }).set(authHeader(token));
    expect(next.body.next).toBe('003');
  });

  it('adresse un OS à plusieurs entreprises, un seul numéro', async () => {
    const { token } = setup('tm-p2');
    const res = await request(app).post('/api/ordres_de_service').set(authHeader(token)).send({
      project_id: 'tm-p2', marche_ids: ['tm-p2-m1', 'tm-p2-m2'], title: 'Reprise de la dalle', date: '2026-10-01',
    });
    expect(res.status).toBe(201);
    expect(res.body.os_number).toBe('001');
    expect(res.body.marche_id).toBe('tm-p2-m1');
    expect(res.body.marche_ids).toEqual(['tm-p2-m1', 'tm-p2-m2']);
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
  it('numérote les FTM par affaire et rattache les devis', async () => {
    const { token } = setup('tm-p4');
    const f1 = await request(app).post('/api/projects/tm-p4/ftm').set(authHeader(token)).send({ title: 'Reprise en sous-oeuvre', marche_ids: ['tm-p4-m1'], origine: 'aleas' });
    const f2 = await request(app).post('/api/projects/tm-p4/ftm').set(authHeader(token)).send({ title: 'Renfort charpente', numero: 'FTM-99' });
    expect(f1.status).toBe(201);
    expect(f1.body.numero).toBe('FTM-01');
    expect(f1.body.status).toBe('brouillon');
    expect(f2.body.numero).toBe('FTM-02');

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

  it('prochainNumeroFtm reprend après le plus grand numéro', () => {
    expect(prochainNumeroFtm([])).toBe('FTM-01');
    expect(prochainNumeroFtm(['FTM-01', 'FTM-07', null])).toBe('FTM-08');
  });
});
