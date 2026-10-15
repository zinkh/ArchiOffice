// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows = vi.hoisted(() => new Map<string, any>());

vi.mock('../../db', () => ({
  db: {
    pendingWrites: {
      orderBy: () => ({ toArray: async () => [...rows.values()].sort((a, b) => a.createdAt - b.createdAt) }),
      put: async (row: any) => { rows.set(row.id, row); },
    },
  },
}));

import { buildQueueBackup, importQueueBackup, BACKUP_FORMAT } from '../offlineQueueBackup';

const json = (id: string, createdAt: number, extra: object = {}) => ({
  id, entity: 'observation', method: 'POST', url: '/api/projects/p1/observations', kind: 'json',
  jsonBody: { id, texte: 'Plinthes non conformes' }, status: 'error', attempts: 3, lastError: '500', createdAt, tenantId: 't1', ...extra,
});

describe('sauvegarde de la file hors ligne', () => {
  beforeEach(() => rows.clear());

  it('exporte puis réimporte des saisies et une photo, remises en attente', async () => {
    rows.set('o1', json('o1', 1));
    rows.set('ph1', {
      id: 'ph1', entity: 'observationPhoto', method: 'POST', url: '/api/observations/o1/photos', kind: 'multipart',
      blob: new Blob(['abc'], { type: 'image/jpeg' }), blobFieldName: 'photo', blobFilename: 'a.jpg',
      status: 'pending', attempts: 0, createdAt: 2, tenantId: 't1',
    });

    const { backup, unreadable } = await buildQueueBackup();
    expect(unreadable).toEqual([]);
    expect(backup.writes).toHaveLength(2);
    expect(backup.writes[1].blob).toEqual({ base64: 'YWJj', type: 'image/jpeg' });

    rows.clear();
    const summary = await importQueueBackup(JSON.stringify(backup));

    expect(summary).toEqual({ imported: 2, rejected: [] });
    expect(rows.get('o1')).toMatchObject({ status: 'pending', attempts: 0, tenantId: 't1', jsonBody: { texte: 'Plinthes non conformes' } });
    expect(rows.get('o1').lastError).toBeUndefined();
    const photo = rows.get('ph1');
    expect(photo.blob.size).toBe(3);
    expect(photo.blob.type).toBe('image/jpeg');
    expect(photo.blobFieldName).toBe('photo');
  });

  it('importer deux fois le même fichier ne crée pas de doublon', async () => {
    rows.set('o1', json('o1', 1));
    const { backup } = await buildQueueBackup();
    await importQueueBackup(JSON.stringify(backup));
    await importQueueBackup(JSON.stringify(backup));
    expect(rows.size).toBe(1);
  });

  it('signale une photo illisible au lieu de l\'omettre en silence', async () => {
    rows.set('ph1', { id: 'ph1', entity: 'observationPhoto', method: 'POST', url: '/api/x', kind: 'multipart', blob: new Blob([]), status: 'pending', attempts: 0, createdAt: 1 });
    const { backup, unreadable } = await buildQueueBackup();
    expect(backup.writes).toHaveLength(0);
    expect(unreadable).toEqual(['ph1']);
  });

  it('refuse un fichier qui n\'est pas une sauvegarde', async () => {
    await expect(importQueueBackup('pas du json')).rejects.toThrow('JSON illisible');
    await expect(importQueueBackup(JSON.stringify({ hello: 1 }))).rejects.toThrow('pas une sauvegarde');
  });

  it('refuse une sauvegarde d\'une version plus récente', async () => {
    await expect(importQueueBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 99, writes: [] }))).rejects.toThrow('plus récente');
  });

  it('écarte les entrées qui visent autre chose que l\'API de l\'application', async () => {
    const file = {
      format: BACKUP_FORMAT, version: 1, writes: [
        json('ok', 1),
        json('ext', 2, { url: 'https://evil.example/steal' }),
        json('dots', 3, { url: '/api/../admin' }),
        json('proto', 4, { url: '//evil.example/api/x' }),
        json('ent', 5, { entity: 'invoices' }),
        json('meth', 6, { method: 'TRACE' }),
        { id: 'ph', entity: 'observationPhoto', method: 'POST', url: '/api/x', kind: 'multipart', createdAt: 7 },
      ],
    };
    const { imported, rejected } = await importQueueBackup(JSON.stringify(file));
    expect(imported).toBe(1);
    expect(rows.has('ok')).toBe(true);
    expect(rejected.map(r => r.id).sort()).toEqual(['dots', 'ent', 'ext', 'meth', 'ph', 'proto']);
    expect(rows.size).toBe(1);
  });
});
