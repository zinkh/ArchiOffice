import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeAgentAction } from '../packages/archioffice-agents/src/server/tools';
import { articlesDuLot, cleNumero, trouverArticle, totalLotPostes, repartirSaisie, quantitesDifferent } from '../packages/archioffice-agents/src/server/consultationPostes';
import { capabilitiesFromAgent } from '../packages/archioffice-agents/src/types';

const NO_CAPS = { action_scopes: [] as string[], web_fetch_enabled: false, mail_enabled: false, mail_send_enabled: false, geo_enabled: false, docs_read_enabled: false };
const auth = { authorization: 'Bearer x' };
const caps = capabilitiesFromAgent({ ...NO_CAPS, action_scopes: ['projects'] });
const run = (args: any) => executeAgentAction('http://localhost', auth, caps, { name: 'manage_consultation', args: { project_id: 'p1', action: 'set_postes', ...args } }) as Promise<{ response: any }>;

const lots = [{ id: 'l1', lot_number: '01', lot_title: 'GO' }, { id: 'l2', lot_number: '02', lot_title: 'TERRASSEMENT' }];
const dpgf = () => ({
  version: 'v1',
  lots: [{
    id: 'dl2', numero: '02', projectLotId: 'l2',
    chapitres: [
      { id: 'c1', numero: '1', titre: 'Fouilles', lignes: [
        { id: 'a1', numero: '1.1', designation: 'Fouille en rigole', unite: 'm3', quantite: 10 },
        { id: 'a2', numero: '1.2', designation: 'Tranchée EU', unite: 'ml', quantite: 5 },
        { id: 'a4', numero: '1.3', designation: 'Variante drain', unite: 'ml', quantite: 4, nature: 'option' },
      ] },
      { id: 'c3', numero: '3', titre: 'Divers', lignes: [{ id: 'a3', numero: '3.1', designation: 'Forfait', unite: 'ens', quantite: 1 }] },
      { id: 'c9', numero: '9', titre: 'Prescriptions', cctpOnly: true, lignes: [{ id: 'a9', numero: '9.1', designation: 'Texte', unite: '', quantite: 0 }] },
    ],
  }],
});

/** Serveur factice avec état : la consultation et les offres du DPGF se relisent après écriture. */
const monde = (opts: { document_reference?: string; base_quantites?: string; offres?: any[]; entreprises?: any[]; offresConsultation?: any[]; contacts?: any[] } = {}) => {
  const etat = {
    consultation: {
      document_reference: opts.document_reference,
      base_quantites: opts.base_quantites,
      entreprises: opts.entreprises ?? [{ id: 'e1', nom: 'Dupont SARL', contact_id: 'c1', lots_ids: ['l2'] }],
      offres: opts.offresConsultation ?? [],
    } as any,
    offres: (opts.offres ?? []) as any[],
  };
  const ecritures: { method: string; url: string; body: any }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    const method = init?.method || 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const rep = (data: any) => ({ ok: true, status: 200, json: async () => data });
    if (method !== 'GET') ecritures.push({ method, url, body });
    if (url.includes('/dpgf/offres/') && method === 'PUT') {
      const id = url.split('/dpgf/offres/')[1];
      etat.offres = etat.offres.map(o => (o.id === id ? { ...o, ...body } : o));
      return rep(etat.offres.find(o => o.id === id));
    }
    if (url.includes('/dpgf/offres') && method === 'POST') {
      const saved = { ...body.offre, id: `n${etat.offres.length + 1}`, importedAt: new Date().toISOString() };
      etat.offres = [...etat.offres, saved];
      return rep(saved);
    }
    if (url.includes('/dpgf/offres')) return rep(etat.offres);
    if (url.includes('/dpgf')) return rep(dpgf());
    if (url.includes('/api/projects/p1/act') && method === 'PUT') { etat.consultation = body.consultation; return rep({ id: 'a' }); }
    if (url.includes('/api/projects/p1/act')) return rep({ consultation: etat.consultation });
    if (url.includes('/api/projects/p1/lots')) return rep(lots);
    if (url.includes('/api/contacts')) return rep(opts.contacts ?? [{ id: 'c1', company_name: 'Dupont SARL' }]);
    return rep([]);
  }));
  return { etat, ecritures, postsDpgf: () => ecritures.filter(e => e.url.includes('/dpgf/offres')) };
};

describe('set_postes : logique pure', () => {
  const articles = articlesDuLot(dpgf().lots[0]);

  it('ne retient que les articles chiffrables, hors chapitres réservés au CCTP', () => {
    expect(articles.map(a => a.numero)).toEqual(['1.1', '1.2', '1.3', '3.1']);
    expect(articles.find(a => a.numero === '1.3')!.horsBase).toBe(true);
  });

  it('retrouve un poste par numéro, avec ou sans zéros et préfixe de lot', () => {
    expect(cleNumero('03.01')).toBe('3.1');
    expect(trouverArticle(articles, { numero: '3.1' }, '02').article?.id).toBe('a3');
    expect(trouverArticle(articles, { numero: '02.3.1' }, '02').article?.id).toBe('a3');
    expect(trouverArticle(articles, { id: 'a2' }, '02').article?.numero).toBe('1.2');
    expect(trouverArticle(articles, { numero: '7.7' }, '02').erreur).toContain('introuvable');
  });

  it('refuse un numéro porté par deux postes', () => {
    const doubles = [...articles, { ...articles[0], id: 'zz' }];
    expect(trouverArticle(doubles, { numero: '1.1' }, '02').erreur).toContain('2 postes');
  });

  it('calcule le total sur la base seulement, pour mémoire exclu, postes ajoutés comptés', () => {
    const total = totalLotPostes(articles, { a1: 100, a2: null, a4: 50, a3: 500 }, [{ id: 'p', numero: '', designation: 'x', unite: '', quantite: null, prixUnitaire: 200 }]);
    expect(total).toBe(100 * 10 + 500 + 200);
    expect(totalLotPostes(articles, { a2: null }, [])).toBeNull();
  });

  it("range un prix nouveau dans « Saisie manuelle » et corrige un prix là où il est", () => {
    const importee = { id: 'o1', entrepriseId: 'e1', fichierNom: 'devis.xlsx', importedAt: '2026-10-01', prix: { a1: 90 }, postesAjoutes: [] };
    const maj = repartirSaisie([importee], 'e1', 'dl2', ['a1', 'a2'], { a1: 95, a2: 20 }, []);
    expect(maj.find(m => m.id === 'o1')!.prix).toEqual({ a1: 95 });
    expect(maj.find(m => m.id === null)!.prix).toEqual({ a2: 20 });
  });
});

describe('manage_consultation / set_postes', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const devis = { lot: '02', entreprise: 'Dupont SARL', postes: [{ numero: '1.1', prix_unitaire: 100 }, { numero: '1.2', pour_memoire: true }, { numero: '3.1', prix_unitaire: 3550 }] };

  it("écrit les prix dans une offre « Saisie manuelle », déduit le total et passe le lot en mode postes", async () => {
    const m = monde();
    const r = await run({ offres: [devis] });
    expect(r.response.success).toBe(true);
    const [post] = m.postsDpgf().filter(e => e.method === 'POST');
    expect(post.body.offre).toMatchObject({ entrepriseId: 'e1', entrepriseNom: 'Dupont SARL', fichierNom: 'Saisie manuelle', documentVersion: 'v1', statut: 'validee', prix: { a1: 100, a2: null, a3: 3550 } });
    expect(m.etat.consultation.offres[0]).toMatchObject({ lot_id: 'l2', entreprise_id: 'e1', mode_saisie: 'postes', montant_base: 100 * 10 + 3550 });
    expect(m.etat.consultation.entreprises[0].offre_recue_le).toBeDefined();
    expect(r.response.saisies[0]).toMatchObject({ lot: '02', entreprise: 'Dupont SARL', total_ht: 4550, postes_chiffres: 2, postes_pour_memoire: 1, articles_du_dpgf_non_chiffres: 1 });
  });

  it("ne modifie jamais le DPGF (aucune écriture sur le document)", async () => {
    const m = monde();
    await run({ offres: [devis] });
    expect(m.ecritures.every(e => /\/dpgf\/offres|\/act/.test(e.url))).toBe(true);
  });

  it('demande confirmation avant de remplacer un total saisi à la main', async () => {
    const m = monde({ offresConsultation: [{ id: 'o1', lot_id: 'l2', entreprise_id: 'e1', montant_base: 4400, mode_saisie: 'total', conforme: true, note_technique: 0 }] });
    const first = await run({ offres: [devis] });
    expect(first.response.needs_confirmation).toBe(true);
    expect(first.response.concerne[0]).toMatchObject({ lot: '02', entreprise: 'Dupont SARL', total_saisi_actuel: 4400, nouveau_total_calcule: 4550 });
    expect(m.ecritures).toHaveLength(0);
    const ok = await run({ offres: [devis], confirm: true });
    expect(ok.response.success).toBe(true);
    expect(m.etat.consultation.offres[0]).toMatchObject({ mode_saisie: 'postes', montant_base: 4550 });
  });

  it('rejouer le même appel ne crée rien de plus', async () => {
    const m = monde();
    await run({ offres: [devis] });
    const apres = m.ecritures.length;
    const encore = await run({ offres: [devis] });
    expect(encore.response.success).toBe(true);
    expect(m.etat.offres).toHaveLength(1);
    expect(m.ecritures.length).toBe(apres);
  });

  it("refuse tout le lot sur un numéro inconnu, sans rien écrire", async () => {
    const m = monde();
    const r = await run({ offres: [{ ...devis, postes: [...devis.postes, { numero: '8.8', prix_unitaire: 1 }] }] });
    expect(r.response.error).toBeDefined();
    expect(r.response.non_traites[0].erreurs[0].raison).toContain('introuvable');
    expect(r.response.non_traites[0].numeros_possibles).toContain('3.1');
    expect(m.ecritures).toHaveLength(0);
  });

  it('refuse un prix absent ou négatif', async () => {
    const m = monde();
    const r = await run({ offres: [{ lot: '02', entreprise: 'Dupont SARL', postes: [{ numero: '1.1' }, { numero: '1.2', prix_unitaire: -4 }] }] });
    expect(r.response.error).toBeDefined();
    expect(r.response.non_traites[0].erreurs).toHaveLength(2);
    expect(m.ecritures).toHaveLength(0);
  });

  it("range une ligne de devis sans poste correspondant dans les postes ajoutés, sans la doubler au rejeu", async () => {
    const m = monde();
    const args = { offres: [{ lot: '02', entreprise: 'Dupont SARL', postes: [{ numero: '1.1', prix_unitaire: 100 }], postes_ajoutes: [{ designation: 'Prestations diverses', unite: 'ens', quantite: 1, prix_unitaire: 6720 }] }] };
    const r = await run(args);
    expect(r.response.saisies[0]).toMatchObject({ total_ht: 100 * 10 + 6720, postes_ajoutes_par_l_entreprise: 1 });
    expect(m.etat.offres[0].postesAjoutes).toHaveLength(1);
    expect(m.etat.offres[0].postesAjoutes[0]).toMatchObject({ designation: 'Prestations diverses', prixUnitaire: 6720, lotId: 'dl2' });
    await run({ offres: [{ ...args.offres[0], postes_ajoutes: [{ designation: 'Prestations diverses', unite: 'ens', quantite: 1, prix_unitaire: 7000 }] }] });
    expect(m.etat.offres.flatMap(o => o.postesAjoutes)).toHaveLength(1);
    expect(m.etat.offres[0].postesAjoutes[0].prixUnitaire).toBe(7000);
  });

  it("ajoute à la consultation une entreprise qui n'y figure pas, puis range ses prix sous son identifiant", async () => {
    const m = monde({ contacts: [{ id: 'c9', company_name: 'Richi Kamal' }] });
    const r = await run({ offres: [{ lot: '02', entreprise: 'Richi Kamal', postes: [{ numero: '1.1', prix_unitaire: 10 }] }] });
    expect(r.response.success).toBe(true);
    const richi = m.etat.consultation.entreprises.find((e: any) => e.nom === 'Richi Kamal');
    expect(richi).toMatchObject({ contact_id: 'c9', lots_ids: ['l2'], envoyer_dce: false });
    expect(m.etat.offres[0]).toMatchObject({ entrepriseId: richi.id, entrepriseNom: 'Richi Kamal' });
    expect(m.etat.consultation.offres.find((o: any) => o.entreprise_id === richi.id)).toMatchObject({ mode_saisie: 'postes', montant_base: 100 });
  });

  it('met à jour le prix là où il est déjà (offre importée) au lieu de créer un doublon', async () => {
    const importee = { id: 'o1', entrepriseId: 'e1', entrepriseNom: 'Dupont SARL', fichierNom: 'devis.xlsx', importedAt: '2026-10-01', prix: { a1: 90, a3: 1 }, postesAjoutes: [] };
    const m = monde({ offres: [importee] });
    await run({ offres: [{ lot: '02', entreprise: 'Dupont SARL', postes: [{ numero: '1.1', prix_unitaire: 95 }] }] });
    expect(m.etat.offres).toHaveLength(1);
    expect(m.etat.offres[0].prix).toEqual({ a1: 95, a3: 1 });
    expect(m.etat.consultation.offres[0].montant_base).toBe(95 * 10 + 1);
  });

  it('refuse une consultation qui compare le bordereau', async () => {
    const m = monde({ document_reference: 'bpu' });
    const r = await run({ offres: [devis] });
    expect(r.response.error).toContain('BPU');
    expect(m.ecritures).toHaveLength(0);
  });

  it('refuse un lot absent du DPGF', async () => {
    const m = monde();
    const r = await run({ offres: [{ lot: '01', entreprise: 'Dupont SARL', postes: [{ numero: '1.1', prix_unitaire: 1 }] }] });
    expect(r.response.error).toBeDefined();
    expect(JSON.stringify(r.response.non_traites)).toContain("n'existe pas dans le DPGF");
    expect(m.ecritures).toHaveLength(0);
  });
});

describe('set_postes : quantités proposées par l\'entreprise', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const devis = (quantite: number) => ({ lot: '02', entreprise: 'Dupont SARL', postes: [{ numero: '1.1', prix_unitaire: 100, quantite }, { numero: '3.1', prix_unitaire: 3550 }] });

  it('garde la quantité de l\'entreprise dans son offre quand elle diffère du DPGF, sans toucher au total (base MOE)', async () => {
    const m = monde();
    const r = await run({ offres: [devis(12)] });
    expect(r.response.success).toBe(true);
    const [post] = m.postsDpgf().filter(e => e.method === 'POST');
    expect(post.body.offre).toMatchObject({ quantites: { a1: 12 }, quantitesAcceptees: [] });
    expect(m.etat.consultation.offres[0].montant_base).toBe(100 * 10 + 3550); // quantités du MOE
    expect(r.response.saisies[0].quantites_differentes_du_dpgf).toEqual([{ poste: '1.1', quantite_dpgf: 10, quantite_entreprise: 12, acceptee: false }]);
  });

  it('base « entreprise » : le total suit les quantités remises', async () => {
    const m = monde({ base_quantites: 'entreprise' });
    await run({ offres: [devis(12)] });
    expect(m.etat.consultation.offres[0].montant_base).toBe(100 * 12 + 3550);
  });

  it('ne garde rien quand la quantité reprend celle du DPGF, et n\'écrit aucune quantité sans en recevoir', async () => {
    const m = monde();
    await run({ offres: [devis(10)] });
    const [post] = m.postsDpgf().filter(e => e.method === 'POST');
    expect(post.body.offre.quantites ?? {}).toEqual({}); // rien à garder : absence = même quantité
    const m2 = monde();
    await run({ offres: [{ lot: '02', entreprise: 'Dupont SARL', postes: [{ numero: '1.1', prix_unitaire: 100 }] }] });
    const [post2] = m2.postsDpgf().filter(e => e.method === 'POST');
    expect(post2.body.offre).not.toHaveProperty('quantites');
  });

  it('refuse une quantité négative ou illisible : rien n\'est enregistré pour ce lot', async () => {
    const m = monde();
    const r = await run({ offres: [devis(-3)] });
    expect(r.response.non_traites?.[0].erreurs?.[0].raison).toContain('quantite');
    expect(m.postsDpgf()).toHaveLength(0);
  });

  it('rejouer avec la même quantité ne change rien, une quantité retirée efface l\'ancienne ; le DPGF reste intact', async () => {
    const m = monde();
    await run({ offres: [devis(12)] });
    await run({ offres: [devis(12)] });
    expect(m.etat.offres).toHaveLength(1);
    expect(m.etat.offres[0].quantites).toEqual({ a1: 12 });
    await run({ offres: [devis(10)] }); // reprend la quantité du DPGF : l'écart disparaît
    expect(m.etat.offres[0].quantites).toEqual({});
    expect(m.ecritures.every(e => /\/dpgf\/offres|\/act/.test(e.url))).toBe(true);
  });

  it('une quantité acceptée à l\'écran reste acceptée quand on rejoue les prix sans la changer', async () => {
    const m = monde({ offres: [{ id: 'o1', entrepriseId: 'e1', fichierNom: 'Saisie manuelle', importedAt: '2026-10-01', prix: { a1: 100 }, postesAjoutes: [], quantites: { a1: 12 }, quantitesAcceptees: ['a1'] }] });
    const r = await run({ offres: [devis(12)] });
    expect(r.response.success).toBe(true);
    expect(m.etat.offres[0].quantitesAcceptees ?? []).toEqual(['a1']);
    expect(m.etat.consultation.offres[0].montant_base).toBe(100 * 12 + 3550); // acceptée : compte dans la base MOE
  });

  it('compare à la virgule près', () => {
    expect(quantitesDifferent(10, 10.001)).toBe(true);
    expect(quantitesDifferent(0.1 + 0.2, 0.3)).toBe(false);
  });
});
