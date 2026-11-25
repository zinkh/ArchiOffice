// ── Exports de l'analyse des offres (module ACT) ─────────────────────────────
// Le rapport d'analyse des offres (RAO, PDF) et le comparatif des offres
// (Excel). Mêmes règles que le reste des exports : charte du cabinet, nuances
// de gris, pagination « P1|2 ». Sortis de ACTModule.tsx pour y rester lisibles.
import type { ProjectLot } from '../types';
import type { AgencySettings } from './proposalExport';
import { drawAgencyHeader, drawAgencyFooters, loadLogoDataUrl, tableauGris, TABLEAU_GRIS } from './pdfLetterhead';
import {
  ajouterFeuille, chargerLogo, enregistrerClasseur, nouveauClasseur, FORMAT_EURO, FORMAT_QUANTITE,
  type Cellule, type Colonne,
} from './xlsxLetterhead';
import { LIBELLE_BASE, type BaseQuantites } from './quantitesOffre';

interface OffreExport {
  lot_id: string;
  entreprise_id: string;
  montant_base: number;
  note_technique: number;
  conforme: boolean;
  motif_nc?: string;
  /** Devis partiel : affiché avec son périmètre, jamais pris pour moins-disant ni noté. */
  partielle?: boolean;
  perimetre?: string;
}

interface ComparatifArticleExport {
  code: string;
  titre: string;
  estimatif?: number;
  prix: Record<string, number>;
  is_section_header?: boolean;
  is_subtotal?: boolean;
  ajoute_par?: string;
  /** Propositions d'entreprises rattachées à cet article (leur montant est déjà dans `prix`). */
  propositions?: { entrepriseId: string; entrepriseNom: string; designation: string; montant: number }[];
  unite?: string;
  /** Quantité du document (DPGF ou DQE). */
  quantite?: number;
  /** Entreprises qui ont remis une autre quantité que celle du document. */
  ecartsQuantites?: Record<string, { quantite: number; acceptee: boolean; prixUnitaire: number | null }>;
}

/** Ce que ces exports lisent d'une consultation ; ACTModule en porte davantage. */
export interface ConsultationExport {
  entreprises: { id: string; nom: string }[];
  criteres: { id: string; nom: string; poids: number }[];
  offres: OffreExport[];
  attributions: { lot_id: string; entreprise_id: string; montant: number }[];
  comparatif?: { lot_id: string; articles: ComparatifArticleExport[] }[];
  /** Base de quantités des montants du comparatif : celle du maître d'œuvre (défaut) ou celles des entreprises. */
  base_quantites?: BaseQuantites;
}

const nomFichier = (s: string) => s.replace(/\s+/g, '_');

const euros = (n?: number) =>
  n == null ? '—' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n).replace(/[  ]/g, ' ');

// ── RAO (PDF) ─────────────────────────────────────────────────────────────────

/** Un poste ajouté par une entreprise le dit dans l'export, où la couleur ne passe pas. */
const titreArticle = (a: { titre: string; ajoute_par?: string; propositions?: { entrepriseNom: string; designation: string }[] }) => {
  if (a.ajoute_par) return `${a.titre} (ajouté par ${a.ajoute_par})`;
  const propositions = (a.propositions ?? []).map(p => `${p.entrepriseNom} : ${p.designation}`);
  return propositions.length ? `${a.titre} (proposition rattachée, ${propositions.join(' ; ')})` : a.titre;
};

export async function generateRAO(
  lots: ProjectLot[],
  consultation: ConsultationExport,
  projectName: string,
  settings: AgencySettings = {},
  lotId?: string,
): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }, logo] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadLogoDataUrl(settings.logoUrl),
  ]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = 297;
  const margin = 14;
  const letterhead = { title: "Rapport d'analyse des offres", subtitle: projectName, margin, logo };

  const lotsToAnalyse = lotId
    ? lots.filter(l => l.id === lotId)
    : lots.filter(l => consultation.offres.some(o => o.lot_id === l.id));

  if (lotsToAnalyse.length === 0) {
    const y = drawAgencyHeader(doc, settings, letterhead);
    doc.setTextColor(...TABLEAU_GRIS.texte);
    doc.setFontSize(11);
    doc.text('Aucun lot avec des offres à analyser.', W / 2, y + 30, { align: 'center' });
  }

  lotsToAnalyse.forEach((lot, idx) => {
    if (idx > 0) doc.addPage();
    const y = drawAgencyHeader(doc, settings, { ...letterhead, subtitle: `${projectName} — Lot ${lot.lot_number} : ${lot.lot_title}` });

    const offresLot = consultation.offres.filter(o => o.lot_id === lot.id);
    if (offresLot.length === 0) {
      doc.setTextColor(...TABLEAU_GRIS.texte);
      doc.setFontSize(10);
      doc.text('Aucune offre saisie pour ce lot.', W / 2, y + 30, { align: 'center' });
      return;
    }

    // Une offre partielle n'est ni moins-disante ni notée : elle ne couvre pas tout le lot.
    const montantsConformes = offresLot.filter(o => o.conforme && !o.partielle && o.montant_base > 0).map(o => o.montant_base);
    const minMontant = montantsConformes.length > 0 ? Math.min(...montantsConformes) : 0;
    const poidsPrix = consultation.criteres.find(c => c.id === 'prix')?.poids ?? 60;
    const poidsTech = consultation.criteres.find(c => c.id === 'tech')?.poids ?? 40;

    const head = [['Entreprise', 'Montant HT', '% / moins-disant', 'Conformité', 'Note prix', 'Note tech.', ...consultation.criteres.map(c => `${c.nom}\n(${c.poids}%)`), 'NOTE GLOBALE', 'Rang']];
    const body = offresLot.map(offre => {
      const entreprise = consultation.entreprises.find(e => e.id === offre.entreprise_id);
      const partielle = !!offre.partielle;
      const pctMinDisant = minMontant > 0 ? ((offre.montant_base - minMontant) / minMontant * 100).toFixed(1) + '%' : '—';
      const notePrix = offre.conforme && !partielle && offre.montant_base > 0 && minMontant > 0 ? (minMontant / offre.montant_base * 100).toFixed(1) : '—';
      const noteGlobale = !offre.conforme ? 'NC' : partielle ? '—'
        : ((parseFloat(notePrix) || 0) * poidsPrix / 100 + (offre.note_technique || 0) * poidsTech / 100).toFixed(1);
      const extraCriteres = consultation.criteres.filter(c => c.id !== 'prix' && c.id !== 'tech').map(() => '—');
      return [
        entreprise?.nom || '—',
        euros(offre.montant_base),
        !offre.conforme ? 'NC' : partielle ? '—' : `+${pctMinDisant}`,
        !offre.conforme ? `Non conforme : ${offre.motif_nc || 'motif non précisé'}`
          : partielle ? `Offre partielle${offre.perimetre ? ` : ${offre.perimetre}` : ''}` : 'Conforme',
        notePrix,
        partielle ? '—' : String(offre.note_technique || '—'),
        ...extraCriteres,
        noteGlobale,
        '—',
      ];
    });

    body.sort((a, b) => (parseFloat(b[b.length - 2]) || -1) - (parseFloat(a[a.length - 2]) || -1));
    body.forEach((row, i) => { row[row.length - 1] = String(i + 1); });

    autoTable(doc, {
      ...tableauGris(margin),
      startY: y,
      head,
      body,
      styles: { fontSize: 7.5, textColor: TABLEAU_GRIS.texte, cellPadding: 2 },
      columnStyles: { 0: { cellWidth: 40 } },
    });

    const attribution = consultation.attributions.find(a => a.lot_id === lot.id);
    if (attribution) {
      const entreprise = consultation.entreprises.find(e => e.id === attribution.entreprise_id);
      const finalY = (doc as any).lastAutoTable.finalY + 6;
      doc.setFillColor(...TABLEAU_GRIS.groupe);
      doc.rect(margin, finalY, W - 2 * margin, 10, 'F');
      doc.setTextColor(...TABLEAU_GRIS.texte);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(`LOT ATTRIBUÉ À : ${entreprise?.nom || '—'} — ${euros(attribution.montant)} HT`, margin + 3, finalY + 6.5);
    }
  });

  drawAgencyFooters(doc, settings, letterhead);
  doc.save(`RAO_${nomFichier(projectName)}_${lotId ? `Lot${lotId}` : 'Global'}.pdf`);
}

// ── Comparatif des offres (Excel) ─────────────────────────────────────────────

const cellule = (v: number | undefined | null): Cellule => (v == null ? '' : v);

/** Une quantité remise par une entreprise et différente de celle du document, prête à être tabulée. */
export interface LigneEcartQuantite {
  lot: string;
  entrepriseId: string;
  entreprise: string;
  code: string;
  titre: string;
  unite: string;
  quantiteDocument: number;
  quantiteEntreprise: number;
  ecart: number;
  prixUnitaire: number | null;
  /** (quantité entreprise - quantité du document) x P.U. ; null sans prix chiffré. */
  effet: number | null;
  acceptee: boolean;
}

/**
 * Les quantités changées par les entreprises, dans l'ordre des lots, puis du plus lourd en euros au plus léger
 * (les postes sans prix en dernier). Le document n'est jamais modifié : ces lignes ne font que les rapporter.
 */
export function lignesEcartsQuantites(
  lots: Array<{ id: string; lot_number: string; lot_title: string }>,
  comparatif: NonNullable<ConsultationExport['comparatif']>,
  entreprises: Array<{ id: string; nom: string }>,
): LigneEcartQuantite[] {
  const sortie: LigneEcartQuantite[] = [];
  for (const lot of lots) {
    const lignes: LigneEcartQuantite[] = [];
    for (const a of comparatif.find(c => c.lot_id === lot.id)?.articles ?? []) {
      if (!a.ecartsQuantites) continue;
      for (const e of entreprises) {
        const ec = a.ecartsQuantites[e.id];
        if (!ec) continue;
        const doc = a.quantite ?? 0;
        lignes.push({
          lot: `Lot ${lot.lot_number} - ${lot.lot_title}`, entrepriseId: e.id, entreprise: e.nom, code: a.code || '', titre: a.titre,
          unite: a.unite ?? '', quantiteDocument: doc, quantiteEntreprise: ec.quantite, ecart: ec.quantite - doc,
          prixUnitaire: ec.prixUnitaire, effet: ec.prixUnitaire != null ? (ec.quantite - doc) * ec.prixUnitaire : null, acceptee: ec.acceptee,
        });
      }
    }
    lignes.sort((x, y) => {
      if ((x.effet == null) !== (y.effet == null)) return x.effet == null ? 1 : -1;
      return Math.abs(y.effet ?? 0) - Math.abs(x.effet ?? 0) || x.code.localeCompare(y.code, 'fr', { numeric: true });
    });
    sortie.push(...lignes);
  }
  return sortie;
}

export async function generateComparatifExcel(
  lots: ProjectLot[],
  consultation: ConsultationExport,
  projectName: string,
  settings: AgencySettings = {},
): Promise<void> {
  const [wb, logo] = await Promise.all([nouveauClasseur(), chargerLogo(settings)]);
  const entreprises = consultation.entreprises;
  const comparatif = consultation.comparatif ?? [];
  const base = consultation.base_quantites ?? 'moe';
  const ecarts = lignesEcartsQuantites(lots, comparatif, entreprises);

  // ── Comparaison : une colonne par entreprise ───────────────────────────────
  const colonnes: Colonne[] = [
    { header: 'Code', width: 12 },
    { header: 'Titre', width: 45 },
    { header: 'Estimatif HT (€)', width: 16, align: 'right', numFmt: FORMAT_EURO },
    ...entreprises.map(e => ({ header: e.nom, width: 18, align: 'right' as const, numFmt: FORMAT_EURO })),
  ];
  const comparaison = ajouterFeuille(wb, {
    nom: 'Comparaison', settings, logo,
    title: 'Comparatif des offres',
    // Quand une entreprise a changé des quantités, le classeur dit sur quelle base les montants sont calculés.
    subtitle: ecarts.length ? `${projectName} - Base de comparaison : ${LIBELLE_BASE[base]}` : projectName,
    colonnes,
  });
  const vides = entreprises.map((): Cellule => '');

  for (const lot of lots) {
    const cl = comparatif.find(c => c.lot_id === lot.id);
    comparaison.ligne([`Lot ${lot.lot_number} - ${lot.lot_title}`, '', '', ...vides], { gras: true, fond: 'groupe' });
    for (const article of cl?.articles ?? []) {
      if (article.is_section_header) {
        comparaison.ligne([article.code || '', article.titre, '', ...vides], { gras: true, fond: 'doux' });
      } else if (article.is_subtotal) {
        comparaison.ligne(['', article.titre, '', ...entreprises.map(e => cellule(article.prix[e.id]))], { gras: true });
      } else {
        comparaison.ligne([article.code || '', titreArticle(article), cellule(article.estimatif), ...entreprises.map(e => cellule(article.prix[e.id]))]);
      }
    }
    comparaison.total([
      '', 'Sous-total du lot HT', '',
      ...entreprises.map(e => {
        const offre = consultation.offres.find(o => o.lot_id === lot.id && o.entreprise_id === e.id);
        return offre && offre.montant_base ? offre.montant_base : '';
      }),
    ]);
    comparaison.vide();
  }

  // ── Une feuille par entreprise ─────────────────────────────────────────────
  const noms = new Set<string>(['comparaison']);
  for (const e of entreprises) {
    // Les noms d'onglet sont uniques : deux entreprises aux 31 premiers caractères identiques se heurteraient.
    let nom = e.nom.substring(0, 31).replace(/[\\/:*?[\]]/g, '_') || 'Entreprise';
    for (let n = 2; noms.has(nom.toLowerCase()); n++) {
      nom = `${nom.substring(0, 28)} ${n}`;
    }
    noms.add(nom.toLowerCase());

    // Une entreprise qui a changé des quantités voit s'ajouter la quantité du document et la sienne.
    const avecQuantites = ecarts.some(x => x.entrepriseId === e.id);
    const f = ajouterFeuille(wb, {
      nom, settings, logo,
      title: e.nom,
      subtitle: `Offre — ${projectName}`,
      paysage: false,
      colonnes: [
        { header: 'Code', width: 12 },
        { header: 'Désignation', width: 45 },
        ...(avecQuantites ? [
          { header: 'Qté document', width: 14, align: 'right' as const, numFmt: FORMAT_QUANTITE },
          { header: 'Qté entreprise', width: 14, align: 'right' as const, numFmt: FORMAT_QUANTITE },
        ] : []),
        { header: 'Estimatif HT', width: 16, align: 'right', numFmt: FORMAT_EURO },
        { header: 'Offre HT', width: 18, align: 'right', numFmt: FORMAT_EURO },
      ],
    });
    for (const lot of lots) {
      const cl = comparatif.find(c => c.lot_id === lot.id);
      f.ligne([`Lot ${lot.lot_number} - ${lot.lot_title}`], { gras: true, fond: 'groupe', fusionner: true });
      for (const article of cl?.articles ?? []) {
        if (article.is_section_header || article.is_subtotal) continue;
        f.ligne([
          article.code || '', titreArticle(article),
          ...(avecQuantites ? [cellule(article.quantite), cellule(article.ecartsQuantites?.[e.id]?.quantite)] : []),
          cellule(article.estimatif), cellule(article.prix[e.id]),
        ]);
      }
      const offre = consultation.offres.find(o => o.lot_id === lot.id && o.entreprise_id === e.id);
      f.ligne(['', 'Total lot HT', ...(avecQuantites ? ['', ''] : []), '', offre?.montant_base ?? ''], { gras: true });
      f.vide();
    }
  }

  // ── Quantités modifiées par les entreprises ────────────────────────────────
  if (ecarts.length) {
    const q = ajouterFeuille(wb, {
      nom: 'Quantités modifiées', settings, logo,
      title: 'Quantités modifiées par les entreprises',
      subtitle: `${projectName} - Base de comparaison : ${LIBELLE_BASE[base]}`,
      colonnes: [
        { header: 'Entreprise', width: 28 },
        { header: 'Code', width: 12 },
        { header: 'Désignation', width: 45 },
        { header: 'U', width: 7 },
        { header: 'Qté document', width: 14, align: 'right', numFmt: FORMAT_QUANTITE },
        { header: 'Qté entreprise', width: 14, align: 'right', numFmt: FORMAT_QUANTITE },
        { header: 'Écart', width: 12, align: 'right', numFmt: FORMAT_QUANTITE },
        { header: 'P.U. HT (€)', width: 14, align: 'right', numFmt: FORMAT_EURO },
        { header: 'Effet HT (€)', width: 16, align: 'right', numFmt: FORMAT_EURO },
        { header: 'Acceptée', width: 11 },
      ],
    });
    let lotCourant = '';
    for (const l of ecarts) {
      if (l.lot !== lotCourant) { lotCourant = l.lot; q.ligne([l.lot, '', '', '', '', '', '', '', '', ''], { gras: true, fond: 'groupe' }); }
      q.ligne([l.entreprise, l.code, l.titre, l.unite, l.quantiteDocument, l.quantiteEntreprise, l.ecart, cellule(l.prixUnitaire), cellule(l.effet), l.acceptee ? 'Oui' : 'Non']);
    }
    q.vide();
    q.ligne(['Le DPGF (ou DQE) n\'est jamais modifié : une quantité acceptée ne change que l\'offre de l\'entreprise.'], { fusionner: true });
  }

  await enregistrerClasseur(wb, `Comparatif_${nomFichier(projectName)}.xlsx`);
}
