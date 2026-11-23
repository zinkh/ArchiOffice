import { describe, expect, it } from 'vitest';
import {
  blocQuantitesAConfirmer, quantitesApresReponses, reponseAppliquee, validerReponsesQuantites,
} from '../quantitesConfirmation';
import { marquageEnvoi, planEnvoiGroupe } from '../dceEnvoiGroupe';
import { blocsMessageDce, remplirModele, MODELE_CORPS_QUANTITES } from '../dceEnvoiMessage';
import type { EntrepriseSuivi } from '../actEntreprises';

const AUTORISES = new Set(['a1', 'a2']);

describe('validerReponsesQuantites', () => {
  it('accepte les trois choix et lit une quantité à la française', () => {
    const r = validerReponsesQuantites({ reponses: [
      { ligne_id: 'a1', choix: 'moe' }, { ligne_id: 'a2', choix: 'autre', quantite: '12,5' },
    ] }, AUTORISES);
    expect(r).toEqual({ ok: true, reponses: [{ ligneId: 'a1', choix: 'moe' }, { ligneId: 'a2', choix: 'autre', quantite: 12.5 }] });
  });

  it('refuse un poste qui n\'est pas à confirmer, un doublon, un choix inconnu et une quantité négative', () => {
    expect(validerReponsesQuantites({ reponses: [{ ligne_id: 'zz', choix: 'moe' }] }, AUTORISES).ok).toBe(false);
    expect(validerReponsesQuantites({ reponses: [{ ligne_id: 'a1', choix: 'moe' }, { ligne_id: 'a1', choix: 'maintenue' }] }, AUTORISES).ok).toBe(false);
    expect(validerReponsesQuantites({ reponses: [{ ligne_id: 'a1', choix: 'peut-etre' }] }, AUTORISES).ok).toBe(false);
    expect(validerReponsesQuantites({ reponses: [{ ligne_id: 'a1', choix: 'autre', quantite: -1 }] }, AUTORISES).ok).toBe(false);
    expect(validerReponsesQuantites({ reponses: [{ ligne_id: 'a1', choix: 'autre' }] }, AUTORISES).ok).toBe(false);
    expect(validerReponsesQuantites({ reponses: [] }, AUTORISES).ok).toBe(false);
    expect(validerReponsesQuantites(null, AUTORISES).ok).toBe(false);
  });
});

describe('quantitesApresReponses', () => {
  const dossier = new Map([['a1', 10], ['a2', 5]]);
  it('reprend le dossier, maintient ou propose une autre quantité', () => {
    const suite = quantitesApresReponses({ a1: 12, a2: 6 }, [
      { ligneId: 'a1', choix: 'moe' }, { ligneId: 'a2', choix: 'maintenue' },
    ], dossier);
    expect(suite).toEqual({ a1: undefined, a2: 6 });
    expect(quantitesApresReponses({ a1: 12 }, [{ ligneId: 'a1', choix: 'autre', quantite: 11 }], dossier).a1).toBe(11);
  });

  it('ne garde rien quand l\'autre quantité est celle du dossier', () => {
    expect(quantitesApresReponses({ a1: 12 }, [{ ligneId: 'a1', choix: 'autre', quantite: 10 }], dossier).a1).toBeUndefined();
  });

  it('ignore un poste inconnu du dossier', () => {
    expect(quantitesApresReponses({}, [{ ligneId: 'x', choix: 'autre', quantite: 3 }], dossier)).toEqual({});
  });
});

describe('reponseAppliquee', () => {
  it('« maintient » n\'a rien à appliquer ; « dossier » reste à appliquer tant que l\'offre diffère', () => {
    expect(reponseAppliquee({ ligneId: 'a1', choix: 'maintenue' }, 12, 10)).toBe(true);
    expect(reponseAppliquee({ ligneId: 'a1', choix: 'moe' }, 12, 10)).toBe(false);
    expect(reponseAppliquee({ ligneId: 'a1', choix: 'autre', quantite: 11 }, 12, 10)).toBe(false);
    expect(reponseAppliquee({ ligneId: 'a1', choix: 'autre', quantite: 12 }, 12, 10)).toBe(true);
  });
});

describe('message « quantités à confirmer »', () => {
  const lots = [{ lot: 'Lot 02 Charpente', lignes: [{ ligneId: 'a1', code: '1.1', titre: 'Fouille', unite: 'm3', quantiteDossier: 10, quantiteEntreprise: 12 }] }];
  it('liste les postes par lot, sans bloc vide', () => {
    expect(blocQuantitesAConfirmer(lots)).toContain('Quantités à confirmer :');
    expect(blocQuantitesAConfirmer(lots)).toContain('- 1.1 Fouille : 12 m3 dans votre offre, 10 m3 au dossier');
    expect(blocQuantitesAConfirmer([{ lot: 'Lot 03', lignes: [] }])).toBe('');
  });

  it('remplit le modèle avec les postes et le lien de dépôt', () => {
    const blocs = blocsMessageDce({
      operation: 'Villa', entreprise: 'Dupont', lots: [], piecesMarche: [], lignesIndices: [], echecsPieces: [],
      quantites: lots, lienDepot: 'https://exemple.test/depot/abc',
    });
    const texte = remplirModele(MODELE_CORPS_QUANTITES, blocs);
    expect(texte).toContain('1.1 Fouille');
    expect(texte).toContain('https://exemple.test/depot/abc');
    expect(texte).not.toContain('Vous pouvez remettre votre offre');
  });

  const e = (extra: Partial<EntrepriseSuivi> = {}): EntrepriseSuivi => ({
    id: 'e1', nom: 'Dupont', email: 'd@x.fr', lots_ids: ['l1'], envoyer_dce: true, ...extra,
  } as EntrepriseSuivi);
  it('marque la demande et décoche une entreprise déjà sollicitée', () => {
    expect(marquageEnvoi(e(), 'quantites', '2026-11-23', false)).toEqual({ quantites_demandees_le: '2026-11-23' });
    const [l] = planEnvoiGroupe([e({ quantites_demandees_le: '2026-11-20' })], 'quantites');
    expect(l).toMatchObject({ dejaEnvoye: true, dejaLe: '2026-11-20' });
    expect(planEnvoiGroupe([e()], 'quantites')[0].dejaEnvoye).toBe(false);
  });
});
