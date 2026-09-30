import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/mailOAuthTokens', () => ({
  getGmailAccessToken: async () => 'gtok',
  getOutlookAccessToken: async () => 'otok',
}));

import { fileMessageInProjectFolder, projectFolderName } from '../server/mailFiling';

const project = { name: 'GEORGES', project_code: '2611' };
const res = (body: any, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe('projectFolderName', () => {
  it('assemble code et nom sans séparateur ni caractère réservé', () => {
    expect(projectFolderName({ name: 'Villa A/B: "Nord"', project_code: '26.014' })).toBe('26 014 - Villa A B Nord');
  });
  it('retombe sur un nom par défaut', () => {
    expect(projectFolderName({})).toBe('Sans nom');
  });
});

describe('classement Gmail', () => {
  it('crée le libellé absent puis pose le libellé en retirant INBOX', async () => {
    const calls: Array<{ url: string; method?: string; body?: any }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined });
      if (url.endsWith('/labels') && !init?.method) return res({ labels: [{ id: 'INBOX', name: 'INBOX' }] });
      if (url.endsWith('/labels')) return res({ id: 'Label_9' });
      return res({});
    }));
    const out = await fileMessageInProjectFolder({}, { provider: 'google' } as any, project, 'm1');
    expect(out).toEqual({ folder: 'ArchiOffice/2611 - GEORGES', newExternalMessageId: 'm1' });
    expect(calls[1].body.name).toBe('ArchiOffice/2611 - GEORGES');
    expect(calls[2].body).toEqual({ addLabelIds: ['Label_9'], removeLabelIds: ['INBOX'] });
  });

  it('réutilise un libellé existant', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      calls.push({ url, method: init?.method });
      if (url.endsWith('/labels')) return res({ labels: [{ id: 'L1', name: 'ArchiOffice/2611 - GEORGES' }] });
      return res({});
    }));
    await fileMessageInProjectFolder({}, { provider: 'google' } as any, project, 'm1');
    expect(calls.filter(c => c.method === 'POST' && c.url.endsWith('/labels'))).toHaveLength(0);
  });
});

describe('classement Outlook', () => {
  it('crée racine et dossier d\'affaire, déplace et rend le nouvel id', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      if (url.includes('/move')) return res({ id: 'new-id' });
      if (init?.method === 'POST') return res({ id: url.includes('childFolders') ? 'child' : 'root' });
      return res({ value: [] });
    }));
    const out = await fileMessageInProjectFolder({}, { provider: 'microsoft' } as any, project, 'old-id');
    expect(out).toEqual({ folder: 'ArchiOffice/2611 - GEORGES', newExternalMessageId: 'new-id' });
  });

  it('remonte l\'erreur du fournisseur', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ error: { message: 'Access denied' } }, 403)));
    await expect(fileMessageInProjectFolder({}, { provider: 'microsoft' } as any, project, 'x')).rejects.toThrow(/Access denied|Création/);
  });
});
