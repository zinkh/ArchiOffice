// ── Exports de l'analyse des offres (module ACT) ─────────────────────────────
// Le rapport d'analyse des offres (RAO, PDF) et le comparatif des offres
// (Excel). Mêmes règles que le reste des exports : charte du cabinet, nuances
// de gris, pagination « P1|2 ». Sortis de ACTModule.tsx pour y rester lisibles.
import type { ProjectLot } from '../types';
import type { AgencySettings } from './proposalExport';
import { drawAgencyHeader, drawAgencyFooters, loadLogoDataUrl, tableauGris, TABLEAU_GRIS } from './pdfLetterhead';
import {
  ajouterFeuille, chargerLogo, enregistrerClasseur, nouveauClasseur, FORMAT_EURO,
  type Cellule, type Colonne,
} from './xlsxLetterhead';

interface OffreExport {
  lot_id: string;
  entreprise_id: string;
  montant_base: number;
  note_technique: number;
  conforme: boolean;
  motif_nc?: string;
}

interface ComparatifArticleExport {
  code: string;
  titre: string;
  estimatif?: number;
  prix: Record<string, number>;
  is_section_header?: boolean;
  is_subtotal?: boolean;
}

/** Ce que ces exports lisent d'une consultation ; ACTModule en porte davantage. */
export interface ConsultationExport {
  entreprises: { id: string; nom: string }[];
  criteres: { id: string; nom: string; poids: number }[];
  offres: OffreExport[];
  attributions: { lot_id: string; entreprise_id: string; montant: number }[];
  comparatif?: { lot_id: string; articles: ComparatifArticleExport[] }[];
}

const nomFichier = (s: string) => s.replace(/\s+/g, '_');

const euros = (n?: number) =>
  n == null ? '—' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n).replace(/[  ]/g, ' ');

// ── RAO (PDF) ─────────────────────────────────────────────────────────────────

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

    const montantsConformes = offresLot.filter(o => o.conforme).map(o => o.montant_base);
    const minMontant = Math.min(...montantsConformes);
    const poidsPrix = consultation.criteres.find(c => c.id === 'prix')?.poids ?? 60;
    const poidsTech = consultation.criteres.find(c => c.id === 'tech')?.poids ?? 40;

    const head = [['Entreprise', 'Montant HT', '% / moins-disant', 'Conformité', 'Note prix', 'Note tech.', ...consultation.criteres.map(c => `${c.nom}\n(${c.poids}%)`), 'NOTE GLOBALE', 'Rang']];
    const body = offresLot.map(offre => {
      const entreprise = consultation.entreprises.find(e => e.id === offre.entreprise_id);
      const pctMinDisant = minMontant > 0 ? ((offre.montant_base - minMontant) / minMontant * 100).toFixed(1) + '%' : '—';
      const notePrix = offre.conforme && offre.montant_base > 0 ? (minMontant / offre.montant_base * 100).toFixed(1) : '—';
      const noteGlobale = offre.conforme
        ? ((parseFloat(notePrix) || 0) * poidsPrix / 100 + (offre.note_technique || 0) * poidsTech / 100).toFixed(1)
        : 'NC';
      const extraCriteres = consultation.criteres.filter(c => c.id !== 'prix' && c.id !== 'tech').map(() => '—');
      return [
        entreprise?.nom || '—',
        euros(offre.montant_base),
        offre.conforme ? `+${pctMinDisant}` : 'NC',
        offre.conforme ? 'Conforme' : `Non conforme : ${offre.motif_nc || 'motif non précisé'}`,
        notePrix,
        String(offre.note_technique || '—'),
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

export async function generateComparatifExcel(
  lots: ProjectLot[],
  consultation: ConsultationExport,
  projectName: string,
  settings: AgencySettings = {},
): Promise<void> {
  const [wb, logo] = await Promise.all([nouveauClasseur(), chargerLogo(settings)]);
  const entreprises = consultation.entreprises;
  const comparatif = consultation.comparatif ?? [];

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
    subtitle: projectName,
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
        comparaison.ligne([article.code || '', article.titre, cellule(article.estimatif), ...entreprises.map(e => cellule(article.prix[e.id]))]);
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

    const f = ajouterFeuille(wb, {
      nom, settings, logo,
      title: e.nom,
      subtitle: `Offre — ${projectName}`,
      paysage: false,
      colonnes: [
        { header: 'Code', width: 12 },
        { header: 'Désignation', width: 45 },
        { header: 'Estimatif HT', width: 16, align: 'right', numFmt: FORMAT_EURO },
        { header: 'Offre HT', width: 18, align: 'right', numFmt: FORMAT_EURO },
      ],
    });
    for (const lot of lots) {
      const cl = comparatif.find(c => c.lot_id === lot.id);
      f.ligne([`Lot ${lot.lot_number} - ${lot.lot_title}`], { gras: true, fond: 'groupe', fusionner: true });
      for (const article of cl?.articles ?? []) {
        if (article.is_section_header || article.is_subtotal) continue;
        f.ligne([article.code || '', article.titre, cellule(article.estimatif), cellule(article.prix[e.id])]);
      }
      const offre = consultation.offres.find(o => o.lot_id === lot.id && o.entreprise_id === e.id);
      f.ligne(['', 'Total lot HT', '', offre?.montant_base ?? ''], { gras: true });
      f.vide();
    }
  }

  await enregistrerClasseur(wb, `Comparatif_${nomFichier(projectName)}.xlsx`);
}
