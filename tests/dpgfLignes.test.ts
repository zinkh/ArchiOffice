// manage_dpgf : écriture ciblée de lignes dans le DPGF d'une opération.
// Logique pure (server/dpgfLignes.ts), route (POST /api/projects/:id/dpgf/lignes) et
// confirmation en deux temps de l'outil (fetch stubbé, comme tests/writeDpgfArticle.test.ts).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { appliquerOperation, DpgfLignesError, MAX_LIGNES_PAR_APPEL } from '../server/dpgfLignes';
import { executeProjectWorkTool } from '../packages/archioffice-agents/src/server/projectWorkTools';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });
afterEach(() => { vi.unstubAllGlobals(); });

const doc = () => ({
  id: 'd1', projectId: 'p1', titre: 'DPGF', version: '1.0', statut: 'draft', totalHT: 0, TVA: 10, totalTTC: 0,
  lots: [
    { id: 'l5', numero: '05', titre: 'Menuiseries', sousTotal: 0, chapitres: [
      { id: 'c5a', numero: '1', titre: 'PRESCRIPTIONS GENERALES', cctpOnly: true, cctpDescription: 'Texte général', lignes: [] },
      { id: 'c5b', numero: '3', titre: 'DESCRIPTION DES OUVRAGES', lignes: [
        { id: 'v', numero: '3.1', designation: 'Nouvel article', unite: 'u', quantite: 0, prixUnitaire: 0, prixTotal: 0, type: 'ouvrage' },
        { id: 'k', numero: '3.2', designation: 'Porte', unite: 'u', quantite: 1, prixUnitaire: 100, prixTotal: 100, type: 'ouvrage', cctpDescription: 'Porte pleine, finition...' },
      ] },
    ] },
    { id: 'l6', numero: '06', titre: 'Peinture', sousTotal: 50, chapitres: [
      { id: 'c6', numero: '3', titre: 'DESCRIPTION DES OUVRAGES', lignes: [
        { id: 'p', numero: '3.1', designation: 'Peinture', unite: 'm²', quantite: 5, prixUnitaire: 10, prixTotal: 50, type: 'ouvrage' },
      ] },
    ] },
  ],
});

const add = (over: any = {}) => ({ action: 'add_lignes' as const, lot: '5', lignes: [{ designation: 'Fenêtre', unite: 'u', quantite: 2, prix_unitaire: 150 }], ...over });

describe('add_lignes', () => {
  it('ajoute à un lot vide de lignes, numérote à la suite et recalcule les totaux', () => {
    const src = doc();
    src.lots[0].chapitres[1].lignes = [];
    const { doc: next, rapport } = appliquerOperation(src, add({ lignes: [
      { designation: 'A', unite: 'u', quantite: 2, prix_unitaire: 150 }, { designation: 'B', unite: 'ml', quantite: '3,5' },
    ] }));
    const lignes = next.lots[0].chapitres[1].lignes;
    expect(lignes.map((l: any) => l.numero)).toEqual(['3.1', '3.2']);
    expect(lignes[0]).toMatchObject({ type: 'ouvrage', prixTotal: 300, cctpOnly: false, cctpDescription: '', children: [] });
    expect(lignes[0]).not.toHaveProperty('batimentId');
    expect(lignes[1]).toMatchObject({ quantite: 3.5, prixUnitaire: 0, prixTotal: 0 });
    expect(rapport.lignes_ajoutees).toEqual({ '05': 2 });
    // 300 (lot 05) + 50 (lot 06) ; TVA du document (10 %).
    expect(next.lots[0].sousTotal).toBe(300);
    expect(rapport).toMatchObject({ total_ht: 350, total_ttc: 385, tva: 10 });
    expect(src.lots[0].chapitres[1].lignes).toHaveLength(0); // le document d'origine n'est pas modifié
  });

  it('numérote après le dernier numéro existant du chapitre', () => {
    const { doc: next } = appliquerOperation(doc(), add());
    expect(next.lots[0].chapitres[1].lignes.at(-1).numero).toBe('3.3');
  });

  it('replace_existing écrase la ligne vide mais garde celle qui porte un texte CCTP', () => {
    const { doc: next, rapport } = appliquerOperation(doc(), add({ replace_existing: true }));
    const lignes = next.lots[0].chapitres[1].lignes;
    expect(lignes.map((l: any) => l.designation)).toEqual(['Porte', 'Fenêtre']);
    expect(lignes[0].cctpDescription).toBe('Porte pleine, finition...');
    expect(rapport.lignes_remplacees).toBe(1);
    expect(rapport.lignes_conservees).toEqual([{ numero: '3.2', raison: 'porte un texte CCTP' }]);
    expect(lignes[1].numero).toBe('3.3');
    expect(next.lots[0].sousTotal).toBe(400);
  });

  it('refuse un lot inexistant en listant les lots disponibles', () => {
    expect(() => appliquerOperation(doc(), add({ lot: '99' }))).toThrow(/lot « 99 » n'existe pas.*05 Menuiseries, 06 Peinture/);
  });

  it('refuse un chapitre inexistant, et ne touche jamais un chapitre réservé au CCTP', () => {
    expect(() => appliquerOperation(doc(), add({ chapitre: 'Divers' }))).toThrow(/chapitre « Divers » n'existe pas/);
    expect(() => appliquerOperation(doc(), add({ chapitre: 'PRESCRIPTIONS GENERALES' }))).toThrow(/réservé au CCTP/);
  });

  it('retrouve le chapitre par son titre, sans tenir compte des accents ni de la casse', () => {
    const src = doc();
    src.lots[1].chapitres[0].titre = 'Préparation';
    const { rapport } = appliquerOperation(src, add({ lot: '06', chapitre: 'preparation' }));
    expect(rapport.lignes_ajoutees).toEqual({ '06': 1 });
  });

  it.each([
    ['quantité négative', { lignes: [{ designation: 'A', quantite: -1 }] }, /Ligne 1 : quantite ne peut pas être négatif/],
    ['quantité non numérique', { lignes: [{ designation: 'A', quantite: 'abc' }] }, /quantite doit être un nombre/],
    ['prix négatif', { lignes: [{ designation: 'A', quantite: 1, prix_unitaire: -5 }] }, /prix_unitaire ne peut pas être négatif/],
    ['désignation vide', { lignes: [{ designation: ' ', quantite: 1 }] }, /designation est requise/],
    ['numéro déjà pris', { lignes: [{ designation: 'A', quantite: 1, numero: '3.1' }] }, /existe déjà/],
    ['aucune ligne', { lignes: [] }, /au moins une ligne/],
  ])('valide les entrées : %s', (_nom, over, message) => {
    expect(() => appliquerOperation(doc(), add(over))).toThrow(message);
  });

  it('refuse tout l\'appel si une ligne est invalide (aucune écriture partielle)', () => {
    const src = doc();
    expect(() => appliquerOperation(src, add({ lignes: [{ designation: 'OK', quantite: 1 }, { designation: 'KO', quantite: -1 }] }))).toThrow(DpgfLignesError);
    expect(src.lots[0].chapitres[1].lignes).toHaveLength(2);
  });

  it(`accepte ${MAX_LIGNES_PAR_APPEL} lignes et refuse au-delà`, () => {
    const lignes = (n: number) => Array.from({ length: n }, (_, i) => ({ designation: `L${i}`, unite: 'u', quantite: 1, prix_unitaire: 1 }));
    const { rapport } = appliquerOperation(doc(), add({ lignes: lignes(MAX_LIGNES_PAR_APPEL) }));
    expect(rapport.lignes_ajoutees).toEqual({ '05': MAX_LIGNES_PAR_APPEL });
    expect(() => appliquerOperation(doc(), add({ lignes: lignes(MAX_LIGNES_PAR_APPEL + 1) }))).toThrow(/maximum/);
  });
});

describe('update_ligne et delete_ligne', () => {
  it('modifie par numéro et recalcule la ligne et les totaux', () => {
    const { doc: next, rapport } = appliquerOperation(doc(), { action: 'update_ligne', numero: '3.1', lot: '06', quantite: 8 });
    expect(next.lots[1].chapitres[0].lignes[0]).toMatchObject({ quantite: 8, prixTotal: 80 });
    expect(rapport.total_ht).toBe(180); // 100 (Porte, lot 05) + 80
  });

  it('refuse un numéro ambigu entre deux lots', () => {
    expect(() => appliquerOperation(doc(), { action: 'update_ligne', numero: '3.1', quantite: 1 })).toThrow(/Plusieurs lignes/);
  });

  it('garde le cctpDescription en modifiant une ligne', () => {
    const { doc: next } = appliquerOperation(doc(), { action: 'update_ligne', id: 'k', prix_unitaire: 120 });
    expect(next.lots[0].chapitres[1].lignes[1]).toMatchObject({ prixTotal: 120, cctpDescription: 'Porte pleine, finition...' });
  });

  it('supprime une ligne et refuse celle qui porte un texte CCTP', () => {
    const { doc: next, rapport } = appliquerOperation(doc(), { action: 'delete_ligne', id: 'p' });
    expect(next.lots[1].chapitres[0].lignes).toHaveLength(0);
    expect(rapport.total_ht).toBe(100); // reste « Porte » du lot 05
    expect(() => appliquerOperation(doc(), { action: 'delete_ligne', id: 'k' })).toThrow(/texte CCTP/);
  });
});

describe('POST /api/projects/:id/dpgf/lignes', () => {
  const seed = (tenantId: string, projectId: string) => fakeSupabaseAdmin.seed('dpgfs', [{
    id: `dpgf-${projectId}`, tenant_id: tenantId, project_id: projectId, data: JSON.stringify(doc()), offres: [],
  }]);
  const stocke = (projectId: string) => JSON.parse(fakeSupabaseAdmin.getTable('dpgfs').find((r: any) => r.project_id === projectId)!.data);

  it('écrit les lignes, recalcule et répond avec le récapitulatif', async () => {
    const tenantId = makeTenant(); const { token } = makeUser(tenantId); seed(tenantId, 'pa');
    const res = await request(app).post('/api/projects/pa/dpgf/lignes').set(authHeader(token)).send(add({ replace_existing: true }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, lignes_ajoutees: { '05': 1 }, total_ht: 450, total_ttc: 495 });
    expect(res.body.sous_totaux).toEqual([
      { lot: '05', titre: 'Menuiseries', sous_total_ht: 400 }, { lot: '06', titre: 'Peinture', sous_total_ht: 50 },
    ]);
    expect(stocke('pa').totalHT).toBe(450);
  });

  it('refuse un lot inexistant en 404 sans rien écrire', async () => {
    const tenantId = makeTenant(); const { token } = makeUser(tenantId); seed(tenantId, 'pb');
    const avant = fakeSupabaseAdmin.getTable('dpgfs').find((r: any) => r.project_id === 'pb')!.data;
    const res = await request(app).post('/api/projects/pb/dpgf/lignes').set(authHeader(token)).send(add({ lot: '99' }));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/lot « 99 » n'existe pas/);
    expect(fakeSupabaseAdmin.getTable('dpgfs').find((r: any) => r.project_id === 'pb')!.data).toBe(avant);
  });

  it("n'atteint pas le DPGF d'un autre cabinet", async () => {
    const autre = makeTenant(); seed(autre, 'pc');
    const { token } = makeUser(makeTenant());
    const res = await request(app).post('/api/projects/pc/dpgf/lignes').set(authHeader(token)).send(add());
    expect(res.status).toBe(404);
  });

  it('dry_run ne modifie rien', async () => {
    const tenantId = makeTenant(); const { token } = makeUser(tenantId); seed(tenantId, 'pd');
    const avant = fakeSupabaseAdmin.getTable('dpgfs').find((r: any) => r.project_id === 'pd')!.data;
    const res = await request(app).post('/api/projects/pd/dpgf/lignes').set(authHeader(token)).send({ action: 'delete_ligne', id: 'p', dry_run: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dry_run: true, ligne: { numero: '3.1' } });
    expect(fakeSupabaseAdmin.getTable('dpgfs').find((r: any) => r.project_id === 'pd')!.data).toBe(avant);
  });

  it('deux appels simultanés ne se perdent pas', async () => {
    const tenantId = makeTenant(); const { token } = makeUser(tenantId); seed(tenantId, 'pe');
    const envoyer = (n: string) => request(app).post('/api/projects/pe/dpgf/lignes').set(authHeader(token))
      .send(add({ lot: '06', lignes: [{ designation: n, unite: 'u', quantite: 1, prix_unitaire: 10 }] }));
    const [a, b] = await Promise.all([envoyer('X'), envoyer('Y')]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const lignes = stocke('pe').lots[1].chapitres[0].lignes.map((l: any) => l.designation);
    expect(lignes).toEqual(expect.arrayContaining(['X', 'Y']));
    expect(new Set(stocke('pe').lots[1].chapitres[0].lignes.map((l: any) => l.numero)).size).toBe(3);
  });
});

describe('outil manage_dpgf', () => {
  it('delete_ligne demande une confirmation, puis supprime avec confirm: true', async () => {
    const appels: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
      const corps = JSON.parse(init.body); appels.push(corps);
      return new Response(JSON.stringify(corps.dry_run ? { success: true, dry_run: true, ligne: { numero: '3.1' } } : { success: true, ligne: { numero: '3.1' }, total_ht: 0 }), { status: 200 });
    }));
    const auth = { token: 't' } as any;
    const premier = await executeProjectWorkTool('http://x', auth, 'manage_dpgf', { project_id: 'p1', action: 'delete_ligne', id: 'p' });
    expect(premier.response).toMatchObject({ needs_confirmation: true, a_retirer: { numero: '3.1' } });
    expect(appels).toHaveLength(1);
    expect(appels[0].dry_run).toBe(true);

    const second = await executeProjectWorkTool('http://x', auth, 'manage_dpgf', { project_id: 'p1', action: 'delete_ligne', id: 'p', confirm: true });
    expect(second.response).toMatchObject({ success: true });
    expect(appels[1].dry_run).toBeUndefined();
  });

  it('refuse plus de 300 lignes avant tout appel réseau', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const lignes = Array.from({ length: 301 }, () => ({ designation: 'x', quantite: 1 }));
    const r = await executeProjectWorkTool('http://x', { token: 't' } as any, 'manage_dpgf', { project_id: 'p1', action: 'add_lignes', lot: '05', lignes });
    expect((r.response as any).error).toMatch(/maximum est 300/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── Marqueur de rédaction (incomplet / en cours d'édition) ───────────────────
describe('marqueur de rédaction', () => {
  const avecMarqueur = (marqueur: any) => {
    const d = doc();
    (d.lots[1].chapitres[0].lignes[0] as any).marqueur = marqueur;
    return d;
  };
  const maj = (over: any = {}) => ({ action: 'update_ligne' as const, id: 'p', ...over });

  it('un agent pose un marqueur sous le nom « Agent IA », avec sa précision', () => {
    const { doc: next, rapport } = appliquerOperation(doc(), maj({ marqueur: 'incomplet', note_marqueur: 'Prix à confirmer' }));
    const m = (next.lots[1].chapitres[0].lignes[0] as any).marqueur;
    expect(m).toMatchObject({ statut: 'incomplet', par: 'Agent IA', note: 'Prix à confirmer' });
    expect(Date.parse(m.le)).not.toBeNaN();
    expect(rapport.ligne?.marqueur).toContain('incomplet par Agent IA');
  });

  it('un marqueur seul est une modification valide et ne touche pas aux montants', () => {
    const { doc: next } = appliquerOperation(doc(), maj({ marqueur: 'en_cours' }));
    expect(next.lots[1].chapitres[0].lignes[0].prixTotal).toBe(50);
  });

  it('« aucun » lève le marqueur ; une valeur inconnue est refusée', () => {
    const { doc: next } = appliquerOperation(avecMarqueur({ statut: 'incomplet', par: 'Agent IA' }), maj({ marqueur: 'aucun' }));
    expect('marqueur' in next.lots[1].chapitres[0].lignes[0]).toBe(false);
    expect(() => appliquerOperation(doc(), maj({ marqueur: 'termine' }))).toThrow(/incomplet, en_cours ou aucun/);
  });

  const enCours = { statut: 'en_cours', par: 'Sophie', le: '2026-11-01T08:00:00Z' };

  it('refuse (409) de modifier, supprimer ou remplacer une ligne en cours d’édition par une personne', () => {
    const src = avecMarqueur(enCours);
    for (const op of [maj({ quantite: 9 }), maj({ marqueur: 'aucun' }), { action: 'delete_ligne' as const, id: 'p' }]) {
      try { appliquerOperation(src, op); throw new Error('aurait dû refuser'); } catch (e: any) {
        expect(e).toBeInstanceOf(DpgfLignesError);
        expect(e.status).toBe(409);
        expect(e.message).toMatch(/en cours d'édition par Sophie/);
      }
    }
    const { rapport } = appliquerOperation(src, add({ lot: '6', replace_existing: true }));
    expect(rapport.lignes_remplacees).toBe(0);
    expect(rapport.lignes_conservees?.[0]).toMatchObject({ numero: '3.1' });
    expect(rapport.lignes_conservees?.[0].raison).toMatch(/Sophie/);
  });

  it('« forcer » passe outre sur demande explicite', () => {
    const { doc: next } = appliquerOperation(avecMarqueur(enCours), maj({ quantite: 9, forcer: true }));
    expect(next.lots[1].chapitres[0].lignes[0].quantite).toBe(9);
  });

  it('ne bloque ni un simple « incomplet », ni un marqueur posé par un agent', () => {
    expect(() => appliquerOperation(avecMarqueur({ statut: 'incomplet', par: 'Sophie' }), maj({ quantite: 9 }))).not.toThrow();
    expect(() => appliquerOperation(avecMarqueur({ statut: 'en_cours', par: 'Agent IA' }), maj({ quantite: 9 }))).not.toThrow();
  });

  it('la route fixe l’auteur côté serveur : un « par » envoyé est ignoré', async () => {
    const tenantId = makeTenant(); const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('dpgfs', [{ id: 'dpgf-pm', tenant_id: tenantId, project_id: 'pm', data: JSON.stringify(doc()), offres: [] }]);
    const res = await request(app).post('/api/projects/pm/dpgf/lignes').set(authHeader(token))
      .send({ action: 'update_ligne', id: 'p', marqueur: 'en_cours', par: 'Sophie' });
    expect(res.status).toBe(200);
    const stocke = JSON.parse(fakeSupabaseAdmin.getTable('dpgfs').find((r: any) => r.project_id === 'pm')!.data);
    expect(stocke.lots[1].chapitres[0].lignes[0].marqueur.par).toBe('Agent IA');
  });

  it('la route répond 409 sur une ligne en cours d’édition par une personne', async () => {
    const tenantId = makeTenant(); const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('dpgfs', [{ id: 'dpgf-pn', tenant_id: tenantId, project_id: 'pn', data: JSON.stringify(avecMarqueur(enCours)), offres: [] }]);
    const res = await request(app).post('/api/projects/pn/dpgf/lignes').set(authHeader(token)).send({ action: 'update_ligne', id: 'p', quantite: 3 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/forcer: true seulement/);
  });
});
