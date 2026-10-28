import { describe, expect, it } from 'vitest';
import {
  buildMergePlan, contactName, findDuplicateGroups, isMergeConfirmed, nameKey, normalizeSiret, resolveMergePatch, suggestPrimary,
  type MergeContact,
} from '../contactMerge';

const c = (id: string, extra: Record<string, any> = {}): MergeContact => ({ id, first_name: '', last_name: '', ...extra });

describe('isMergeConfirmed', () => {
  it('exige le mot FUSIONNER, sans tenir compte de la casse ni des espaces', () => {
    expect(isMergeConfirmed('FUSIONNER')).toBe(true);
    expect(isMergeConfirmed('  fusionner ')).toBe(true);
    expect(isMergeConfirmed('fusion')).toBe(false);
    expect(isMergeConfirmed(undefined)).toBe(false);
  });
});

describe('contactName', () => {
  it('préfère la société, puis la personne, puis l\'e-mail', () => {
    expect(contactName(c('1', { company_name: 'Selia' }))).toBe('Selia');
    expect(contactName(c('2', { first_name: 'Claire', last_name: 'Aubry' }))).toBe('Claire Aubry');
    expect(contactName(c('3', { email: 'a@b.fr' }))).toBe('a@b.fr');
    expect(contactName(c('4'))).toBe('Sans nom');
  });
});

describe('buildMergePlan', () => {
  const list = [
    c('a', { company_name: 'Selia', email: 'a@selia.fr', phone: '' }),
    c('b', { company_name: ' selia ', email: 'b@selia.fr', phone: '0383000001', city: 'Nancy' }),
  ];
  it('ne garde que les champs renseignés et signale les conflits réels', () => {
    const plan = Object.fromEntries(buildMergePlan(list, 'a').map(p => [p.key, p]));
    expect(plan.company_name.conflict).toBe(false); // même valeur à la casse et aux espaces près
    expect(plan.email.conflict).toBe(true);
    expect(plan.phone.conflict).toBe(false);
    expect(plan.phone.pick).toBe('b'); // vide sur la fiche conservée : comblé par l'autre
    expect(plan.city.pick).toBe('b');
    expect(plan.siret).toBeUndefined();
  });
  it('place la fiche conservée en premier : son choix est celui par défaut', () => {
    const plan = buildMergePlan(list, 'b').find(p => p.key === 'email')!;
    expect(plan.values[0].id).toBe('b');
    expect(plan.pick).toBe('b');
  });
});

describe('resolveMergePatch', () => {
  const list = [
    c('a', { company_name: 'Selia', email: 'a@selia.fr', notes: 'Appeler le matin', tags: 'vip, nancy', corps_etat: ['maçonnerie'] }),
    c('b', { company_name: 'SELIA ASSOC.', email: 'b@selia.fr', phone: '0383000001', notes: 'Appeler le matin\n', tags: 'Nancy, bois', corps_etat: ['peinture', 'Maçonnerie'] }),
    c('c', { notes: 'Facture à envoyer à la compta' }),
  ];
  it('comble les vides, respecte les choix et fait l\'union des listes et des notes', () => {
    const patch = resolveMergePatch(list, 'a', { email: 'b', company_name: 'b' });
    expect(patch).toEqual({
      company_name: 'SELIA ASSOC.',
      email: 'b@selia.fr',
      phone: '0383000001',
      tags: 'vip, nancy, bois',
      corps_etat: ['maçonnerie', 'peinture'],
      notes: 'Appeler le matin\n\nFacture à envoyer à la compta',
    });
  });
  it('ignore un choix qui désigne une fiche vide ou inconnue', () => {
    expect(resolveMergePatch(list, 'a', { phone: 'a', email: 'inconnu' }).phone).toBe('0383000001');
    expect(resolveMergePatch(list, 'a', { email: 'inconnu' }).email).toBeUndefined(); // défaut : la fiche conservée
  });
  it('ne rend rien quand rien ne change', () => {
    expect(resolveMergePatch([list[0], c('z')], 'a')).toEqual({});
    expect(resolveMergePatch(list, 'absent')).toEqual({});
  });
});

describe('suggestPrimary', () => {
  it('propose la fiche la plus renseignée, puis la plus gros chiffre d\'affaires', () => {
    expect(suggestPrimary([c('a', { email: 'x@y.fr' }), c('b', { email: 'x@y.fr', phone: '1', city: 'N' })])).toBe('b');
    expect(suggestPrimary([c('a', { email: 'x@y.fr', ca_amount: 10 }), c('b', { email: 'x@y.fr', ca_amount: 500 })])).toBe('b');
  });
});

describe('détection de doublons', () => {
  it('normalise SIRET et noms', () => {
    expect(normalizeSiret('823 456 789 00012')).toBe('82345678900012');
    expect(normalizeSiret('123')).toBe('');
    expect(nameKey(c('1', { company_name: 'SELIA ASSOCIATION' }))).toBe(nameKey(c('2', { company_name: 'Selia Assoc.' })));
    expect(nameKey(c('3', { first_name: 'Claire', last_name: 'Aubry' }))).toBe(nameKey(c('4', { first_name: 'AUBRY', last_name: 'claire' })));
    expect(nameKey(c('5', { company_name: 'AB' }))).toBe(''); // trop court pour être fiable
  });

  it('regroupe par SIRET, e-mail ou nom, en chaîne, avec les motifs', () => {
    const list = [
      c('1', { company_name: 'Selia Association', siret: '823 456 789 00012' }),
      c('2', { company_name: 'Autre nom', siret: '82345678900012', email: 'compta@selia.fr' }),
      c('3', { company_name: 'Troisième', email_work: 'COMPTA@selia.fr' }),
      c('4', { company_name: 'Tasty République' }),
      c('5', { company_name: 'Tasty Republique SARL' }),
      c('6', { company_name: 'Isolé' }),
    ];
    const groups = findDuplicateGroups(list);
    expect(groups).toHaveLength(2);
    const selia = groups.find(g => g.ids.includes('1'))!;
    expect(selia.ids.sort()).toEqual(['1', '2', '3']);
    expect(selia.reasons.sort()).toEqual(['email', 'siret']);
    expect(groups.find(g => g.ids.includes('4'))).toMatchObject({ reasons: ['name'] });
  });

  it('ne confond pas deux personnes d\'une même société, ni un contact personnel', () => {
    const list = [
      c('1', { first_name: 'Claire', last_name: 'Aubry', company_name: 'Selia' }),
      c('2', { first_name: 'Hugo', last_name: 'Perrin', company_name: 'Selia' }),
      c('3', { first_name: 'Claire', last_name: 'Aubry', is_personal: true }),
    ];
    expect(findDuplicateGroups(list)).toEqual([]);
  });
});

import { isSafeDuplicateGroup, planSafeMerges } from '../contactMerge';

describe('fusion automatique des doublons sûrs', () => {
  it('même nom sans conflit : sûr ; téléphones différents ou noms différents : non', () => {
    expect(isSafeDuplicateGroup([{ id: 'a', company_name: 'SOCOTEC' }, { id: 'b', company_name: 'Socotec', email: 'x@y.fr' }])).toBe(true);
    expect(isSafeDuplicateGroup([{ id: 'a', company_name: 'LCR', phone: '1' }, { id: 'b', company_name: 'LCR', phone: '2' }])).toBe(false);
    expect(isSafeDuplicateGroup([{ id: 'a', first_name: 'A', last_name: 'Durand', email: 'z@z.fr' }, { id: 'b', first_name: 'P', last_name: 'Martin', email: 'z@z.fr' }])).toBe(false);
  });

  it('planSafeMerges garde la fiche la plus renseignée comme fiche conservée', () => {
    const { safe, skipped } = planSafeMerges([{ id: 'a', company_name: 'SOCOTEC' }, { id: 'b', company_name: 'Socotec', email: 'x@y.fr', city: 'Nancy' }]);
    expect(skipped).toBe(0);
    expect(safe).toEqual([{ primaryId: 'b', duplicateIds: ['a'] }]);
  });
});
