// ── Versement du BPU et de ses offres vers le comparatif ACT ─────────────────
// Le module ACT (src/components/ACTModule.tsx) possède déjà un comparatif
// détaillé par article, avec son écran de comparaison, sa notation et son
// générateur de RAO. Ses articles sont aujourd'hui saisis un par un à la main.
// Le BPU les produit, et les offres importées remplissent les prix.
//
// À la demande, jamais automatiquement et jamais dans les deux sens : le
// comparatif ACT est éditable par l'architecte, une synchronisation
// automatique se battrait contre lui.
import type { BPU, BPULigne, OffreBPU } from '../types/bpu';

/** Forme des articles attendue par ACTModule (voir son ComparatifArticle). */
export interface ComparatifArticle {
  id: string;
  code: string;
  titre: string;
  unite?: string;
  quantite?: number;
  estimatif?: number;
  prix: Record<string, number>;
  is_section_header?: boolean;
  is_subtotal?: boolean;
}

export interface ComparatifLot {
  lot_id: string;
  articles: ComparatifArticle[];
}

export interface VersementResultat {
  comparatif: ComparatifLot[];
  /** Lots du BPU sans rattachement à un lot du projet : rien n'est versé pour eux. */
  lotsNonRattaches: { numero: string; titre: string }[];
}

/**
 * Projette le bordereau et les offres retenues vers la structure du comparatif.
 *
 * ComparatifLot.lot_id désigne un project_lots.id, pas un lot interne au BPU :
 * un lot de bordereau non rattaché ne peut pas être versé. Ils sont rapportés
 * à l'appelant plutôt que laissés tomber en silence.
 */
export function bpuVersComparatif(bpu: BPU, offres: OffreBPU[]): VersementResultat {
  const comparatif: ComparatifLot[] = [];
  const lotsNonRattaches: { numero: string; titre: string }[] = [];
  const retenues = offres.filter(o => o.statut !== 'ecartee' && o.entrepriseId);

  for (const lot of bpu.lots) {
    if (!lot.projectLotId) {
      lotsNonRattaches.push({ numero: lot.numero, titre: lot.titre });
      continue;
    }

    const articles: ComparatifArticle[] = [];

    for (const chap of lot.chapitres) {
      articles.push({
        id: chap.id, code: chap.numero, titre: chap.titre,
        prix: {}, is_section_header: true,
      });

      const walk = (lignes: BPULigne[]) => {
        for (const l of lignes) {
          // Un article parent porte la somme de ses enfants : il ne se chiffre
          // pas et n'a donc rien à faire dans un comparatif de prix.
          if (l.children?.length) { walk(l.children); continue; }
          const prix: Record<string, number> = {};
          for (const o of retenues) {
            const pu = o.prix?.[l.id];
            // Un poste non chiffré reste absent : l'écrire à 0 fausserait le
            // classement des offres.
            if (pu != null) prix[o.entrepriseId!] = pu * (l.quantite || 0);
          }
          articles.push({
            id: l.id, code: l.numero, titre: l.designation, unite: l.unite,
            quantite: l.quantite, estimatif: l.prixTotal || undefined, prix,
          });
        }
      };
      walk(chap.lignes);
    }

    // Sous-total du lot, par entreprise.
    const sousTotaux: Record<string, number> = {};
    for (const o of retenues) {
      const total = articles.reduce(
        (s, a) => s + (a.is_section_header ? 0 : (a.prix[o.entrepriseId!] ?? 0)), 0,
      );
      if (total > 0) sousTotaux[o.entrepriseId!] = total;
    }
    articles.push({
      id: `${lot.id}__soustotal`, code: '', titre: `Sous-total ${lot.numero} — ${lot.titre}`,
      estimatif: lot.sousTotal || undefined, prix: sousTotaux, is_subtotal: true,
    });

    comparatif.push({ lot_id: lot.projectLotId, articles });
  }

  return { comparatif, lotsNonRattaches };
}
