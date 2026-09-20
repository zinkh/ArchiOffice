// read_email_attachment (mailAttachmentTools.ts) : capacité mail_attachments_enabled,
// palier au-dessus de mail_enabled — voir CLAUDE.md, "Donne aux agents la
// possibilité d'extraire les pièces jointes et les exploiter". Comme
// agentMailAccounts.test.ts, ces tests stubbent global.fetch plutôt que de
// faire tourner un vrai serveur.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeMailAttachmentTool } from '../packages/archioffice-agents/src/server/mailAttachmentTools';
import { executeAgentAction } from '../packages/archioffice-agents/src/server/tools';
import type { AgentCapabilities } from '../packages/archioffice-agents/src/types';

afterEach(() => { vi.unstubAllGlobals(); });

const ACCOUNTS = [
  { id: 'acc-agence', provider: 'infomaniak' as const, authType: 'imap' as const, email: 'contact@aazs.fr', displayName: 'Agence', isDefault: true, hasSmtp: true },
  { id: 'acc-gmail', provider: 'google' as const, authType: 'oauth' as const, email: 'gmail@aazs.fr', displayName: null, isDefault: false, hasSmtp: false },
];

const MESSAGE_WITH_ATTACHMENT = {
  id: 'msg-1',
  subject: 'Documents Blénod',
  from: 'client@example.test',
  bodyText: 'Voir pièce jointe.',
  attachments: [{ id: 'att-1', filename: 'notice.txt', mimeType: 'text/plain', size: 42 }],
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

const baseCaps = (mailAttachments: boolean): AgentCapabilities => ({
  actionScopes: [], webFetch: false, mailRead: true, mailSend: false, mailAttachments,
  geo: false, docsRead: false, docsWrite: false, delegate: false, notifyUsers: false, webSearch: false, knowledge: false,
});

describe('executeMailAttachmentTool', () => {
  it('télécharge et extrait le texte brut d\'une pièce jointe IMAP', async () => {
    let downloadUrl = '';
    stub((u) => {
      if (u.includes('/api/mail/imap/messages/INBOX/42') && !u.includes('attachments')) {
        return { ok: true, json: async () => MESSAGE_WITH_ATTACHMENT } as any;
      }
      if (u.includes('/attachments/att-1')) {
        downloadUrl = u;
        return { ok: true, arrayBuffer: async () => new TextEncoder().encode('Contenu de la notice.').buffer } as any;
      }
      return null;
    });
    const outcome = await executeMailAttachmentTool('http://local', { authorization: 'Bearer t' }, 'read_email_attachment', { id: 'INBOX::42', attachment_id: 'att-1' });
    expect(downloadUrl).toContain('/api/mail/imap/messages/INBOX/42/attachments/att-1');
    expect(downloadUrl).toContain('accountId=acc-agence');
    expect((outcome.response as any).content).toContain('Contenu de la notice.');
    expect((outcome.response as any).filename).toBe('notice.txt');
  });

  it('passe filename/mimeType en query pour le téléchargement Gmail', async () => {
    let downloadUrl = '';
    stub((u) => {
      if (u.includes('/api/gmail/messages/msg-1?')) return { ok: true, json: async () => MESSAGE_WITH_ATTACHMENT } as any;
      if (u.includes('/attachments/att-1')) {
        downloadUrl = u;
        return { ok: true, arrayBuffer: async () => new TextEncoder().encode('Texte Gmail.').buffer } as any;
      }
      return null;
    });
    const outcome = await executeMailAttachmentTool('http://local', { authorization: 'Bearer t' }, 'read_email_attachment', { id: 'msg-1', attachment_id: 'att-1', compte: 'gmail@aazs.fr' });
    expect(downloadUrl).toContain('filename=notice.txt');
    expect(downloadUrl).toContain('mimeType=text%2Fplain');
    expect((outcome.response as any).content).toContain('Texte Gmail.');
  });

  it("erreur si l'attachment_id ne correspond à aucune pièce jointe du message", async () => {
    stub((u) => {
      if (u.includes('/api/mail/imap/messages/INBOX/42') && !u.includes('attachments')) {
        return { ok: true, json: async () => MESSAGE_WITH_ATTACHMENT } as any;
      }
      return null;
    });
    const outcome = await executeMailAttachmentTool('http://local', { authorization: 'Bearer t' }, 'read_email_attachment', { id: 'INBOX::42', attachment_id: 'inconnu' });
    expect((outcome.response as any).error).toMatch(/introuvable/i);
  });

  it('refuse une pièce jointe trop volumineuse sans télécharger', async () => {
    let downloadCalled = false;
    stub((u) => {
      if (u.includes('/api/mail/imap/messages/INBOX/42') && !u.includes('attachments')) {
        return {
          ok: true,
          json: async () => ({ ...MESSAGE_WITH_ATTACHMENT, attachments: [{ id: 'att-1', filename: 'plan.pdf', mimeType: 'application/pdf', size: 30_000_000 }] }),
        } as any;
      }
      if (u.includes('/attachments/att-1')) { downloadCalled = true; return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) } as any; }
      return null;
    });
    const outcome = await executeMailAttachmentTool('http://local', { authorization: 'Bearer t' }, 'read_email_attachment', { id: 'INBOX::42', attachment_id: 'att-1' });
    expect(downloadCalled).toBe(false);
    expect((outcome.response as any).error).toMatch(/volumineuse/i);
  });
});

describe('executeAgentAction — dispatch read_email_attachment', () => {
  it('refuse sans capacité mailAttachments même si mailRead est actif', async () => {
    const outcome = await executeAgentAction('http://local', { authorization: 'Bearer t' }, baseCaps(false), { name: 'read_email_attachment', args: { id: 'INBOX::42', attachment_id: 'att-1' } });
    expect((outcome.response as any).error).toMatch(/pas activé/i);
  });

  it('dispatche vers executeMailAttachmentTool quand la capacité est active', async () => {
    stub((u) => {
      if (u.includes('/api/mail/imap/messages/INBOX/42') && !u.includes('attachments')) {
        return { ok: true, json: async () => MESSAGE_WITH_ATTACHMENT } as any;
      }
      if (u.includes('/attachments/att-1')) {
        return { ok: true, arrayBuffer: async () => new TextEncoder().encode('Contenu.').buffer } as any;
      }
      return null;
    });
    const outcome = await executeAgentAction('http://local', { authorization: 'Bearer t' }, baseCaps(true), { name: 'read_email_attachment', args: { id: 'INBOX::42', attachment_id: 'att-1' } });
    expect((outcome.response as any).content).toContain('Contenu.');
  });
});
