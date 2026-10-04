import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  regrouperQualifications, organismeDepuisAdeme, qualificationsRgeParSiret, resetRgeCache,
  RgeUnavailableError, MAX_SIRETS_PAR_REQUETE,
} from '../server/rgeLookup';

// Deux SIRET dont la clé de Luhn est correcte.
const S1 = '55208131700018';
const S2 = '35600000000001';

const reponse = (results: any[], ok = true, status = 200) =>
  ({ ok, status, json: async () => ({ results }) }) as any;

beforeEach(() => resetRgeCache());

describe('organismeDepuisAdeme', () => {
  it('reconnaît les organismes, sans tenir compte de la casse ni des accents', () => {
    expect(organismeDepuisAdeme('QUALIBAT')).toBe('qualibat');
    expect(organismeDepuisAdeme('Qualifelec')).toBe('qualifelec');
    expect(organismeDepuisAdeme("QUALIT'ENR")).toBe('qualit_enr');
    expect(organismeDepuisAdeme('CERTIBAT')).toBe('certibat');
    expect(organismeDepuisAdeme('AFNOR Certification')).toBe('rge');
    expect(organismeDepuisAdeme('')).toBe('rge');
  });
});

describe('regrouperQualifications', () => {
  it('fusionne les domaines d\'une même qualification et élargit les dates', () => {
    const r = regrouperQualifications([
      { organisme: 'QUALIBAT', code_qualification: '7131', nom_qualification: 'Isolation', domaine: 'Isolation des murs', date_debut: '2024-01-10', date_fin: '2026-01-09' },
      { organisme: 'QUALIBAT', code_qualification: '7131', nom_qualification: 'Isolation', domaine: 'Isolation des combles', date_debut: '2023-06-01', date_fin: '2027-02-01' },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      organisme: 'qualibat', reference: '7131', libelle: 'Isolation',
      date_debut: '2023-06-01', date_fin: '2027-02-01',
    });
    expect(r[0].domaines).toBe('Isolation des murs, Isolation des combles');
  });
  it('sépare deux codes différents', () => {
    const r = regrouperQualifications([
      { organisme: 'QUALIBAT', code_qualification: '7131' },
      { organisme: 'QUALIBAT', code_qualification: '5212' },
    ]);
    expect(r.map(q => q.reference).sort()).toEqual(['5212', '7131']);
  });
  it('tolère des colonnes sous un autre nom et des dates françaises', () => {
    const r = regrouperQualifications([{ organisme: 'Qualifelec', nom_certificat: 'CERT-9', lien_date_fin: '01/02/2027' }]);
    expect(r[0]).toMatchObject({ organisme: 'qualifelec', reference: 'CERT-9', date_fin: '2027-02-01' });
  });
  it('liste vide sans ligne', () => {
    expect(regrouperQualifications([])).toEqual([]);
  });
});

describe('qualificationsRgeParSiret', () => {
  it('interroge une fois pour plusieurs SIRET et répartit les lignes', async () => {
    const fetchFn = vi.fn().mockResolvedValue(reponse([
      { siret: S1, organisme: 'QUALIBAT', code_qualification: '7131', date_fin: '2027-01-01' },
      { siret: S2, organisme: 'QUALIFELEC', code_qualification: 'E1', date_fin: '2026-12-31' },
    ]));
    const r = await qualificationsRgeParSiret([S1, S2], fetchFn as any);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(r.get(S1)?.[0].organisme).toBe('qualibat');
    expect(r.get(S2)?.[0].organisme).toBe('qualifelec');
  });
  it('rend une liste vide, pas une absence, pour un SIRET sans qualification RGE', async () => {
    const fetchFn = vi.fn().mockResolvedValue(reponse([]));
    const r = await qualificationsRgeParSiret([S1], fetchFn as any);
    expect(r.get(S1)).toEqual([]);
  });
  it('ignore un SIRET invalide sans appeler le service', async () => {
    const fetchFn = vi.fn();
    const r = await qualificationsRgeParSiret(['123', '55208131700014'], fetchFn as any);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(r.size).toBe(0);
  });
  it('garde le résultat en mémoire', async () => {
    const fetchFn = vi.fn().mockResolvedValue(reponse([{ siret: S1, organisme: 'QUALIBAT', code_qualification: '1' }]));
    await qualificationsRgeParSiret([S1], fetchFn as any);
    await qualificationsRgeParSiret([S1], fetchFn as any);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it('ne met pas en cache un échec', async () => {
    const fetchFn = vi.fn()
      .mockRejectedValueOnce(new Error('réseau'))
      .mockResolvedValueOnce(reponse([]));
    await expect(qualificationsRgeParSiret([S1], fetchFn as any)).rejects.toBeInstanceOf(RgeUnavailableError);
    await expect(qualificationsRgeParSiret([S1], fetchFn as any)).resolves.toBeDefined();
  });
  it('signale un statut HTTP en erreur', async () => {
    const fetchFn = vi.fn().mockResolvedValue(reponse([], false, 503));
    await expect(qualificationsRgeParSiret([S1], fetchFn as any)).rejects.toThrow('503');
  });
  it('découpe en plusieurs requêtes au-delà de la limite', async () => {
    // 30 SIRET valides distincts : on fait varier les derniers chiffres jusqu'à une clé correcte.
    const valides: string[] = [];
    const luhn = (s: string) => { let t = 0; for (let i = 0; i < s.length; i++) { let n = +s[s.length - 1 - i]; if (i % 2) { n *= 2; if (n > 9) n -= 9; } t += n; } return t % 10 === 0; };
    for (let k = 0; valides.length < MAX_SIRETS_PAR_REQUETE + 5; k++) {
      const s = `1234567890${String(k).padStart(4, '0')}`;
      if (luhn(s)) valides.push(s);
    }
    const fetchFn = vi.fn().mockResolvedValue(reponse([]));
    await qualificationsRgeParSiret(valides, fetchFn as any);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
