import { describe, expect, it } from 'vitest';
import type { ReservePhoto } from '../../types';
import {
  overlayPendingPhotos, pendingPhotosByReserve, photoDisplaySrc, photoEntityFor, reserveIdFromPhotoUrl,
} from '../reservePhotoQueue';

describe('photoDisplaySrc', () => {
  const full = 'https://x/reserve-photos/t/r/p.jpg';
  const thumb = 'https://x/reserve-photos/t/r/p-thumb.jpg';

  it('affiche la miniature quand le serveur en a une', () => {
    expect(photoDisplaySrc({ file_url: full, thumb_url: thumb })).toBe(thumb);
  });

  it('affiche la photo pour une photo antérieure aux miniatures', () => {
    expect(photoDisplaySrc({ file_url: full })).toBe(full);
    expect(photoDisplaySrc({ file_url: full, thumb_url: null })).toBe(full);
    expect(photoDisplaySrc({ file_url: full, thumb_url: '' })).toBe(full);
  });

  it('retombe sur la photo quand la miniature ne se charge pas', () => {
    expect(photoDisplaySrc({ file_url: full, thumb_url: thumb }, true)).toBe(full);
  });
});

const write = (over: Record<string, unknown> = {}) => ({
  id: 'p1', entity: 'reservePhoto' as const, method: 'POST' as const, url: '/api/reserves/r1/photos',
  kind: 'multipart' as const, status: 'pending' as const, createdAt: 1_000, lastError: undefined as string | undefined,
  ...over,
});

const preview = (id: string) => `blob:${id}`;

describe('reserveIdFromPhotoUrl', () => {
  it('lit la réserve OPR et la réserve GPA', () => {
    expect(reserveIdFromPhotoUrl('/api/reserves/abc/photos')).toBe('abc');
    expect(reserveIdFromPhotoUrl('/api/gpa-reserves/xyz/photos')).toBe('xyz');
  });

  it('refuse toute autre adresse', () => {
    expect(reserveIdFromPhotoUrl('/api/reserves/abc')).toBeNull();
    expect(reserveIdFromPhotoUrl('/api/reserves/abc/photos/p1')).toBeNull();
    expect(reserveIdFromPhotoUrl('/api/meetings/abc/photos')).toBeNull();
  });
});

describe('photoEntityFor', () => {
  it('distingue les deux jeux de réserves', () => {
    expect(photoEntityFor('/api/reserves')).toBe('reservePhoto');
    expect(photoEntityFor('/api/gpa-reserves')).toBe('gpaReservePhoto');
  });
});

describe('pendingPhotosByReserve', () => {
  it("regroupe par réserve, dans l'ordre où les photos ont été prises", () => {
    const map = pendingPhotosByReserve([
      write({ id: 'b', createdAt: 2_000 }),
      write({ id: 'a', createdAt: 1_000 }),
      write({ id: 'c', url: '/api/reserves/r2/photos', createdAt: 1_500 }),
    ], 'reservePhoto', preview);
    expect(map.get('r1')?.map(p => p.id)).toEqual(['a', 'b']);
    expect(map.get('r2')?.map(p => p.id)).toEqual(['c']);
    expect(map.get('r1')?.[0]).toMatchObject({ pendingSync: true, localPreviewUrl: 'blob:a', reserve_kind: 'opr', file_url: '' });
  });

  it("ignore les écritures d'une autre entité, les suppressions et les saisies JSON", () => {
    const map = pendingPhotosByReserve([
      write({ id: 'gpa', entity: 'gpaReservePhoto' }),
      write({ id: 'del', method: 'DELETE' }),
      write({ id: 'json', kind: 'json' }),
      write({ id: 'ok' }),
    ], 'reservePhoto', preview);
    expect([...map.values()].flat().map(p => p.id)).toEqual(['ok']);
  });

  it('signale une photo refusée par le serveur avec sa raison', () => {
    const [photo] = pendingPhotosByReserve([write({ status: 'error', lastError: 'Type de fichier non autorisé' })], 'reservePhoto', preview).get('r1')!;
    expect(photo.syncError).toBe('Type de fichier non autorisé');
    const [fine] = pendingPhotosByReserve([write()], 'reservePhoto', preview).get('r1')!;
    expect(fine.syncError).toBeUndefined();
  });

  it('marque les photos GPA comme telles', () => {
    const map = pendingPhotosByReserve([write({ entity: 'gpaReservePhoto', url: '/api/gpa-reserves/g1/photos' })], 'gpaReservePhoto', preview);
    expect(map.get('g1')?.[0].reserve_kind).toBe('gpa');
  });
});

describe('overlayPendingPhotos', () => {
  const photo = (id: string): ReservePhoto => ({ id, reserve_id: 'r1', reserve_kind: 'opr', file_url: `f/${id}`, uploaded_at: '2026-10-29T08:00:00.000Z' });

  it("rend la même liste quand il n'y a rien à superposer", () => {
    const reserves = [{ id: 'r1', photos: [photo('s1')] }];
    expect(overlayPendingPhotos(reserves, new Map())).toBe(reserves);
    expect(overlayPendingPhotos(reserves, pendingPhotosByReserve([write({ url: '/api/reserves/autre/photos' })], 'reservePhoto', preview))).toBe(reserves);
  });

  it("ajoute les photos en attente après celles du serveur, sans modifier la liste d'origine", () => {
    const reserves = [{ id: 'r1', photos: [photo('s1')] }, { id: 'r2' }];
    const shown = overlayPendingPhotos(reserves, pendingPhotosByReserve([write({ id: 'p1' })], 'reservePhoto', preview));
    expect(shown[0].photos?.map(p => p.id)).toEqual(['s1', 'p1']);
    expect(shown[1]).toBe(reserves[1]);
    expect(reserves[0].photos).toHaveLength(1);
  });

  it("n'affiche pas deux fois une photo déjà revenue du serveur", () => {
    const reserves = [{ id: 'r1', photos: [photo('p1')] }];
    const pending = pendingPhotosByReserve([write({ id: 'p1' })], 'reservePhoto', preview);
    expect(overlayPendingPhotos(reserves, pending)).toBe(reserves);
  });

  it("montre la photo sur une réserve qui n'avait aucune photo", () => {
    const shown = overlayPendingPhotos([{ id: 'r1' } as { id: string; photos?: ReservePhoto[] }], pendingPhotosByReserve([write()], 'reservePhoto', preview));
    expect(shown[0].photos).toHaveLength(1);
  });
});
