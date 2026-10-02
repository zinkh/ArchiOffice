// Le nommage des dossiers et fichiers créés sur l'espace du cabinet
// (server/externalStorage/folderNaming.ts) et le chemin logique qui en découle
// (server/externalStorage/businessFolderPath.ts).
//
// L'enjeu de ces tests est moins la sécurité que la lisibilité : l'architecte
// ouvre cette arborescence dans son propre Drive. Un « Général » devenu
// « G_n_ral » serait un défaut visible tous les jours.
import { describe, expect, it } from 'vitest';
import { sanitizeExternalFileName, sanitizeFolderSegment } from '../server/externalStorage/folderNaming';
import {
  buildDocumentFolderPath,
  buildPlanFolderPath,
  buildVisaFolderPath,
  projectFolderName,
} from '../server/externalStorage/businessFolderPath';
import { sanitizeFilename } from '../server/sanitizeFilename';

describe('sanitizeFolderSegment', () => {
  it('conserve les accents, les espaces et les tirets', () => {
    expect(sanitizeFolderSegment('Général')).toBe('Général');
    expect(sanitizeFolderSegment('26014 - Villa Martin')).toBe('26014 - Villa Martin');
    expect(sanitizeFolderSegment('Réhabilitation Château')).toBe('Réhabilitation Château');
  });

  // La raison d'être de ce module : sanitizeFilename est fait pour un chemin
  // d'objet Supabase que personne ne regarde, pas pour un dossier visible.
  it('ne se comporte pas comme sanitizeFilename', () => {
    expect(sanitizeFilename('26014 - Villa Martin')).not.toBe('26014 - Villa Martin');
    expect(sanitizeFolderSegment('26014 - Villa Martin')).toBe('26014 - Villa Martin');
  });

  it('retire les caractères qu’un poste Windows ou un serveur WebDAV refuse', () => {
    expect(sanitizeFolderSegment('Lot 3/4 : gros œuvre')).toBe('Lot 3 4 gros œuvre');
    expect(sanitizeFolderSegment('a*b?c"d<e>f|g')).toBe('a b c d e f g');
  });

  it('retire les points et espaces de fin, que Windows supprime en silence', () => {
    expect(sanitizeFolderSegment('Esquisse.')).toBe('Esquisse');
    expect(sanitizeFolderSegment('Esquisse   ')).toBe('Esquisse');
  });

  it('ne rend jamais une chaîne vide', () => {
    expect(sanitizeFolderSegment('')).toBe('Sans nom');
    expect(sanitizeFolderSegment(null)).toBe('Sans nom');
    expect(sanitizeFolderSegment('///')).toBe('Sans nom');
  });

  it('tronque à 80 caractères', () => {
    expect(sanitizeFolderSegment('é'.repeat(200))).toHaveLength(80);
  });
});

describe('sanitizeExternalFileName', () => {
  it('préserve l’extension à la troncature', () => {
    const long = `${'a'.repeat(200)}.pdf`;
    const out = sanitizeExternalFileName(long);
    expect(out.endsWith('.pdf')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(120);
  });

  it('laisse intact un nom ordinaire', () => {
    expect(sanitizeExternalFileName('CCTP Lot 01 - Démolition.pdf')).toBe('CCTP Lot 01 - Démolition.pdf');
  });

  it('ne prend pas un point tardif pour une extension', () => {
    const out = sanitizeExternalFileName(`${'a'.repeat(200)}.description-tres-longue`);
    expect(out).toHaveLength(120);
  });

  it('ne rend jamais une chaîne vide', () => {
    expect(sanitizeExternalFileName('')).toBe('fichier');
    expect(sanitizeExternalFileName(null)).toBe('fichier');
  });
});

describe('chemin logique métier', () => {
  const project = { project_code: '26014', name: 'Villa Martin' };

  it('nomme le dossier d’affaire « code - nom »', () => {
    expect(projectFolderName(project)).toBe('26014 - Villa Martin');
  });

  it('retombe sur le seul nom quand l’affaire n’a pas de numéro', () => {
    expect(projectFolderName({ project_code: null, name: 'Villa Martin' })).toBe('Villa Martin');
    expect(projectFolderName({ project_code: '26014', name: null })).toBe('26014');
  });

  it('classe un document par affaire puis par phase', () => {
    expect(buildDocumentFolderPath(project, 'DCE')).toEqual(['26014 - Villa Martin', 'DCE']);
  });

  it('range un document sans phase dans « Général »', () => {
    expect(buildDocumentFolderPath(project, null)).toEqual(['26014 - Villa Martin', 'Général']);
  });

  it('range un document sans affaire à la racine, sous « Général »', () => {
    expect(buildDocumentFolderPath(null, 'APD')).toEqual(['Général', 'APD']);
  });

  it('donne aux plans et aux visas leur propre sous-dossier d’affaire', () => {
    expect(buildPlanFolderPath(project)).toEqual(['26014 - Villa Martin', 'Plans']);
    // « VISA » est déjà l'une des phases connues : pas de treizième dossier.
    expect(buildVisaFolderPath(project)).toEqual(['26014 - Villa Martin', 'VISA']);
  });
});
