import { describe, expect, it } from 'vitest';
import type { DPGF, FicheTechnique } from '../../types/dpgf';
import type { AgencySettings } from '../proposalExport';
import { DOSSIER_ANNEXE, planAnnexe, produireAnnexe } from '../annexeFichesTechniques';
import { estPhoto, mimePhotoLisible } from '../fichePhoto';

const fiche = (id: string, nom: string, extra: Partial<FicheTechnique> = {}): FicheTechnique => ({ id, documentId: `doc-${id}`, fileUrl: `t/${id}`, nom, ...extra });

const doc = (): Pick<DPGF, 'lots'> => ({
  lots: [{
    id: 'l1', numero: '05', titre: 'Menuiseries', sousTotal: 0,
    chapitres: [{ id: 'c1', numero: '1', titre: 'Ouvrages', lignes: [
      { id: 'a1', numero: '1.1', designation: 'Fenêtre PVC', unite: 'u', quantite: 1, prixUnitaire: 0, prixTotal: 0, type: 'ouvrage',
        fichesTechniques: [fiche('1', 'Fenetre.pdf'), fiche('2', 'Chantier.jpg'), fiche('3', 'Profile.pdf', { anonymiser: true })] },
      { id: 'a2', numero: '1.2', designation: 'Volet roulant', unite: 'u', quantite: 1, prixUnitaire: 0, prixTotal: 0, type: 'ouvrage',
        fichesTechniques: [fiche('1', 'Fenetre.pdf')],
        children: [{ id: 'a3', numero: '1.2.1', designation: 'Moteur', unite: 'u', quantite: 1, prixUnitaire: 0, prixTotal: 0, type: 'ouvrage', fichesTechniques: [fiche('4', 'Moteur.pdf')] }] },
    ] }],
  }],
} as Pick<DPGF, 'lots'>);

describe('photos', () => {
  it('reconnaît une photo par son extension et ne lit que JPEG, PNG et WebP', () => {
    expect(estPhoto('Chantier.JPG')).toBe(true);
    expect(estPhoto('fiche.pdf')).toBe(false);
    expect(mimePhotoLisible(undefined, 'a.jpeg')).toBe('image/jpeg');
    expect(mimePhotoLisible('image/png', 'a')).toBe('image/png');
    expect(mimePhotoLisible('image/heic', 'a.heic')).toBeNull();
  });
});

describe('planAnnexe', () => {
  it('liste les fiches des postes dans l\'ordre, sans les photos, et garde un seul chemin par fichier', () => {
    const entrees = planAnnexe(doc());
    expect(entrees.map(e => [e.numero, e.nom])).toEqual([
      ['1.1', 'Fenetre.pdf'], ['1.1', 'Profile.pdf'], ['1.2', 'Fenetre.pdf'], ['1.2.1', 'Moteur.pdf'],
    ]);
    expect(entrees.every(e => e.chemin.startsWith(`${DOSSIER_ANNEXE}/`))).toBe(true);
    expect(entrees[0].chemin).toBe(entrees[2].chemin);
    expect(new Set(entrees.map(e => e.chemin)).size).toBe(3);
    expect(entrees[1].anonymiser).toBe(true);
  });
});

describe('produireAnnexe', () => {
  const settings = { agencyName: 'Agence', address: '1 rue', logoUrl: '' } as unknown as AgencySettings;

  it('joint les fichiers d\'origine une seule fois, signale les illisibles et les fiches à marques', async () => {
    const lus: string[] = [];
    const res = await produireAnnexe(doc(), {
      settings, avecIndex: false,
      lireFichier: async (url) => { lus.push(url); if (url === 't/4') throw new Error('illisible'); return new Blob([url]); },
    });
    expect(lus.sort()).toEqual(['t/1', 't/3', 't/4']);
    expect(res.fichiers).toHaveLength(2);
    expect(res.manquantes).toEqual(['Moteur.pdf']);
    expect(res.avecMarques).toBe(1);
  });

  it('ne produit aucun fichier quand aucun poste ne porte de fiche', async () => {
    const vide = { lots: [{ id: 'l', numero: '01', titre: 'X', sousTotal: 0, chapitres: [{ id: 'c', numero: '1', titre: 'Y', lignes: [] }] }] } as unknown as Pick<DPGF, 'lots'>;
    const res = await produireAnnexe(vide, { settings, lireFichier: async () => new Blob(['x']) });
    expect(res.entrees).toEqual([]);
    expect(res.fichiers).toEqual([]);
  });
});
