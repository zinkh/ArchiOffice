// Sources du planning de chantier : server/planningSources.ts (DPGF et CCTP d'une opération).
import { describe, expect, it } from 'vitest';
import { associerMarches, sourcesPourPlanning, texteSourceLot } from '../server/planningSources';

const lots = [
  { id: 'l1', lot_number: '01', lot_title: 'Gros œuvre' },
  { id: 'l2', lot_number: '2', lot_title: 'Charpente' },
];

const dpgf = {
  multiBatiments: true,
  batiments: [{ id: 'b1', code: 'A', libelle: 'Bâtiment A' }, { id: 'b2', code: 'B', libelle: 'Préau' }],
  multiPhases: false, phases: [{ id: 'p1', code: '1', libelle: 'Phase 1' }],
  lots: [
    {
      numero: '1', titre: 'Gros œuvre', projectLotId: 'l1', cctpDescription: 'Cure du béton 7 jours avant chargement.',
      chapitres: [
        { numero: '1', titre: 'PRESCRIPTIONS GENERALES', cctpOnly: true, cctpDescription: 'Accès par le portail nord.', lignes: [] },
        {
          numero: '2', titre: 'Fondations', lignes: [
            { type: 'ouvrage', designation: 'Fouilles en rigole', unite: 'm3', quantite: 120, prixTotal: 6000 },
            { type: 'ouvrage', designation: 'Béton de propreté', unite: 'm3', quantite: 20, prixTotal: 2000, cctpDescription: 'Dosage 150 kg/m3.' },
            { type: 'ouvrage', designation: 'Option drain', unite: 'ml', quantite: 40, prixTotal: 900, nature: 'option' },
            { type: 'ouvrage', designation: 'Pour mémoire', unite: 'u', quantite: 1, prixTotal: 0, pourMemoire: true },
          ],
        },
      ],
    },
    // Rattaché par le numéro quand le lot du document n'est pas lié.
    { numero: '02', titre: 'Charpente', chapitres: [{ numero: '1', titre: 'Ossature', lignes: [{ type: 'ouvrage', designation: 'Fermes', unite: 'u', quantite: 8, prixTotal: 24000 }] }] },
    // Lot du document absent du projet : ignoré.
    { numero: '99', titre: 'Inconnu', chapitres: [{ numero: '1', titre: 'x', lignes: [{ type: 'ouvrage', designation: 'x', prixTotal: 5 }] }] },
  ],
};

describe('sourcesPourPlanning', () => {
  it('résume chaque lot du projet : chapitres chiffrés en base, ouvrages principaux, CCTP', () => {
    const s = sourcesPourPlanning(dpgf, lots);
    expect(s.aDpgf).toBe(true);
    expect(s.aCctp).toBe(true);
    expect(s.lots.map(l => l.lotId)).toEqual(['l1', 'l2']);
    const go = s.lots[0];
    expect(go.chapitres).toHaveLength(1); // le chapitre réservé au CCTP n'est pas un chapitre de travaux
    expect(go.chapitres[0]).toMatchObject({ titre: 'Fondations', montantHt: 8000 }); // option et pour mémoire exclus
    expect(go.chapitres[0].ouvrages[0]).toBe('Fouilles en rigole (120 m3)');
    expect(go.cctp).toContain('Cure du béton 7 jours');
    expect(go.cctp).toContain('Accès par le portail nord');
    expect(go.cctp).toContain('Dosage 150 kg/m3');
    expect(s.lots[1].montantHt).toBe(24000);
  });

  it('reprend les bâtiments seulement quand le découpage est actif', () => {
    const s = sourcesPourPlanning(dpgf, lots);
    expect(s.batiments).toEqual(['Bâtiment A', 'Préau']);
    expect(s.phases).toEqual([]);
  });

  it('tolère l’absence de DPGF ou un document vide', () => {
    expect(sourcesPourPlanning(null, lots)).toMatchObject({ lots: [], aDpgf: false, aCctp: false });
    expect(sourcesPourPlanning({ lots: [] }, lots).lots).toEqual([]);
    expect(sourcesPourPlanning('pas un objet', lots).aDpgf).toBe(false);
  });

  it('signale un CCTP sans DPGF chiffré', () => {
    const s = sourcesPourPlanning({ lots: [{ numero: '1', projectLotId: 'l1', cctpDescription: 'Prescriptions seules', chapitres: [] }] }, lots);
    expect(s).toMatchObject({ aDpgf: false, aCctp: true });
  });

  it('borne la taille du texte donné au modèle', () => {
    const long = { lots: [{ numero: '1', cctpDescription: 'x '.repeat(2000), chapitres: [] }] };
    expect(sourcesPourPlanning(long, lots).lots[0].cctp.length).toBeLessThanOrEqual(900);
  });
});

describe('texteSourceLot', () => {
  it('rend un bloc lisible, ou rien', () => {
    const s = sourcesPourPlanning(dpgf, lots);
    const texte = texteSourceLot(s.lots[0]);
    expect(texte).toContain('DPGF, 1 chapitre :');
    expect(texte).toContain('- 2 Fondations (8000 € HT) : Fouilles en rigole (120 m3)');
    expect(texte).toContain('CCTP :');
    expect(texteSourceLot(undefined)).toBe('');
  });
});

// Affaire réelle (SELIA) : les numéros de marché ne suivent pas ceux des lots.
describe('associerMarches', () => {
  const l = (id: string, lot_number: string, lot_title: string) => ({ id, lot_number, lot_title });
  const lotsReels = [
    l('go', '01', 'GROS-OEUVRE - VRD - ESPACES VERTS'), l('ch', '02', 'CHARPENTE BOIS'), l('co', '03', 'COUVERTURE - BARDAGES'),
    l('me', '04', 'MENUISERIES EXTERIEURES - SERRURERIE'), l('mi', '05', 'MENUISERIES INTERIEURES'), l('pl', '06', 'PLATRERIE ISOLATION'),
    l('pe', '07', 'PEINTURE'), l('so', '08', 'REVETEMENTS DE SOLS-SOUPLES'),
    l('cvc', '09', 'CHAUFFAGE - VENTILATION - CLIMATISATION - PLOMBERIE'), l('el', '10', 'ELECTRICITE'), l('pv', '11', 'PANNEAUX PHOTOVOLTAÏQUES'),
  ];
  const m = (lot_numero: string, lot_titre: string, montant_ht: number, entreprise_nom = 'X') => ({ lot_numero, lot_titre, montant_ht, entreprise_nom, statut: 'en_cours' });
  const marchesReels = [
    m('00', 'INSTALLATION DE CHANTIER', 36114.29),
    m('01', 'GO VRD ESPACES VERTS VEGETATION', 55726.75, 'A'), m('01', 'GO VRD ESPACES VERTS VEGETATION', 128565.6, 'B'),
    m('03', 'COUVERTURE ZINGUERIE', 74125.85),
    m('05', 'CLOISONS MODULAIRES - MENUISERIES INTERIEURES', 6282.5),
    m('09', 'PEINTURE', 12206.3),
    m('10', 'CHAUFFAGE VENTILATION - CLIMATISATION', 51000), m('11', 'PLOMBERIE', 3730),
    m('12', 'ELECTRICITE', 2916.36),
  ];
  const { parLot, sansLot } = associerMarches(lotsReels, marchesReels);

  it('rapproche par intitulé quand les numéros divergent', () => {
    expect(parLot.get('pe')?.montantHt).toBe(12206); // marché 09 → lot 07, pas lot 09
    expect(parLot.get('el')?.montantHt).toBe(2916); // marché 12 → lot 10
    expect(parLot.get('cvc')?.montantHt).toBe(54730); // marchés 10 et 11 réunis sur le lot 09
    expect(parLot.get('co')?.montantHt).toBe(74126);
    expect(parLot.get('mi')?.montantHt).toBe(6283);
  });

  it('additionne les marchés d’un même lot et garde chaque entreprise', () => {
    expect(parLot.get('go')).toMatchObject({ montantHt: 184292, entreprises: ['A', 'B'] });
  });

  it('laisse sans lot un marché qui n’en a pas (installation de chantier) et les lots sans marché', () => {
    expect(sansLot.map(x => x.lot_titre)).toEqual(['INSTALLATION DE CHANTIER']);
    expect(parLot.has('ch')).toBe(false);
    expect(parLot.has('pv')).toBe(false);
  });

  it('rapproche par numéro un marché sans intitulé et ignore un marché résilié', () => {
    const r = associerMarches(lotsReels, [{ lot_numero: '2', lot_titre: '', montant_ht: 90000, entreprise_nom: 'Y' }, { ...m('07', 'PEINTURE', 5000), statut: 'resilie' }]);
    expect(r.parLot.get('ch')).toMatchObject({ montantHt: 90000, entreprises: ['Y'] });
    expect(r.parLot.has('pe')).toBe(false);
  });
});

// Extrait réel (SELIA) : DPGF quasiment non chiffré, groupes de sous-articles, lignes « Nouvel article »,
// texte générique dans les chapitres réservés au CCTP, bâtiments activés.
describe('sourcesPourPlanning sur un DPGF réel peu chiffré', () => {
  const lotsSelia = [
    { id: 'go', lot_number: '01', lot_title: 'GROS-OEUVRE - VRD - ESPACES VERTS' },
    { id: 'co', lot_number: '03', lot_title: 'COUVERTURE - BARDAGES' },
    { id: 'me', lot_number: '04', lot_title: 'MENUISERIES EXTERIEURES - SERRURERIE' },
  ];
  const o = (designation: string, extra: object = {}) => ({ type: 'ouvrage', unite: '', quantite: 0, prixTotal: 0, designation, ...extra });
  const doc = {
    multiBatiments: true, multiPhases: null, phases: null,
    batiments: [{ id: 'b1', code: 'SP', libelle: 'Salle Polyvalente', ordre: 0 }, { id: 'b2', code: 'DX', libelle: 'Duplex', ordre: 1 }, { id: 'b3', code: 'PR', libelle: 'Préau', ordre: 2 }],
    lots: [
      { numero: '01', projectLotId: 'go', cctpDescription: null, chapitres: [
        { numero: '1', titre: 'Travaux Préparatoire', lignes: [o('Etudes d\'Exécution'), o('Installation de chantier'), o('Enlèvement Arbres', { unite: 'u', quantite: 3, prixTotal: 1500 }), o('Nouvel article')] },
        { numero: '2', titre: 'Terrassements', lignes: [o('Fouilles en pleine masse'), o('Déblais', { children: [o('Déblais pour bâtiments'), o('Déblais pour aménagements extérieurs')] })] },
      ] },
      { numero: '03', projectLotId: 'co', cctpDescription: null, chapitres: [
        { numero: '1', titre: 'PRESCRIPTIONS GENERALES', cctpOnly: true, lignes: [o('Généralités', { cctpOnly: true })] },
        { numero: '3', titre: 'DESCRIPTION DES OUVRAGES', cctpOnly: false, lignes: [
          { type: 'titre', designation: 'Sécurité collective et individuelle', quantite: 0, prixTotal: 0 },
          { type: 'titre', designation: 'Couverture métallique', children: [o('Couverture métallique aspect joint debout'), o('Bande de rive'), o('Bande d\'égout ventilé')] },
          o('Reconstitution de paroi', { cctpDescription: 'Suite dépose des menuiseries du bâtiment des enfants, reconstitution du pare-pluie existant et bardage extérieur.' }),
        ] },
      ] },
      { numero: '04', projectLotId: 'me', cctpDescription: null, chapitres: [
        { numero: '1', titre: 'PRESCRIPTIONS GENERALES', cctpOnly: true, lignes: [
          o('Objet du présent document', { cctpOnly: true, cctpDescription: 'Le présent Cahier de Clauses Techniques Particulières a pour but de définir les prestations.' }),
          o('Conditions contractuelles', { cctpOnly: true, cctpDescription: 'Les travaux sont soumis aux clauses de la Norme NF P 03-001 relative aux travaux privés.' }),
        ] },
        { numero: '3', titre: 'DESCRIPTION DES OUVRAGES', cctpOnly: false, lignes: [o('Travaux de dépose', { cctpDescription: 'Dépose des menuiseries extérieures du bâtiment des enfants' })] },
      ] },
    ],
  };
  const s = sourcesPourPlanning(doc, lotsSelia);

  it('n’écrit aucun montant quand le DPGF n’est pas chiffré, et compte un groupe pour un poste', () => {
    const go = texteSourceLot(s.lots.find(x => x.lotId === 'go'));
    expect(go).toContain('- 2 Terrassements : Fouilles en pleine masse ; Déblais (2 postes)');
    expect(go).not.toContain('Nouvel article');
    expect(go).not.toMatch(/\(0 € HT\)/);
    expect(go).toContain('Enlèvement Arbres (3 u)');
    expect(go).toContain('- 1 Travaux Préparatoire (1500 € HT)');
  });

  it('donne le nom du groupe plutôt que ses seules feuilles, sans les titres vides', () => {
    const co = texteSourceLot(s.lots.find(x => x.lotId === 'co'));
    expect(co).toContain('Couverture métallique (3 postes)');
    expect(co).not.toContain('Sécurité collective');
  });

  it('met les prescriptions des ouvrages avant le texte générique du CCTP', () => {
    const me = s.lots.find(x => x.lotId === 'me')!.cctp;
    expect(me.indexOf('Dépose des menuiseries extérieures')).toBeLessThan(me.indexOf('Le présent Cahier'));
    expect(me).toContain('Travaux de dépose : Dépose des menuiseries');
    expect(s.batiments).toEqual(['Salle Polyvalente', 'Duplex', 'Préau']);
  });
});
