import { describe, expect, it } from 'vitest';
import {
  additifsDeLentreprise, blocAdditif, controlerRevision, entreprisesConcernees, marquerRevisionNotifiee, numeroRevision,
  type DceRevision, type PieceDceCiblee,
} from '../dceRevisions';
import { MODELE_CORPS_ADDITIF, MODELE_SUJET_ADDITIF, blocsMessageDce, remplirModele, type DonneesMessageDce } from '../dceEnvoiMessage';
import type { EntrepriseSuivi } from '../actEntreprises';

const pieces: PieceDceCiblee[] = [
  { id: 'rc', tous_lots: true, lots_ids: [] },
  { id: 'cctp1', tous_lots: false, lots_ids: ['L1'] },
  { id: 'cctp2', tous_lots: false, lots_ids: ['L2'] },
];
const ent = (id: string, p: Partial<EntrepriseSuivi> = {}): EntrepriseSuivi => ({
  id, nom: `Ent ${id}`, email: `${id}@ent.fr`, lots_ids: ['L1'], envoyer_dce: true, dce_transmis_le: '2026-11-01', ...p,
});
const rev = (id: string, ids: string[], p: Partial<DceRevision> = {}): DceRevision => ({
  id, cree_le: '2026-11-23', motif: 'Cotes modifiées', pieces: ids.map(i => ({ id: i, libelle: `Pièce ${i}` })), ...p,
});

describe('controlerRevision', () => {
  it('exige un motif et au moins une pièce', () => {
    expect(controlerRevision('  ', [{ id: 'a', libelle: 'A' }]).ok).toBe(false);
    expect(controlerRevision('Cotes', []).ok).toBe(false);
  });

  it('nettoie le motif, retire les doublons de pièces et les indices vides', () => {
    const r = controlerRevision('  Cotes\r\nmodifiées ', [
      { id: 'a', libelle: ' A ', indice: ' C ' }, { id: 'a', libelle: 'A bis', indice: 'D' }, { id: 'b', libelle: '', indice: '  ' },
    ]);
    expect(r).toEqual({ ok: true, motif: 'Cotes\nmodifiées', pieces: [{ id: 'a', libelle: 'A', indice: 'C' }, { id: 'b', libelle: 'Pièce du DCE' }] });
  });

  it('refuse un motif trop long', () => {
    expect(controlerRevision('x'.repeat(1001), [{ id: 'a', libelle: 'A' }]).ok).toBe(false);
  });
});

describe('entreprisesConcernees', () => {
  it('ne prévient que celles qui ont reçu le DCE, répondent et sont touchées par une pièce modifiée', () => {
    const liste = [
      ent('a'), // lot 1, a reçu le DCE
      ent('b', { lots_ids: ['L2'] }), // autre lot
      ent('c', { dce_transmis_le: undefined }), // DCE pas encore parti : le recevra à jour
      ent('d', { ne_repond_pas: true }),
    ];
    expect(entreprisesConcernees(rev('r', ['cctp1']), pieces, liste).map(e => e.id)).toEqual(['a']);
  });

  it('une pièce de tous les lots concerne toutes les entreprises qui ont reçu le DCE', () => {
    const liste = [ent('a'), ent('b', { lots_ids: ['L2'] }), ent('c', { lots_ids: [] })];
    expect(entreprisesConcernees(rev('r', ['rc']), pieces, liste).map(e => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('plusieurs pièces : une entreprise touchée par l\'une d\'elles suffit, sans doublon', () => {
    const liste = [ent('a', { lots_ids: ['L1', 'L2'] })];
    expect(entreprisesConcernees(rev('r', ['cctp1', 'cctp2']), pieces, liste)).toHaveLength(1);
  });
});

describe('suivi des additifs', () => {
  it('marque chaque entreprise sans doublon et garde la date du dernier envoi', () => {
    const r = rev('r', ['rc']);
    const a = marquerRevisionNotifiee(marquerRevisionNotifiee(r, 'e1', '2026-11-23'), 'e2', '2026-11-24');
    const b = marquerRevisionNotifiee(a, 'e1', '2026-11-25');
    expect(b.notifiee_a).toEqual(['e1', 'e2']);
    expect(b.notifiee_le).toBe('2026-11-25');
    expect(r).not.toHaveProperty('notifiee_a');
  });

  it('numérote dans l\'ordre de publication', () => {
    const liste = [rev('a', ['rc']), rev('b', ['rc'])];
    expect(numeroRevision(liste, 'a')).toBe(1);
    expect(numeroRevision(liste, 'b')).toBe(2);
    expect(numeroRevision(liste, 'inconnu')).toBe(3);
  });

  it('page de l\'entreprise : ses additifs seulement, du plus récent au plus ancien', () => {
    const liste = [rev('a', ['cctp1']), rev('b', ['cctp2']), rev('c', ['rc'])];
    expect(additifsDeLentreprise(liste, pieces, ['L1']).map(x => [x.revision.id, x.numero])).toEqual([['c', 3], ['a', 1]]);
    expect(additifsDeLentreprise(liste, pieces, ['L2']).map(x => x.revision.id)).toEqual(['c', 'b']);
  });
});

describe('message d\'additif', () => {
  const base: DonneesMessageDce = {
    operation: 'Résidence Les Tilleuls', entreprise: 'Maçonnerie Dupont', lots: [], piecesMarche: [], lignesIndices: [], echecsPieces: [],
  };

  it('annonce le numéro, le motif, les pièces et le lien de confirmation propre à l\'entreprise', () => {
    const r = rev('r', ['cctp1'], { pieces: [{ id: 'cctp1', libelle: 'CCTP Charpente', indice: 'C' }, { id: 'rc', libelle: 'RC' }] });
    const donnees = { ...base, additif: blocAdditif(r, 2, '23/11/2026', 'https://app.test/api/public/additif/accuse/abc.def') };
    const corps = remplirModele(MODELE_CORPS_ADDITIF, blocsMessageDce(donnees));
    expect(corps).toContain('« Résidence Les Tilleuls »');
    expect(corps).toContain('Additif n° 2 du 23/11/2026\nMotif : Cotes modifiées\n\nPièces modifiées :\n- CCTP Charpente (indice C)\n- RC');
    expect(corps).toContain('Merci de confirmer la réception de cet additif en ouvrant le lien suivant :\nhttps://app.test/api/public/additif/accuse/abc.def');
    expect(corps).not.toMatch(/\n{3,}/);
    expect(remplirModele(MODELE_SUJET_ADDITIF, blocsMessageDce(donnees))).toBe('Additif n°2 au DCE : Résidence Les Tilleuls');
  });

  it('sans lien de confirmation, le message n\'en promet pas', () => {
    const donnees = { ...base, additif: blocAdditif(rev('r', ['rc']), 1, '23/11/2026') };
    expect(remplirModele(MODELE_CORPS_ADDITIF, blocsMessageDce(donnees))).not.toContain('confirmer la réception');
  });
});
