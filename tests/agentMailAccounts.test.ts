// Couche outil messagerie des agents IA (mailTools.ts) après le support
// multi-comptes : detectMailProvider() (une requête par fournisseur, ordre
// figé) a été remplacé par resolveMailAccount(), qui interroge
// GET /api/mail/accounts une seule fois et choisit le compte par défaut ou
// celui nommé explicitement (`compte`). Comme agentInterop.test.ts, ces
// tests stubbent global.fetch plutôt que de faire tourner un vrai serveur.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveMailAccount, executeMailTool } from '../packages/archioffice-agents/src/server/mailTools';

afterEach(() => { vi.unstubAllGlobals(); });

const ACCOUNTS = [
  { id: 'acc-agence', provider: 'infomaniak' as const, authType: 'imap' as const, email: 'contact@aazs.fr', displayName: 'Agence', isDefault: true, hasSmtp: true },
  { id: 'acc-perso', provider: 'google' as const, authType: 'oauth' as const, email: 'perso@gmail.test', displayName: null, isDefault: false, hasSmtp: false },
];

function stubAccountsFetch(accounts = ACCOUNTS, extra?: (url: string, opts: any) => any) {
  vi.stubGlobal('fetch', vi.fn(async (url: any, opts: any) => {
    const u = String(url);
    if (u.endsWith('/api/mail/accounts')) {
      return { ok: true, json: async () => accounts } as any;
    }
    if (extra) {
      const res = extra(u, opts);
      if (res) return res;
    }
    throw new Error('Unexpected fetch url: ' + u);
  }));
}

describe('resolveMailAccount', () => {
  it("choisit le défaut quand aucun compte n'est nommé", async () => {
    stubAccountsFetch();
    const account = await resolveMailAccount('http://local', 'Bearer t', undefined);
    expect(account?.id).toBe('acc-agence');
  });

  it('choisit le compte dont l\'adresse ou le nom correspond à l\'indice', async () => {
    stubAccountsFetch();
    const account = await resolveMailAccount('http://local', 'Bearer t', 'perso@gmail.test');
    expect(account?.id).toBe('acc-perso');
  });

  it('retombe sur le défaut si l\'indice ne correspond à rien', async () => {
    stubAccountsFetch();
    const account = await resolveMailAccount('http://local', 'Bearer t', 'inconnu@example.test');
    expect(account?.id).toBe('acc-agence');
  });

  it('renvoie null sans aucun compte connecté', async () => {
    stubAccountsFetch([]);
    const account = await resolveMailAccount('http://local', 'Bearer t');
    expect(account).toBeNull();
  });
});

describe('executeMailTool — search_emails / list_emails passent accountId au compte résolu', () => {
  it('interroge la route IMAP avec l\'accountId du compte par défaut', async () => {
    let calledUrl = '';
    stubAccountsFetch(ACCOUNTS, (u) => {
      if (u.includes('/api/mail/imap/search')) { calledUrl = u; return { ok: true, json: async () => [] } as any; }
      return null;
    });
    const outcome = await executeMailTool('http://local', 'Bearer t', 'search_emails', { query: 'devis' }, false);
    expect(calledUrl).toContain('accountId=acc-agence');
    expect((outcome.response as any).compte).toBe('contact@aazs.fr');
  });

  it('interroge Gmail avec l\'accountId du compte nommé explicitement', async () => {
    let calledUrl = '';
    stubAccountsFetch(ACCOUNTS, (u) => {
      if (u.includes('/api/gmail/messages')) { calledUrl = u; return { ok: true, json: async () => ({ messages: [], nextPageToken: null }) } as any; }
      return null;
    });
    const outcome = await executeMailTool('http://local', 'Bearer t', 'list_emails', { compte: 'perso' }, false);
    expect(calledUrl).toContain('accountId=acc-perso');
    expect((outcome.response as any).compte).toBe('perso@gmail.test');
  });
});

describe('executeMailTool — send_email', () => {
  it('le brouillon de confirmation nomme le compte résolu', async () => {
    stubAccountsFetch();
    const outcome = await executeMailTool('http://local', 'Bearer t', 'send_email', { to: 'x@y.z', subject: 'S', body: 'B' }, true);
    expect((outcome.response as any).draft.from).toBe('contact@aazs.fr');
  });

  it("envoie via /api/send-email avec accountId pour un compte IMAP (l'aiguillage SMTP se fait côté serveur)", async () => {
    let calledUrl = '';
    let calledBody: any = null;
    stubAccountsFetch(ACCOUNTS, (u, opts) => {
      if (u.endsWith('/api/send-email')) { calledUrl = u; calledBody = JSON.parse(opts.body); return { ok: true, json: async () => ({ id: 'sent-1' }) } as any; }
      return null;
    });
    const outcome = await executeMailTool('http://local', 'Bearer t', 'send_email', { to: 'x@y.z', subject: 'S', body: 'B', confirm: true }, true);
    expect(calledUrl).toContain('/api/send-email');
    expect(calledBody.accountId).toBe('acc-agence');
    expect((outcome.response as any).success).toBe(true);
  });

  it('refuse sans capacité mailSend même avec confirm', async () => {
    stubAccountsFetch();
    const outcome = await executeMailTool('http://local', 'Bearer t', 'send_email', { to: 'x@y.z', subject: 'S', body: 'B', confirm: true }, false);
    expect((outcome.response as any).error).toMatch(/pas activé/i);
  });
});
