// L'adaptateur Google Drive (server/externalStorage/providers/googleDrive.ts).
//
// Tests unitaires purs sur la construction des requêtes : aucune API Google
// n'est joignable depuis la suite, et c'est justement là que les erreurs sont
// silencieuses et coûteuses.
import { describe, expect, it } from 'vitest';
import {
  GOOGLE_DRIVE_SCOPE,
  SHARED_DRIVE_PARAMS,
  escapeDriveQueryValue,
} from '../server/externalStorage/providers/googleDrive';

describe('escapeDriveQueryValue', () => {
  // Le piège le plus probable en production : « L'Atelier », « L'Orangerie »…
  // sont des noms d'agence et d'affaire parfaitement courants, et une
  // apostrophe non échappée casse la requête `q` de l'API Drive.
  it('échappe l’apostrophe, qui délimite les valeurs d’une requête Drive', () => {
    expect(escapeDriveQueryValue("L'Atelier")).toBe("L\\'Atelier");
  });

  it('échappe la barre oblique inverse avant l’apostrophe', () => {
    expect(escapeDriveQueryValue('a\\b')).toBe('a\\\\b');
    expect(escapeDriveQueryValue("a\\'b")).toBe("a\\\\\\'b");
  });

  it('laisse intact un nom ordinaire, accents compris', () => {
    expect(escapeDriveQueryValue('26014 - Réhabilitation Château')).toBe('26014 - Réhabilitation Château');
  });
});

describe('paramètres partagés', () => {
  // Sans ces deux paramètres sur CHAQUE appel, un cabinet qui travaille sur un
  // Drive partagé reçoit des 404 sur des fichiers qui existent.
  it('déclare le support des Drive partagés', () => {
    expect(SHARED_DRIVE_PARAMS).toEqual({ supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
  });

  // `drive` est un scope restreint chez Google : il impose une évaluation de
  // sécurité CASA et un audit annuel. `drive.file` suffit et ne l'impose pas.
  it('demande le scope étroit drive.file, jamais le scope restreint drive', () => {
    expect(GOOGLE_DRIVE_SCOPE).toBe('https://www.googleapis.com/auth/drive.file');
  });
});
