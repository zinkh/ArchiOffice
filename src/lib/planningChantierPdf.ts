// Export PDF du planning de chantier (Gantt par lot), à la charte du cabinet :
// en-tête avec logo sur la première page, nuances de gris, pied et « P1|2 ».
// Complet, ou limité à un lot pour remettre à chaque entreprise SON planning.
import type { AgencySettings } from './proposalExport';
import { drawAgencyHeader, drawAgencyFooters, loadLogoDataUrl } from './pdfLetterhead';
import {
  aujourdhuiIso, bornesPlanning, joursEntre, planningParLot, semainesEntre,
  type LotPlanifiable, type PlanningChantier,
} from './planningChantier';

export interface PlanningPdf { blob: Blob; filename: string }

export interface PlanningPdfOptions {
  project: { name: string; project_code?: string; address?: string };
  /** Limite le document au planning d'un lot (remis à son entreprise). */
  lotId?: string;
}

const MARGIN = 12;
const LABEL_W = 78;
const ROW_H = 5.2;
const GRIS_FOND = [236, 236, 236] as const;
const GRIS_BARRE = [150, 150, 150] as const;
const GRIS_FAIT = [45, 45, 45] as const;
const GRIS_GRILLE = [215, 215, 215] as const;
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const fmt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const nettoyer = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');

export async function exportPlanningToPDF(
  planning: PlanningChantier,
  lots: LotPlanifiable[],
  settings: AgencySettings,
  opts: PlanningPdfOptions,
): Promise<PlanningPdf> {
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const lot = opts.lotId ? lots.find(l => l.id === opts.lotId) : undefined;
  const lignes = planningParLot(planning, lots).filter(l => !opts.lotId || l.lot?.id === opts.lotId);
  const bornes = bornesPlanning({ ...planning, taches: lignes.flatMap(l => l.taches) });

  const titre = lot ? `Planning de chantier, lot ${lot.lot_number} ${lot.lot_title}` : 'Planning de chantier';
  const logo = await loadLogoDataUrl(settings.logoUrl);
  const letterhead = { title: titre, subtitle: opts.project.name, reference: opts.project.project_code, margin: MARGIN, logo };
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const filename = `Planning_${nettoyer(opts.project.project_code || '')}_${nettoyer(opts.project.name)}${lot ? `_lot${nettoyer(lot.lot_number)}` : ''}.pdf`;

  let y = drawAgencyHeader(doc, settings, letterhead) + 2;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(17, 24, 39);
  doc.text(titre, MARGIN, y);
  y += 5.5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(75, 85, 99);
  const resume = [
    [opts.project.project_code, opts.project.name].filter(Boolean).join(' - '),
    opts.project.address,
    bornes ? `Du ${fmt(bornes.debut)} au ${fmt(bornes.fin)}` : null,
    lot?.contact_name ? `Entreprise : ${lot.contact_name}` : null,
    `Édité le ${new Date().toLocaleDateString('fr-FR')}`,
  ].filter(Boolean).join('   ·   ');
  doc.text(doc.splitTextToSize(resume, pageW - MARGIN * 2) as string[], MARGIN, y);
  y += 7;

  if (!bornes || !lignes.length) {
    doc.setFont('helvetica', 'italic');
    doc.text('Aucune tâche planifiée.', MARGIN, y);
    drawAgencyFooters(doc, settings, letterhead);
    return { blob: doc.output('blob'), filename };
  }

  const semaines = semainesEntre(bornes.debut, bornes.fin);
  const x0 = MARGIN + LABEL_W;
  const colW = (pageW - MARGIN - x0) / semaines.length;
  const premierLundi = semaines[0];
  const xDate = (iso: string) => x0 + (joursEntre(premierLundi, iso) / 7) * colW;
  // Fin d'une tâche = fin du dernier jour travaillé (le vendredi occupe sa case jusqu'au dimanche).
  const xFin = (iso: string) => xDate(iso) + colW / 7;
  const aujourdhui = aujourdhuiIso();

  /** Axe des mois et des semaines, redessiné en tête de chaque page. */
  const axe = (top: number): number => {
    doc.setFillColor(...GRIS_FOND);
    doc.rect(MARGIN, top, pageW - MARGIN * 2, 9, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(17, 24, 39);
    doc.text('Lot / tâche', MARGIN + 1.5, top + 5.6);
    let debutMois = 0;
    semaines.forEach((lundi, i) => {
      const mois = lundi.slice(0, 7);
      if (i < semaines.length - 1 && semaines[i + 1].slice(0, 7) === mois) return;
      const largeur = (i - debutMois + 1) * colW;
      const etiquette = largeur > 12 ? `${MOIS[Number(mois.slice(5, 7)) - 1]} ${mois.slice(0, 4)}` : largeur > 6 ? MOIS[Number(mois.slice(5, 7)) - 1] : '';
      if (etiquette) doc.text(etiquette, x0 + debutMois * colW + 1, top + 3.4);
      doc.setDrawColor(...GRIS_GRILLE); doc.setLineWidth(0.15);
      doc.line(x0 + (i + 1) * colW, top, x0 + (i + 1) * colW, top + 9);
      debutMois = i + 1;
    });
    if (colW >= 4.2) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); doc.setTextColor(75, 85, 99);
      semaines.forEach((lundi, i) => doc.text(lundi.slice(8, 10), x0 + i * colW + colW / 2, top + 7.8, { align: 'center' }));
    }
    return top + 9;
  };

  const grille = (top: number, bas: number) => {
    doc.setDrawColor(...GRIS_GRILLE); doc.setLineWidth(0.1);
    semaines.forEach((_, i) => doc.line(x0 + i * colW, top, x0 + i * colW, bas));
    if (aujourdhui >= premierLundi && aujourdhui <= bornes.fin) {
      doc.setDrawColor(60, 60, 60); doc.setLineWidth(0.35);
      doc.line(xDate(aujourdhui), top, xDate(aujourdhui), bas);
    }
  };

  y = axe(y);
  let topGrille = y;
  const place = (h: number) => {
    if (y + h <= pageH - 16) return;
    grille(topGrille, y);
    doc.addPage();
    y = axe(drawAgencyHeader(doc, settings, letterhead) + 2);
    topGrille = y;
  };
  const coupe = (texte: string, largeur: number) => (doc.splitTextToSize(texte, largeur) as string[])[0] ?? '';

  for (const ligne of lignes) {
    place(ROW_H * 2);
    const nom = ligne.lot ? `Lot ${ligne.lot.lot_number}  ${ligne.lot.lot_title}` : 'Tâches générales du chantier';
    doc.setFillColor(...GRIS_FOND); doc.rect(MARGIN, y, pageW - MARGIN * 2, ROW_H, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(17, 24, 39);
    doc.text(coupe(nom, LABEL_W - 3), MARGIN + 1.5, y + ROW_H * 0.7);
    // Barre de synthèse du lot, fine.
    doc.setFillColor(...GRIS_BARRE);
    doc.rect(xDate(ligne.debut), y + ROW_H * 0.38, Math.max(0.8, xFin(ligne.fin) - xDate(ligne.debut)), ROW_H * 0.24, 'F');
    y += ROW_H;
    if (ligne.lot?.contact_name) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(6.5); doc.setTextColor(90, 90, 90);
      doc.text(coupe(ligne.lot.contact_name, LABEL_W - 6), MARGIN + 4, y + ROW_H * 0.6);
      y += ROW_H * 0.85;
    }
    for (const t of ligne.taches) {
      place(ROW_H);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(17, 24, 39);
      doc.text(coupe(t.libelle, LABEL_W - 24), MARGIN + 4, y + ROW_H * 0.7);
      doc.setFontSize(6); doc.setTextColor(90, 90, 90);
      doc.text(`${fmt(t.debut).slice(0, 5)} - ${fmt(t.fin).slice(0, 5)}`, x0 - 1.5, y + ROW_H * 0.7, { align: 'right' });
      if (t.jalon) {
        doc.setFillColor(...GRIS_FAIT);
        doc.circle(xDate(t.debut) + colW / 14 * 5, y + ROW_H / 2, 1.3, 'F');
      } else {
        const bx = xDate(t.debut);
        const bw = Math.max(0.8, xFin(t.fin) - bx);
        doc.setFillColor(...GRIS_BARRE); doc.rect(bx, y + 1, bw, ROW_H - 2, 'F');
        if (t.avancement > 0) { doc.setFillColor(...GRIS_FAIT); doc.rect(bx, y + 1, bw * (t.avancement / 100), ROW_H - 2, 'F'); }
      }
      y += ROW_H;
    }
  }
  grille(topGrille, y);

  if (planning.hypotheses.length && !opts.lotId) {
    y += 4; place(8);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(17, 24, 39);
    doc.text('Hypothèses retenues', MARGIN, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(75, 85, 99);
    for (const h of planning.hypotheses) {
      y += 4; place(4);
      doc.text(coupe(`- ${h}`, pageW - MARGIN * 2), MARGIN, y);
    }
  }

  y += 7; place(6);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(75, 85, 99);
  doc.setFillColor(...GRIS_BARRE); doc.rect(MARGIN, y - 2.5, 8, 3, 'F'); doc.text('Prévu', MARGIN + 10, y);
  doc.setFillColor(...GRIS_FAIT); doc.rect(MARGIN + 26, y - 2.5, 8, 3, 'F'); doc.text('Réalisé', MARGIN + 36, y);
  doc.circle(MARGIN + 58, y - 1, 1.3, 'F'); doc.text('Jalon', MARGIN + 61, y);

  drawAgencyFooters(doc, settings, letterhead);
  return { blob: doc.output('blob'), filename };
}
