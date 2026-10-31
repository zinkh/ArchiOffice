// Répartition du stockage par auteur : logique pure de server/storageBreakdown.ts.
import { describe, it, expect } from 'vitest';
import { buildStorageBreakdown } from '../server/storageBreakdown';

const MB = 1024 * 1024;

describe('buildStorageBreakdown', () => {
  it('fusionne un même auteur écrit avec une casse ou des espaces différents', () => {
    const result = buildStorageBreakdown({
      usedBytes: 100 * MB,
      rows: [
        { uploaded_by: 'Camille Durand', bytes: 10 * MB, files: 2 },
        { uploaded_by: '  camille durand ', bytes: 5 * MB, files: 1 },
      ],
      canSeeAll: true,
      myName: 'Camille Durand',
    });
    expect(result.users).toEqual([{ name: 'Camille Durand', bytes: 15 * MB, files: 3, is_me: true }]);
  });

  it('lit les bigint renvoyés en texte', () => {
    const result = buildStorageBreakdown({
      usedBytes: 10 * MB,
      rows: [{ uploaded_by: 'Samir', bytes: String(4 * MB), files: '3' }],
      canSeeAll: true,
      myName: '',
    });
    expect(result.users[0]).toMatchObject({ bytes: 4 * MB, files: 3 });
  });

  it('classe les auteurs du plus gros au plus petit', () => {
    const result = buildStorageBreakdown({
      usedBytes: 100 * MB,
      rows: [
        { uploaded_by: 'Petit', bytes: 1 * MB, files: 1 },
        { uploaded_by: 'Gros', bytes: 50 * MB, files: 1 },
      ],
      canSeeAll: true,
      myName: '',
    });
    expect(result.users.map(u => u.name)).toEqual(['Gros', 'Petit']);
  });

  it('rapporte comme non attribué ce que le total dépasse des documents', () => {
    const result = buildStorageBreakdown({
      usedBytes: 92 * MB,
      rows: [{ uploaded_by: 'Samir', bytes: 67 * MB, files: 5 }],
      canSeeAll: true,
      myName: '',
    });
    expect(result.unattributed_bytes).toBe(25 * MB);
  });

  it('ne rend jamais un non attribué négatif quand les documents dépassent le total mesuré', () => {
    const result = buildStorageBreakdown({
      usedBytes: 10 * MB,
      rows: [{ uploaded_by: 'Samir', bytes: 50 * MB, files: 1 }],
      canSeeAll: true,
      myName: '',
    });
    expect(result.unattributed_bytes).toBe(0);
  });

  it('garde un document sans auteur sous un nom vide', () => {
    const result = buildStorageBreakdown({
      usedBytes: 10 * MB,
      rows: [{ uploaded_by: null, bytes: 2 * MB, files: 1 }],
      canSeeAll: true,
      myName: 'Camille',
    });
    expect(result.users).toEqual([{ name: '', bytes: 2 * MB, files: 1, is_me: false }]);
  });

  it('ne marque jamais « moi » une ligne sans auteur quand mon nom est vide', () => {
    const result = buildStorageBreakdown({
      usedBytes: 10 * MB,
      rows: [{ uploaded_by: '', bytes: 2 * MB, files: 1 }],
      canSeeAll: true,
      myName: '',
    });
    expect(result.users[0].is_me).toBe(false);
  });

  it('restreint un non responsable à sa propre ligne, sans le non attribué', () => {
    const result = buildStorageBreakdown({
      usedBytes: 100 * MB,
      rows: [
        { uploaded_by: 'Léa Martin', bytes: 8 * MB, files: 2 },
        { uploaded_by: 'Samir', bytes: 40 * MB, files: 3 },
      ],
      canSeeAll: false,
      myName: 'léa martin',
    });
    expect(result.scope).toBe('self');
    expect(result.users).toEqual([{ name: 'Léa Martin', bytes: 8 * MB, files: 2, is_me: true }]);
    expect(result.unattributed_bytes).toBeNull();
  });

  it('rend une liste vide à un non responsable qui n\'a rien déposé', () => {
    const result = buildStorageBreakdown({
      usedBytes: 100 * MB,
      rows: [{ uploaded_by: 'Samir', bytes: 40 * MB, files: 3 }],
      canSeeAll: false,
      myName: 'Léa Martin',
    });
    expect(result.users).toEqual([]);
  });
});
