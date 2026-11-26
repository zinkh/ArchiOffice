import { describe, expect, it } from 'vitest';
import {
  cleBrouillon, cleRecupere, delaiNouvelEssai, ecrireBrouillon, effacerBrouillon, lireBrouillon, rapprocherBrouillons, type Stockage,
} from '../proDraft';

function stockageEnMemoire(): Stockage & { contenu: Map<string, string> } {
  const contenu = new Map<string, string>();
  return {
    contenu,
    getItem: cle => contenu.get(cle) ?? null,
    setItem: (cle, valeur) => { contenu.set(cle, valeur); },
    removeItem: cle => { contenu.delete(cle); },
  };
}

type Doc = { titre: string };

describe('brouillon local', () => {
  it('écrit puis relit le document avec l\'instant d\'écriture', () => {
    const stockage = stockageEnMemoire();
    const cle = cleBrouillon('archioffice_dpgf_p1');
    expect(ecrireBrouillon(cle, JSON.stringify({ titre: 'ma saisie' }), 1_794_137_402_475, stockage)).toBe(true);
    expect(lireBrouillon<Doc>(cle, stockage)).toEqual({ enregistreLe: 1_794_137_402_475, doc: { titre: 'ma saisie' } });
  });

  it('les deux emplacements d\'un document sont distincts de la copie locale', () => {
    expect(cleBrouillon('k')).toBe('k:brouillon');
    expect(cleRecupere('k')).toBe('k:recupere');
  });

  it('rend null pour une valeur absente, illisible ou sans document', () => {
    const stockage = stockageEnMemoire();
    expect(lireBrouillon('absent', stockage)).toBeNull();
    stockage.setItem('x', 'pas du json');
    expect(lireBrouillon('x', stockage)).toBeNull();
    stockage.setItem('y', JSON.stringify({ enregistreLe: 1 }));
    expect(lireBrouillon('y', stockage)).toBeNull();
    stockage.setItem('z', JSON.stringify({ doc: { titre: 'a' } }));
    expect(lireBrouillon('z', stockage)).toBeNull();
  });

  it('signale un stockage plein au lieu de faire croire la saisie protégée', () => {
    const plein: Stockage = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => {} };
    expect(ecrireBrouillon('k', '{}', 1, plein)).toBe(false);
    expect(ecrireBrouillon('k', '{}', 1, null)).toBe(false);
  });

  it('efface le brouillon', () => {
    const stockage = stockageEnMemoire();
    ecrireBrouillon('k', '{"titre":"a"}', 1, stockage);
    effacerBrouillon('k', stockage);
    expect(lireBrouillon('k', stockage)).toBeNull();
  });
});

describe('rapprocherBrouillons', () => {
  const serveur = JSON.stringify({ titre: 'serveur' });

  it('ignore un brouillon identique à la version du serveur', () => {
    const { aProposer, ecartes } = rapprocherBrouillons<Doc>(serveur, [{ enregistreLe: 5, doc: { titre: 'serveur' } }, null]);
    expect(aProposer).toBeNull();
    expect(ecartes).toEqual([]);
  });

  it('propose le brouillon qui diffère', () => {
    const { aProposer } = rapprocherBrouillons<Doc>(serveur, [{ enregistreLe: 5, doc: { titre: 'ma saisie' } }, null]);
    expect(aProposer).toEqual({ enregistreLe: 5, doc: { titre: 'ma saisie' } });
  });

  it('propose le plus récent et rend l\'autre pour qu\'il soit figé', () => {
    const ancien = { enregistreLe: 1, doc: { titre: 'ancienne saisie' } };
    const recent = { enregistreLe: 9, doc: { titre: 'saisie récente' } };
    const { aProposer, ecartes } = rapprocherBrouillons<Doc>(serveur, [ancien, recent]);
    expect(aProposer).toBe(recent);
    expect(ecartes).toEqual([ancien]);
  });
});

describe('delaiNouvelEssai', () => {
  it('double à chaque échec puis plafonne à 30 secondes', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(delaiNouvelEssai)).toEqual([5_000, 5_000, 10_000, 20_000, 30_000, 30_000, 30_000]);
  });
});
