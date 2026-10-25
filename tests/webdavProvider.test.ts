// L'adaptateur WebDAV (server/externalStorage/providers/webdav.ts), servant à
// la fois Nextcloud et kDrive.
//
// Tests unitaires purs : aucun serveur WebDAV n'est joignable depuis la suite,
// donc ce qui est vérifié ici est la construction des requêtes — la partie où
// les erreurs sont silencieuses et coûteuses (un chemin mal encodé casse au
// premier nom d'affaire accentué, c'est-à-dire tout de suite).
import { describe, expect, it } from 'vitest';
import { buildWebdavUrl, completeNextcloudUrl, normalizeBaseUrl } from '../server/externalStorage/providers/webdav';

const NEXTCLOUD = 'https://cloud.aazs.test/remote.php/dav/files/khaldoun/';
const KDRIVE = 'https://123456.connect.kdrive.infomaniak.com/';

describe('normalizeBaseUrl', () => {
  it('impose exactement une barre oblique finale', () => {
    expect(normalizeBaseUrl('https://cloud.aazs.test/dav')).toBe('https://cloud.aazs.test/dav/');
    expect(normalizeBaseUrl('https://cloud.aazs.test/dav/')).toBe('https://cloud.aazs.test/dav/');
    expect(normalizeBaseUrl('https://cloud.aazs.test/dav///')).toBe('https://cloud.aazs.test/dav/');
    expect(normalizeBaseUrl('  https://cloud.aazs.test/dav  ')).toBe('https://cloud.aazs.test/dav/');
  });
});

describe('buildWebdavUrl', () => {
  // Le piège principal : encodeURIComponent sur le chemin entier détruirait les
  // barres obliques qui le structurent.
  it('encode segment par segment, sans détruire la structure du chemin', () => {
    expect(buildWebdavUrl(NEXTCLOUD, 'ArchiOffice/26014 - Villa Martin/DCE/cctp.pdf'))
      .toBe(`${NEXTCLOUD}ArchiOffice/26014%20-%20Villa%20Martin/DCE/cctp.pdf`);
  });

  it('encode les accents et les esperluettes', () => {
    expect(buildWebdavUrl(NEXTCLOUD, 'ArchiOffice/Réhabilitation & Extension/PRO/note.pdf'))
      .toBe(`${NEXTCLOUD}ArchiOffice/R%C3%A9habilitation%20%26%20Extension/PRO/note.pdf`);
  });

  // Plusieurs implémentations Nextcloud exigent la barre finale sur une
  // collection pour PROPFIND et MKCOL, et la refusent sur un fichier.
  it('termine une collection par une barre oblique, jamais un fichier', () => {
    expect(buildWebdavUrl(NEXTCLOUD, 'ArchiOffice/DCE', true)).toBe(`${NEXTCLOUD}ArchiOffice/DCE/`);
    expect(buildWebdavUrl(NEXTCLOUD, 'ArchiOffice/DCE', false)).toBe(`${NEXTCLOUD}ArchiOffice/DCE`);
  });

  it('rend la base seule pour un chemin vide, sans doubler la barre', () => {
    expect(buildWebdavUrl(NEXTCLOUD, '', true)).toBe(NEXTCLOUD);
    expect(buildWebdavUrl(NEXTCLOUD, '/', true)).toBe(NEXTCLOUD);
  });

  // Les deux offres ne diffèrent que par la base ; le code n'en sait rien de plus.
  it('traite kDrive exactement comme Nextcloud', () => {
    expect(buildWebdavUrl(KDRIVE, 'ArchiOffice/26014 - Villa Martin', true))
      .toBe(`${KDRIVE}ArchiOffice/26014%20-%20Villa%20Martin/`);
  });
});

describe('completeNextcloudUrl', () => {
  const dav = 'https://cloud.aazs.test/remote.php/dav/files/khaldoun/';
  it("reconstruit le point d'accès WebDAV depuis l'adresse du navigateur", () => {
    expect(completeNextcloudUrl('nextcloud', 'https://cloud.aazs.test/', 'khaldoun')).toBe(dav);
    expect(completeNextcloudUrl('nextcloud', 'https://cloud.aazs.test/index.php/apps/files/', 'khaldoun')).toBe(dav);
  });
  it("garde le sous-dossier d'installation", () => {
    expect(completeNextcloudUrl('nextcloud', 'https://x.test/nextcloud/apps/files', 'a b')).toBe(
      'https://x.test/nextcloud/remote.php/dav/files/a%20b/',
    );
  });
  it('laisse intactes une URL WebDAV et celle de kDrive', () => {
    expect(completeNextcloudUrl('nextcloud', dav, 'khaldoun')).toBe(dav);
    expect(completeNextcloudUrl('kdrive', 'https://id.connect.kdrive.infomaniak.com/', 'u')).toBe(
      'https://id.connect.kdrive.infomaniak.com/',
    );
  });
});
