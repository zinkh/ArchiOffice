// Adresses e-mail typées de Google Contacts (Travail, Domicile, Autre) : la synchro doit les
// ranger dans les champs de la fiche et les renvoyer avec leur type, sans jamais en perdre.
import { describe, expect, it } from 'vitest';
import { allGoogleEmails, buildSyncIndex, emailsForGoogle, emailsFromGoogle, findExistingContact } from '../server/contactSyncMatch';

describe('emailsFromGoogle', () => {
  it('range le travail et le domicile dans leurs champs, `email` suit le travail', () => {
    expect(emailsFromGoogle([
      { value: 'perso@gmail.com', type: 'home' },
      { value: 'pro@agence.fr', type: 'work' },
    ])).toEqual({ email_work: 'pro@agence.fr', email_home: 'perso@gmail.com', email_other: '', email: 'pro@agence.fr' });
  });

  it('une adresse sans type prend la première place libre, le travail d\'abord', () => {
    expect(emailsFromGoogle([{ value: 'a@x.fr' }])).toMatchObject({ email_work: 'a@x.fr', email: 'a@x.fr' });
    expect(emailsFromGoogle([{ value: 'a@x.fr', type: 'work' }, { value: 'b@x.fr' }]))
      .toMatchObject({ email_work: 'a@x.fr', email_home: 'b@x.fr' });
  });

  it('une deuxième adresse du même type ne remplace jamais la première', () => {
    const r = emailsFromGoogle([{ value: 'a@x.fr', type: 'work' }, { value: 'b@x.fr', type: 'work' }]);
    expect(r.email_work).toBe('a@x.fr');
    expect(r.email_home).toBe('b@x.fr');
  });

  it('ignore les doublons et les valeurs vides, sans planter sur une liste absente', () => {
    expect(emailsFromGoogle([{ value: 'A@x.fr', type: 'work' }, { value: 'a@x.fr', type: 'home' }, { value: '  ' }]))
      .toMatchObject({ email_work: 'A@x.fr', email_home: '', email_other: '' });
    expect(emailsFromGoogle(undefined).email).toBe('');
  });
});

describe('emailsForGoogle', () => {
  it('renvoie les adresses avec leur type', () => {
    expect(emailsForGoogle({ email_work: 'pro@agence.fr', email_home: 'perso@gmail.com', email: 'pro@agence.fr' }))
      .toEqual([{ value: 'pro@agence.fr', type: 'work' }, { value: 'perso@gmail.com', type: 'home' }]);
  });

  it('une fiche ancienne qui n\'a que `email` l\'envoie quand même', () => {
    expect(emailsForGoogle({ email: 'ancienne@x.fr' })).toEqual([{ value: 'ancienne@x.fr' }]);
  });

  it('aller-retour : ce qui part chez Google revient dans les mêmes champs', () => {
    const fiche = { email_work: 'pro@agence.fr', email_home: 'perso@gmail.com', email_other: '', email: 'pro@agence.fr' };
    expect(emailsFromGoogle(emailsForGoogle(fiche))).toEqual(fiche);
  });
});

describe('rapprochement par e-mail', () => {
  it('retrouve une fiche par n\'importe laquelle des adresses du contact Google', () => {
    const index = buildSyncIndex([{ id: 'f', email_home: 'perso@gmail.com', created_at: '2026-01-01T00:00:00Z' }]);
    const g = emailsFromGoogle([{ value: 'pro@agence.fr', type: 'work' }, { value: 'perso@gmail.com', type: 'home' }]);
    expect(findExistingContact(index, { first_name: 'X', ...g })?.id).toBe('f');
  });

  it('allGoogleEmails liste toutes les adresses non vides', () => {
    expect(allGoogleEmails([{ value: 'a@x.fr' }, { value: ' ' }, { value: 'b@x.fr' }])).toEqual(['a@x.fr', 'b@x.fr']);
  });
});
