// Pont d'authentification interne pour le relevé de messagerie entrante
// (server/agentMailRelayTokens.ts) : jamais un JWT Supabase, un jeton
// mail_at_ à usage unique et de courte durée de vie — même forme que
// mcp_at_/tg_at_, voir CLAUDE.md, « Le pont d'authentification mail_at_ ».
import { describe, expect, it } from 'vitest';
import { FakeSupabaseAdmin } from './fakeSupabaseAdmin';
import { issueMailRelayToken, resolveMailRelayToken } from '../server/agentMailRelayTokens';

describe('issueMailRelayToken / resolveMailRelayToken', () => {
  it('émet un jeton préfixé mail_at_ qui résout vers le bon (tenant, utilisateur)', async () => {
    const db = new FakeSupabaseAdmin();
    const token = await issueMailRelayToken(db as any, 'tenant-1', 'user-1');
    expect(token).toMatch(/^mail_at_/);
    const resolved = await resolveMailRelayToken(db as any, token);
    expect(resolved).toEqual({ tenantId: 'tenant-1', userId: 'user-1' });
  });

  it('refuse un jeton déjà consommé (usage unique)', async () => {
    const db = new FakeSupabaseAdmin();
    const token = await issueMailRelayToken(db as any, 'tenant-1', 'user-1');
    const first = await resolveMailRelayToken(db as any, token);
    expect(first).not.toBeNull();
    const second = await resolveMailRelayToken(db as any, token);
    expect(second).toBeNull();
  });

  it('refuse un jeton expiré', async () => {
    const db = new FakeSupabaseAdmin();
    const token = await issueMailRelayToken(db as any, 'tenant-1', 'user-1');
    const row = db.getTable('agent_mail_relay_tokens')[0];
    row.expires_at = new Date(Date.now() - 1000).toISOString();
    const resolved = await resolveMailRelayToken(db as any, token);
    expect(resolved).toBeNull();
  });

  it('refuse un jeton inconnu ou vide', async () => {
    const db = new FakeSupabaseAdmin();
    expect(await resolveMailRelayToken(db as any, 'mail_at_jamais-emis')).toBeNull();
    expect(await resolveMailRelayToken(db as any, '')).toBeNull();
  });

  it('refuse un jeton sans le préfixe attendu (non-régression avec mcp_at_/tg_at_)', async () => {
    const db = new FakeSupabaseAdmin();
    expect(await resolveMailRelayToken(db as any, 'tg_at_quelquechose')).toBeNull();
    expect(await resolveMailRelayToken(db as any, 'mcp_at_quelquechose')).toBeNull();
  });
});
