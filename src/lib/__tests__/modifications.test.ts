import { describe, expect, it } from 'vitest';
import { estamperModifications } from '../modifications';
import type { DPGF, Ligne } from '../../types/dpgf';

const AVANT = '2026-11-08T10:00:00.000Z';
const MAINTENANT = '2026-11-08T17:40:00.000Z';

const ligne = (id: string, extra: Partial<Ligne> = {}): Ligne => ({
  id, numero: '1.1', designation: id, unite: 'u', quantite: 1, prixUnitaire: 10, prixTotal: 10, type: 'ouvrage', ...extra,
});

const document = (lignes: Ligne[], chapitre: Record<string, unknown> = {}): DPGF => ({
  id: 'd', projectId: 'p', titre: 'CCTP', version: '1', dateCreation: '', statut: 'draft', TVA: 20, totalHT: 0, totalTTC: 0,
  lots: [{ id: 'lot', numero: '01', titre: 'Gros œuvre', sousTotal: 0, chapitres: [{ id: 'c1', numero: '1', titre: 'Maçonnerie', lignes, ...chapitre }] }],
} as unknown as DPGF);

const articles = (d: DPGF) => d.lots[0].chapitres[0].lignes;
const chapitre = (d: DPGF) => d.lots[0].chapitres[0];

describe('estamperModifications', () => {
  it('ne date rien quand le document n\'avait jamais été enregistré', () => {
    const apres = document([ligne('a')]);
    expect(estamperModifications(null, apres, 'Alice', MAINTENANT)).toBe(apres);
  });

  it('date et signe l\'article dont le contenu change, pas les autres', () => {
    const avant = document([ligne('a'), ligne('b')]);
    const apres = document([ligne('a', { cctpDescription: 'Texte rédigé' }), ligne('b')]);
    const resultat = estamperModifications(avant, apres, 'Alice', MAINTENANT);
    expect(articles(resultat)[0]).toMatchObject({ modifieLe: MAINTENANT, modifiePar: 'Alice' });
    expect(articles(resultat)[1].modifieLe).toBeUndefined();
    expect(articles(resultat)[1].modifiePar).toBeUndefined();
  });

  it('date et signe un article créé', () => {
    const avant = document([ligne('a')]);
    const apres = document([ligne('a'), ligne('neuf')]);
    const resultat = estamperModifications(avant, apres, 'Alice', MAINTENANT);
    expect(articles(resultat)[1]).toMatchObject({ modifieLe: MAINTENANT, modifiePar: 'Alice' });
    expect(articles(resultat)[0].modifieLe).toBeUndefined();
  });

  it('un article inchangé garde l\'estampille enregistrée, quoi que le client envoie', () => {
    const avant = document([ligne('a', { modifieLe: AVANT, modifiePar: 'Bob' })]);
    const apres = document([ligne('a', { modifieLe: '2030-01-01T00:00:00.000Z', modifiePar: 'Usurpateur' })]);
    const resultat = estamperModifications(avant, apres, 'Alice', MAINTENANT);
    expect(articles(resultat)[0]).toMatchObject({ modifieLe: AVANT, modifiePar: 'Bob' });
  });

  it('une estampille envoyée par le client sur un article modifié est remplacée', () => {
    const avant = document([ligne('a', { modifieLe: AVANT, modifiePar: 'Bob' })]);
    const apres = document([ligne('a', { designation: 'Nouveau titre', modifieLe: '2030-01-01T00:00:00.000Z', modifiePar: 'Usurpateur' })]);
    const resultat = estamperModifications(avant, apres, 'Alice', MAINTENANT);
    expect(articles(resultat)[0]).toMatchObject({ modifieLe: MAINTENANT, modifiePar: 'Alice' });
  });

  it('un simple changement de numéro (renumérotation) ne date pas l\'article', () => {
    const avant = document([ligne('a', { numero: '1.1' })]);
    const apres = document([ligne('a', { numero: '2.1' })]);
    const resultat = estamperModifications(avant, apres, 'Alice', MAINTENANT);
    expect(articles(resultat)[0].modifieLe).toBeUndefined();
  });

  it('poser un marqueur de rédaction ne date pas l\'article', () => {
    const avant = document([ligne('a')]);
    const apres = document([ligne('a', { marqueur: { statut: 'en_cours', par: 'Alice', le: MAINTENANT } })]);
    const resultat = estamperModifications(avant, apres, 'Bob', MAINTENANT);
    expect(articles(resultat)[0].modifieLe).toBeUndefined();
  });

  it('l\'ordre des clés n\'est pas une modification', () => {
    const avant = document([{ id: 'a', numero: '1', designation: 'a', unite: 'u', quantite: 1, prixUnitaire: 10, prixTotal: 10, type: 'ouvrage' } as Ligne]);
    const apres = document([{ type: 'ouvrage', prixTotal: 10, prixUnitaire: 10, quantite: 1, unite: 'u', designation: 'a', numero: '1', id: 'a' } as Ligne]);
    expect(estamperModifications(avant, apres, 'Alice', MAINTENANT)).toBe(apres);
  });

  it('date le chapitre dont le texte change, pas ses articles', () => {
    const avant = document([ligne('a')], { cctpDescription: 'Ancien texte' });
    const apres = document([ligne('a')], { cctpDescription: 'Nouveau texte' });
    const resultat = estamperModifications(avant, apres, 'Alice', MAINTENANT);
    expect(chapitre(resultat)).toMatchObject({ modifieLe: MAINTENANT, modifiePar: 'Alice' });
    expect(articles(resultat)[0].modifieLe).toBeUndefined();
  });

  it('modifier un sous-article date le sous-article, pas son parent dont les totaux ne sont que des sommes', () => {
    const parent = (enfant: Ligne, total: number) => ligne('p', { quantite: 1, prixTotal: total, children: [enfant] });
    const avant = document([parent(ligne('e', { prixUnitaire: 10, prixTotal: 10 }), 10)]);
    const apres = document([parent(ligne('e', { prixUnitaire: 25, prixTotal: 25 }), 25)]);
    const resultat = estamperModifications(avant, apres, 'Alice', MAINTENANT);
    expect(articles(resultat)[0].modifieLe).toBeUndefined();
    expect(articles(resultat)[0].children![0]).toMatchObject({ modifieLe: MAINTENANT, modifiePar: 'Alice' });
  });

  it('un document inchangé est rendu tel quel, sans copie', () => {
    const avant = document([ligne('a', { modifieLe: AVANT, modifiePar: 'Bob' }), ligne('b')]);
    const apres = JSON.parse(JSON.stringify(avant)) as DPGF;
    expect(estamperModifications(avant, apres, 'Alice', MAINTENANT)).toBe(apres);
  });
});
