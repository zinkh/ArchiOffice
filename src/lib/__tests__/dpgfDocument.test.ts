// Contrat client / serveur de la révision du document CCTP / DPGF (voir src/lib/dpgfDocument.ts).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();
vi.mock('../api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import { figerVersion, loadDPGF, revisionConnue, saveDPGF } from '../dpgfDocument';
import type { DPGF } from '../../types/dpgf';

const doc = (titre = 'DPGF') => ({ id: 'd1', projectId: 'p1', titre, version: '1', dateCreation: '', statut: 'draft', TVA: 20, totalHT: 0, totalTTC: 0, lots: [] }) as unknown as DPGF;

beforeEach(() => { apiFetch.mockReset(); });

describe('dpgfDocument', () => {
  it('lit la révision avec le document et ne la laisse pas dans le document', async () => {
    apiFetch.mockResolvedValueOnce({ ...doc(), _rev: 7 });
    const loaded = await loadDPGF('p1');
    expect(loaded).not.toBeNull();
    expect((loaded as any)._rev).toBeUndefined();
    expect(revisionConnue('p1')).toBe(7);
  });

  it('renvoie la révision lue à l\'enregistrement et retient la nouvelle', async () => {
    apiFetch.mockResolvedValueOnce({ ...doc(), _rev: 7 });
    await loadDPGF('p2');
    apiFetch.mockResolvedValueOnce({ _rev: 8 });
    await saveDPGF('p2', doc('Modifié'));

    expect(apiFetch).toHaveBeenLastCalledWith('/api/projects/p2/dpgf?baseRev=7', expect.objectContaining({ method: 'POST' }));
    expect(revisionConnue('p2')).toBe(8);
  });

  it('un enregistrement refusé garde la révision lue : le conflit ne se résout pas tout seul', async () => {
    apiFetch.mockResolvedValueOnce({ ...doc(), _rev: 3 });
    await loadDPGF('p3');
    apiFetch.mockRejectedValueOnce(Object.assign(new Error('périmé'), { status: 409, code: 'DOC_STALE' }));
    await expect(saveDPGF('p3', doc('Ma version'))).rejects.toMatchObject({ code: 'DOC_STALE' });
    expect(revisionConnue('p3')).toBe(3);
  });

  it('sans révision connue (document créé ici), l\'enregistrement part sans condition', async () => {
    apiFetch.mockRejectedValueOnce(Object.assign(new Error('absent'), { status: 404 }));
    expect(await loadDPGF('p4')).toBeNull();
    apiFetch.mockResolvedValueOnce({ _rev: 0 });
    await saveDPGF('p4', doc());
    expect(apiFetch).toHaveBeenLastCalledWith('/api/projects/p4/dpgf', expect.anything());
    expect(revisionConnue('p4')).toBe(0);
  });

  it('met de côté la version stockée, ou celle fournie', async () => {
    apiFetch.mockResolvedValue({});
    await figerVersion('p5', 'Avant remplacement');
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ label: 'Avant remplacement' });

    await figerVersion('p5', 'Mes modifications', doc('Ma version'));
    const body = JSON.parse(apiFetch.mock.calls[1][1].body);
    expect(body.label).toBe('Mes modifications');
    expect(body.document.titre).toBe('Ma version');
  });
});
