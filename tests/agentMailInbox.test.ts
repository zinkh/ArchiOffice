// Courrier entrant (server/agentMailInbox.ts) : un email transféré à
// agents+<slug-cabinet>@<domaine> doit désigner sans ambiguïté un cabinet, et
// son expéditeur doit être un membre reconnu de CE cabinet avant toute
// action — voir CLAUDE.md, « Courrier entrant : transfert d'un email vers un
// agent ». Ces tests couvrent les fonctions pures/DB-only, sans connexion
// IMAP réelle (comme tests/imapSearchCriteria.test.ts).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeSupabaseAdmin } from './fakeSupabaseAdmin';
import {
  extractTenantSlugFromRecipient,
  extractSenderEmail,
  buildMailInboxAlias,
  resolveSenderMembership,
  alreadyProcessed,
  markProcessed,
} from '../server/agentMailInbox';

describe('extractTenantSlugFromRecipient', () => {
  it('reconnaît un alias sous-adressé isolé', () => {
    expect(extractTenantSlugFromRecipient('agents+aazs@archioffice.app')).toBe('aazs');
  });

  it('reconnaît un alias parmi plusieurs destinataires avec noms affichés', () => {
    expect(extractTenantSlugFromRecipient('Sophie <sophie@example.test>, Cabinet <agents+villa-martin@archioffice.app>')).toBe('villa-martin');
  });

  it('normalise la casse du slug', () => {
    expect(extractTenantSlugFromRecipient('agents+AAZS@archioffice.app')).toBe('aazs');
  });

  it('renvoie null sans motif reconnu', () => {
    expect(extractTenantSlugFromRecipient('contact@aazs.fr')).toBeNull();
    expect(extractTenantSlugFromRecipient('')).toBeNull();
  });
});

describe('extractSenderEmail', () => {
  it('extrait l\'adresse entre chevrons', () => {
    expect(extractSenderEmail('Khaldoun Sektaoui <sektaoui.khaldoun@gmail.com>')).toBe('sektaoui.khaldoun@gmail.com');
  });

  it('accepte une adresse seule', () => {
    expect(extractSenderEmail('contact@aazs.fr')).toBe('contact@aazs.fr');
  });

  it('renvoie null sans arobase exploitable', () => {
    expect(extractSenderEmail('Nom sans adresse')).toBeNull();
    expect(extractSenderEmail('')).toBeNull();
  });
});

describe('buildMailInboxAlias', () => {
  const ORIGINAL = process.env.AGENT_MAIL_INBOX_ALIAS_DOMAIN;
  afterEach(() => { process.env.AGENT_MAIL_INBOX_ALIAS_DOMAIN = ORIGINAL; });

  it('compose l\'alias quand le domaine est configuré', () => {
    process.env.AGENT_MAIL_INBOX_ALIAS_DOMAIN = 'archioffice.app';
    expect(buildMailInboxAlias('aazs')).toBe('agents+aazs@archioffice.app');
  });

  it('renvoie null sans domaine configuré', () => {
    delete process.env.AGENT_MAIL_INBOX_ALIAS_DOMAIN;
    expect(buildMailInboxAlias('aazs')).toBeNull();
  });
});

describe('resolveSenderMembership', () => {
  let db: FakeSupabaseAdmin;
  const TENANT_ID = 'tenant-1';
  const OTHER_TENANT_ID = 'tenant-2';

  beforeEach(() => {
    db = new FakeSupabaseAdmin();
    db.seed('profiles', [
      { id: 'user-membre', email: 'khaldoun@aazs.fr', tenant_id: TENANT_ID },
      { id: 'user-autre-cabinet', email: 'ailleurs@example.test', tenant_id: OTHER_TENANT_ID },
    ]);
  });

  it('reconnaît un expéditeur membre de ce cabinet (repli profiles.tenant_id)', async () => {
    const userId = await resolveSenderMembership(db as any, 'Khaldoun <khaldoun@aazs.fr>', TENANT_ID);
    expect(userId).toBe('user-membre');
  });

  it('refuse un expéditeur dont l\'email est connu mais membre d\'un AUTRE cabinet', async () => {
    const userId = await resolveSenderMembership(db as any, 'ailleurs@example.test', TENANT_ID);
    expect(userId).toBeNull();
  });

  it('refuse un expéditeur totalement inconnu', async () => {
    const userId = await resolveSenderMembership(db as any, 'inconnu@example.test', TENANT_ID);
    expect(userId).toBeNull();
  });

  it('refuse un en-tête From illisible', async () => {
    const userId = await resolveSenderMembership(db as any, 'Nom sans adresse', TENANT_ID);
    expect(userId).toBeNull();
  });
});

describe('idempotence (agent_mail_inbox_processed)', () => {
  let db: FakeSupabaseAdmin;
  beforeEach(() => { db = new FakeSupabaseAdmin(); });

  it('un message jamais vu n\'est pas déjà traité', async () => {
    expect(await alreadyProcessed(db as any, '<msg-1@example.test>')).toBe(false);
  });

  it('un message marqué traité est retrouvé comme tel', async () => {
    await markProcessed(db as any, '<msg-1@example.test>', 'tenant-1');
    expect(await alreadyProcessed(db as any, '<msg-1@example.test>')).toBe(true);
  });

  it('un second marquage du même Message-ID ne duplique pas la ligne (upsert)', async () => {
    await markProcessed(db as any, '<msg-1@example.test>', 'tenant-1');
    await markProcessed(db as any, '<msg-1@example.test>', 'tenant-1');
    const rows = db.getTable('agent_mail_inbox_processed').filter(r => r.message_id_header === '<msg-1@example.test>');
    expect(rows).toHaveLength(1);
  });
});
