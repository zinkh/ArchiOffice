import { describe, expect, it } from 'vitest';
import {
  buildReserveMail, buildReserveRecipients, groupReservesByLot, selectReserves, statutDiffusion, SANS_LOT,
  type ReserveDiffusable,
} from '../reserveDiffusion';
import type { Contact } from '../../types';

const lots = [
  { lot_number: '10', lot_title: 'PEINTURE' },
  { lot_number: '2', lot_title: 'PLATRERIE', contact_id: 'c-plat', contact_name: 'Plâtres Martin' },
  { lot_number: '01', lot_title: 'GROS-OEUVRE' },
];
const r = (id: string, number: number, extra: Partial<ReserveDiffusable> = {}): ReserveDiffusable => ({ id, number, status: 'A faire', ...extra });
const contact = (id: string, extra: Partial<Contact>): Contact => ({ id, ...extra } as Contact);

describe('groupReservesByLot', () => {
  it('classe par numéro de lot, « Sans lot » en dernier, réserves par numéro', () => {
    const reserves = [
      r('a', 5, { lots: '["PEINTURE"]' }), r('b', 1), r('c', 3, { lots: '["PLATRERIE"]' }), r('d', 2, { lots: '["PLATRERIE"]' }),
      r('e', 4, { lots: '["GROS-OEUVRE"]' }),
    ];
    const groupes = groupReservesByLot(reserves, lots);
    expect(groupes.map(g => g.key)).toEqual(['GROS-OEUVRE', 'PLATRERIE', 'PEINTURE', SANS_LOT]);
    expect(groupes[1].rows.map(x => x.id)).toEqual(['d', 'c']);
    expect(groupes[1].label).toBe('2 · PLATRERIE');
  });

  it('range une réserve à plusieurs lots sous le premier, une seule fois', () => {
    const groupes = groupReservesByLot([r('a', 1, { lots: ['PEINTURE', 'PLATRERIE'] })], lots);
    expect(groupes.map(g => g.key)).toEqual(['PEINTURE']);
  });

  it('garde un lot inconnu du projet après les lots connus', () => {
    const groupes = groupReservesByLot([r('a', 1, { lots: '["ZINGUERIE"]' }), r('b', 2, { lots: '["PEINTURE"]' })], lots);
    expect(groupes.map(g => g.key)).toEqual(['PEINTURE', 'ZINGUERIE']);
  });
});

describe('selectReserves', () => {
  const reserves = [r('a', 1, { lots: '["PEINTURE"]' }), r('b', 2, { lots: '["PLATRERIE","PEINTURE"]' }), r('c', 3)];
  it('rend toute la liste sans périmètre', () => expect(selectReserves(reserves, null)).toHaveLength(3));
  it('garde les réserves qui portent l’un des lots choisis', () => {
    expect(selectReserves(reserves, ['PLATRERIE']).map(x => x.id)).toEqual(['b']);
    expect(selectReserves(reserves, ['PEINTURE']).map(x => x.id)).toEqual(['a', 'b']);
  });
  it('« Sans lot » désigne les réserves sans lot', () => expect(selectReserves(reserves, [SANS_LOT]).map(x => x.id)).toEqual(['c']));
});

describe('buildReserveRecipients', () => {
  const contacts = [
    contact('c-plat', { company_name: 'Plâtres Martin', email: 'plat@exemple.fr' }),
    contact('c-peint', { company_name: 'Peintures Durand' }),
    contact('c-moe', { company_name: 'Bureau Structure', email: 'bet@exemple.fr' }),
  ];
  const reserves = [
    r('a', 1, { lots: '["PLATRERIE"]', entreprises: '["Plâtres Martin"]' }),
    r('b', 2, { lots: '["PEINTURE"]', entreprises: '["Peintures Durand"]' }),
    r('c', 3, { lots: '["PEINTURE"]', entreprises: '["Peintures Durand","Inconnu SARL"]' }),
  ];
  const input = {
    reserves, lots, contacts, marches: [{ entreprise_nom: 'Peintures Durand', contact_id: 'c-peint' }],
    stakeholders: [{ name: 'BET', role: 'Bureau d’études', contact_id: 'c-moe' }, { name: 'Sans fiche', role: 'AMO' }],
  };

  it('donne le rapport complet aux intervenants qui ont une fiche', () => {
    const { intervenants } = buildReserveRecipients(input);
    expect(intervenants).toHaveLength(1);
    expect(intervenants[0]).toMatchObject({ key: 'int:c-moe', email: 'bet@exemple.fr', reserveIds: ['a', 'b', 'c'] });
  });

  it('donne à chaque entreprise ses seules réserves, avec ou sans adresse', () => {
    const { entreprises } = buildReserveRecipients(input);
    const parNom = Object.fromEntries(entreprises.map(e => [e.name, e]));
    expect(parNom['Plâtres Martin']).toMatchObject({ contactId: 'c-plat', email: 'plat@exemple.fr', reserveIds: ['a'] });
    expect(parNom['Peintures Durand']).toMatchObject({ contactId: 'c-peint', email: '', reserveIds: ['b', 'c'] });
    expect(parNom['Inconnu SARL']).toMatchObject({ contactId: null, email: '', reserveIds: ['c'] });
  });

  it('n’envoie pas deux fois à une entreprise déjà intervenante', () => {
    const { entreprises } = buildReserveRecipients({ ...input, stakeholders: [{ name: 'Plâtres', role: 'Entreprise', contact_id: 'c-plat' }] });
    expect(entreprises.map(e => e.name)).not.toContain('Plâtres Martin');
  });
});

describe('statutDiffusion', () => {
  it('se déduit des envois', () => {
    expect(statutDiffusion([])).toBe('en_cours');
    expect(statutDiffusion([{ status: 'envoye' }, { status: 'envoye' }])).toBe('envoye');
    expect(statutDiffusion([{ status: 'envoye' }, { status: 'echec' }])).toBe('partiel');
    expect(statutDiffusion([{ status: 'echec' }])).toBe('echec');
  });
});

describe('buildReserveMail', () => {
  const base = { recipientName: 'Plâtres Martin', title: 'Réserves', projectName: 'Villa Martin', projectCode: '26014', count: 4, open: 3 };
  it('précise la portée selon le destinataire', () => {
    expect(buildReserveMail({ ...base, role: 'entreprise' }).text).toContain('dont vous avez la charge');
    expect(buildReserveMail({ ...base, role: 'intervenant' }).text).toContain('liste complète');
  });
  it('ne laisse jamais un retour à la ligne s’injecter dans l’objet et échappe le HTML', () => {
    const mail = buildReserveMail({ ...base, role: 'intervenant', projectName: 'A\r\nBcc: x@y.z', note: '<b>note</b>' });
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.html).toContain('&lt;b&gt;');
  });
});

import { buildReminderMail, estNonLevee, joursDeRetard } from '../reserveDiffusion';

describe('rappel hebdomadaire', () => {
  const today = new Date(2026, 9, 30);
  const ctx = { recipientName: 'Plâtres Martin', title: 'Réserves', projectName: 'Villa Martin', projectCode: '26014', agencyName: 'AAZS', today };

  it('ne retient que les réserves non levées', () => {
    expect(estNonLevee({ status: 'A faire' })).toBe(true);
    expect(estNonLevee({ status: 'Levée' })).toBe(false);
    expect(estNonLevee({ status: 'Quitus Transmis' })).toBe(false);
  });

  it('calcule le retard en jours civils, jamais pour une date absente ou illisible', () => {
    expect(joursDeRetard('2026-10-25', today)).toBe(5);
    expect(joursDeRetard('2026-10-30', today)).toBe(0);
    expect(joursDeRetard(null, today)).toBe(0);
    expect(joursDeRetard('n’importe quoi', today)).toBe(0);
  });

  it('rend null quand tout est levé : aucun rappel inutile', () => {
    expect(buildReminderMail({ ...ctx, reserves: [{ status: 'Levée', number: 1 }] })).toBeNull();
  });

  it('liste les réserves en retard d’abord, avec le retard', () => {
    const mail = buildReminderMail({ ...ctx, reserves: [
      { status: 'A faire', number: 1, title: 'Peinture', due_date: '2026-11-20' },
      { status: 'En cours', number: 2, title: 'Joints', due_date: '2026-10-20' },
      { status: 'Levée', number: 3, title: 'Levée' },
    ] })!;
    expect(mail.subject).toContain('2 réserves à lever');
    expect(mail.text.indexOf('n° 2')).toBeLessThan(mail.text.indexOf('n° 1'));
    expect(mail.text).toContain('en retard de 10 j');
    expect(mail.text).not.toContain('Levée');
  });

  it('échappe le HTML et limite la longueur de la liste', () => {
    const beaucoup = Array.from({ length: 70 }, (_, i) => ({ status: 'A faire', number: i + 1, title: i === 0 ? '<script>x</script>' : `R${i}` }));
    const mail = buildReminderMail({ ...ctx, reserves: beaucoup })!;
    expect(mail.html).not.toContain('<script>');
    expect(mail.text).toContain('… et 10 autres.');
  });
});
