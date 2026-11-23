import { describe, expect, it } from 'vitest';
import {
  MODELE_CORPS, MODELE_SUJET, blocsMessageDce, jetonsInconnus, remplirModele, type DonneesMessageDce,
} from '../dceEnvoiMessage';
import { entreprisesDceAEnvoyer, lignesCochees, planEnvoiGroupe } from '../dceEnvoiGroupe';
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
    expect(plan[1].dejaTransmis).toBe(true);
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
