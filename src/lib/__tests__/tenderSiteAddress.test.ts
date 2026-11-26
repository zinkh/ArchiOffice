import { describe, it, expect } from 'vitest';
import { usableSiteAddress, siteAddressOf, sameSiteAddress } from '../tenderSiteAddress';

describe('usableSiteAddress', () => {
  it('garde une adresse ou une commune', () => {
    expect(usableSiteAddress('12 rue des Lilas, 54000 Nancy')).toBe('12 rue des Lilas, 54000 Nancy');
    expect(usableSiteAddress('Vandœuvre-lès-Nancy')).toBe('Vandœuvre-lès-Nancy');
  });
  it('retire le libellé de tête et réduit les espaces', () => {
    expect(usableSiteAddress("Lieu d'exécution :  Lycée   Poincaré, Nancy")).toBe('Lycée Poincaré, Nancy');
    expect(usableSiteAddress("Lieu d’exécution des travaux : Metz")).toBe('Metz');
  });
  it('écarte les départements, codes NUTS et valeurs vides', () => {
    expect(usableSiteAddress('Dépt. 57, 54')).toBeNull();
    expect(usableSiteAddress('NUTS FRF31')).toBeNull();
    expect(usableSiteAddress('FRF31')).toBeNull();
    expect(usableSiteAddress('54')).toBeNull();
    expect(usableSiteAddress('  ')).toBeNull();
    expect(usableSiteAddress(null)).toBeNull();
    expect(usableSiteAddress(undefined)).toBeNull();
  });
});

describe('siteAddressOf', () => {
  it('préfère l\'adresse de la fiche au lieu d\'exécution', () => {
    expect(siteAddressOf({ adresse_terrain: '1 rue A, Nancy', ville_execution: 'Metz' })).toBe('1 rue A, Nancy');
  });
  it('se rabat sur le lieu d\'exécution exploitable, sinon rien', () => {
    expect(siteAddressOf({ adresse_terrain: '', ville_execution: 'Metz' })).toBe('Metz');
    expect(siteAddressOf({ adresse_terrain: null, ville_execution: 'Dépt. 57' })).toBeNull();
  });
});

describe('sameSiteAddress', () => {
  it('ignore casse, accents et ponctuation', () => {
    expect(sameSiteAddress('12, Rue des Lilas - Nancy', '12 rue des lilas nancy')).toBe(true);
    expect(sameSiteAddress('Metz', 'Nancy')).toBe(false);
    expect(sameSiteAddress('', '')).toBe(false);
  });
});
