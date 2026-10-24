// Accès d'Electron aux fichiers du cabinet (electron/fileAccess.cjs).
//
// C'est la frontière de sécurité des boutons « Afficher dans l'Explorateur » et
// « Ouvrir » : une clé venue du renderer ne doit jamais désigner autre chose qu'un
// fichier du dossier de stockage, et un clic sur « Ouvrir » ne doit jamais lancer un
// programme.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const { resolveStorageFile, isSafeToOpen } = require('../electron/fileAccess.cjs');

let root: string;
let outside: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'archioffice-fileaccess-')));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'archioffice-outside-'));
  fs.mkdirSync(path.join(root, 'documents', 'T1', '26014 - Villa Martin', 'DCE'), { recursive: true });
  fs.mkdirSync(path.join(root, 'plans', 'T1'), { recursive: true });
  fs.mkdirSync(path.join(root, 'cv', 'T1'), { recursive: true });
  fs.writeFileSync(path.join(root, 'documents', 'T1', '26014 - Villa Martin', 'DCE', 'CCTP.pdf'), 'cctp');
  fs.writeFileSync(path.join(root, 'plans', 'T1', 'facade.pdf'), 'plan');
  fs.writeFileSync(path.join(root, 'cv', 'T1', 'cv.pdf'), 'cv');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  fs.writeFileSync(path.join(root, 'documents', 'hors-cabinet.txt'), 'x');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe('resolveStorageFile', () => {
  it('retrouve un fichier du cabinet, nom lisible compris', () => {
    const file = resolveStorageFile(root, 'documents', 'T1/26014 - Villa Martin/DCE/CCTP.pdf');
    expect(file).toBe(path.join(root, 'documents', 'T1', '26014 - Villa Martin', 'DCE', 'CCTP.pdf'));
    expect(resolveStorageFile(root, 'plans', 'T1/facade.pdf')).toBe(path.join(root, 'plans', 'T1', 'facade.pdf'));
  });

  it('refuse un bucket qu\'Electron n\'ouvre pas', () => {
    expect(resolveStorageFile(root, 'cv', 'T1/cv.pdf')).toBeNull();
    expect(resolveStorageFile(root, 'meeting-photos', 'T1/x.jpg')).toBeNull();
    expect(resolveStorageFile(root, '../documents', 'T1/x.pdf')).toBeNull();
  });

  it('refuse toute remontée de dossier et tout chemin absolu', () => {
    for (const bad of [
      '../cv/T1/cv.pdf',
      'T1/../../cv/T1/cv.pdf',
      '/etc/passwd',
      '//serveur/partage/x.pdf',
      './T1/facade.pdf',
      'T1//facade.pdf',
      path.join(outside, 'secret.txt'),
    ]) {
      expect(resolveStorageFile(root, 'plans', bad)).toBeNull();
    }
  });

  it('refuse les lecteurs Windows, les flux alternatifs et les antislashs', () => {
    for (const bad of ['C:/Windows/system.ini', 'T1/facade.pdf:flux', 'T1\\facade.pdf', 'T1/..\\..\\x.pdf']) {
      expect(resolveStorageFile(root, 'plans', bad)).toBeNull();
    }
  });

  it('refuse un octet nul et les entrées qui ne sont pas du texte', () => {
    expect(resolveStorageFile(root, 'plans', 'T1/facade.pdf\0.txt')).toBeNull();
    expect(resolveStorageFile(root, 'plans', '')).toBeNull();
    expect(resolveStorageFile(root, 'plans', undefined)).toBeNull();
    expect(resolveStorageFile(root, 'plans', { toString: () => 'T1/facade.pdf' })).toBeNull();
    expect(resolveStorageFile('', 'plans', 'T1/facade.pdf')).toBeNull();
    expect(resolveStorageFile(undefined, 'plans', 'T1/facade.pdf')).toBeNull();
  });

  it('refuse un dossier et un fichier absent', () => {
    expect(resolveStorageFile(root, 'documents', 'T1/26014 - Villa Martin/DCE')).toBeNull();
    expect(resolveStorageFile(root, 'documents', 'T1/absent.pdf')).toBeNull();
  });

  it('refuse un lien symbolique qui pointe hors du dossier de stockage', () => {
    const link = path.join(root, 'documents', 'T1', 'lien.txt');
    try {
      fs.symlinkSync(path.join(outside, 'secret.txt'), link);
    } catch {
      return; // création de lien non permise sur ce poste : rien à vérifier
    }
    expect(resolveStorageFile(root, 'documents', 'T1/lien.txt')).toBeNull();
  });

  it('refuse un dossier lié qui sort du bucket', () => {
    const link = path.join(root, 'documents', 'T1', 'dossier-lie');
    try {
      fs.symlinkSync(outside, link, 'dir');
    } catch {
      return;
    }
    expect(resolveStorageFile(root, 'documents', 'T1/dossier-lie/secret.txt')).toBeNull();
  });

  it('accepte un lien qui reste dans le bucket', () => {
    const link = path.join(root, 'documents', 'T1', 'raccourci.pdf');
    try {
      fs.symlinkSync(path.join(root, 'documents', 'T1', '26014 - Villa Martin', 'DCE', 'CCTP.pdf'), link);
    } catch {
      return;
    }
    expect(resolveStorageFile(root, 'documents', 'T1/raccourci.pdf')).toBe(
      path.join(root, 'documents', 'T1', '26014 - Villa Martin', 'DCE', 'CCTP.pdf'),
    );
  });
});

describe('isSafeToOpen', () => {
  it('autorise les documents, images et plans courants, majuscules comprises', () => {
    for (const name of ['CCTP.pdf', 'Plan.DWG', 'devis.XLSX', 'note.docx', 'photo.JPG', 'maquette.skp', 'export.ifc']) {
      expect(isSafeToOpen(name)).toBe(true);
    }
  });

  it('refuse tout ce qui peut lancer un programme', () => {
    for (const name of [
      'setup.exe', 'script.bat', 'run.cmd', 'x.com', 'x.scr', 'inst.msi', 'x.ps1', 'x.vbs', 'x.js', 'x.jar',
      'x.hta', 'lien.lnk', 'x.url', 'x.reg', 'x.dll', 'x.sh', 'x.app',
    ]) {
      expect(isSafeToOpen(name)).toBe(false);
    }
  });

  it('refuse les documents à macros et les archives', () => {
    for (const name of ['facture.docm', 'tableau.xlsm', 'diapo.pptm', 'dossier.zip', 'archive.7z', 'x.rar']) {
      expect(isSafeToOpen(name)).toBe(false);
    }
  });

  it('refuse un double suffixe trompeur et un fichier sans extension', () => {
    expect(isSafeToOpen('facture.pdf.exe')).toBe(false);
    expect(isSafeToOpen('facture.pdf ')).toBe(false);
    expect(isSafeToOpen('README')).toBe(false);
    expect(isSafeToOpen('')).toBe(false);
    expect(isSafeToOpen(undefined)).toBe(false);
  });
});
