import { describe, it, expect } from 'vitest';
import {
  activerTranches, desactiverTranches, ajouterTranche, modifierTranche, supprimerTranche,
  deplacerTranche, affecterMission, dupliquerMissionSurTranche, totauxParTranche,
  donneesFermeSeule, validerTranches, lireDonnees, tranchesActives, listeTranches,
  TRANCHE_FERME_ID, type DonneesTranches,
} from '../tranches';

const mission = (id: string, amount: number, extra: Record<string, unknown> = {}) => ({
  id, name: id.toUpperCase(), category: 'Mission base' as const, amount, percentages: { architect: 100, c1: 0 }, ...extra,
});

const ancien = (): DonneesTranches => ({ missions: [mission('esquisse', 1000), mission('det', 4000)] });

describe('format ancien (sans tranches)', () => {
  it('reste inactif et lit toutes les missions comme tranche ferme', () => {
    const d = ancien();
    expect(tranchesActives(d)).toBe(false);
    expect(listeTranches(d)).toHaveLength(1);
    const t = totauxParTranche(d);
    expect(t.ferme).toBe(5000);
    expect(t.conditionnel).toBe(0);
    expect(t.global).toBe(5000);
  });

  it('lireDonnees ne lève jamais d\'exception', () => {
    expect(lireDonnees('pas du json')).toBeNull();
    expect(lireDonnees(undefined)).toBeNull();
    expect(lireDonnees('{"missions":[]}')).toEqual({ missions: [] });
  });
});

describe('gestion des tranches', () => {
  it('active le mode en rattachant les missions à la tranche ferme', () => {
    const d = activerTranches(ancien());
    expect(d.tranches).toHaveLength(1);
    expect(d.missions.every(m => m.tranche_id === TRANCHE_FERME_ID)).toBe(true);
  });

  it('ajoute des conditionnelles numérotées et une seconde ferme', () => {
    let d = ajouterTranche(ancien(), 'conditionnelle');
    d = ajouterTranche(d, 'conditionnelle');
    d = ajouterTranche(d, 'ferme');
    expect(d.tranches!.map(t => t.label)).toEqual([
      'Tranche ferme', 'Tranche conditionnelle 1', 'Tranche conditionnelle 2', 'Tranche ferme 2',
    ]);
    expect(new Set(d.tranches!.map(t => t.id)).size).toBe(4);
  });

  it('refuse de retirer la dernière tranche ferme', () => {
    const d = ajouterTranche(ancien(), 'conditionnelle');
    const cond = d.tranches![1].id;
    expect(modifierTranche(d, TRANCHE_FERME_ID, { type: 'conditionnelle' })).toBe(d);
    expect(supprimerTranche(d, TRANCHE_FERME_ID)).toBe(d);
    expect(modifierTranche(d, cond, { label: 'Phase 2' }).tranches![1].label).toBe('Phase 2');
  });

  it('supprimer une tranche renvoie ses missions en ferme', () => {
    let d = ajouterTranche(ancien(), 'conditionnelle');
    const cond = d.tranches![1].id;
    d = affecterMission(d, 'det', cond);
    d = supprimerTranche(d, cond);
    expect(d.tranches).toHaveLength(1);
    expect(d.missions.find(m => m.id === 'det')!.tranche_id).toBe(TRANCHE_FERME_ID);
  });

  it('réordonne sans sortir des bornes', () => {
    const d = ajouterTranche(ancien(), 'conditionnelle');
    expect(deplacerTranche(d, TRANCHE_FERME_ID, -1)).toBe(d);
    const inv = deplacerTranche(d, TRANCHE_FERME_ID, 1);
    expect(inv.tranches![1].id).toBe(TRANCHE_FERME_ID);
  });

  it('ne désactive le mode que sans conditionnelle', () => {
    const avec = ajouterTranche(ancien(), 'conditionnelle');
    expect(desactiverTranches(avec)).toBe(avec);
    const seul = activerTranches(ancien());
    const retour = desactiverTranches(seul);
    expect(retour.tranches).toBeUndefined();
    expect(retour.missions.every(m => m.tranche_id === undefined)).toBe(true);
  });
});

describe('répartition d\'une mission sur plusieurs tranches', () => {
  it('duplique la ligne avec un identifiant unique et un montant à zéro', () => {
    let d = ajouterTranche(ancien(), 'conditionnelle');
    const cond = d.tranches![1].id;
    d = dupliquerMissionSurTranche(d, 'det', cond);
    const copie = d.missions.find(m => m.id === `det__${cond}`)!;
    expect(copie.tranche_id).toBe(cond);
    expect(copie.amount).toBe(0);
    expect(copie.percentages).toEqual({ architect: 100, c1: 0 });
    expect(copie.percentages).not.toBe(d.missions.find(m => m.id === 'det')!.percentages);
    expect(d.missions.find(m => m.id === 'det')!.amount).toBe(4000);
    expect(d.missions.findIndex(m => m.id === copie.id)).toBe(d.missions.findIndex(m => m.id === 'det') + 1);
  });

  it('une seconde duplication sur la même tranche garde des identifiants uniques', () => {
    let d = ajouterTranche(ancien(), 'conditionnelle');
    const cond = d.tranches![1].id;
    d = dupliquerMissionSurTranche(d, 'det', cond);
    d = dupliquerMissionSurTranche(d, 'det', cond);
    expect(new Set(d.missions.map(m => m.id)).size).toBe(d.missions.length);
  });

  it('ignore une mission ou une tranche inconnue', () => {
    const d = ajouterTranche(ancien(), 'conditionnelle');
    expect(dupliquerMissionSurTranche(d, 'nope', d.tranches![1].id)).toBe(d);
    expect(dupliquerMissionSurTranche(d, 'det', 'nope')).toBe(d);
  });
});

describe('totaux', () => {
  it('sépare ferme, conditionnel et global', () => {
    let d = ajouterTranche(ancien(), 'conditionnelle');
    const cond = d.tranches![1].id;
    d = dupliquerMissionSurTranche(d, 'det', cond);
    d = { ...d, missions: d.missions.map(m => (m.id === `det__${cond}` ? { ...m, amount: 1500.555 } : m)) };
    const t = totauxParTranche(d);
    expect(t.ferme).toBe(5000);
    expect(t.conditionnel).toBe(1500.56);
    expect(t.global).toBe(6500.56);
    expect(t.parTranche.map(p => p.total)).toEqual([5000, 1500.56]);
  });

  it('une mission à tranche inconnue compte en ferme', () => {
    const d: DonneesTranches = {
      tranches: [{ id: 'a', label: 'Ferme', type: 'ferme' }],
      missions: [mission('x', 100, { tranche_id: 'fantome' })],
    };
    expect(totauxParTranche(d).ferme).toBe(100);
  });

  it('donneesFermeSeule retire les missions conditionnelles', () => {
    let d = ajouterTranche(ancien(), 'conditionnelle');
    d = affecterMission(d, 'det', d.tranches![1].id);
    const f = donneesFermeSeule(d);
    expect(f.missions.map(m => m.id)).toEqual(['esquisse']);
    expect(f.tranches!.every(t => t.type === 'ferme')).toBe(true);
  });
});

describe('validerTranches', () => {
  it('accepte l\'ancien format et un format cohérent', () => {
    expect(validerTranches({ missions: [] })).toBeNull();
    expect(validerTranches(ajouterTranche(ancien(), 'conditionnelle'))).toBeNull();
  });

  it('refuse les cas incohérents', () => {
    expect(validerTranches({ tranches: 'x', missions: [] })).toMatch(/liste/);
    expect(validerTranches({ tranches: [{ id: 'a', label: 'A', type: 'conditionnelle' }], missions: [] })).toMatch(/tranche ferme/);
    expect(validerTranches({ tranches: [{ id: 'a', label: 'A', type: 'ferme' }, { id: 'a', label: 'B', type: 'ferme' }], missions: [] })).toMatch(/double/);
    expect(validerTranches({ tranches: [{ id: 'a', label: 'A', type: 'autre' }], missions: [] })).toMatch(/invalide/);
    expect(validerTranches({ tranches: [{ id: 'a', label: ' ', type: 'ferme' }], missions: [] })).toMatch(/libellé/);
    expect(validerTranches({ tranches: [{ id: 'a', label: 'A', type: 'ferme' }], missions: [{ id: 'm', tranche_id: 'zz' }] })).toMatch(/inconnue/);
    expect(validerTranches({ tranches: [{ id: 'a', label: 'A', type: 'ferme' }], missions: [{ id: 'm' }, { id: 'm' }] })).toMatch(/mission en double/);
  });
});
