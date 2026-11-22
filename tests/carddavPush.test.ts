// Envoi ArchiOffice -> CardDAV : fabrication de la vCard, lecture de la réponse du serveur,
// décision d'importer ou d'envoyer, et la route de bout en bout contre un serveur simulé.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import dns from 'dns/promises';
import { buildVcard, escapeVcardText } from '../server/vcardBuild';
import { collectionPrefix, decidePull, parseCardMultistatus, resolveCardHref } from '../server/carddavSync';
import { splitVcardValue, vcardTypedValues } from '../server/vcardTypedValues';
import { emailsFromGoogle } from '../server/contactSyncMatch';
import { phonesFromGoogle } from '../src/lib/contactPhones';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

describe('buildVcard', () => {
  const base = { id: 'c-1', first_name: 'Claire', last_name: 'Aubry', company_name: 'Atelier Aubry', job_title: 'Gérante' };

  it('écrit l\'identité, la société et les valeurs typées', () => {
    const v = buildVcard({ ...base, email_work: 'pro@agence.fr', email_home: 'perso@gmail.com', phone_mobile: '0612345678', phone_work: '0383123456' }, new Date('2026-06-01T10:00:00Z'));
    expect(v).toContain('BEGIN:VCARD\r\nVERSION:3.0');
    expect(v).toContain('UID:c-1');
    expect(v).toContain('FN:Claire Aubry');
    expect(v).toContain('N:Aubry;Claire;;;');
    expect(v).toContain('ORG:Atelier Aubry');
    expect(v).toContain('TITLE:Gérante');
    expect(v).toContain('EMAIL;TYPE=INTERNET,WORK:pro@agence.fr');
    expect(v).toContain('EMAIL;TYPE=INTERNET,HOME:perso@gmail.com');
    expect(v).toContain('TEL;TYPE=CELL:0612345678');
    expect(v).toContain('TEL;TYPE=WORK,VOICE:0383123456');
    expect(v).toContain('REV:20260601T100000Z');
    expect(v.endsWith('END:VCARD\r\n')).toBe(true);
  });

  it('aller-retour : la vCard fabriquée se relit dans les mêmes champs', () => {
    const fiche = { ...base, email_work: 'pro@agence.fr', email_home: 'perso@gmail.com', phone_mobile: '0612345678', phone_work: '0383123456', phone_fax_work: '0383654321' };
    const v = buildVcard(fiche);
    expect(emailsFromGoogle(vcardTypedValues(v, 'EMAIL'))).toMatchObject({ email_work: 'pro@agence.fr', email_home: 'perso@gmail.com' });
    expect(phonesFromGoogle(vcardTypedValues(v, 'TEL'))).toMatchObject({ phone_mobile: '0612345678', phone_work: '0383123456', phone_fax_work: '0383654321' });
  });

  it('une fiche ancienne qui n\'a que `email` et `phone` les envoie quand même', () => {
    const v = buildVcard({ id: 'c-2', last_name: 'Ancien', email: 'ancien@x.fr', phone: '0145000000' });
    expect(v).toContain('EMAIL;TYPE=INTERNET:ancien@x.fr');
    expect(v).toContain('TEL:0145000000');
  });

  it('une société sans nom de personne est marquée comme société', () => {
    const v = buildVcard({ id: 'c-3', company_name: 'SOCOTEC' });
    expect(v).toContain('FN:SOCOTEC');
    expect(v).toContain('N:;;;;');
    expect(v).toContain('X-ABShowAs:COMPANY');
  });

  it('échappe les caractères spéciaux et les relit à l\'identique', () => {
    expect(escapeVcardText('A, B; C\\D\nE')).toBe('A\\, B\\; C\\\\D\\nE');
    expect(splitVcardValue(escapeVcardText('Dupont, Fils; SARL'))).toEqual(['Dupont, Fils; SARL']);
    expect(splitVcardValue('Aubry;Claire;;;')).toEqual(['Aubry', 'Claire', '', '', '']);
  });

  it('replie les lignes longues à 75 caractères sans rien perdre', () => {
    const title = 'Architecte DPLG, urbaniste et expert près la cour d\'appel de Nancy, '.repeat(3);
    const v = buildVcard({ ...base, job_title: title });
    for (const line of v.split('\r\n')) expect(Array.from(line).length).toBeLessThanOrEqual(75);
    expect(v.replace(/\r\n /g, '')).toContain(`TITLE:${escapeVcardText(title.trim())}`);
  });
});

describe('parseCardMultistatus', () => {
  const vcard = 'BEGIN:VCARD\nFN:Claire Aubry\nEMAIL:c@x.fr\nEND:VCARD';

  it('lit l\'adresse, l\'ETag, la date et la vCard, quel que soit le préfixe d\'espace de noms', () => {
    const xml = `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
      <D:response><D:href>/ab/contacts/</D:href><D:propstat><D:prop><D:getetag>"coll"</D:getetag></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
      <D:response><D:href>/ab/contacts/a.vcf</D:href><D:propstat><D:prop><D:getetag>"e1"</D:getetag><D:getlastmodified>Mon, 01 Jun 2026 10:00:00 GMT</D:getlastmodified><C:address-data>${vcard}</C:address-data></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
    </D:multistatus>`;
    const cards = parseCardMultistatus(xml);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ href: '/ab/contacts/a.vcf', etag: '"e1"', modified: Date.parse('2026-06-01T10:00:00Z') });
    expect(cards[0].vcard).toContain('FN:Claire Aubry');
  });

  it('décode les entités XML de la vCard', () => {
    const xml = '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/a.vcf</d:href><d:propstat><d:prop><d:getetag>"e"</d:getetag><d:address-data>BEGIN:VCARD&#13;\nFN:Dupont &amp; Fils&#13;\nEND:VCARD</d:address-data></d:prop></d:propstat></d:response></d:multistatus>';
    expect(parseCardMultistatus(xml)[0].vcard).toContain('FN:Dupont & Fils');
  });

  it('une réponse qui n\'est pas du XML est lue comme avant, sans adresse', () => {
    const cards = parseCardMultistatus(`${vcard}\n${vcard}`);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ href: '', etag: '', modified: null });
  });
});

describe('adresses de vCards', () => {
  const prefix = collectionPrefix('https://dav.example.com/ab/contacts');

  it('le carnet se termine par une barre', () => {
    expect(prefix).toBe('https://dav.example.com/ab/contacts/');
    expect(collectionPrefix('https://dav.example.com/ab/contacts/?x=1')).toBe('https://dav.example.com/ab/contacts/');
  });

  it('accepte une adresse du carnet, relative ou absolue', () => {
    expect(resolveCardHref('/ab/contacts/a.vcf', prefix)).toBe('https://dav.example.com/ab/contacts/a.vcf');
    expect(resolveCardHref('https://dav.example.com/ab/contacts/b.vcf', prefix)).toBe('https://dav.example.com/ab/contacts/b.vcf');
  });

  it('refuse une adresse qui sort du carnet : autre hôte, autre dossier, ou le carnet lui-même', () => {
    expect(resolveCardHref('https://evil.example.com/ab/contacts/a.vcf', prefix)).toBeNull();
    expect(resolveCardHref('/ab/autre/a.vcf', prefix)).toBeNull();
    expect(resolveCardHref('/ab/contacts/', prefix)).toBeNull();
    expect(resolveCardHref('', prefix)).toBeNull();
    expect(resolveCardHref(null, prefix)).toBeNull();
  });
});

describe('decidePull', () => {
  const t = (iso: string) => Date.parse(iso);
  const linked = { linked: true, pushEnabled: true, localEtag: '"e1"', remoteEtag: '"e1"', localUpdatedAt: t('2026-06-01T10:00:00Z'), syncedAt: t('2026-06-01T10:00:00Z'), remoteModified: null };

  it('une fiche pas encore reliée à cette vCard est importée (comportement d\'avant)', () => {
    expect(decidePull({ ...linked, linked: false })).toBe('pull');
  });
  it('vCard inchangée depuis le dernier échange : rien à faire', () => {
    expect(decidePull(linked)).toBe('skip_unchanged');
  });
  it('vCard changée côté serveur seulement : importée', () => {
    expect(decidePull({ ...linked, remoteEtag: '"e2"' })).toBe('pull');
  });
  it('ETag inconnu d\'un côté : on considère la vCard changée', () => {
    expect(decidePull({ ...linked, localEtag: null })).toBe('pull');
  });
  it('changée des deux côtés : la plus récente l\'emporte', () => {
    const both = { ...linked, remoteEtag: '"e2"', localUpdatedAt: t('2026-06-02T10:00:00Z') };
    expect(decidePull({ ...both, remoteModified: t('2026-06-03T10:00:00Z') })).toBe('pull');
    expect(decidePull({ ...both, remoteModified: t('2026-06-01T12:00:00Z') })).toBe('local_wins');
  });
  it('changée des deux côtés sans date serveur : on ne tranche pas', () => {
    expect(decidePull({ ...linked, remoteEtag: '"e2"', localUpdatedAt: t('2026-06-02T10:00:00Z') })).toBe('conflict');
  });
  it('catégorie non envoyée : une modification locale ne protège rien, le serveur l\'emporte', () => {
    expect(decidePull({ ...linked, pushEnabled: false, remoteEtag: '"e2"', localUpdatedAt: t('2026-06-02T10:00:00Z') })).toBe('pull');
  });
});

describe('POST /api/sync/carddav : envoi', () => {
  let app: Express;
  const originalFetch = global.fetch;
  const COLLECTION = 'https://dav.example.com/ab/contacts';
  const SYNCED = '2026-06-01T10:00:00.000Z';
  const AFTER = '2026-06-02T10:00:00.000Z';
  beforeAll(async () => { app = await getTestApp(); });
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

  interface RemoteCard { href: string; etag: string; vcard: string; modified?: string }
  const xmlOf = (cards: RemoteCard[]) =>
    `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">${cards.map(c =>
      `<d:response><d:href>${c.href}</d:href><d:propstat><d:prop><d:getetag>${c.etag}</d:getetag>${c.modified ? `<d:getlastmodified>${c.modified}</d:getlastmodified>` : ''}<card:address-data>${c.vcard}</card:address-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join('')}</d:multistatus>`;
  const card = (n: string, etag = '"e1"', extra = '', modified?: string): RemoteCard => ({
    href: `/ab/contacts/${n}.vcf`, etag, modified,
    vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Claire Aubry\nN:Aubry;Claire;;;\nEMAIL;TYPE=WORK:pro@agence.fr\n${extra}END:VCARD`,
  });

  interface Put { url: string; headers: Record<string, string>; body: string }
  const run = async (token: string, cards: RemoteCard[], putStatus = 201) => {
    const puts: Put[] = [];
    global.fetch = vi.fn(async (u: any, init?: any) => {
      if (init?.method === 'PROPFIND') return { ok: true, text: async () => xmlOf(cards) };
      if (init?.method === 'PUT') {
        puts.push({ url: String(u), headers: init.headers, body: String(init.body) });
        return { status: putStatus, headers: { get: (h: string) => (h.toLowerCase() === 'etag' ? '"new1"' : null) } };
      }
      throw new Error(`appel inattendu : ${init?.method} ${u}`);
    }) as any;
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);
    const res = await request(app).post('/api/sync/carddav').set(authHeader(token)).send({ url: COLLECTION, username: 'u', password: 'p' });
    return { res, puts };
  };
  const setup = (rows: Record<string, any>[], categories: string[] | null = ['Client']) => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    if (categories) fakeSupabaseAdmin.seed('settings', [{ id: `s-${tenantId}`, tenant_id: tenantId, carddav_sync_categories: categories }]);
    fakeSupabaseAdmin.seed('contacts', rows.map(r => ({ tenant_id: tenantId, created_at: '2026-01-01T00:00:00Z', ...r })));
    const row = (id: string) => fakeSupabaseAdmin.getTable('contacts').find(c => c.id === id && c.tenant_id === tenantId)!;
    return { tenantId, token, row };
  };
  const mine = { category: 'Client', first_name: 'Claire', last_name: 'Aubry', email_work: 'pro@agence.fr' };

  it('sans catégorie cochée, rien n\'est envoyé (l\'import n\'est pas touché)', async () => {
    const { token } = setup([{ id: 'c-a', ...mine, updated_at: AFTER }], null);
    const { res, puts } = await run(token, []);
    expect(res.status).toBe(200);
    expect(puts).toHaveLength(0);
    expect(res.body).toMatchObject({ pushedCreated: 0, pushedUpdated: 0, pushUnavailable: false });
  });

  it('crée la vCard d\'un contact jamais envoyé, sans écraser un fichier existant', async () => {
    const { token, row } = setup([{ id: 'c-new', ...mine, phone_mobile: '0612345678', updated_at: AFTER }]);
    const { res, puts } = await run(token, []);
    expect(res.body).toMatchObject({ pushedCreated: 1, pushedUpdated: 0 });
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toBe('https://dav.example.com/ab/contacts/c-new.vcf');
    expect(puts[0].headers['If-None-Match']).toBe('*');
    expect(puts[0].headers['If-Match']).toBeUndefined();
    expect(puts[0].headers.Authorization).toMatch(/^Basic /);
    expect(puts[0].body).toContain('UID:c-new');
    expect(puts[0].body).toContain('EMAIL;TYPE=INTERNET,WORK:pro@agence.fr');
    expect(puts[0].body).toContain('TEL;TYPE=CELL:0612345678');
    expect(row('c-new')).toMatchObject({ carddav_href: 'https://dav.example.com/ab/contacts/c-new.vcf', carddav_etag: '"new1"' });
    expect(row('c-new').carddav_synced_at).toBeTruthy();
  });

  it('n\'envoie jamais un contact personnel ni une catégorie non cochée', async () => {
    const { token } = setup([
      { id: 'c-perso', ...mine, is_personal: true, updated_at: AFTER },
      { id: 'c-autre', ...mine, category: 'Fournisseur', updated_at: AFTER },
    ]);
    const { puts } = await run(token, []);
    expect(puts).toHaveLength(0);
  });

  it('met à jour une vCard reliée modifiée en local, protégée par l\'ETag courant', async () => {
    const href = 'https://dav.example.com/ab/contacts/a.vcf';
    const { token, row } = setup([{ id: 'c-a', ...mine, carddav_href: href, carddav_etag: '"e1"', carddav_synced_at: SYNCED, updated_at: AFTER }]);
    const { res, puts } = await run(token, [card('a', '"e1"')]);
    expect(res.body).toMatchObject({ pushedCreated: 0, pushedUpdated: 1 });
    expect(puts[0].url).toBe(href);
    expect(puts[0].headers['If-Match']).toBe('"e1"');
    expect(puts[0].headers['If-None-Match']).toBeUndefined();
    expect(row('c-a').carddav_etag).toBe('"new1"');
  });

  it('une vCard reliée et inchangée des deux côtés ne déclenche aucun envoi ni aucune écriture', async () => {
    const href = 'https://dav.example.com/ab/contacts/a.vcf';
    const { token, row } = setup([{ id: 'c-a', ...mine, first_name: 'Local', carddav_href: href, carddav_etag: '"e1"', carddav_synced_at: SYNCED, updated_at: SYNCED }]);
    const { res, puts } = await run(token, [card('a', '"e1"')]);
    expect(puts).toHaveLength(0);
    expect(res.body).toMatchObject({ imported: 0, updated: 0 });
    expect(row('c-a').first_name).toBe('Local');
  });

  it('importe une vCard modifiée sur le serveur quand la fiche n\'a rien en attente, sans l\'écraser ensuite', async () => {
    const href = 'https://dav.example.com/ab/contacts/a.vcf';
    const { token, row } = setup([{ id: 'c-a', ...mine, first_name: 'Ancien', carddav_href: href, carddav_etag: '"e1"', carddav_synced_at: SYNCED, updated_at: SYNCED }]);
    const { res, puts } = await run(token, [card('a', '"e2"')]);
    expect(res.body).toMatchObject({ updated: 1, pushedUpdated: 0 });
    expect(puts).toHaveLength(0);
    expect(row('c-a')).toMatchObject({ first_name: 'Claire', carddav_etag: '"e2"' });
  });

  it('modifiée des deux côtés sans date serveur : rien n\'est écrasé, le conflit est compté', async () => {
    const href = 'https://dav.example.com/ab/contacts/a.vcf';
    const { token, row } = setup([{ id: 'c-a', ...mine, first_name: 'Local', carddav_href: href, carddav_etag: '"e1"', carddav_synced_at: SYNCED, updated_at: AFTER }]);
    const { res, puts } = await run(token, [card('a', '"e2"')]);
    expect(res.body).toMatchObject({ pushConflicts: 1, pushedUpdated: 0, updated: 0 });
    expect(puts).toHaveLength(0);
    expect(row('c-a').first_name).toBe('Local');
  });

  it('modifiée des deux côtés : le plus récent l\'emporte', async () => {
    const href = 'https://dav.example.com/ab/contacts/a.vcf';
    // Le serveur a changé avant la modification locale : la fiche locale l'emporte et part avec l'ETag courant.
    const a = setup([{ id: 'c-a', ...mine, first_name: 'Local', carddav_href: href, carddav_etag: '"e1"', carddav_synced_at: SYNCED, updated_at: AFTER }]);
    const localWins = await run(a.token, [card('a', '"e2"', '', 'Mon, 01 Jun 2026 12:00:00 GMT')]);
    expect(localWins.res.body).toMatchObject({ pushedUpdated: 1, updated: 0 });
    expect(localWins.puts[0].headers['If-Match']).toBe('"e2"');
    expect(a.row('c-a').first_name).toBe('Local');
    // Le serveur a changé après : sa version est importée, rien n'est envoyé.
    const b = setup([{ id: 'c-b', ...mine, first_name: 'Local', carddav_href: href, carddav_etag: '"e1"', carddav_synced_at: SYNCED, updated_at: AFTER }]);
    const remoteWins = await run(b.token, [card('a', '"e2"', '', 'Fri, 05 Jun 2026 12:00:00 GMT')]);
    expect(remoteWins.res.body).toMatchObject({ pushedUpdated: 0, updated: 1 });
    expect(remoteWins.puts).toHaveLength(0);
    expect(b.row('c-b').first_name).toBe('Claire');
  });

  it('un 412 du serveur est un conflit, jamais forcé', async () => {
    const href = 'https://dav.example.com/ab/contacts/a.vcf';
    const { token } = setup([{ id: 'c-a', ...mine, carddav_href: href, carddav_etag: '"e1"', carddav_synced_at: SYNCED, updated_at: AFTER }]);
    const { res, puts } = await run(token, [card('a', '"e1"')], 412);
    expect(puts).toHaveLength(1);
    expect(res.body).toMatchObject({ pushConflicts: 1, pushedUpdated: 0, pushFailed: 0 });
  });

  it('une erreur du serveur est comptée sans interrompre les autres envois', async () => {
    const { token } = setup([{ id: 'c-a', ...mine, updated_at: AFTER }, { id: 'c-b', ...mine, last_name: 'Autre', email_work: 'b@x.fr', updated_at: AFTER }]);
    const { res, puts } = await run(token, [], 500);
    expect(puts).toHaveLength(2);
    expect(res.body).toMatchObject({ pushFailed: 2, pushedCreated: 0 });
  });

  it('une vCard dont l\'adresse sort du carnet n\'est jamais reliée ni écrite : l\'envoi reste dans le carnet choisi', async () => {
    const { token, row } = setup([{ id: 'c-a', ...mine, updated_at: SYNCED }]);
    const evil: RemoteCard = { ...card('a'), href: 'https://evil.example.com/steal.vcf' };
    const { res, puts } = await run(token, [evil]);
    expect(res.status).toBe(200);
    expect(row('c-a').carddav_href ?? '').not.toContain('evil.example.com');
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toBe('https://dav.example.com/ab/contacts/c-a.vcf');
  });

  it('relie à l\'import la fiche trouvée par adresse e-mail, pour ne plus la recréer', async () => {
    const { token, row } = setup([{ id: 'c-a', ...mine, updated_at: SYNCED }]);
    const { res, puts } = await run(token, [card('a', '"e1"')]);
    expect(res.body).toMatchObject({ updated: 1, pushedCreated: 0 });
    expect(puts).toHaveLength(0);
    expect(row('c-a')).toMatchObject({ carddav_href: 'https://dav.example.com/ab/contacts/a.vcf', carddav_etag: '"e1"' });
  });

  it('importe une société sans la ranger comme nom de famille', async () => {
    const { token, tenantId } = setup([], null);
    const company: RemoteCard = { href: '/ab/contacts/s.vcf', etag: '"s1"', vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:SOCOTEC\nN:;;;;\nORG:SOCOTEC\nEND:VCARD' };
    await run(token, [company]);
    const created = fakeSupabaseAdmin.getTable('contacts').find(c => c.tenant_id === tenantId && c.company_name === 'SOCOTEC');
    expect(created).toMatchObject({ company_name: 'SOCOTEC', last_name: '' });
  });
});
