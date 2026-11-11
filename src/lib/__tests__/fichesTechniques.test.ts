import { describe, expect, it, vi } from 'vitest';
import type { DPGF, FicheTechnique } from '../../types/dpgf';
import { ajouterFiches, basculerAnonymisation, marquerAnonymisation, retirerFiche } from '../fichesTechniques';
import { cctpBlocs } from '../cctpExport';

vi.mock('../authToken', () => ({ getAccessToken: async () => null }));

const fiche = (id: string, nom: string, extra: Partial<FicheTechnique> = {}): FicheTechnique => ({ id, documentId: `doc-${id}`, fileUrl: `t/${id}.pdf`, nom, ...extra });

describe('anonymisation des fiches techniques', () => {
  it('marque les fiches ajoutées seulement quand l\'option d\'import est cochée', () => {
    const f = [fiche('1', 'a.pdf')];
    expect(marquerAnonymisation(f, false)).toBe(f);
    expect(marquerAnonymisation(f, true)[0].anonymiser).toBe(true);
    expect(f[0].anonymiser).toBeUndefined();
  });

  it('garde l\'anonymisation à l\'ajout, sans doublon, et la bascule fiche par fiche', () => {
    const liste = ajouterFiches([fiche('1', 'a.pdf')], marquerAnonymisation([fiche('2', 'b.pdf'), fiche('1', 'a.pdf')], true));
    expect(liste.map(f => f.id)).toEqual(['1', '2']);
    expect(liste[0].anonymiser).toBeUndefined();
    expect(liste[1].anonymiser).toBe(true);

    const bascule = basculerAnonymisation(liste, '1', true);
    expect(bascule[0].anonymiser).toBe(true);
    expect(bascule[1]).toBe(liste[1]);
    expect(basculerAnonymisation(bascule, '2', false)[1].anonymiser).toBeUndefined();
    expect(retirerFiche(bascule, '1').map(f => f.id)).toEqual(['2']);
  });
});

describe('export du CCTP avec fiches techniques', () => {
  const doc = (fiches: FicheTechnique[]): DPGF => ({
    id: 'd', projectId: 'p', titre: 'CCTP', version: '1', dateCreation: '', statut: 'draft', TVA: 20, totalHT: 0, totalTTC: 0,
    lots: [{ id: 'l', numero: '01', titre: 'Gros oeuvre', sousTotal: 0, chapitres: [{ id: 'c', numero: '1', titre: 'Ouvrages', lignes: [{
      id: 'a', numero: '1.1', designation: 'Dallage', unite: 'm2', quantite: 0, prixUnitaire: 0, prixTotal: 0, type: 'ouvrage', cctpDescription: 'Texte.', fichesTechniques: fiches,
    }] }] }],
  });

  it('rappelle le nom d\'une fiche normale et masque celui d\'une fiche anonymisée', () => {
    const blocs = cctpBlocs(doc([fiche('1', 'Sika_dalle.pdf'), fiche('2', 'Weber_enduit.pdf', { anonymiser: true })]));
    const article = blocs.find(b => b.numero === '1.1');
    expect(article?.fiches).toEqual(['Sika_dalle.pdf', 'Fiche technique 2 (marque non citée)']);
    expect(JSON.stringify(blocs)).not.toContain('Weber');
  });
});
