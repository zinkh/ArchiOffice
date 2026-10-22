import { describe, expect, it } from 'vitest';
import {
  attribuerNumeros, cleEntreprise, entreprisesDistinctes, formatNumeroFtm, formatNumeroOs, numeroHeriteFtm, numeroHeriteOs, resumeNumeros,
} from '../numerotationEntreprise';

const marches = [
  { id: 'm1', entreprise_nom: 'Maçonnerie Durand' },
  { id: 'm2', entreprise_nom: 'Charpente Petit' },
  { id: 'm3', entreprise_nom: '  maconnerie  durand ' },
];
const cleDe = (id: string) => { const m = marches.find(x => x.id === id); return m ? cleEntreprise(m) : undefined; };

describe('numérotation par entreprise', () => {
  it('reconnaît une même entreprise malgré la casse, les accents et les espaces', () => {
    expect(cleEntreprise(marches[0])).toBe(cleEntreprise(marches[2]));
    expect(cleEntreprise({ contact_id: 'k1', entreprise_nom: 'x' })).toBe('c:k1');
    expect(entreprisesDistinctes(marches)).toHaveLength(2);
  });

  it('chaque entreprise repart de 1, indépendamment des autres', () => {
    const lignes = [{ marche_id: 'm1', os_number: '001' }, { marche_id: 'm1', os_number: '002' }, { marche_id: 'm2', os_number: '003' }];
    const [durand] = attribuerNumeros(lignes, entreprisesDistinctes([marches[0]]), cleDe, numeroHeriteOs);
    const [petit] = attribuerNumeros(lignes, entreprisesDistinctes([marches[1]]), cleDe, numeroHeriteOs);
    expect(durand.numero).toBe(3);
    // Une ligne ancienne (numérotée à l'affaire) compte pour son entreprise : on continue après son numéro.
    expect(petit.numero).toBe(4);
  });

  it('lit numeros_entreprises quand il existe, et ignore les autres entreprises', () => {
    const lignes = [{ marche_ids: ['m1', 'm2'], numeros_entreprises: [
      { marche_id: 'm1', cle: cleEntreprise(marches[0]), entreprise: 'D', numero: 5 },
      { marche_id: 'm2', cle: cleEntreprise(marches[1]), entreprise: 'P', numero: 2 },
    ] }];
    const numeros = attribuerNumeros(lignes, entreprisesDistinctes(marches), cleDe, numeroHeriteOs);
    expect(numeros.map(n => n.numero)).toEqual([6, 3]);
    expect(resumeNumeros(numeros, formatNumeroOs)).toBe('006 / 003');
  });

  it('formate et relit les numéros', () => {
    expect(formatNumeroFtm(3)).toBe('FTM-03');
    expect(numeroHeriteFtm({ numero: 'FTM-07' } as any)).toBe(7);
    expect(numeroHeriteOs({ os_number: '002 / 001' } as any)).toBe(2);
    expect(numeroHeriteOs({} as any)).toBe(0);
  });
});
