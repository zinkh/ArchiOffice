// Sources du planning de chantier : server/planningSources.ts (DPGF et CCTP d'une opération).
import { describe, expect, it } from 'vitest';
import { sourcesPourPlanning, texteSourceLot } from '../server/planningSources';

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
