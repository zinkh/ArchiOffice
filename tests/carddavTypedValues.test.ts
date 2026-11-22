// CardDAV : les e-mails et téléphones d'une vCard sont lus avec leur type et rangés dans les mêmes
// champs de la fiche que ceux de Google Contacts (travail, domicile, mobile...), sans en perdre.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import dns from 'dns/promises';
import { vcardTypedValues } from '../server/vcardTypedValues';
import { emailsFromGoogle } from '../server/contactSyncMatch';
import { phonesFromGoogle } from '../src/lib/contactPhones';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

describe('vcardTypedValues', () => {
  it('lit chaque e-mail avec son type', () => {
    const v = 'BEGIN:VCARD\nEMAIL;TYPE=INTERNET,WORK:pro@agence.fr\nEMAIL;TYPE=HOME:perso@gmail.com\nEND:VCARD';
    expect(vcardTypedValues(v, 'EMAIL')).toEqual([
      { value: 'pro@agence.fr', type: 'work' },
      { value: 'perso@gmail.com', type: 'home' },
    ]);
  });

  it('lit les téléphones : mobile, fixe, fax, et la forme vCard 2.1 sans TYPE=', () => {
    const v = [
      'TEL;TYPE=CELL:0612345678',
      'TEL;TYPE=WORK,VOICE:0383123456',
      'TEL;TYPE=WORK,FAX:0383654321',
      'TEL;HOME;VOICE:0145000000',
      'TEL;TYPE=PAGER:0600000001',
    ].join('\r\n');
    expect(vcardTypedValues(v, 'TEL')).toEqual([
      { value: '0612345678', type: 'mobile' },
      { value: '0383123456', type: 'work' },
      { value: '0383654321', type: 'workFax' },
      { value: '0145000000', type: 'home' },
      { value: '0600000001', type: 'pager' },
    ]);
  });

  it('une ligne sans type garde sa valeur sans type, comme l\'ancien lecteur', () => {
    expect(vcardTypedValues('EMAIL:jean@example.com\nTEL:0600000000', 'EMAIL')).toEqual([{ value: 'jean@example.com' }]);
    expect(vcardTypedValues('EMAIL:jean@example.com\nTEL:0600000000', 'TEL')).toEqual([{ value: '0600000000' }]);
  });

  it('gère le préfixe de groupe d\'Apple, le schéma tel: et les lignes repliées', () => {
    const v = 'item1.EMAIL;type=INTERNET;type=HOME;type=pref:perso@gmail.com\r\nTEL;VALUE=uri;TYPE="work,voice":tel:+33 3 83 12\r\n 34 56';
    expect(vcardTypedValues(v, 'EMAIL')).toEqual([{ value: 'perso@gmail.com', type: 'home' }]);
    expect(vcardTypedValues(v, 'TEL')).toEqual([{ value: '+33 3 83 1234 56', type: 'work' }]);
  });

  it('ne confond pas EMAIL avec une autre propriété ni TEL avec TELEX', () => {
    expect(vcardTypedValues('X-EMAIL-NOTE:a@x.fr\nTELEX:123', 'EMAIL')).toEqual([]);
    expect(vcardTypedValues('TELEX:123', 'TEL')).toEqual([]);
  });

  it('une vCard lue puis rangée donne les mêmes champs que Google', () => {
    const v = 'EMAIL;TYPE=HOME:perso@gmail.com\nEMAIL;TYPE=WORK:pro@agence.fr\nTEL;TYPE=CELL:0612345678\nTEL;TYPE=WORK:0383123456';
    expect(emailsFromGoogle(vcardTypedValues(v, 'EMAIL'))).toMatchObject({ email_work: 'pro@agence.fr', email_home: 'perso@gmail.com', email: 'pro@agence.fr' });
    expect(phonesFromGoogle(vcardTypedValues(v, 'TEL'))).toMatchObject({ phone_mobile: '0612345678', phone_work: '0383123456', phone: '0612345678' });
  });
});

describe('POST /api/sync/carddav avec des valeurs typées', () => {
  let app: Express;
  const originalFetch = global.fetch;
  beforeAll(async () => { app = await getTestApp(); });
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

  const sync = (token: string, vcard: string) => {
    global.fetch = vi.fn(async () => ({ ok: true, text: async () => vcard })) as any;
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);
    return request(app).post('/api/sync/carddav').set(authHeader(token))
      .send({ url: 'https://carddav.example.com', username: 'u', password: 'p' });
  };

  it('range travail et personnel, mobile et fixe, dans leurs champs', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const vcard = 'BEGIN:VCARD\nFN:Claire Aubry\nN:Aubry;Claire\nEMAIL;TYPE=HOME:perso@gmail.com\nEMAIL;TYPE=WORK:pro@agence.fr\nTEL;TYPE=CELL:0612345678\nTEL;TYPE=WORK:0383123456\nEND:VCARD';
    const res = await sync(token, vcard);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ imported: 1, updated: 0 });
    const c = fakeSupabaseAdmin.getTable('contacts').find(r => r.tenant_id === tenantId && r.last_name === 'Aubry');
    expect(c).toMatchObject({
      email_work: 'pro@agence.fr', email_home: 'perso@gmail.com', email: 'pro@agence.fr',
      phone_mobile: '0612345678', phone_work: '0383123456', phone: '0612345678',
    });
  });

  it('retrouve la fiche par l\'adresse personnelle et ne lui efface rien', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('contacts', [{
      id: 'c-keep', tenant_id: tenantId, first_name: 'Claire', last_name: 'Aubry',
      email_home: 'perso@gmail.com', phone_home: '0145000000', phone: '0145000000', created_at: '2026-01-01T00:00:00Z',
    }]);
    const vcard = 'BEGIN:VCARD\nFN:Claire Aubry\nN:Aubry;Claire\nEMAIL;TYPE=HOME:perso@gmail.com\nTEL;TYPE=CELL:0612345678\nEND:VCARD';
    const res = await sync(token, vcard);
    expect(res.body).toMatchObject({ imported: 0, updated: 1 });
    expect(fakeSupabaseAdmin.getTable('contacts').find(r => r.id === 'c-keep')).toMatchObject({
      email_home: 'perso@gmail.com', phone_home: '0145000000', phone_mobile: '0612345678',
    });
  });
});
