import { describe, expect, it } from 'vitest';
import {
  MODELE_CORPS, MODELE_CORPS_REPONSE, MODELE_CORPS_VISITE, MODELE_SUJET, MODELE_SUJET_REPONSE, blocsMessageDce, jetonsInconnus, remplirModele, type DonneesMessageDce,
} from '../dceEnvoiMessage';
import { entreprisesAConvoquer, entreprisesDceAEnvoyer, lignesCochees, marquageEnvoi, planEnvoiGroupe } from '../dceEnvoiGroupe';
import { aRenotifier, visiteNotifiee, visitePourMessage } from '../actVisites';
import { entreprisesDeLaReponse, marquerDiffusee, reponseDiffusable, type QuestionDiffusable } from '../depotQuestions';
import type { EntrepriseSuivi } from '../actEntreprises';

const base: DonneesMessageDce = {
  operation: 'Résidence Les Tilleuls',
  entreprise: 'Maçonnerie Dupont',
  lots: [{ lot_number: '02', lot_title: 'Gros œuvre' }, { lot_number: '03', lot_title: 'Charpente' }],
  piecesMarche: [],
  lignesIndices: [],
  echecsPieces: [],
};

describe('message du DCE', () => {
  it('compose le message complet : lots, pièces, indices, lien de dépôt et date limite', () => {
    const d: DonneesMessageDce = {
      ...base,
      piecesMarche: ['Règlement de consultation', 'Acte d\'engagement'],
      lignesIndices: [{ designation: 'CCTP', fichier: 'cctp.pdf', indice: 'B' }, { designation: 'Plans', fichier: '', indice: '' }],
      lienDepot: 'https://app.test/depot/abc',
      dateLimite: '12/12/2026 à 12:00',
    };
    const corps = remplirModele(MODELE_CORPS, blocsMessageDce(d));
    expect(corps).toBe([
      'Bonjour,',
      '',
      'Dans le cadre de la consultation des entreprises pour l\'opération « Résidence Les Tilleuls », nous vous transmettons le dossier de consultation (DCE) relatif à :',
      '- Lot 02 — Gros œuvre',
      '- Lot 03 — Charpente',
      '',
      'Pièces du marché jointes :',
      '- Règlement de consultation',
      '- Acte d\'engagement',
      'L\'acte d\'engagement est à compléter, signer et remettre avec votre offre.',
      '',
      'Pièces du dossier (indice de révision) :',
      '- CCTP : cctp.pdf (indice B)',
      '- Plans',
      '',
      'Le tableau des indices est joint à ce message.',
      '',
      'Vous pouvez remettre votre offre en ligne sur votre espace de dépôt personnel (saisie de l\'offre ou dépôt de vos documents) :',
      'https://app.test/depot/abc',
      'Date limite de remise : 12/12/2026 à 12:00.',
      'Ce lien vous est personnel : merci de ne pas le transmettre.',
      '',
      'Nous restons à votre disposition pour toute précision.',
      '',
      'Cordialement,',
    ].join('\n'));
  });

  it('sans pièces ni lien, les blocs vides ne laissent pas de lignes vides en trop', () => {
    const corps = remplirModele(MODELE_CORPS, blocsMessageDce({ ...base, lots: [] }));
    expect(corps).not.toMatch(/\n{3,}/);
    expect(corps).toContain('(DCE).');
    expect(corps.endsWith('Cordialement,')).toBe(true);
  });

  it('signale les pièces non jointes et le lien non créé', () => {
    const corps = remplirModele(MODELE_CORPS, blocsMessageDce({
      ...base, echecLienDepot: true, echecsPieces: ['plan.pdf'], depotNonPropose: 'espace indisponible',
    }));
    expect(corps).toContain('[Lien de dépôt non proposé : espace indisponible]');
    expect(corps).toContain('[Lien de dépôt non créé');
    expect(corps).toContain('[À joindre manuellement, téléchargement impossible : plan.pdf]');
  });

  it('ne signale pas l\'absence de dépôt quand un lien existe', () => {
    const corps = remplirModele(MODELE_CORPS, blocsMessageDce({ ...base, lienDepot: 'https://x/y', depotNonPropose: 'raison' }));
    expect(corps).not.toContain('Lien de dépôt non proposé');
  });

  it('l\'objet reprend l\'opération et les lots courts', () => {
    expect(remplirModele(MODELE_SUJET, blocsMessageDce(base))).toBe('Consultation des entreprises — Résidence Les Tilleuls — Lot 02, Lot 03');
    expect(remplirModele(MODELE_SUJET, blocsMessageDce({ ...base, lots: [] }))).toBe('Consultation des entreprises — Résidence Les Tilleuls');
  });

  it('un même modèle donne un message propre à chaque entreprise', () => {
    const a = remplirModele('Bonjour {{entreprise}}{{lots}}', blocsMessageDce({ ...base, entreprise: 'A', lots: [{ lot_number: '01', lot_title: 'VRD' }] }));
    const b = remplirModele('Bonjour {{entreprise}}{{lots}}', blocsMessageDce({ ...base, entreprise: 'B', lots: [{ lot_number: '05', lot_title: 'Plâtrerie' }] }));
    expect(a).toContain('Bonjour A');
    expect(a).toContain('Lot 01');
    expect(a).not.toContain('Lot 05');
    expect(b).toContain('Lot 05');
    expect(b).not.toContain('Lot 01');
  });

  it('laisse en clair un jeton inconnu et le signale', () => {
    const corps = remplirModele('Bonjour {{entrepris}}', blocsMessageDce(base));
    expect(corps).toBe('Bonjour {{entrepris}}');
    expect(jetonsInconnus('Bonjour {{entrepris}} {{lots}}')).toEqual(['{{entrepris}}']);
    expect(jetonsInconnus(MODELE_CORPS)).toEqual([]);
  });
});

const ent = (id: string, p: Partial<EntrepriseSuivi> = {}): EntrepriseSuivi => ({
  id, nom: `Ent ${id}`, email: `${id}@ent.fr`, lots_ids: ['L1'], envoyer_dce: true, ...p,
});

describe('plan d\'envoi groupé', () => {
  it('écarte les entreprises qui ne peuvent pas recevoir le DCE, avec le motif', () => {
    const plan = planEnvoiGroupe([
      ent('a'),
      ent('b', { ne_repond_pas: true }),
      ent('c', { email: '', emails_supplementaires: '' }),
      ent('d', { lots_ids: [] }),
    ]);
    expect(plan.map(l => l.motif)).toEqual([undefined, 'ne_repond_pas', 'sans_adresse', 'sans_lot']);
  });

  it('décoche d\'office une entreprise qui a déjà reçu le DCE', () => {
    const plan = planEnvoiGroupe([ent('a'), ent('b', { dce_transmis_le: '2026-11-01' })]);
    expect(plan[1].dejaEnvoye).toBe(true);
    expect([...lignesCochees(plan)]).toEqual(['a']);
  });

  it('prend toutes les adresses de l\'entreprise sans doublon', () => {
    const [l] = planEnvoiGroupe([ent('a', { emails_supplementaires: 'a@ent.fr; compta@ent.fr' })]);
    expect(l.destinataires).toEqual(['a@ent.fr', 'compta@ent.fr']);
  });

  it('« DCE à envoyer » : case cochée, DCE non parti, ni refus de répondre ni offre reçue', () => {
    const liste = [
      ent('a'),
      ent('b', { envoyer_dce: false }),
      ent('c', { dce_transmis_le: '2026-11-01' }),
      ent('d', { ne_repond_pas: true }),
      ent('e', { offre_recue_le: '2026-11-05' }),
    ];
    expect(entreprisesDceAEnvoyer(liste).map(e => e.id)).toEqual(['a']);
  });
});

const creneaux = [
  { id: 'c2', date_heure: '2030-06-12T14:00' },
  { id: 'c1', date_heure: '2030-06-10T09:30' },
  { id: 'passe', date_heure: '2020-01-01T09:00' },
];

describe('visite de site dans le message', () => {
  it('cite le créneau affecté, le lieu et les consignes', () => {
    const visite = visitePourMessage({ visite_creneau_id: 'c1' }, creneaux, { lieu: ' 12 rue du Chantier ', consignes: 'Casque obligatoire' });
    expect(visite).toMatchObject({ assigne: true, lieu: '12 rue du Chantier', consignes: 'Casque obligatoire' });
    expect(visite?.creneaux).toHaveLength(1);
    const corps = remplirModele(MODELE_CORPS, blocsMessageDce({ ...base, visite }));
    expect(corps).toContain('Visite de site :\n- ');
    expect(corps).toContain('Lieu : 12 rue du Chantier');
    expect(corps).toContain('Consignes : Casque obligatoire');
    expect(corps).not.toContain('créneaux proposés');
  });

  it('sans créneau affecté, propose les créneaux à venir dans l\'ordre et ignore les passés', () => {
    const visite = visitePourMessage({}, creneaux, undefined, new Date('2030-01-01T00:00'));
    expect(visite?.assigne).toBe(false);
    expect(visite?.creneaux).toHaveLength(2);
    const corps = remplirModele(MODELE_CORPS, blocsMessageDce({ ...base, visite }));
    expect(corps).toContain('Visite de site, créneaux proposés :');
    expect(corps).toContain('Merci de nous indiquer le créneau que vous retenez.');
  });

  it('un créneau supprimé n\'est pas cité : on propose les autres', () => {
    expect(visitePourMessage({ visite_creneau_id: 'disparu' }, creneaux, undefined, new Date('2030-01-01'))?.assigne).toBe(false);
  });

  it('n\'annonce aucune visite sans créneau à citer, même avec un lieu', () => {
    expect(visitePourMessage({}, [], { lieu: 'Chantier' })).toBeUndefined();
    expect(visitePourMessage({}, [creneaux[2]], { lieu: 'Chantier' }, new Date('2030-01-01'))).toBeUndefined();
    const corps = remplirModele(MODELE_CORPS, blocsMessageDce(base));
    expect(corps).not.toContain('Visite de site');
  });

  it('la convocation seule reprend le bloc visite', () => {
    const visite = visitePourMessage({ visite_creneau_id: 'c2' }, creneaux, { lieu: 'Parking nord' });
    const corps = remplirModele(MODELE_CORPS_VISITE, blocsMessageDce({ ...base, visite }));
    expect(corps).toContain('« Résidence Les Tilleuls »');
    expect(corps).toContain('Lieu : Parking nord');
    expect(corps).toContain('confirmer votre présence');
    expect(corps).not.toMatch(/\n{3,}/);
  });
});

describe('convocation à la visite', () => {
  it('écarte une entreprise sans créneau, sans adresse ou qui ne répond pas', () => {
    const plan = planEnvoiGroupe([
      ent('a', { visite_creneau_id: 'c1' }),
      ent('b'),
      ent('c', { visite_creneau_id: 'c1', email: '' }),
      ent('d', { visite_creneau_id: 'c1', ne_repond_pas: true }),
      ent('e', { visite_creneau_id: 'c1', lots_ids: [] }),
    ], 'visite');
    expect(plan.map(l => l.motif)).toEqual([undefined, 'sans_creneau', 'sans_adresse', 'ne_repond_pas', undefined]);
  });

  it('décoche une entreprise déjà convoquée pour son créneau actuel, pas pour un autre', () => {
    const a = ent('a', { visite_creneau_id: 'c1', visite_convoquee_creneau_id: 'c1', visite_convoquee_le: '2026-11-20' });
    const b = ent('b', { visite_creneau_id: 'c2', visite_convoquee_creneau_id: 'c1', visite_convoquee_le: '2026-11-20' });
    const plan = planEnvoiGroupe([a, b], 'visite');
    expect([...lignesCochees(plan)]).toEqual(['b']);
    expect(plan[0].dejaLe).toBe('2026-11-20');
  });

  it('détecte le créneau modifié depuis la dernière convocation', () => {
    expect(aRenotifier({ visite_creneau_id: 'c2', visite_convoquee_creneau_id: 'c1', visite_convoquee_le: '2026-11-20' })).toBe(true);
    expect(aRenotifier({ visite_creneau_id: 'c1', visite_convoquee_creneau_id: 'c1', visite_convoquee_le: '2026-11-20' })).toBe(false);
    expect(aRenotifier({ visite_creneau_id: 'c1' })).toBe(false);
    expect(visiteNotifiee({ visite_creneau_id: 'c1', visite_convoquee_creneau_id: 'c1' })).toBe(true);
  });

  it('« à convoquer » : créneau affecté, pas déjà prévenue, pas « ne répond pas »', () => {
    const liste = [
      ent('a', { visite_creneau_id: 'c1' }),
      ent('b'),
      ent('c', { visite_creneau_id: 'c1', visite_convoquee_creneau_id: 'c1' }),
      ent('d', { visite_creneau_id: 'c1', ne_repond_pas: true }),
      ent('e', { visite_creneau_id: 'c2', visite_convoquee_creneau_id: 'c1' }),
    ];
    expect(entreprisesAConvoquer(liste).map(e => e.id)).toEqual(['a', 'e']);
  });
});

describe('ce qui est enregistré après un envoi réussi', () => {
  it('DCE : pose la transmission, et la convocation si le créneau a été cité', () => {
    const e = ent('a', { visite_creneau_id: 'c1', envoyer_dce: false, ne_repond_pas: true });
    expect(marquageEnvoi(e, 'dce', '2026-11-23', true)).toEqual({
      dce_transmis_le: '2026-11-23', envoyer_dce: true, ne_repond_pas: false,
      visite_convoquee_creneau_id: 'c1', visite_convoquee_le: '2026-11-23',
    });
    expect(marquageEnvoi(e, 'dce', '2026-11-23', false)).not.toHaveProperty('visite_convoquee_le');
  });

  it('DCE : garde la date de première transmission', () => {
    expect(marquageEnvoi(ent('a', { dce_transmis_le: '2026-11-01' }), 'dce', '2026-11-23', false).dce_transmis_le).toBe('2026-11-01');
  });

  it('convocation : ne touche ni au DCE ni au statut', () => {
    const m = marquageEnvoi(ent('a', { visite_creneau_id: 'c1' }), 'visite', '2026-11-23', true);
    expect(m).toEqual({ visite_convoquee_creneau_id: 'c1', visite_convoquee_le: '2026-11-23' });
    expect(marquageEnvoi(ent('a', { visite_creneau_id: 'c1' }), 'visite', '2026-11-23', false)).toEqual({});
  });
});

describe('diffusion d\'une réponse publique', () => {
  const qr = { objet: 'Plancher', question: 'Quelle épaisseur de dalle ?', reponse: 'Vingt centimètres.' };

  it('compose le message sans nom d\'auteur, avec la question et la réponse', () => {
    const corps = remplirModele(MODELE_CORPS_REPONSE, blocsMessageDce({ ...base, questionReponse: qr }));
    expect(corps).toContain('« Résidence Les Tilleuls »');
    expect(corps).toContain('Objet : Plancher\nQuestion : Quelle épaisseur de dalle ?\n\nRéponse : Vingt centimètres.');
    expect(corps).not.toContain('Maçonnerie Dupont');
    expect(corps).not.toMatch(/\n{3,}/);
    expect(remplirModele(MODELE_SUJET_REPONSE, blocsMessageDce(base))).toBe('Réponse à une question : Résidence Les Tilleuls');
  });

  it('omet la ligne d\'objet quand la question n\'en a pas', () => {
    const corps = remplirModele(MODELE_CORPS_REPONSE, blocsMessageDce({ ...base, questionReponse: { question: 'Horaires ?', reponse: '8h-17h' } }));
    expect(corps).not.toContain('Objet :');
    expect(corps).toContain('Question : Horaires ?');
  });

  it('seule une réponse publique et saisie peut être diffusée', () => {
    expect(reponseDiffusable({ publique: true, reponse: 'Oui.' })).toBe(true);
    expect(reponseDiffusable({ publique: false, reponse: 'Oui.' })).toBe(false);
    expect(reponseDiffusable({ publique: true, reponse: '   ' })).toBe(false);
    expect(reponseDiffusable({ publique: true })).toBe(false);
  });

  it('destinataires : les entreprises du lot visé, ou toutes pour une question générale', () => {
    const liste = [ent('a', { lots_ids: ['L1'] }), ent('b', { lots_ids: ['L2'] }), ent('c', { lots_ids: ['L1', 'L2'] })];
    expect(entreprisesDeLaReponse(liste, { lot_id: 'L1' }).map(e => e.id)).toEqual(['a', 'c']);
    expect(entreprisesDeLaReponse(liste, {}).map(e => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('plan : écarte sans adresse et « ne répond pas », décoche celles qui ont déjà reçu la réponse', () => {
    const plan = planEnvoiGroupe([
      ent('a'), ent('b', { ne_repond_pas: true }), ent('c', { email: '' }), ent('d', { lots_ids: [] }), ent('e'),
    ], 'reponse', new Set(['e']));
    expect(plan.map(l => l.motif)).toEqual([undefined, 'ne_repond_pas', 'sans_adresse', undefined, undefined]);
    expect([...lignesCochees(plan)]).toEqual(['a', 'd']); // pas de contrainte de lot : le filtre se fait avant
    expect(plan[4].dejaEnvoye).toBe(true);
  });

  it('marque chaque destinataire sans doublon et garde la date du dernier envoi', () => {
    const q: QuestionDiffusable = { id: 'q1', question: 'x', publique: true, reponse: 'y' };
    const a = marquerDiffusee(q, 'e1', '2026-11-23');
    const b = marquerDiffusee(a, 'e2', '2026-11-24');
    const c = marquerDiffusee(b, 'e1', '2026-11-25');
    expect(c.diffusee_a).toEqual(['e1', 'e2']);
    expect(c.diffusee_le).toBe('2026-11-25');
    expect(q).not.toHaveProperty('diffusee_a'); // l'original n'est pas modifié
  });

  it('n\'enregistre rien sur l\'entreprise après une diffusion', () => {
    expect(marquageEnvoi(ent('a'), 'reponse', '2026-11-23', false)).toEqual({});
  });
});
