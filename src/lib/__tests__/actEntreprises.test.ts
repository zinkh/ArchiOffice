import { describe, it, expect } from 'vitest';
import {
  statutEntreprise, resumeSuivi, couverture, suggererContacts, filtrerEntreprises,
  radicauxMetier, todayIso, listeAPlat, SANS_LOT, FILTRES_VIDES, type EntrepriseSuivi,
} from '../actEntreprises';

const ent = (p: Partial<EntrepriseSuivi> = {}): EntrepriseSuivi => ({
  id: 'e', nom: 'Dupont SARL', lots_ids: [], envoyer_dce: true, ...p,
});
const TODAY = '2026-10-02';

describe('statutEntreprise', () => {
  it('à envoyer quand le DCE est prévu mais pas encore transmis', () => {
    expect(statutEntreprise(ent(), TODAY)).toBe('a_envoyer');
  });
  it('hors envoi quand le DCE n\'est pas prévu', () => {
    expect(statutEntreprise(ent({ envoyer_dce: false }), TODAY)).toBe('hors_envoi');
  });
  it('DCE envoyé tant que la relance n\'est pas atteinte', () => {
    expect(statutEntreprise(ent({ dce_transmis_le: '2026-09-20', relance_le: '2026-10-10' }), TODAY)).toBe('dce_envoye');
  });
  it('à relancer quand la date de relance est atteinte sans offre', () => {
    expect(statutEntreprise(ent({ dce_transmis_le: '2026-09-20', relance_le: '2026-10-02' }), TODAY)).toBe('a_relancer');
  });
  it('l\'offre reçue l\'emporte sur la relance', () => {
    expect(statutEntreprise(ent({ dce_transmis_le: '2026-09-20', relance_le: '2026-09-25', offre_recue_le: '2026-09-30' }), TODAY)).toBe('offre_recue');
  });
  it('« ne répond pas » l\'emporte sur tout', () => {
    expect(statutEntreprise(ent({ ne_repond_pas: true, offre_recue_le: '2026-09-30' }), TODAY)).toBe('sans_reponse');
  });
});

describe('resumeSuivi', () => {
  it('compte chaque statut', () => {
    const r = resumeSuivi([ent({ id: '1' }), ent({ id: '2', offre_recue_le: '2026-09-30' }), ent({ id: '3', ne_repond_pas: true })], TODAY);
    expect(r.total).toBe(3);
    expect(r.parStatut.a_envoyer).toBe(1);
    expect(r.parStatut.offre_recue).toBe(1);
    expect(r.parStatut.sans_reponse).toBe(1);
  });
});

describe('couverture', () => {
  const lots = [
    { id: 'l1', lot_number: '01', lot_title: 'Gros œuvre' },
    { id: 'l2', lot_number: '02', lot_title: 'Charpente bois' },
  ];
  it('signale les lots sous le minimum, sans compter « ne répond pas »', () => {
    const es = [
      ent({ id: 'a', lots_ids: ['l1'] }), ent({ id: 'b', lots_ids: ['l1'] }), ent({ id: 'c', lots_ids: ['l1'] }),
      ent({ id: 'd', lots_ids: ['l2'] }), ent({ id: 'x', lots_ids: ['l2'], ne_repond_pas: true }),
    ];
    const c = couverture(es, lots);
    expect(c.lotsInsuffisants.map(x => [x.lot.id, x.nb])).toEqual([['l2', 1]]);
  });
  it('liste les entreprises sans lot (y compris lot supprimé) et sans email', () => {
    const es = [ent({ id: 'a', lots_ids: ['disparu'] }), ent({ id: 'b', lots_ids: ['l1'], email: 'b@x.fr' })];
    const c = couverture(es, lots);
    expect(c.sansLot.map(e => e.id)).toEqual(['a']);
    expect(c.sansEmail.map(e => e.id)).toEqual(['a']);
  });
  it('ne réclame pas l\'email d\'une entreprise déjà servie', () => {
    const c = couverture([ent({ dce_transmis_le: '2026-09-01' })], lots);
    expect(c.sansEmail).toHaveLength(0);
  });
});

describe('suggererContacts', () => {
  const lot = { id: 'l2', lot_number: '02', lot_title: 'CHARPENTE BOIS' };
  const contacts = [
    { id: '1', company_name: 'Bois & Fils', corps_etat: ['Charpente - Ossature bois'] },
    { id: '2', company_name: 'Menuiseries Lorraines', corps_etat: ['Menuiseries intérieures'] },
    { id: '3', company_name: 'Charpentes de l\'Est', corps_etat: ['Charpente métallique'] },
    { id: '4', company_name: 'Déjà là', corps_etat: ['Charpente bois'] },
  ];
  it('classe par recoupement avec l\'intitulé du lot et exclut les déjà consultés', () => {
    const r = suggererContacts(lot, contacts, new Set(['4']));
    expect(r.map(c => c.id)).toEqual(['1', '3']);
  });
  it('rapproche singulier et pluriel', () => {
    expect([...radicauxMetier('Menuiserie')]).toEqual([...radicauxMetier('Menuiseries')]);
  });
  it('ne suggère rien pour un lot sans mot significatif', () => {
    expect(suggererContacts({ id: 'x', lot_number: '9', lot_title: 'Lot 9' }, contacts, new Set())).toEqual([]);
  });
});

describe('filtrerEntreprises', () => {
  const es = [
    ent({ id: 'a', nom: 'Étanchéité Générale', email: 'contact@etanch.fr' }),
    ent({ id: 'b', nom: 'Dupont', offre_recue_le: '2026-09-30' }),
  ];
  it('cherche sans tenir compte de la casse ni des accents, dans le nom et l\'email', () => {
    expect(filtrerEntreprises(es, { ...FILTRES_VIDES, recherche: 'etancheite' }, TODAY).map(e => e.id)).toEqual(['a']);
    expect(filtrerEntreprises(es, { ...FILTRES_VIDES, recherche: 'ETANCH.FR' }, TODAY).map(e => e.id)).toEqual(['a']);
  });
  it('filtre par statut', () => {
    expect(filtrerEntreprises(es, { ...FILTRES_VIDES, statut: 'offre_recue' }, TODAY).map(e => e.id)).toEqual(['b']);
  });
});

describe('todayIso', () => {
  it('formate en heure locale', () => {
    expect(todayIso(new Date(2026, 9, 2, 0, 30))).toBe('2026-10-02');
  });
});

describe('listeAPlat', () => {
  const lots = [{ id: 'l1', lot_number: '01', lot_title: 'Gros œuvre' }, { id: 'l2', lot_number: '02', lot_title: 'Charpente' }];
  const es = [
    ent({ id: 'b', nom: 'Zinc & Fils', lots_ids: ['l1', 'l2'] }),
    ent({ id: 'a', nom: 'étanchéité Est', lots_ids: ['l2'] }),
    ent({ id: 'v', nom: '', lots_ids: [] }),
    ent({ id: 'c', nom: 'Bati', lots_ids: ['disparu'] }),
  ];
  it('rend chaque entreprise une seule fois, triée par nom, les noms vides en dernier', () => {
    expect(listeAPlat(es, '', lots).map(e => e.id)).toEqual(['c', 'a', 'b', 'v']);
  });
  it('filtre par appartenance à un lot', () => {
    expect(listeAPlat(es, 'l2', lots).map(e => e.id)).toEqual(['a', 'b']);
  });
  it('« sans lot » retient aussi les entreprises dont le lot a été supprimé', () => {
    expect(listeAPlat(es, SANS_LOT, lots).map(e => e.id)).toEqual(['c', 'v']);
  });
  it('ne modifie pas la liste d\'origine', () => {
    const avant = es.map(e => e.id);
    listeAPlat(es, '', lots);
    expect(es.map(e => e.id)).toEqual(avant);
  });
});
