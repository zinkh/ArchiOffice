// Archive « tout le dossier » du portail de dépôt : noms sûrs et sans doublon, plafonds, et
// construction à partir du drive du cabinet (fournisseur en mémoire).
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  MAX_ARCHIVES_SIMULTANEES, cheminsUniques, nomArchive, reserverConstruction, segmentArchive,
} from '../server/consultationDepot/dossierZip';

describe('noms dans l\'archive', () => {
  it('garde les accents et retire ce qui est réservé ou dangereux', () => {
    expect(segmentArchive('Plan R+1 : façade <nord>?.pdf')).toBe('Plan R+1 façade nord .pdf');
    expect(segmentArchive('../../etc/passwd')).toBe('etc passwd');
    expect(segmentArchive('   ...   ', 'Repli')).toBe('Repli');
    expect(segmentArchive('a'.repeat(300))).toHaveLength(120);
  });

  it('ne produit jamais de chemin qui sorte du dossier', () => {
    const [chemin] = cheminsUniques([{ dossier: '../hors', nom: '..\\..\\secret.pdf' }]);
    expect(chemin).not.toContain('..');
    expect(chemin.split('/')).toHaveLength(2);
  });

  it('distingue deux fichiers de même nom dans une même pièce, extension conservée', () => {
    const chemins = cheminsUniques([
      { dossier: 'CCTP', nom: 'Plan.pdf' }, { dossier: 'CCTP', nom: 'plan.PDF' }, { dossier: 'CCTP', nom: 'Plan.pdf' },
      { dossier: 'RC', nom: 'Plan.pdf' },
    ]);
    expect(chemins).toEqual(['CCTP/Plan.pdf', 'CCTP/plan (2).PDF', 'CCTP/Plan (3).pdf', 'RC/Plan.pdf']);
  });

  it('propose un nom d\'archive lisible et une version ASCII', () => {
    const nom = nomArchive('Résidence « Les Tilleuls »');
    expect(nom.utf8).toBe('Résidence « Les Tilleuls » - Dossier de consultation.zip');
    expect(nom.ascii).toMatch(/^[\x20-\x7e]+$/);
    expect(nom.ascii).not.toContain('"');
    expect(nomArchive(null).utf8).toBe('Consultation - Dossier de consultation.zip');
  });
});

describe('constructions simultanées', () => {
  it('refuse au-delà du plafond et libère les places', () => {
    const prises = Array.from({ length: MAX_ARCHIVES_SIMULTANEES }, () => reserverConstruction());
    expect(prises.every(Boolean)).toBe(true);
    expect(reserverConstruction()).toBeNull();
    prises[0]!();
    prises[0]!(); // idempotent : une seule place rendue
    const nouvelle = reserverConstruction();
    expect(nouvelle).not.toBeNull();
    expect(reserverConstruction()).toBeNull();
    nouvelle!(); prises[1]!();
    const dernier = reserverConstruction();
    expect(dernier).not.toBeNull();
    dernier!();
  });
});

describe('format de l\'archive', () => {
  it('JSZip relit une archive aux noms accentués', async () => {
    const zip = new JSZip();
    zip.file('Pièce n°1/Règlement.pdf', Buffer.from('x'));
    const relue = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }));
    expect(Object.keys(relue.files)).toContain('Pièce n°1/Règlement.pdf');
  });
});
