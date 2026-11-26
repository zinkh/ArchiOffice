import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  ajouterOffresRecues, cheminSur, estTableur, lireDepot, marquerOffreRecue, normaliser, offresRecues,
  rechercherEntreprises, retirerOffreRecue, type OffreFichierRecu,
} from '../offresRecues';

const entreprises = [
  { id: '1', nom: 'REVETEMENTS GRAND EST (HADOL CARRELAGE)' },
  { id: '2', nom: 'Peduzzi' },
  { id: '3', nom: 'SAS Pierre B' },
  { id: '4', nom: 'Électricité Générale de Lorraine' },
];

describe('rechercherEntreprises', () => {
  it('retrouve une entreprise sans tenir compte des accents ni de la casse', () => {
    expect(rechercherEntreprises(entreprises, 'electricite').map(e => e.id)).toEqual(['4']);
    expect(rechercherEntreprises(entreprises, 'PEDU').map(e => e.id)).toEqual(['2']);
  });

  it('exige tous les mots saisis, dans le désordre', () => {
    expect(rechercherEntreprises(entreprises, 'carrelage hadol').map(e => e.id)).toEqual(['1']);
    expect(rechercherEntreprises(entreprises, 'hadol plomberie')).toEqual([]);
  });

  it('classe le début de mot avant une simple inclusion', () => {
    const l = [{ id: 'a', nom: 'Aprofil' }, { id: 'b', nom: 'Profil Est' }];
    expect(rechercherEntreprises(l, 'prof').map(e => e.id)).toEqual(['b', 'a']);
  });

  it('rend tout par ordre alphabétique quand le texte est vide', () => {
    expect(rechercherEntreprises(entreprises, '  ').map(e => e.id)).toEqual(['4', '2', '1', '3']);
  });
});

describe('normaliser', () => {
  it('ramène la ponctuation à des espaces', () => {
    expect(normaliser('Hadol-Carrelage (Nancy)')).toBe('hadol carrelage nancy');
  });
});

describe('cheminSur', () => {
  it('refuse les remontées, chemins absolus et lecteurs', () => {
    expect(cheminSur('../secret.pdf')).toBeNull();
    expect(cheminSur('a/../../b.pdf')).toBeNull();
    expect(cheminSur('/etc/passwd')).toBeNull();
    expect(cheminSur('C:\\Windows\\x.pdf')).toBeNull();
  });
  it('normalise les séparateurs', () => {
    expect(cheminSur('Offre\\Lot 08\\devis.pdf')).toBe('Offre/Lot 08/devis.pdf');
  });
});

describe('estTableur', () => {
  it('reconnaît les tableurs, pas les PDF', () => {
    expect(estTableur('bordereau.XLSX')).toBe(true);
    expect(estTableur('devis.pdf')).toBe(false);
  });
});

describe('lireDepot', () => {
  const fichier = (nom: string, contenu = 'x') => new File([contenu], nom);

  it('garde les PDF isolés et refuse les autres formats', async () => {
    const r = await lireDepot([fichier('devis.pdf'), fichier('photo.jpg'), fichier('prog.exe')]);
    expect(r.pieces.map(p => p.chemin)).toEqual(['devis.pdf']);
    expect(r.ignorees.map(i => i.nom)).toEqual(['photo.jpg', 'prog.exe']);
  });

  it('ouvre un ZIP, garde sous-dossiers et formats acceptés, écarte parasites et chemins non sûrs', async () => {
    const zip = new JSZip();
    zip.file('Offre/Lot 08/devis.pdf', 'pdf');
    zip.file('Offre/memoire.docx', 'docx');
    zip.file('Offre/logo.png', 'png');
    zip.file('__MACOSX/Offre/._devis.pdf', 'junk');
    zip.file('.DS_Store', 'junk');
    zip.file('../evil.pdf', 'evil');
    const blob = await zip.generateAsync({ type: 'blob' });
    const r = await lireDepot([new File([blob], 'entreprise.zip')]);
    // JSZip aplatit déjà « ../evil.pdf » en « evil.pdf » ; quoi qu'il arrive, aucun chemin retenu ne remonte.
    const chemins = r.pieces.map(p => p.chemin).sort();
    expect(chemins).toEqual(expect.arrayContaining(['Offre/Lot 08/devis.pdf', 'Offre/memoire.docx']));
    expect(chemins.some(c => c.includes('..') || c.startsWith('/'))).toBe(false);
    expect(chemins.some(c => c.includes('MACOSX') || c.includes('DS_Store'))).toBe(false);
    expect(r.pieces.every(p => p.archive === 'entreprise.zip')).toBe(true);
    expect(r.pieces.find(p => p.chemin.endsWith('devis.pdf'))!.file.name).toBe('devis.pdf');
    expect(r.ignorees.map(i => i.nom)).toContain('Offre/logo.png');
  });

  it('signale une archive illisible sans planter', async () => {
    const r = await lireDepot([fichier('casse.zip', 'pas un zip')]);
    expect(r.pieces).toEqual([]);
    expect(r.ignorees[0].nom).toBe('casse.zip');
  });

  it('écarte un doublon', async () => {
    const r = await lireDepot([fichier('devis.pdf', 'abc'), fichier('devis.pdf', 'abc')]);
    expect(r.pieces).toHaveLength(1);
    expect(r.ignorees[0].motif).toBe('doublon');
  });
});

describe('consultation', () => {
  const o = (id: string): OffreFichierRecu => ({
    id, entreprise_nom: 'Peduzzi', lots_ids: ['L1'], document_id: 'd', file_url: 'ref', nom: 'devis.pdf',
    taille: 10, recu_le: '2026-11-25', statut: 'recu', origine: 'hors_plateforme',
  });

  it('ajoute, marque et retire sans toucher au reste', () => {
    const c0 = { autre: 1 } as { autre: number; offres_recues_fichiers?: OffreFichierRecu[] };
    expect(offresRecues(c0)).toEqual([]);
    const c1 = ajouterOffresRecues(c0, [o('a'), o('b')]);
    expect(c1.autre).toBe(1);
    const c2 = marquerOffreRecue(c1, 'a', 'traite');
    expect(offresRecues(c2).map(x => x.statut)).toEqual(['traite', 'recu']);
    expect(offresRecues(retirerOffreRecue(c2, 'a')).map(x => x.id)).toEqual(['b']);
    expect(ajouterOffresRecues(c0, [])).toBe(c0);
  });
});
