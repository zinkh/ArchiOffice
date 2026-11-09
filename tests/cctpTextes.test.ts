import { describe, expect, it } from 'vitest';
import { appliquerOperationCctp } from '../server/cctpTextes';
import { DpgfLignesError } from '../server/dpgfLignes';

const doc = () => ({
  lots: [{
    id: 'lot1', numero: '05', titre: 'Charpente', cctpDescription: '',
    chapitres: [
      { id: 'c1', numero: '1', titre: 'DESCRIPTION DES OUVRAGES', cctpDescription: '', lignes: [
        { id: 'l1', numero: '1.1', designation: 'Charpente bois', unite: 'm2', quantite: 10, prixUnitaire: 20, prixTotal: 200, cctpDescription: 'Texte existant.' },
        { id: 'l2', numero: '1.2', designation: 'Fermettes', unite: 'u', quantite: 2, prixUnitaire: 5, prixTotal: 10, cctpDescription: '' },
        { id: 'l3', numero: '1.3', designation: 'En cours', unite: 'u', quantite: 1, prixUnitaire: 1, prixTotal: 1, cctpDescription: '',
          marqueur: { statut: 'en_cours', par: 'Khaldoun', le: '2026-11-09T10:00:00.000Z' } },
      ] },
      { id: 'c0', numero: '2', titre: 'PRESCRIPTIONS GENERALES', cctpOnly: true, cctpDescription: '', lignes: [] },
    ],
  }],
});

describe('appliquerOperationCctp', () => {
  it('écrit le texte d\'un article vide, sans toucher quantité ni prix', () => {
    const { doc: apres, rapport } = appliquerOperationCctp(doc(), { action: 'set_texte', cible: 'article', numero: '1.2', texte: 'Fermettes industrielles.' });
    const l = apres.lots[0].chapitres[0].lignes[1];
    expect(l.cctpDescription).toBe('Fermettes industrielles.');
    expect(l.quantite).toBe(2);
    expect(l.prixTotal).toBe(10);
    expect(rapport.cible?.type).toBe('article');
  });

  it('refuse d\'écraser un texte existant sans remplacer: true, et le remplace avec', () => {
    expect(() => appliquerOperationCctp(doc(), { action: 'set_texte', cible: 'article', id: 'l1', texte: 'Nouveau.' })).toThrowError(/remplacer: true/);
    const { doc: apres } = appliquerOperationCctp(doc(), { action: 'set_texte', cible: 'article', id: 'l1', texte: 'Nouveau.', remplacer: true });
    expect(apres.lots[0].chapitres[0].lignes[0].cctpDescription).toBe('Nouveau.');
  });

  it('ajoute à la suite sans rien perdre', () => {
    const { doc: apres } = appliquerOperationCctp(doc(), { action: 'append_texte', cible: 'article', id: 'l1', texte: 'Suite.' });
    expect(apres.lots[0].chapitres[0].lignes[0].cctpDescription).toBe('Texte existant.\n\nSuite.');
  });

  it('écrit le texte d\'un lot et d\'un chapitre', () => {
    const lot = appliquerOperationCctp(doc(), { action: 'set_texte', cible: 'lot', lot: '5', texte: 'Généralités du lot.' }).doc;
    expect(lot.lots[0].cctpDescription).toBe('Généralités du lot.');
    const chap = appliquerOperationCctp(doc(), { action: 'set_texte', cible: 'chapitre', lot: '05', chapitre: 'PRESCRIPTIONS GENERALES', texte: 'Règles.' }).doc;
    expect(chap.lots[0].chapitres[1].cctpDescription).toBe('Règles.');
  });

  it('ne touche pas un élément en cours d\'édition par une personne (409), sauf forcer', () => {
    try {
      appliquerOperationCctp(doc(), { action: 'set_texte', cible: 'article', id: 'l3', texte: 'X' });
      throw new Error('attendu : refus');
    } catch (e: any) {
      expect(e).toBeInstanceOf(DpgfLignesError);
      expect(e.status).toBe(409);
    }
    const { doc: apres } = appliquerOperationCctp(doc(), { action: 'set_texte', cible: 'article', id: 'l3', texte: 'X', forcer: true });
    expect(apres.lots[0].chapitres[0].lignes[2].cctpDescription).toBe('X');
  });

  it('ajoute des articles sans quantité ni prix, réservés au CCTP dans un chapitre réservé', () => {
    const { doc: apres, rapport } = appliquerOperationCctp(doc(), {
      action: 'add_articles', lot: '05', chapitre: 'PRESCRIPTIONS GENERALES',
      articles: [{ designation: 'Documents de référence', texte: 'DTU 31.1', unite: 'm2' }],
    });
    const a = apres.lots[0].chapitres[1].lignes[0];
    expect(a).toMatchObject({ numero: '2.1', cctpOnly: true, unite: '', quantite: 0, prixUnitaire: 0, prixTotal: 0, cctpDescription: 'DTU 31.1' });
    expect(rapport.articles_ajoutes?.[0].cctp_only).toBe(true);
  });

  it('numérote à la suite et refuse un appel invalide en entier', () => {
    const { doc: apres } = appliquerOperationCctp(doc(), { action: 'add_articles', lot: '05', chapitre: '1', articles: [{ designation: 'A', unite: 'ml' }, { designation: 'B' }] });
    expect(apres.lots[0].chapitres[0].lignes.map((l: any) => l.numero)).toEqual(['1.1', '1.2', '1.3', '1.4', '1.5']);
    const avant = doc();
    expect(() => appliquerOperationCctp(avant, { action: 'add_articles', lot: '05', chapitre: '1', articles: [{ designation: 'OK' }, { designation: '' }] })).toThrowError(/designation/);
    expect(avant.lots[0].chapitres[0].lignes).toHaveLength(3);
  });

  it('explique les lots et chapitres disponibles quand la cible n\'existe pas', () => {
    expect(() => appliquerOperationCctp(doc(), { action: 'set_texte', cible: 'lot', lot: '99', texte: 'X' })).toThrowError(/Lots disponibles : 05 Charpente/);
    expect(() => appliquerOperationCctp(doc(), { action: 'add_articles', lot: '05', chapitre: 'Inconnu', articles: [{ designation: 'A' }] })).toThrowError(/Chapitres disponibles/);
  });
});
