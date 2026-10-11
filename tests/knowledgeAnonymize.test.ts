// Anonymisation d'un extrait technique : server/knowledge/anonymize.ts.
// Un CCTP fictif réaliste : ce qui doit disparaître, ce qui doit rester.
import { describe, expect, it } from 'vitest';
import {
  anonymizeTechnicalText, buildKnownMatchers, findResidualProperNouns, maskKnownValues,
} from '../server/knowledge/anonymize';

const CCTP = [
  'CCTP LOT 04 - FAÇADES BARDAGE',
  'Opération : Construction de 12 logements collectifs "Résidence Les Tilleuls"',
  "Maître d'ouvrage : SCI BELLEVUE, représentée par M. Jean-Pierre Martin",
  "Maître d'œuvre : Atelier d'Architecture Zoméno Sektaoui, 23 Bd de l'Europe 54500 Vandœuvre-lès-Nancy",
  'Entreprise titulaire : Martin Façades SAS, SIRET 123 456 789 00012, tél. 03 83 12 34 56',
  'Parcelle cadastrale AB 0123, commune de Laxou. Permis de construire n° PC 054 305 24 C0012.',
  'Bardage vertical en mélèze naturel, section 21x120 mm, entraxe 600 mm, fixation par vis inox A2.',
  'Pare-pluie HPV classe Sd < 0,1 m. Conforme au NF DTU 41.2. Contact : m.durand@martin-facades.fr',
  'Le projet de M. Dupont à Nancy, rue Saint-Dizier. Montant des travaux : 125 000,00 € HT soit 150 000 € TTC.',
  'Réf. dossier 26014. Coordonnées GPS 48.6921, 6.1844.',
  "Pose sur ossature de 45 mm d'épaisseur, longueur 2,40 m, par l'entreprise Durand Bâtiment.",
  'La résidence Les Tilleuls est livrée en 2027. Le client Sophie Lambert valide les teintes.',
].join('\n');

const known = buildKnownMatchers([
  { value: 'SCI Bellevue', category: 'CLIENT' }, { value: 'Jean-Pierre Martin', category: 'PERSONNE' },
  { value: 'Martin Façades', category: 'ENTREPRISE' }, { value: 'Sophie Lambert', category: 'PERSONNE' },
  { value: 'Résidence Les Tilleuls', category: 'OPERATION' }, { value: 'Atelier Zoméno Sektaoui', category: 'CABINET' },
  { value: 'Durand Bâtiment', category: 'ENTREPRISE' },
]);

describe('anonymisation : ce qui doit disparaître', () => {
  const result = anonymizeTechnicalText(CCTP, { known });

  it.each([
    'BELLEVUE', 'Jean-Pierre', 'Martin Façades', 'Zoméno', 'Sektaoui', 'Bd de l', '54500', 'Vandœuvre', 'Laxou',
    'AB 0123', 'PC 054', '123 456 789', '03 83 12 34 56', 'durand@', 'Dupont', 'Saint-Dizier', '125 000',
    '150 000', '48.6921', '26014', 'Sophie Lambert', 'Durand Bâtiment', 'Tilleuls',
  ])('retire « %s »', (needle) => {
    expect(result.text).not.toContain(needle);
  });

  it('garde les prescriptions techniques', () => {
    for (const keep of ['mélèze naturel', '21x120 mm', 'entraxe 600 mm', 'vis inox A2', 'NF DTU 41.2', 'classe Sd < 0,1 m', "45 mm d'épaisseur", 'longueur 2,40 m']) {
      expect(result.text).toContain(keep);
    }
  });

  it('rapporte ce qui a été masqué, par catégorie', () => {
    expect(result.byCategory).toMatchObject({ PERSONNE: expect.any(Number), MONTANT: 2, PARCELLE: 1, PERMIS: 1 });
    expect(result.replacements).toBeGreaterThan(10);
  });

  it('est stable : ré-anonymiser un texte déjà anonymisé ne le change pas', () => {
    expect(anonymizeTechnicalText(result.text).text).toBe(result.text);
  });
});

describe('anonymisation : pièges du vocabulaire du bâtiment', () => {
  it('ne prend pas « m » (mètres) pour « Monsieur »', () => {
    const text = 'Longueur 10 m de bardage, hauteur 3 m Pose soignée.';
    expect(anonymizeTechnicalText(text).text).toBe(text);
  });

  it('ne masque pas un mot du métier même s’il est aussi un nom connu', () => {
    const matchers = buildKnownMatchers([{ value: 'Bois', category: 'ENTREPRISE' }, { value: 'Façade', category: 'ENTREPRISE' }]);
    expect(matchers).toHaveLength(0);
    expect(maskKnownValues('Bardage en bois sur façade nord', matchers).text).toBe('Bardage en bois sur façade nord');
  });

  it('retire les mots courts ambigus et garde les valeurs plus longues', () => {
    const matchers = buildKnownMatchers([{ value: 'Paul', category: 'PERSONNE' }, { value: 'Lambert', category: 'PERSONNE' }]);
    expect(matchers.map(m => m.category)).toEqual(['PERSONNE']);
    expect(maskKnownValues('M. Lambert et Paul', matchers).text).toBe('M. [PERSONNE] et Paul');
  });

  it('ignore casse, accents et espaces multiples des valeurs connues', () => {
    const matchers = buildKnownMatchers([{ value: 'Atelier Zoméno Sektaoui', category: 'CABINET' }]);
    expect(maskKnownValues('Cabinet ATELIER  zomeno   sektaoui, Nancy', matchers).text).toBe('Cabinet [CABINET], Nancy');
  });

  it('masque la valeur la plus longue avant la plus courte', () => {
    const matchers = buildKnownMatchers([
      { value: 'Sektaoui', category: 'PERSONNE' }, { value: 'Atelier Zoméno Sektaoui', category: 'CABINET' },
    ]);
    expect(maskKnownValues('Atelier Zoméno Sektaoui', matchers).text).toBe('[CABINET]');
  });

  it('une ligne étiquetée est masquée jusqu’à la fin de la phrase, pas au-delà', () => {
    const out = anonymizeTechnicalText('Contact : Jean Dupont, 06 12 34 56 78. Bardage vertical, entraxe 600 mm.').text;
    expect(out).toBe('Contact : [MENTION]. Bardage vertical, entraxe 600 mm.');
  });
});

describe('contrôle des noms propres restants', () => {
  it('repère un nom de personne ou de commune non masqué', () => {
    expect(findResidualProperNouns('Le client Sophie Lambert valide à Nancy.').map(f => f.text)).toEqual(
      expect.arrayContaining(['Sophie Lambert', 'Nancy']));
  });

  it('ne signale ni sigles, ni normes, ni débuts de phrase, ni balises', () => {
    const text = 'Pose conforme au NF DTU 41.2 et à l’Eurocode 5. Le [PERSONNE] valide. Bardage en PVC, classe C.';
    expect(findResidualProperNouns(text)).toEqual([]);
  });

  it('repère un numéro long (référence, matricule)', () => {
    expect(findResidualProperNouns('dossier 9876543 en cours').map(f => f.reason)).toContain('numéro long');
  });
});
