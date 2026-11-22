// Numéros typés de Google Contacts (mobile, travail, domicile...) : rangés dans les champs de la
// fiche à la réception, renvoyés avec leur type à l'envoi, sans jamais en perdre un.
import { describe, expect, it } from 'vitest';
import { legacyPhoneSlot, phonesForGoogle, phonesFromGoogle, primaryPhone } from '../contactPhones';

describe('legacyPhoneSlot', () => {
  it('06 et 07 sont des mobiles, le reste est un fixe, quelle que soit la mise en forme', () => {
    expect(legacyPhoneSlot('0767702286')).toBe('phone_mobile');
    expect(legacyPhoneSlot('+33 7 67 70 22 86')).toBe('phone_mobile');
    expect(legacyPhoneSlot('06 12 34 56 78')).toBe('phone_mobile');
    expect(legacyPhoneSlot('0033612345678')).toBe('phone_mobile');
    expect(legacyPhoneSlot('03 83 12 34 56')).toBe('phone_work');
    expect(legacyPhoneSlot('+33 3 83 12 34 56')).toBe('phone_work');
    expect(legacyPhoneSlot('')).toBe('phone_work');
  });
});

describe('phonesFromGoogle', () => {
  it('range chaque numéro dans le champ de son type, `phone` suit le mobile', () => {
    const r = phonesFromGoogle([
      { value: '0383123456', type: 'work' },
      { value: '0612345678', type: 'mobile' },
      { value: '0383654321', type: 'workFax' },
      { value: '0145000000', type: 'home' },
    ]);
    expect(r).toMatchObject({
      phone_mobile: '0612345678', phone_work: '0383123456', phone_home: '0145000000',
      phone_fax_work: '0383654321', phone: '0612345678',
    });
  });

  it('un numéro sans type est rangé selon sa forme : mobile ou fixe', () => {
    expect(phonesFromGoogle([{ value: '0767702286' }])).toMatchObject({ phone_mobile: '0767702286', phone: '0767702286' });
    expect(phonesFromGoogle([{ value: '0383123456' }])).toMatchObject({ phone_work: '0383123456', phone: '0383123456' });
  });

  it('un deuxième numéro du même type prend la place libre suivante, sans écraser le premier', () => {
    const r = phonesFromGoogle([{ value: '0611111111', type: 'mobile' }, { value: '0622222222', type: 'mobile' }]);
    expect(r.phone_mobile).toBe('0611111111');
    expect(r.phone_work).toBe('0622222222');
  });

  it('ignore les doublons (même numéro écrit autrement) et les valeurs vides', () => {
    const r = phonesFromGoogle([{ value: '06 12 34 56 78', type: 'mobile' }, { value: '0612345678', type: 'work' }, { value: ' ' }]);
    expect(r.phone_mobile).toBe('06 12 34 56 78');
    expect(r.phone_work).toBe('');
    expect(phonesFromGoogle(undefined).phone).toBe('');
  });

  it('un type personnalisé ou inconnu ne perd pas le numéro', () => {
    expect(phonesFromGoogle([{ value: '0383123456', type: 'Chantier' }]).phone_mobile).toBe('0383123456');
  });
});

describe('phonesForGoogle', () => {
  it('renvoie les numéros avec leur type Google', () => {
    expect(phonesForGoogle({ phone_mobile: '0612345678', phone_work: '0383123456', phone_fax_work: '0383654321', phone: '0612345678' }))
      .toEqual([
        { value: '0612345678', type: 'mobile' },
        { value: '0383123456', type: 'work' },
        { value: '0383654321', type: 'workFax' },
      ]);
  });

  it('une fiche ancienne qui n\'a que `phone` l\'envoie quand même', () => {
    expect(phonesForGoogle({ phone: '0767702286' })).toEqual([{ value: '0767702286' }]);
  });

  it('ne renvoie pas deux fois le même numéro écrit différemment', () => {
    expect(phonesForGoogle({ phone_mobile: '0767702286', phone: '+33 7 67 70 22 86' })).toHaveLength(1);
  });

  it('aller-retour : ce qui part chez Google revient dans les mêmes champs', () => {
    const fiche = {
      phone_mobile: '0612345678', phone_work: '0383123456', phone_home: '', phone_main: '',
      phone_fax_work: '0383654321', phone_fax_home: '', phone_pager: '', phone_other: '', phone: '0612345678',
    };
    expect(phonesFromGoogle(phonesForGoogle(fiche))).toEqual(fiche);
  });
});

describe('primaryPhone', () => {
  it('mobile d\'abord, puis travail, puis domicile', () => {
    expect(primaryPhone({ phone_work: '0383', phone_home: '0145' })).toBe('0383');
    expect(primaryPhone({})).toBe('');
  });
});
