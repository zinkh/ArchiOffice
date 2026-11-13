import { describe, expect, it } from 'vitest';
import {
  ENTETE_DOSSIER_PARTAGE as ENTETE, ajouterAuCorps, assainirLiensExternes, lienExterneValide, ligneDossier, retirerDuCorps,
} from '../dossierPartageMail';

const corps = ['Bonjour,', '', 'Texte.', '', 'Nous restons à votre disposition.', '', 'Cordialement,'].join('\n');
const zip = { id: 'p1', libelle: 'DCE complet.zip' };
const lien = { id: 'p2', libelle: 'Plans', url: 'https://exemple.fr/d/abc' };

describe('lienExterneValide', () => {
  it('accepte https et normalise', () => {
    expect(lienExterneValide(' https://exemple.fr/d/abc ')).toBe('https://exemple.fr/d/abc');
  });
  it.each(['javascript:alert(1)', 'data:text/html,x', 'http://exemple.fr', 'ftp://exemple.fr', 'exemple.fr', '', 'https://localhost'])(
    'refuse %s', v => expect(lienExterneValide(v)).toBeNull());
});

describe('assainirLiensExternes', () => {
  it('ne garde que les liens https et borne le libellé', () => {
    const r = assainirLiensExternes([
      { libelle: 'Plans', url: 'https://exemple.fr/a' },
      { libelle: 'Piège', url: 'javascript:alert(1)' },
      { libelle: 'x'.repeat(500), url: 'https://exemple.fr/b' },
      { url: 'https://exemple.fr/c' },
      null, 'texte', { libelle: 'Sans url' },
    ]);
    expect(r.map(l => l.url)).toEqual(['https://exemple.fr/a', 'https://exemple.fr/b', 'https://exemple.fr/c']);
    expect(r[1].libelle).toHaveLength(200);
    expect(r[2].libelle).toBe('exemple.fr');
  });
  it('rend une liste vide pour autre chose qu\'un tableau', () => {
    expect(assainirLiensExternes(undefined)).toEqual([]);
    expect(assainirLiensExternes({ url: 'https://exemple.fr' })).toEqual([]);
  });
  it('plafonne à 20 liens', () => {
    const beaucoup = Array.from({ length: 30 }, (_, i) => ({ libelle: `L${i}`, url: `https://exemple.fr/${i}` }));
    expect(assainirLiensExternes(beaucoup)).toHaveLength(20);
  });
});

describe('ajouterAuCorps', () => {
  it('crée le bloc avant l\'ancre', () => {
    const r = ajouterAuCorps(corps, ENTETE, zip, 'Nous restons à votre disposition');
    expect(r).toContain(`${ENTETE}\n${ligneDossier(zip)}\n\nNous restons`);
    expect(r.endsWith('Cordialement,')).toBe(true);
  });
  it('ajoute sous l\'en-tête existant', () => {
    const r = ajouterAuCorps(ajouterAuCorps(corps, ENTETE, zip, 'Nous restons'), ENTETE, lien, 'Nous restons');
    expect(r).toContain(`${ligneDossier(zip)}\n${ligneDossier(lien)}\n\nNous restons`);
  });
  it('ne duplique pas une ligne', () => {
    const une = ajouterAuCorps(corps, ENTETE, zip, 'Nous restons');
    expect(ajouterAuCorps(une, ENTETE, zip, 'Nous restons')).toBe(une);
  });
  it('à défaut d\'ancre, ajoute en fin de corps', () => {
    expect(ajouterAuCorps('Bonjour', ENTETE, zip)).toBe(`Bonjour\n\n${ENTETE}\n${ligneDossier(zip)}`);
  });
});

describe('retirerDuCorps', () => {
  it('retire la ligne et garde l\'en-tête tant que le bloc n\'est pas vide', () => {
    const deux = ajouterAuCorps(ajouterAuCorps(corps, ENTETE, zip, 'Nous restons'), ENTETE, lien, 'Nous restons');
    const r = retirerDuCorps(deux, ENTETE, zip);
    expect(r).not.toContain(ligneDossier(zip));
    expect(r).toContain(ENTETE);
    expect(r).toContain(ligneDossier(lien));
  });
  it('retire aussi l\'en-tête quand le bloc se vide, et rend le corps d\'origine', () => {
    const avec = ajouterAuCorps(corps, ENTETE, zip, 'Nous restons');
    expect(retirerDuCorps(avec, ENTETE, zip)).toBe(corps);
  });
  it('sans effet si la ligne a été supprimée à la main', () => {
    expect(retirerDuCorps(corps, ENTETE, zip)).toBe(corps);
  });
});
