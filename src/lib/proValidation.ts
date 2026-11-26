import type { DPGF, DecoupageNoeud, Ligne } from '../types/dpgf';
import { batimentsDeLigne, batimentsDuNoeud } from './batimentsArticles';
import { forEachLigne } from '../components/pro/treeOps';

export type ProIssueSeverity = 'error' | 'warning';
export interface ProIssue {
  severity: ProIssueSeverity;
  code: string;
  message: string;
  articleId?: string;
  /** Champ que l'IA peut proposer de corriger pour cette anomalie (jamais un prix ni une quantité). */
  fixable?: 'unite' | 'cctpDescription' | 'designation';
}

type Affectation = { aBatiment: boolean; aPhase: boolean };

/**
 * Affectation réelle de chaque article feuille : bâtiments (liste par
 * `quantitesBatiments`, `batimentId` hérité de l'article parent, du chapitre
 * puis du lot, ou liste `batimentsIds` d'un chapitre ou d'un lot) et phase.
 * Même règle que `articlesSansBatiment` : `''` veut dire « aucun », sans héritage.
 */
/** Articles réservés au CCTP : le leur, celui d'un parent ou celui de leur chapitre. */
function idsCctpSeul(doc: DPGF): Set<string> {
  const out = new Set<string>();
  const walk = (lignes: Ligne[], herite: boolean) => lignes.forEach(l => {
    const seul = herite || !!l.cctpOnly;
    if (seul) out.add(l.id);
    if (l.children?.length) walk(l.children, seul);
  });
  for (const lot of doc.lots) for (const chap of lot.chapitres) walk(chap.lignes, !!chap.cctpOnly);
  return out;
}

function affectationsDuDocument(doc: DPGF): Map<string, Affectation> {
  const out = new Map<string, Affectation>();
  for (const lot of doc.lots) {
    const listeLot = batimentsDuNoeud(lot as DecoupageNoeud);
    for (const chap of lot.chapitres) {
      const listeChap = batimentsDuNoeud(chap as DecoupageNoeud, listeLot);
      const walk = (lignes: Ligne[], herite: string | undefined, hPhase: string | undefined) => lignes.forEach(ligne => {
        if (ligne.children?.length) { walk(ligne.children, ligne.batimentId ?? herite, ligne.phaseId ?? hPhase); return; }
        const propre = ligne.quantitesBatiments !== undefined || ligne.batimentId !== undefined;
        const ids = batimentsDeLigne(ligne, herite);
        const aBatiment = ids.length > 0 || (!propre && !herite && listeChap.length > 0);
        out.set(ligne.id, { aBatiment, aPhase: !!(ligne.phaseId ?? hPhase) });
      });
      walk(chap.lignes, chap.batimentId ?? lot.batimentId, chap.phaseId ?? lot.phaseId);
    }
  }
  return out;
}

const norm = (v: string) => v.trim().toLocaleLowerCase('fr-FR').replace(/\s+/g, ' ');

/** Contrôle transversal avant diffusion d'un CCTP/DPGF/estimatif. */
export function validateProDocument(doc: DPGF): ProIssue[] {
  const issues: ProIssue[] = [];
  const numeros = new Map<string, Ligne[]>();
  const affectations = affectationsDuDocument(doc);
  const cctpSeul = idsCctpSeul(doc);
  const totalCalcule = doc.lots.reduce((total, lot) => total + lot.chapitres.reduce(
    (s, chap) => s + chap.lignes.filter(l => !l.cctpOnly).reduce((x, l) => x + Number(l.prixTotal || 0), 0), 0,
  ), 0);

  forEachLigne(doc.lots, (ligne: Ligne) => {
    if (ligne.type !== 'ouvrage') return;
    const reserve = cctpSeul.has(ligne.id);
    const prefix = `${ligne.numero || 'Sans numéro'} — ${ligne.designation || 'Sans désignation'}`;
    if (!ligne.designation?.trim()) issues.push({ severity: 'error', code: 'designation_absente', fixable: 'designation', articleId: ligne.id, message: `${prefix} : désignation absente.` });
    if (!ligne.unite?.trim() && !reserve) issues.push({ severity: 'error', code: 'unite_absente', fixable: 'unite', articleId: ligne.id, message: `${prefix} : unité absente.` });
    if (!ligne.cctpDescription?.trim()) issues.push({ severity: 'warning', code: 'cctp_absent', fixable: 'cctpDescription', articleId: ligne.id, message: `${prefix} : prescription CCTP absente.` });
    if (!reserve && !(Number(ligne.quantite) > 0)) issues.push({ severity: 'warning', code: 'quantite_nulle', articleId: ligne.id, message: `${prefix} : quantité nulle.` });
    if (!reserve && !(Number(ligne.prixUnitaire) > 0)) issues.push({ severity: 'warning', code: 'prix_nul', articleId: ligne.id, message: `${prefix} : prix unitaire nul.` });
    if (doc.multiBatiments && !reserve && !ligne.children?.length && affectations.get(ligne.id)?.aBatiment === false) issues.push({ severity: 'warning', code: 'batiment_absent', articleId: ligne.id, message: `${prefix} : bâtiment non affecté.` });
    if (doc.multiPhases && !reserve && !ligne.children?.length && affectations.get(ligne.id)?.aPhase === false) issues.push({ severity: 'warning', code: 'phase_absente', articleId: ligne.id, message: `${prefix} : phase non affectée.` });
    if (!reserve && ligne.quantiteDetails?.length) {
      const somme = ligne.quantiteDetails.reduce((s, d) => s + Number(d.quantite || 0), 0);
      if (Math.abs(somme - Number(ligne.quantite || 0)) > 0.001) issues.push({ severity: 'error', code: 'ventilation_incoherente', articleId: ligne.id, message: `${prefix} : ventilation ${somme} différente de la quantité ${ligne.quantite}.` });
    }
    if (ligne.numero?.trim()) {
      const key = norm(ligne.numero);
      numeros.set(key, [...(numeros.get(key) ?? []), ligne]);
    }
  });
  for (const [numero, lignes] of numeros) {
    if (lignes.length > 1) issues.push({ severity: 'error', code: 'numero_duplique', articleId: lignes[1].id, message: `Numéro d'article dupliqué « ${numero} » (${lignes.length} occurrences).` });
  }
  if (Math.abs(totalCalcule - Number(doc.totalHT || 0)) > 0.01) issues.push({ severity: 'error', code: 'total_incoherent', message: `Total HT enregistré (${doc.totalHT}) différent du total recalculé (${totalCalcule}).` });
  return issues;
}
