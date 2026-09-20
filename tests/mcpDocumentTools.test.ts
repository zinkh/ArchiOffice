// Outils MCP ajoutés pour le pont messagerie → fiche : import_email_attachment
// (dépose une pièce jointe déjà lue sur une fiche du cabinet) et read_document
// (lit le texte d'une pièce déjà attachée). Comme tests/agentMailAttachments.test.ts,
// ces tests stubbent global.fetch plutôt que de faire tourner un vrai serveur.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('pdf-parse', () => ({ default: vi.fn(async (buffer: Buffer) => ({ text: buffer.toString('utf8') })) }));

import { MCP_TOOL_NAMES, executeMcpTool } from '../packages/archioffice-agents/src/server/mcp/tools';
import { withTextExtractionTimeout } from '../packages/archioffice-agents/src/server/documentTextExtraction';

afterEach(() => { vi.unstubAllGlobals(); });

const AUTH = { authorization: 'Bearer t' };

const ACCOUNTS = [
  { id: 'acc-agence', provider: 'infomaniak' as const, authType: 'imap' as const, email: 'contact@aazs.fr', displayName: 'Agence', isDefault: true, hasSmtp: true },
];

const MESSAGE = {
  id: 'msg-52',
  subject: '71 BLANDAN Devis signe',
  from: 'client@example.test',
  bodyText: 'Voir pièces jointes.',
  attachments: [
    { id: 'att-1', filename: 'devis-blandan.pdf', mimeType: 'application/pdf', size: 1200 },
    { id: 'att-2', filename: 'plan-blandan.pdf', mimeType: 'application/pdf', size: 900 },
  ],
};

function stub(extra: (url: string, opts: any) => any) {
  vi.stubGlobal('fetch', vi.fn(async (url: any, opts: any) => {
    const u = String(url);
    if (u.endsWith('/api/mail/accounts')) return { ok: true, json: async () => ACCOUNTS } as any;
    const res = extra(u, opts);
    if (res) return res;
    throw new Error('Unexpected fetch url: ' + u);
  }));
}

describe('MCP_TOOL_NAMES', () => {
  it('expose read_email_attachment (via buildAgentTools/mailAttachments), import_email_attachment et read_document', () => {
    expect(MCP_TOOL_NAMES).toContain('read_email_attachment');
    expect(MCP_TOOL_NAMES).toContain('import_email_attachment');
    expect(MCP_TOOL_NAMES).toContain('read_document');
  });

  it('non-régression : ni delete_record ni send_email ne sont exposés', () => {
    expect(MCP_TOOL_NAMES).not.toContain('delete_record');
    expect(MCP_TOOL_NAMES).not.toContain('send_email');
  });
});

describe('executeMcpTool — delete_record (non-régression)', () => {
  it('reste refusé même si on force le nom', async () => {
    const result = await executeMcpTool('http://local', AUTH, 'delete_record', { resource: 'contacts', id: 'x' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toMatch(/non autorisée/i);
  });
});

describe('executeMcpTool — import_email_attachment', () => {
  it('dépose une seule pièce jointe (succès simple)', async () => {
    let postedUrl = '';
    stub((u, opts) => {
      if (u.includes('/api/mail/imap/messages/INBOX/52') && !u.includes('attachments')) return { ok: true, json: async () => MESSAGE } as any;
      if (u.includes('/attachments/att-1')) return { ok: true, arrayBuffer: async () => new TextEncoder().encode('contenu devis').buffer } as any;
      if (u.includes('/api/documents?resource_type=projects')) return { ok: true, json: async () => [] } as any;
      if (u.endsWith('/api/documents') && opts?.method === 'POST') {
        postedUrl = u;
        return { ok: true, json: async () => ({ id: 'doc-1', size_bytes: 13, uploaded_at: '2026-09-20T00:00:00Z' }) } as any;
      }
      return null;
    });
    const result = await executeMcpTool('http://local', AUTH, 'import_email_attachment', {
      id: 'INBOX::52', attachment_id: 'att-1', resource: 'projects', resource_id: 'proj-1',
    });
    expect(postedUrl).toContain('/api/documents');
    const body = JSON.parse(result.content[0].text);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].id).toBe('doc-1');
    expect(body.results[0].file_name).toBe('devis-blandan.pdf');
    expect(result.isError).toBeFalsy();
  });

  it('dépose plusieurs pièces jointes', async () => {
    let posts = 0;
    stub((u, opts) => {
      if (u.includes('/api/mail/imap/messages/INBOX/52') && !u.includes('attachments')) return { ok: true, json: async () => MESSAGE } as any;
      if (u.includes('/attachments/att-1') || u.includes('/attachments/att-2')) return { ok: true, arrayBuffer: async () => new TextEncoder().encode('x').buffer } as any;
      if (u.includes('/api/documents?resource_type=projects')) return { ok: true, json: async () => [] } as any;
      if (u.endsWith('/api/documents') && opts?.method === 'POST') {
        posts++;
        return { ok: true, json: async () => ({ id: `doc-${posts}`, size_bytes: 1, uploaded_at: '2026-09-20T00:00:00Z' }) } as any;
      }
      return null;
    });
    const result = await executeMcpTool('http://local', AUTH, 'import_email_attachment', {
      id: 'INBOX::52', attachment_ids: ['att-1', 'att-2'], resource: 'projects', resource_id: 'proj-1',
    });
    const body = JSON.parse(result.content[0].text);
    expect(body.results).toHaveLength(2);
    expect(posts).toBe(2);
    expect(result.isError).toBeFalsy();
  });

  it('refuse un doublon (même nom, même taille) puis accepte avec force', async () => {
    let posted = false;
    stub((u, opts) => {
      if (u.includes('/api/mail/imap/messages/INBOX/52') && !u.includes('attachments')) return { ok: true, json: async () => MESSAGE } as any;
      if (u.includes('/attachments/att-1')) return { ok: true, arrayBuffer: async () => new TextEncoder().encode('contenu').buffer } as any;
      if (u.includes('/api/documents?resource_type=projects')) {
        return { ok: true, json: async () => [{ id: 'doc-existing', name: 'devis-blandan.pdf', size_bytes: 1200 }] } as any;
      }
      if (u.endsWith('/api/documents') && opts?.method === 'POST') { posted = true; return { ok: true, json: async () => ({ id: 'doc-2', size_bytes: 1200, uploaded_at: '2026-09-20T00:00:00Z' }) } as any; }
      return null;
    });
    const refused = await executeMcpTool('http://local', AUTH, 'import_email_attachment', {
      id: 'INBOX::52', attachment_id: 'att-1', resource: 'projects', resource_id: 'proj-1',
    });
    expect(posted).toBe(false);
    const refusedBody = JSON.parse(refused.content[0].text);
    expect(refusedBody.results[0].duplicate).toBe(true);
    expect(refused.isError).toBe(true);

    const forced = await executeMcpTool('http://local', AUTH, 'import_email_attachment', {
      id: 'INBOX::52', attachment_id: 'att-1', resource: 'projects', resource_id: 'proj-1', force: true,
    });
    expect(posted).toBe(true);
    const forcedBody = JSON.parse(forced.content[0].text);
    expect(forcedBody.results[0].id).toBe('doc-2');
    expect(forced.isError).toBeFalsy();
  });

  it('attachment_id inconnu du message', async () => {
    stub(u => {
      if (u.includes('/api/mail/imap/messages/INBOX/52') && !u.includes('attachments')) return { ok: true, json: async () => MESSAGE } as any;
      if (u.includes('/api/documents?resource_type=projects')) return { ok: true, json: async () => [] } as any;
      return null;
    });
    const result = await executeMcpTool('http://local', AUTH, 'import_email_attachment', {
      id: 'INBOX::52', attachment_id: 'att-inconnu', resource: 'projects', resource_id: 'proj-1',
    });
    const body = JSON.parse(result.content[0].text);
    expect(body.results[0].error).toMatch(/introuvable/i);
    expect(result.isError).toBe(true);
  });

  it('fichier trop gros (métadonnée) est refusé sans téléchargement', async () => {
    let downloaded = false;
    const bigMessage = { ...MESSAGE, attachments: [{ id: 'att-big', filename: 'plan.pdf', mimeType: 'application/pdf', size: 30_000_000 }] };
    stub(u => {
      if (u.includes('/api/mail/imap/messages/INBOX/52') && !u.includes('attachments')) return { ok: true, json: async () => bigMessage } as any;
      if (u.includes('/attachments/att-big')) { downloaded = true; return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) } as any; }
      if (u.includes('/api/documents?resource_type=projects')) return { ok: true, json: async () => [] } as any;
      return null;
    });
    const result = await executeMcpTool('http://local', AUTH, 'import_email_attachment', {
      id: 'INBOX::52', attachment_id: 'att-big', resource: 'projects', resource_id: 'proj-1',
    });
    expect(downloaded).toBe(false);
    const body = JSON.parse(result.content[0].text);
    expect(body.results[0].error).toMatch(/volumineux/i);
  });

  it('compte introuvable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      const u = String(url);
      if (u.endsWith('/api/mail/accounts')) return { ok: true, json: async () => [] } as any;
      throw new Error('Unexpected fetch url: ' + u);
    }));
    const result = await executeMcpTool('http://local', AUTH, 'import_email_attachment', {
      id: 'INBOX::52', attachment_id: 'att-1', resource: 'projects', resource_id: 'proj-1',
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toMatch(/aucune messagerie/i);
  });

  it('resource invalide', async () => {
    const result = await executeMcpTool('http://local', AUTH, 'import_email_attachment', {
      id: 'INBOX::52', attachment_id: 'att-1', resource: 'invoices', resource_id: 'x',
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toMatch(/non pris en charge/i);
  });
});

describe('executeMcpTool — read_document', () => {
  function stubDocRead(doc: any, bytes: string) {
    stub(u => {
      if (u.includes('/api/documents?resource_type=projects')) return { ok: true, json: async () => [doc] } as any;
      if (u.includes('/api/storage/signed-url')) return { ok: true, json: async () => ({ url: 'https://signed.example/file' }) } as any;
      if (u === 'https://signed.example/file') return { ok: true, arrayBuffer: async () => new TextEncoder().encode(bytes).buffer } as any;
      return null;
    });
  }

  it('lit un PDF avec couche texte', async () => {
    stubDocRead({ id: 'doc-1', name: 'devis.pdf', mime_type: 'application/pdf', size_bytes: 100, file_url: 'archioffice://documents/devis.pdf' }, 'Devis 71 Blandan - montant 12 000 EUR');
    const result = await executeMcpTool('http://local', AUTH, 'read_document', { resource: 'projects', resource_id: 'proj-1', document_id: 'doc-1' });
    const body = JSON.parse(result.content[0].text);
    expect(body.content).toContain('Devis 71 Blandan');
    expect(result.isError).toBeFalsy();
  });

  it('renvoie une note honnête pour un fichier sans texte exploitable', async () => {
    stubDocRead({ id: 'doc-2', name: 'notes.xyz', mime_type: 'application/octet-stream', size_bytes: 10, file_url: 'archioffice://documents/notes.xyz' }, 'donnees binaires');
    const result = await executeMcpTool('http://local', AUTH, 'read_document', { resource: 'projects', resource_id: 'proj-1', document_id: 'doc-2' });
    const body = JSON.parse(result.content[0].text);
    expect(body.content).toBeNull();
    expect(body.note).toMatch(/aucun texte exploitable/i);
  });

  it('document_id introuvable sur la fiche', async () => {
    stub(u => {
      if (u.includes('/api/documents?resource_type=projects')) return { ok: true, json: async () => [] } as any;
      return null;
    });
    const result = await executeMcpTool('http://local', AUTH, 'read_document', { resource: 'projects', resource_id: 'proj-1', document_id: 'doc-inconnu' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toMatch(/introuvable/i);
  });
});

describe('withTextExtractionTimeout', () => {
  it('rejette une extraction trop lente sans attendre le vrai délai de production', async () => {
    const neverResolves = new Promise<{ text: string | null; note: string }>(() => {});
    await expect(withTextExtractionTimeout(neverResolves, 10)).rejects.toThrow(/délai/i);
  });
});
