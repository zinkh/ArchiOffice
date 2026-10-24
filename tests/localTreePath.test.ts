// Chemins lisibles du stockage local (server/externalStorage/localTreePath.ts).
//
// Ce qui est verrouillé ici, c'est ce qui casse sans bruit : une clé non ASCII que
// le cloud refuse en silence, un nom réservé par Windows, une extension perdue à la
// troncature, un chemin trop long pour un partage réseau.
import { describe, expect, it } from 'vitest';
import {
  isDuplicateUploadError,
  readableFileName,
  readableFolderSegment,
  readableObjectPath,
} from '../server/externalStorage/localTreePath';

const TENANT = '3f1c2a9e-8b7d-4c5e-9a10-1234567890ab';
// Caractères que Windows interdit dans un nom, plus tout ce qui n'est pas ASCII imprimable.
const SAFE_PATH = /^[\x20-\x7e]+$/;
const WINDOWS_FORBIDDEN = /[<>:"\\|?*]/;

describe('readableFolderSegment', () => {
  it('garde un nom d\'affaire lisible', () => {
    expect(readableFolderSegment('26014 - Villa Martin')).toBe('26014 - Villa Martin');
  });

  it('retire les accents et remplace l\'esperluette', () => {
    expect(readableFolderSegment('Réhabilitation & Extension')).toBe('Rehabilitation et Extension');
    expect(readableFolderSegment('Œuvre d\u2019art')).toBe("Oeuvre d'art");
  });

  it('remplace les caractères interdits par une espace sans doubler les espaces', () => {
    expect(readableFolderSegment('a/b\\c:d*e?f')).toBe('a b c d e f');
  });

  it('retire les points et espaces de fin, que Windows supprimerait', () => {
    expect(readableFolderSegment('Villa Martin. ')).toBe('Villa Martin');
  });

  it('ne rend jamais un nom vide, ni « . » ni « .. »', () => {
    expect(readableFolderSegment('')).toBe('Sans nom');
    expect(readableFolderSegment('...')).toBe('Sans nom');
    expect(readableFolderSegment('..')).toBe('Sans nom');
    expect(readableFolderSegment(null)).toBe('Sans nom');
  });

  it('évite les noms réservés par Windows', () => {
    expect(readableFolderSegment('CON')).toBe('CON_');
    expect(readableFolderSegment('nul')).toBe('nul_');
    expect(readableFolderSegment('COM3')).toBe('COM3_');
    expect(readableFolderSegment('Console')).toBe('Console');
  });

  it('borne la longueur', () => {
    expect(readableFolderSegment('x'.repeat(200)).length).toBeLessThanOrEqual(50);
  });
});

describe('readableFileName', () => {
  it('garde un nom de fichier ordinaire', () => {
    expect(readableFileName('Plan RDC.pdf')).toBe('Plan RDC.pdf');
  });

  it('numérote les doublons avant l\'extension', () => {
    expect(readableFileName('Plan RDC.pdf', 2)).toBe('Plan RDC (2).pdf');
    expect(readableFileName('Plan RDC.pdf', 3)).toBe('Plan RDC (3).pdf');
  });

  it('ne garde que la dernière extension', () => {
    expect(readableFileName('archive.tar.gz')).toBe('archive.tar.gz');
    expect(readableFileName('archive.tar.gz', 2)).toBe('archive.tar (2).gz');
  });

  it('préserve l\'extension quand le nom est tronqué', () => {
    const name = readableFileName(`${'a'.repeat(200)}.pdf`);
    expect(name.length).toBeLessThanOrEqual(80);
    expect(name.endsWith('.pdf')).toBe(true);
  });

  it('préserve l\'extension d\'un nom numéroté tronqué', () => {
    const name = readableFileName(`${'a'.repeat(200)}.pdf`, 7);
    expect(name.length).toBeLessThanOrEqual(80);
    expect(name.endsWith(' (7).pdf')).toBe(true);
  });

  it('évite un nom réservé même avec une extension (CON.txt est réservé sous Windows)', () => {
    expect(readableFileName('con.txt')).toBe('con_.txt');
    expect(readableFileName('NUL')).toBe('NUL_');
  });

  it('ne rend jamais un nom vide', () => {
    expect(readableFileName('')).toBe('fichier');
    expect(readableFileName('???')).toBe('fichier');
    expect(readableFileName(undefined)).toBe('fichier');
  });

  it('passe à l\'horodatage après les essais numérotés', () => {
    expect(readableFileName('plan.pdf', 51)).toMatch(/^plan \(\d{13}\)\.pdf$/);
  });
});

describe('readableObjectPath', () => {
  it('range sous le cabinet, l\'affaire et la phase', () => {
    expect(readableObjectPath({
      tenantId: TENANT, folderPath: ['26014 - Villa Martin', 'DCE'], fileName: 'CCTP lot 02.pdf',
    })).toBe(`${TENANT}/26014 - Villa Martin/DCE/CCTP lot 02.pdf`);
  });

  it('numérote le fichier, jamais un dossier', () => {
    expect(readableObjectPath({
      tenantId: TENANT, folderPath: ['26014 - Villa Martin', 'DCE'], fileName: 'CCTP.pdf',
    }, 2)).toBe(`${TENANT}/26014 - Villa Martin/DCE/CCTP (2).pdf`);
  });

  it('ne produit que de l\'ASCII valide sous Windows, même pour un nom hostile', () => {
    const path = readableObjectPath({
      tenantId: TENANT,
      folderPath: ['Réhabilitation « Château » : phase 2 ?', 'Général'],
      fileName: 'Plan d\u2019étage n\u00b02 \u2013 final*.pdf',
    });
    expect(path).toMatch(SAFE_PATH);
    expect(path).not.toMatch(WINDOWS_FORBIDDEN);
    expect(path.split('/').every((s) => s.length > 0 && !/[.\s]$/.test(s))).toBe(true);
    expect(path.endsWith('.pdf')).toBe(true);
  });

  it('empêche toute remontée de dossier', () => {
    const path = readableObjectPath({
      tenantId: TENANT, folderPath: ['..', '../etc'], fileName: '../../passwd',
    });
    expect(path.split('/')).not.toContain('..');
    expect(path.startsWith(`${TENANT}/`)).toBe(true);
  });

  it('reste assez court pour un partage réseau, en sacrifiant le nom du fichier', () => {
    const path = readableObjectPath({
      tenantId: TENANT,
      folderPath: ['P'.repeat(200), 'Q'.repeat(200)],
      fileName: `${'f'.repeat(300)}.pdf`,
    });
    expect(path.length).toBeLessThanOrEqual(190);
    expect(path.endsWith('.pdf')).toBe(true);
    // Les dossiers gardent leur longueur bornée : seul le fichier s'est effacé.
    expect(path.split('/')[1].length).toBe(50);
  });

  it('protège un identifiant de cabinet inattendu', () => {
    const path = readableObjectPath({ tenantId: '../x', folderPath: ['A'], fileName: 'b.pdf' });
    expect(path.split('/')).not.toContain('..');
  });
});

describe('isDuplicateUploadError', () => {
  it('reconnaît l\'erreur « existe déjà » de la passerelle', () => {
    expect(isDuplicateUploadError(new Error('Storage upload failed: The resource already exists'))).toBe(true);
    expect(isDuplicateUploadError(new Error('Duplicate'))).toBe(true);
  });

  it('ne prend pas une autre panne pour un doublon', () => {
    expect(isDuplicateUploadError(new Error('Storage upload failed: Invalid key'))).toBe(false);
    expect(isDuplicateUploadError(new Error('ECONNREFUSED'))).toBe(false);
    expect(isDuplicateUploadError(undefined)).toBe(false);
  });
});
