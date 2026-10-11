import { describe, expect, it } from 'vitest';
import { imagesDeLigne, legendeImage, localisationsConnues, nouvelleImage, retirerImage } from '../cctpImages';
import { cctpBlocs } from '../cctpExport';
import type { DPGF, Ligne } from '../../types/dpgf';

const ligne = (id: string, extra: Partial<Ligne> = {}): Ligne => ({
  id, numero: id, designation: id, unite: 'u', quantite: 1, prixUnitaire: 0, prixTotal: 0, type: 'ouvrage', ...extra,
});

const doc = (lignes: Ligne[]): DPGF => ({
  id: 'd', projectId: 'p', version: 1, TVA: 20, totalHT: 0, totalTTC: 0,
  lots: [{ id: 'l', numero: '01', titre: 'Lot', sousTotal: 0, chapitres: [{ id: 'c', numero: '01.1', titre: 'Chap', lignes }] }],
} as unknown as DPGF);

describe('localisationsConnues', () => {
  it('reprend les localisations déjà saisies, les plus fréquentes d\'abord', () => {
    const d = doc([
      ligne('a', { localisation: 'Façade nord' }),
      ligne('b', { localisation: 'SdB étage' }),
      ligne('c', { localisation: 'SdB étage' }),
    ]);
    expect(localisationsConnues(d)).toEqual(['SdB étage', 'Façade nord']);
  });

  it('fusionne casse et espaces, garde l\'écriture la plus utilisée', () => {
    const d = doc([
      ligne('a', { localisation: 'SdB  étage' }),
      ligne('b', { localisation: 'sdb étage' }),
      ligne('c', { localisation: 'sdb étage ' }),
    ]);
    expect(localisationsConnues(d)).toEqual(['sdb étage']);
  });

  it('parcourt les sous-articles et ignore les valeurs vides', () => {
    const d = doc([ligne('a', { localisation: '  ', children: [ligne('a1', { localisation: 'Toiture' })] })]);
    expect(localisationsConnues(d)).toEqual(['Toiture']);
  });
});

describe('illustrations', () => {
  it('la légende d\'une nouvelle image part de la localisation de l\'article', () => {
    const img = nouvelleImage({ id: 'i1', fileUrl: 'u' }, { localisation: ' Cuisine ' });
    expect(img.legende).toBe('Cuisine');
  });

  it('légende et retrait ne touchent que l\'image visée', () => {
    const images = [{ id: 'a', fileUrl: 'x', legende: '' }, { id: 'b', fileUrl: 'y', legende: '' }];
    expect(legendeImage(images, 'b', 'Détail')[1].legende).toBe('Détail');
    expect(legendeImage(images, 'b', 'Détail')[0].legende).toBe('');
    expect(retirerImage(images, 'a').map(i => i.id)).toEqual(['b']);
    expect(retirerImage(undefined, 'a')).toEqual([]);
  });

  it('imagesDeLigne écarte les références vides', () => {
    expect(imagesDeLigne({ images: [{ id: 'a', fileUrl: '', legende: '' }, { id: 'b', fileUrl: 'y', legende: '' }] }).map(i => i.id)).toEqual(['b']);
  });

  it('le bloc d\'export porte les images de l\'article', () => {
    const d = doc([ligne('a', { images: [{ id: 'i', fileUrl: 'u', legende: 'Vue' }] }), ligne('b')]);
    const blocs = cctpBlocs(d);
    expect(blocs.find(b => b.numero === 'a')?.images).toHaveLength(1);
    expect(blocs.find(b => b.numero === 'b')?.images).toBeUndefined();
  });
});
