// Rapprochement des contacts importés (Google Contacts, CardDAV) : une synchronisation rejouée
// ne doit jamais recréer une fiche déjà là, avec ou sans e-mail.
import { describe, expect, it } from 'vitest';
import { addToSyncIndex, buildSyncIndex, findExistingContact, nonEmptyFields, type SyncContactRow } from '../server/contactSyncMatch';

const row = (id: string, extra: Partial<SyncContactRow> = {}): SyncContactRow => ({ id, first_name: '', last_name: '', created_at: '2026-01-01T00:00:00Z', ...extra });

describe('rapprochement des contacts importés', () => {
  it('retrouve une société SANS e-mail par son nom (la cause des doublons à chaque synchro)', () => {
    const index = buildSyncIndex([row('soc', { company_name: 'SOCOTEC' })]);
    expect(findExistingContact(index, { resourceName: 'people/c1', company_name: 'Socotec', email: '' })?.id).toBe('soc');
  });

  it('retrouve par identifiant Google d\'abord, même si le nom a changé', () => {
    const index = buildSyncIndex([row('a', { company_name: 'Ancien nom', google_resource_name: 'people/c9' })]);
    expect(findExistingContact(index, { resourceName: 'people/c9', company_name: 'Nouveau nom' })?.id).toBe('a');
  });

  it('retrouve par e-mail sans tenir compte de la casse, dans les trois champs', () => {
    const index = buildSyncIndex([row('p', { first_name: 'Claire', last_name: 'Aubry', email_work: 'Claire@Selia.fr' })]);
    expect(findExistingContact(index, { email: 'claire@selia.FR', first_name: 'C.', last_name: 'A.' })?.id).toBe('p');
  });

  it('retrouve une personne quel que soit l\'ordre prénom / nom', () => {
    const index = buildSyncIndex([row('p', { first_name: 'Samir', last_name: 'Cheradi' })]);
    expect(findExistingContact(index, { first_name: 'CHERADI', last_name: 'samir' })?.id).toBe('p');
  });

  it('plusieurs fiches locales identiques : la plus ancienne est choisie, jamais une erreur', () => {
    const index = buildSyncIndex([
      row('recent', { email: 'a@b.fr', created_at: '2026-06-01T00:00:00Z' }),
      row('ancien', { email: 'a@b.fr', created_at: '2026-01-01T00:00:00Z' }),
      row('milieu', { email: 'a@b.fr', created_at: '2026-03-01T00:00:00Z' }),
    ]);
    expect(findExistingContact(index, { email: 'a@b.fr' })?.id).toBe('ancien');
  });

  it('ne rapproche jamais un contact personnel, ni un nom trop court pour être fiable', () => {
    const index = buildSyncIndex([row('perso', { company_name: 'Famille Martin', is_personal: true }), row('ab', { company_name: 'AB' })]);
    expect(findExistingContact(index, { company_name: 'Famille Martin' })).toBeUndefined();
    expect(findExistingContact(index, { company_name: 'AB' })).toBeUndefined();
  });

  it('une fiche créée pendant le passage est retrouvée par la suivante (même nom côté Google)', () => {
    const index = buildSyncIndex([]);
    expect(findExistingContact(index, { company_name: 'LCR' })).toBeUndefined();
    addToSyncIndex(index, row('nouvelle', { company_name: 'LCR', google_resource_name: 'people/c1' }));
    expect(findExistingContact(index, { resourceName: 'people/c2', company_name: 'LCR' })?.id).toBe('nouvelle');
  });

  it('une valeur importée vide n\'efface rien', () => {
    expect(nonEmptyFields({ first_name: '', email: 'a@b.fr', phone: '', city: null as any })).toEqual({ email: 'a@b.fr' });
  });
});

// Régression de bout en bout : deux synchronisations de suite ne créent aucun doublon,
// y compris pour une société Google sans e-mail ni nom de personne.
import { afterEach, beforeAll, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

describe('POST /api/sync/google-contacts rejoué', () => {
  let app: Express;
  const realFetch = global.fetch;
  beforeAll(async () => { app = await getTestApp(); });
  afterEach(() => { global.fetch = realFetch; });

  it('ne recrée pas les sociétés sans e-mail ni les fiches déjà liées', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/people/me/connections')) {
        return { ok: true, json: async () => ({ connections: [
          { resourceName: 'people/c1', organizations: [{ name: 'SOCOTEC' }] },
          { resourceName: 'people/c2', names: [{ givenName: 'Samir', familyName: 'Cheradi' }], emailAddresses: [{ value: 'samir@example.com' }] },
          { resourceName: 'people/c3', names: [{ givenName: 'Samir', familyName: 'Cheradi' }], emailAddresses: [{ value: 'SAMIR@example.com' }] },
        ] }) };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as any;
    const sync = () => request(app).post('/api/sync/google-contacts').set(authHeader(token)).send({ access_token: 'tok' });
    const count = () => fakeSupabaseAdmin.getTable('contacts').filter(c => c.tenant_id === tenantId).length;

    const first = await sync();
    expect(first.body).toMatchObject({ imported: 2, updated: 1 }); // c3 retrouve la fiche créée pour c2
    expect(count()).toBe(2);
    const second = await sync();
    expect(second.body).toMatchObject({ imported: 0, updated: 3 });
    expect(count()).toBe(2);
  });
});
