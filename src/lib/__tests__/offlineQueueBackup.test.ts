// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rows = vi.hoisted(() => new Map<string, any>());

vi.mock('../../db', () => ({
  db: {
    pendingWrites: {
      orderBy: () => ({ toArray: async () => [...rows.values()].sort((a, b) => a.createdAt - b.createdAt) }),
      toArray: async () => [...rows.values()],
      bulkGet: async (ids: string[]) => ids.map(id => rows.get(id)),
      delete: async (id: string) => { rows.delete(id); },
      update: async (id: string, patch: object) => { Object.assign(rows.get(id), patch); },
      put: async (row: any) => { rows.set(row.id, row); },
    },
  },
}));

import { buildQueueBackup, importQueueBackup, importQueueBackupFile, prepareQueueBackup, deliverBackupFile, BACKUP_FORMAT } from '../offlineQueueBackup';

const json = (id: string, createdAt: number, extra: object = {}) => ({
  id, entity: 'observation', method: 'POST', url: '/api/projects/p1/observations', kind: 'json',
  jsonBody: { id, texte: 'Plinthes non conformes' }, status: 'error', attempts: 3, lastError: '500', createdAt, tenantId: 't1', ...extra,
});

describe('sauvegarde de la file hors ligne', () => {
  beforeEach(() => rows.clear());
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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

    expect(summary).toEqual({ imported: 2, ids: ['o1', 'ph1'], rejected: [] });
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

  it('prépare un fichier JSON nommé, relisible par l\'import', async () => {
    rows.set('o1', json('o1', 1));
    const { file, count, unreadable } = await prepareQueueBackup();
    expect(file.name).toMatch(/^archioffice-file-attente-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.json$/);
    expect(file.type).toBe('application/json');
    expect([count, unreadable]).toEqual([1, 0]);
    rows.clear();
    expect((await importQueueBackup(await file.text())).imported).toBe(1);
  });

  describe('import d\'un fichier : envoyé ou pas', () => {
    const backupFile = (writes: object[]) => new File([JSON.stringify({ format: BACKUP_FORMAT, version: 1, writes })], 'sauvegarde.json', { type: 'application/json' });

    it('annonce ce qui est arrivé au serveur et suit les phases', async () => {
      vi.stubGlobal('fetch', () => Promise.resolve(new Response(null, { status: 200 })));
      const phases: string[] = [];

      const result = await importQueueBackupFile(backupFile([json('a', 1), json('b', 2)]), p => phases.push(p.step));

      expect(result).toMatchObject({ imported: 2, sent: 2, attempted: true, stillPending: [] });
      expect(phases[0]).toBe('reading');
      expect(phases).toContain('storing');
      expect(phases.at(-1)).toBe('sending');
      expect(rows.size).toBe(0);
    });

    it('dit quelles entrées restent en attente et pourquoi quand le serveur ne les prend pas', async () => {
      vi.stubGlobal('fetch', (url: string) => Promise.resolve(url.endsWith('/bad') ? new Response('gateway', { status: 502 }) : new Response(null, { status: 200 })));

      const result = await importQueueBackupFile(backupFile([json('good', 1), json('bad', 2, { url: '/api/bad' })]));

      expect(result.sent).toBe(1);
      expect(result.stillPending).toHaveLength(1);
      expect(result.stillPending[0]).toMatchObject({ id: 'bad', entity: 'observation' });
      expect(result.stillPending[0].message).toContain('HTTP 502');
    });

    it('hors ligne : rien n\'est tenté, et le résultat le dit au lieu d\'annoncer un succès', async () => {
      vi.stubGlobal('navigator', { onLine: false });
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const result = await importQueueBackupFile(backupFile([json('a', 1)]));

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result).toMatchObject({ imported: 1, sent: 0, attempted: false });
      expect(result.stillPending[0].message).toBe('réseau indisponible');
    });
  });

  describe('remise du fichier', () => {
    const file = () => new File(['{}'], 'sauvegarde.json', { type: 'application/json' });

    it('passe par la feuille de partage quand elle accepte le fichier (iPad)', async () => {
      const share = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { share, canShare: () => true });
      expect(await deliverBackupFile(file())).toBe('shared');
      expect(share).toHaveBeenCalledTimes(1);
    });

    it('retente en texte brut quand le JSON est refusé par le partage', async () => {
      const share = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { share, canShare: ({ files }: { files: File[] }) => files[0].type === 'text/plain' });
      expect(await deliverBackupFile(file())).toBe('shared');
      expect(share.mock.calls[0][0].files[0].type).toBe('text/plain');
      expect(share.mock.calls[0][0].files[0].name).toBe('sauvegarde.json');
    });

    it('signale l\'annulation au lieu d\'annoncer un succès', async () => {
      const abort = Object.assign(new Error('annulé'), { name: 'AbortError' });
      vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(abort), canShare: () => true });
      expect(await deliverBackupFile(file())).toBe('cancelled');
    });

    it('retombe sur le téléchargement quand le partage n\'existe pas', async () => {
      vi.stubGlobal('navigator', {});
      const createObjectURL = vi.fn(() => 'blob:test');
      vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      expect(await deliverBackupFile(file())).toBe('downloaded');
      expect(click).toHaveBeenCalledTimes(1);
    });

    it('retombe sur le téléchargement quand le partage est refusé sans être annulé', async () => {
      const denied = Object.assign(new Error('refusé'), { name: 'NotAllowedError' });
      vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(denied), canShare: () => true });
      vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:test', revokeObjectURL: vi.fn() }));
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      expect(await deliverBackupFile(file())).toBe('downloaded');
      expect(click).toHaveBeenCalled();
    });
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
