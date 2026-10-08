import { describe, it, expect } from 'vitest';
import { buildDiffusionMail, buildDiffusionRecipients, contactEmail, isValidEmail } from '../crDiffusion';
import type { Contact, Observation, ProjectLot, ProjectStakeholder } from '../../types';

const contact = (id: string, patch: Partial<Contact> = {}): Contact =>
  ({ id, first_name: 'Jean', last_name: id, email: `${id}@exemple.test`, ...patch } as Contact);
const lot = (id: string, n: string, title: string, contact_id?: string): ProjectLot =>
  ({ id, project_id: 'p1', lot_number: n, lot_title: title, contact_id } as ProjectLot);
const stakeholder = (id: string, role: string, contact_id?: string): ProjectStakeholder =>
  ({ id, project_id: 'p1', name: role, role, contact_id } as ProjectStakeholder);
const obs = (id: string, patch: Partial<Observation>): Observation =>
  ({ id, project_id: 'p1', texte: `Texte ${id}`, statut: 'À faire', ...patch } as Observation);

describe('isValidEmail / contactEmail', () => {
  it('refuse une adresse qui pourrait injecter un en-tête ou viser plusieurs personnes', () => {
    expect(isValidEmail('a@b.fr')).toBe(true);
    expect(isValidEmail('a@b.fr\nBcc: x@y.fr')).toBe(false);
    expect(isValidEmail('a@b.fr, c@d.fr')).toBe(false);
    expect(isValidEmail('sans-arobase')).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
  });

  it('prend la première adresse valable de la fiche', () => {
    expect(contactEmail({ email: 'invalide', email_work: 'pro@ent.fr', email_other: undefined, email_home: 'perso@ent.fr' })).toBe('pro@ent.fr');
    expect(contactEmail({ email: '', email_work: undefined, email_other: undefined, email_home: undefined })).toBe('');
  });
});

describe('buildDiffusionRecipients', () => {
  const contacts = [
    contact('c1', { company_name: 'Maçonnerie Durand' }),
    contact('c2', { company_name: 'BET Structure' }),
    contact('c3', { company_name: 'Sans adresse', email: '' }),
  ];

  it('rassemble une entreprise titulaire de plusieurs lots en un seul destinataire', () => {
    const recipients = buildDiffusionRecipients({
      lots: [lot('l1', '02', 'Gros œuvre', 'c1'), lot('l2', '03', 'Charpente', 'c1')],
      stakeholders: [],
      contacts,
      observations: [obs('o1', { lot_id: 'l1', number: 2 }), obs('o2', { lot_id: 'l2', number: 1 })],
    });
    expect(recipients).toHaveLength(1);
    expect(recipients[0].name).toBe('Maçonnerie Durand');
    expect(recipients[0].roles).toEqual(['Lot 02 Gros œuvre', 'Lot 03 Charpente']);
    expect(recipients[0].observations.map(o => o.id)).toEqual(['o2', 'o1']);
  });

  it("attribue à chacun ses seules observations, par lot ou par désignation expresse", () => {
    const recipients = buildDiffusionRecipients({
      lots: [lot('l1', '02', 'Gros œuvre', 'c1')],
      stakeholders: [stakeholder('s1', 'Bureau d\'études structure', 'c2')],
      contacts,
      observations: [
        obs('o1', { lot_id: 'l1' }),
        obs('o2', { contact_id: 'c2' }),
        obs('o3', { lot_id: 'l-autre' }),
      ],
    });
    const byId = Object.fromEntries(recipients.map(r => [r.contactId, r.observations.map(o => o.id)]));
    expect(byId).toEqual({ c1: ['o1'], c2: ['o2'] });
  });

  it("n'invente aucun destinataire pour un lot ou un intervenant sans fiche contact", () => {
    const recipients = buildDiffusionRecipients({
      lots: [lot('l1', '02', 'Gros œuvre'), lot('l2', '03', 'Charpente', 'inconnu')],
      stakeholders: [stakeholder('s1', 'MOA')],
      contacts,
      observations: [],
    });
    expect(recipients).toEqual([]);
  });

  it('garde un destinataire sans adresse, avec un e-mail vide, pour que l\'écran le signale', () => {
    const [r] = buildDiffusionRecipients({
      lots: [lot('l1', '04', 'Plomberie', 'c3')], stakeholders: [], contacts, observations: [],
    });
    expect(r.email).toBe('');
  });
});

describe('buildDiffusionMail', () => {
  const ctx = {
    reportNumber: 12, reportDate: '2026-03-12', nextMeeting: '19/03/2026 à 9 h',
    projectName: 'Villa Martin', projectCode: '26014', agencyName: 'AAZS', signature: '',
  };

  it('met les observations du destinataire dans le corps, avec statut et délai', () => {
    const mail = buildDiffusionMail({
      contactId: 'c1', name: 'Durand', roles: ['Lot 02 Gros œuvre'], email: 'd@e.fr',
      observations: [obs('o1', { number: 3, type: 'reserve', texte: 'Reprendre l\'enduit', statut: 'Urgent', urgence: 'bloquant', due_date: '2026-03-20' })],
    }, ctx);
    expect(mail.subject).toBe('Compte rendu de chantier n° 12 du 12/03/2026, 26014 Villa Martin');
    expect(mail.text).toContain('Observations vous concernant (1) :');
    expect(mail.text).toContain('- 3. [À lever] Reprendre l\'enduit (Statut : Urgent, Urgence : bloquant, Délai : 20/03/2026)');
    expect(mail.text).toContain('Prochaine réunion : 19/03/2026 à 9 h');
    expect(mail.text).toContain('AAZS');
    expect(mail.text).not.toContain('—');
  });

  it("dit explicitement quand aucune observation ne concerne le destinataire", () => {
    const mail = buildDiffusionMail({ contactId: 'c2', name: 'BET', roles: [], email: 'b@e.fr', observations: [] }, ctx);
    expect(mail.text).toContain('Aucune observation ne vous concerne dans ce compte rendu.');
    expect(mail.html).not.toContain('<ul>');
  });

  it('échappe le HTML saisi dans une observation et garde le sujet sur une ligne', () => {
    const mail = buildDiffusionMail({
      contactId: 'c1', name: 'Durand', roles: [], email: 'd@e.fr',
      observations: [obs('o1', { texte: '<script>alert(1)</script> & "guillemets"' })],
    }, { ...ctx, projectName: 'Villa\r\nBcc: x@y.fr' });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });
});
