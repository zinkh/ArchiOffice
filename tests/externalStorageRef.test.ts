// Le format de référence écrit dans file_url quand un fichier vit sur l'espace
// de stockage du cabinet (server/externalStorage/externalRef.ts), et sa
// cohabitation avec les références Supabase historiques
// (server/storagePaths.ts::parseStorageRef).
import { describe, expect, it } from 'vitest';
import {
  buildExternalRef,
  isExternalRef,
  isOwnStorageRef,
  parseExternalRef,
} from '../server/externalStorage/externalRef';
import { parseStorageRef } from '../server/storagePaths';

const SUPABASE_REF = 'https://fake.supabase.test/storage/v1/object/public/documents/tenant-1/p1/DCE/doc-1/cctp.pdf';

describe('références de stockage externe', () => {
  it('fait un aller-retour sur un identifiant Google Drive ordinaire', () => {
    const ref = { provider: 'google_drive' as const, connectionId: 'conn-1', externalId: '1AbC_dEf-42' };
    const parsed = parseExternalRef(buildExternalRef(ref));
    expect(parsed).toMatchObject(ref);
  });

  it('survit à un identifiant qui contient des barres obliques, des espaces et des accents (Dropbox, WebDAV)', () => {
    const externalId = '/ArchiOffice/26014 - Réhabilitation Château/DCE/CCTP Lot 01.pdf';
    const parsed = parseExternalRef(
      buildExternalRef({ provider: 'webdav', connectionId: 'conn-2', externalId, fileName: 'CCTP Lot 01.pdf' }),
    );
    expect(parsed?.externalId).toBe(externalId);
    expect(parsed?.fileName).toBe('CCTP Lot 01.pdf');
    expect(parsed?.connectionId).toBe('conn-2');
  });

  it('reconnaît une référence externe et rejette une référence Supabase', () => {
    expect(isExternalRef(buildExternalRef({ provider: 'dropbox', connectionId: 'c', externalId: 'id:1' }))).toBe(true);
    expect(isExternalRef(SUPABASE_REF)).toBe(false);
    expect(isExternalRef(null)).toBe(false);
    expect(isExternalRef('')).toBe(false);
  });

  it('refuse une URI mal formée plutôt que de rendre une référence partielle', () => {
    expect(parseExternalRef('archioffice+external://inconnu/conn/aWQ')).toBeNull();
    expect(parseExternalRef('archioffice+external://dropbox/conn')).toBeNull();
    expect(parseExternalRef('https://evil.example.test/x')).toBeNull();
  });

  // Non-régression essentielle : les deux copies de parseStorageRef dans
  // packages/archioffice-agents doivent continuer de rendre null sur une
  // référence externe (repli propre), et non un couple bucket/chemin inventé.
  it('reste invisible pour parseStorageRef', () => {
    const external = buildExternalRef({ provider: 'google_drive', connectionId: 'c', externalId: 'x' });
    expect(parseStorageRef(external)).toBeNull();
    expect(parseStorageRef(SUPABASE_REF)).toEqual({
      bucket: 'documents',
      path: 'tenant-1/p1/DCE/doc-1/cctp.pdf',
    });
  });

  it('isOwnStorageRef couvre les deux formes, et rien d’autre', () => {
    const external = buildExternalRef({ provider: 'webdav', connectionId: 'c', externalId: 'x' });
    expect(isOwnStorageRef(external, 'documents')).toBe(true);
    expect(isOwnStorageRef(SUPABASE_REF, 'documents')).toBe(true);
    expect(isOwnStorageRef(SUPABASE_REF, 'plans')).toBe(false);
    expect(isOwnStorageRef('https://exemple.test/piece-jointe.pdf', 'documents')).toBe(false);
    expect(isOwnStorageRef(null, 'documents')).toBe(false);
  });
});
