// Date et auteur de la dernière modification de chaque poste du CCTP / DPGF : le serveur fait foi à
// l'enregistrement (sa date, la personne authentifiée), jamais ce que le client prétend.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { PAR_AGENT } from '../src/lib/marqueurRedaction';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

const ANCIENNE = '2026-01-01T10:00:00.000Z';

const article = (id: string, extra: Record<string, unknown> = {}) => ({
  id, numero: '3.1', designation: id, unite: 'u', quantite: 1, prixUnitaire: 10, prixTotal: 10, type: 'ouvrage', ...extra,
});

const document = (projectId: string, lignes: any[]) => ({
  id: `dpgf-${projectId}`, projectId, titre: 'CCTP', version: '1.0', dateCreation: '2026-01-01', statut: 'draft', TVA: 20, totalHT: 0, totalTTC: 0,
  // Le chapitre porte le nom par défaut des outils d'agent (« DESCRIPTION DES OUVRAGES »).
  lots: [{ id: 'l1', numero: '01', titre: 'Gros œuvre', sousTotal: 0, chapitres: [{ id: 'c1', numero: '1', titre: 'DESCRIPTION DES OUVRAGES', lignes }] }],
});

function seed(tenantId: string, projectId: string, lignes: any[]) {
  fakeSupabaseAdmin.seed('dpgfs', [{
    id: `dpgf-${projectId}`, tenant_id: tenantId, project_id: projectId, data: JSON.stringify(document(projectId, lignes)), offres: [],
  }]);
}

const stocke = (projectId: string) => JSON.parse(fakeSupabaseAdmin.getTable('dpgfs').find(r => r.project_id === projectId)!.data);
const lignesStockees = (projectId: string) => stocke(projectId).lots[0].chapitres[0].lignes as any[];

describe('DPGF : estampille de dernière modification', () => {
  it('signe l\'article modifié avec la personne authentifiée et la date du serveur, pas les autres', async () => {
    const tenantId = makeTenant();
    const { token, userId } = makeUser(tenantId);
    seed(tenantId, 'p-modif-1', [article('a'), article('b')]);

    const avant = Date.now();
    const res = await request(app).post('/api/projects/p-modif-1/dpgf').set(authHeader(token))
      .send(document('p-modif-1', [article('a', { cctpDescription: 'Texte rédigé' }), article('b')]));
    expect(res.status).toBe(200);

    const [a, b] = lignesStockees('p-modif-1');
    // Sans nom de profil, le serveur retombe sur la partie locale de l'adresse (ici l'identifiant de la personne).
    expect(a.modifiePar).toBe(userId);
    expect(Date.parse(a.modifieLe)).toBeGreaterThanOrEqual(avant - 1000);
    expect(Date.parse(a.modifieLe)).toBeLessThanOrEqual(Date.now() + 1000);
    expect(b.modifiePar).toBeUndefined();
    expect(b.modifieLe).toBeUndefined();
    // La réponse porte la même estampille que ce qui est stocké.
    expect(res.body.lots[0].chapitres[0].lignes[0].modifiePar).toBe(userId);
  });

  it('ignore les estampilles envoyées par le client : un poste inchangé garde la sienne', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'p-modif-2', [article('a', { modifieLe: ANCIENNE, modifiePar: 'Bob' }), article('b')]);

    const res = await request(app).post('/api/projects/p-modif-2/dpgf').set(authHeader(token))
      .send(document('p-modif-2', [
        article('a', { modifieLe: '2030-01-01T00:00:00.000Z', modifiePar: 'Usurpateur' }),
        article('b', { designation: 'b modifié', modifieLe: ANCIENNE, modifiePar: 'Usurpateur' }),
      ]));
    expect(res.status).toBe(200);

    const [a, b] = lignesStockees('p-modif-2');
    expect(a).toMatchObject({ modifieLe: ANCIENNE, modifiePar: 'Bob' });
    expect(b.modifiePar).not.toBe('Usurpateur');
    expect(b.modifieLe).not.toBe(ANCIENNE);
  });

  it('une renumérotation seule ne date aucun poste', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'p-modif-3', [article('a', { numero: '3.1' })]);

    const res = await request(app).post('/api/projects/p-modif-3/dpgf').set(authHeader(token))
      .send(document('p-modif-3', [article('a', { numero: '4.1' })]));
    expect(res.status).toBe(200);
    expect(lignesStockees('p-modif-3')[0].modifieLe).toBeUndefined();
  });

  it('la première sauvegarde d\'un document ne date rien', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const res = await request(app).post('/api/projects/p-modif-4/dpgf').set(authHeader(token))
      .send(document('p-modif-4', [article('a'), article('b')]));
    expect(res.status).toBe(200);
    expect(lignesStockees('p-modif-4').every(l => l.modifieLe === undefined)).toBe(true);
  });

  it('une écriture d\'agent signe les lignes ajoutées « Agent IA »', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'p-modif-5', [article('existante')]);

    const res = await request(app).post('/api/projects/p-modif-5/dpgf/lignes').set(authHeader(token))
      .send({ action: 'add_lignes', lot: '1', lignes: [{ designation: 'Fenêtre', unite: 'u', quantite: 2, prix_unitaire: 150 }] });
    expect(res.status).toBe(200);

    const lignes = lignesStockees('p-modif-5');
    expect(lignes).toHaveLength(2);
    expect(lignes[0].modifieLe).toBeUndefined();
    expect(lignes[1]).toMatchObject({ designation: 'Fenêtre', modifiePar: PAR_AGENT });
    expect(typeof lignes[1].modifieLe).toBe('string');
  });
});
