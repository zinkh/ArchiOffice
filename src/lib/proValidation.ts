import { batimentEffectif, phaseEffective, type DPGF, type Ligne } from '../types/dpgf';
import { forEachLigne } from '../components/pro/treeOps';

export type ProIssueSeverity = 'error' | 'warning';
export interface ProIssue {
  severity: ProIssueSeverity;
  code: string;
  message: string;
  articleId?: string;
}

const norm = (v: string) => v.trim().toLocaleLowerCase('fr-FR').replace(/\s+/g, ' ');

/** Contrôle transversal avant diffusion d'un CCTP/DPGF/estimatif. */
export function validateProDocument(doc: DPGF): ProIssue[] {
  const issues: ProIssue[] = [];
  const numeros = new Map<string, Ligne[]>();
  const affectations = new Map<string, { batimentId?: string; phaseId?: string }>();
  const totalCalcule = doc.lots.reduce((total, lot) => total + lot.chapitres.reduce(
    (s, chap) => s + chap.lignes.filter(l => !l.cctpOnly).reduce((x, l) => x + Number(l.prixTotal || 0), 0), 0,
  ), 0);

  for (const lot of doc.lots) for (const chap of lot.chapitres) {
    const walk = (lignes: Ligne[]) => lignes.forEach(ligne => {
      affectations.set(ligne.id, { batimentId: batimentEffectif(lot, chap, ligne), phaseId: phaseEffective(lot, chap, ligne) });
      if (ligne.children?.length) walk(ligne.children);
    });
    walk(chap.lignes);
  }

  forEachLigne(doc.lots, (ligne: Ligne) => {
    if (ligne.type !== 'ouvrage') return;
    const prefix = `${ligne.numero || 'Sans numéro'} — ${ligne.designation || 'Sans désignation'}`;
    if (!ligne.designation?.trim()) issues.push({ severity: 'error', code: 'designation_absente', articleId: ligne.id, message: `${prefix} : désignation absente.` });
    if (!ligne.unite?.trim() && !ligne.cctpOnly) issues.push({ severity: 'error', code: 'unite_absente', articleId: ligne.id, message: `${prefix} : unité absente.` });
    if (!ligne.cctpDescription?.trim()) issues.push({ severity: 'warning', code: 'cctp_absent', articleId: ligne.id, message: `${prefix} : prescription CCTP absente.` });
    if (!ligne.cctpOnly && !(Number(ligne.quantite) > 0)) issues.push({ severity: 'warning', code: 'quantite_nulle', articleId: ligne.id, message: `${prefix} : quantité nulle.` });
    if (!ligne.cctpOnly && !(Number(ligne.prixUnitaire) > 0)) issues.push({ severity: 'warning', code: 'prix_nul', articleId: ligne.id, message: `${prefix} : prix unitaire nul.` });
    if (doc.multiBatiments && !affectations.get(ligne.id)?.batimentId) issues.push({ severity: 'warning', code: 'batiment_absent', articleId: ligne.id, message: `${prefix} : bâtiment non affecté.` });
    if (doc.multiPhases && !affectations.get(ligne.id)?.phaseId) issues.push({ severity: 'warning', code: 'phase_absente', articleId: ligne.id, message: `${prefix} : phase non affectée.` });
    if (ligne.quantiteDetails?.length) {
      const somme = ligne.quantiteDetails.reduce((s, d) => s + Number(d.quantite || 0), 0);
      if (Math.abs(somme - Number(ligne.quantite || 0)) > 0.001) issues.push({ severity: 'error', code: 'ventilation_incoherente', articleId: ligne.id, message: `${prefix} : ventilation ${somme} différente de la quantité ${ligne.quantite}.` });
    }
    if (ligne.numero?.trim()) {
      const key = norm(ligne.numero);
      numeros.set(key, [...(numeros.get(key) ?? []), ligne]);
    }
  });
  for (const [numero, lignes] of numeros) {
    if (lignes.length > 1) issues.push({ severity: 'error', code: 'numero_duplique', message: `Numéro d'article dupliqué « ${numero} » (${lignes.length} occurrences).` });
  }
  if (Math.abs(totalCalcule - Number(doc.totalHT || 0)) > 0.01) issues.push({ severity: 'error', code: 'total_incoherent', message: `Total HT enregistré (${doc.totalHT}) différent du total recalculé (${totalCalcule}).` });
  return issues;
}
