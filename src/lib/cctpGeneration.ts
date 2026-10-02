// Conversion de la proposition renvoyée par POST /api/projects/:id/cctp/generate
// (server/routes/cctpGeneration.ts) en lots de l'arbre DPGF/CCTP. Pure, pour
// être testée sans l'éditeur : numérotation, articles marqués « CCTP et
// DPGF » (quantité et prix à 0, à chiffrer ensuite), provenance IA posée.
import type { Chapitre, Ligne, Lot } from '../types/dpgf';

export type CctpGenerationEngine = 'llm' | 'nomic';

export interface GeneratedArticle { designation: string; unite: string; localisation: string; description: string }
export interface GeneratedChapitre { titre: string; description: string; articles: GeneratedArticle[] }
export interface GeneratedLot { titre: string; description: string; chapitres: GeneratedChapitre[] }

export function lotsDepuisGeneration(
  generated: GeneratedLot[],
  lotsExistants: number,
  engine: CctpGenerationEngine,
  uid: () => string,
): Lot[] {
  return generated.map((g, li) => {
    const numeroLot = String(lotsExistants + li + 1).padStart(2, '0');
    const chapitres: Chapitre[] = g.chapitres.map((c, ci) => {
      const numeroChap = `${numeroLot}.${ci + 1}`;
      const lignes: Ligne[] = c.articles.map((a, ai) => ({
        id: uid(),
        numero: `${numeroChap}.${ai + 1}`,
        designation: a.designation,
        unite: a.unite || '',
        quantite: 0,
        prixUnitaire: 0,
        prixTotal: 0,
        type: 'ouvrage',
        cctpOnly: false,
        cctpDescription: a.description,
        ...(a.localisation ? { localisation: a.localisation } : {}),
        genereParIa: engine,
        children: [],
      }));
      return { id: uid(), numero: numeroChap, titre: c.titre, lignes, cctpOnly: false, cctpDescription: c.description };
    });
    const lot: Lot & { cctpDescription?: string } = {
      id: uid(),
      numero: numeroLot,
      titre: g.titre,
      chapitres,
      sousTotal: 0,
      cctpDescription: g.description,
    };
    return lot;
  });
}
