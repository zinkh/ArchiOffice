// Export PDF du planning de chantier (Gantt par lot), à la charte du cabinet :
// en-tête avec logo sur la première page, nuances de gris, pied et « P1|2 ».
// Complet, ou limité à un lot pour remettre à chaque entreprise SON planning.
import { hexVersRgb, RESERVE_COULEUR_NEUTRE } from './reserveCouleurs';
import type { AgencySettings } from './proposalExport';
import { drawAgencyHeader, drawAgencyFooters, loadLogoDataUrl } from './pdfLetterhead';
import {
  AFFICHAGE_PLANNING, periodesPlanning, positionPlanning, ajouterJours, etatTache, type AffichagePlanning,
  aujourdhuiIso, bornesPlanning, planningParLot,
  type LotPlanifiable, type PlanningChantier,
} from './planningChantier';

export interface PlanningPdf { blob: Blob; filename: string }

export interface PlanningPdfOptions {
  project: { name: string; project_code?: string; address?: string };
  /** Limite le document au planning d'un lot (remis à son entreprise). */
  lotId?: string;
  affichage?: AffichagePlanning;
  couleurs?: Map<string, string>;
}

const MARGIN = 12;
const LABEL_W = 78;
const ROW_H = 5.2;
const GRIS_FOND = [236, 236, 236] as const;
const GRIS_BARRE = [150, 150, 150] as const;
const GRIS_FAIT = [45, 45, 45] as const;
const GRIS_GRILLE = [215, 215, 215] as const;

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
  const affichage = opts.affichage ?? AFFICHAGE_PLANNING;
  const lignes = planningParLot(planning, lots).filter(l => (!opts.lotId || l.lot?.id === opts.lotId) && (affichage.generales || l.lot));
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
    `Tous les lots dépliés ; tâches générales ${affichage.generales ? 'incluses' : 'masquées'}.`,
    affichage.relatif ? `Origine S1 / M1 : ${bornesPlanning(planning)?.debut ?? ''}` : 'Dates calendaires',
    `Édité le ${new Date().toLocaleDateString('fr-FR')}`,
  ].filter(Boolean).join('   ·   ');
  const resumeLignes = doc.splitTextToSize(resume, pageW - MARGIN * 2) as string[];
  doc.text(resumeLignes, MARGIN, y);
  y += resumeLignes.length * 4.5 + 3;

  if (!bornes || !lignes.length) {
    doc.setFont('helvetica', 'italic');
    doc.text('Aucune tâche planifiée.', MARGIN, y);
    drawAgencyFooters(doc, settings, letterhead);
    return { blob: doc.output('blob'), filename };
  }

  // Origine du planning complet, même pour un export limité à un lot.
  const total = bornesPlanning(planning)!;
  const periodes = periodesPlanning(total.debut, total.fin, affichage);
  const x0 = MARGIN + LABEL_W;
  const colW = (pageW - MARGIN - x0) / periodes.length;
  const premierLundi = periodes[0].debut;
  const xDate = (iso: string) => x0 + positionPlanning(iso, periodes) * colW;
  const xFin = (iso: string) => xDate(ajouterJours(iso, 1));
  const aujourdhui = aujourdhuiIso();

  /** Axe des mois et des semaines, redessiné en tête de chaque page. */
  const axe = (top: number): number => {
    doc.setFillColor(...GRIS_FOND);
    doc.rect(MARGIN, top, pageW - MARGIN * 2, 9, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(17, 24, 39);
    doc.text('Lot / tâche', MARGIN + 1.5, top + 5.6);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5);
    // Éviter la superposition des libellés pour un planning long.
    const pas = Math.max(1, Math.ceil(15 / colW));
    periodes.forEach((p, i) => {
      if (i % pas === 0) doc.text(p.libelle, x0 + i * colW + 0.5, top + 5.6);
    });
    return top + 9;
  };

  const grille = (top: number, bas: number) => {
    doc.setDrawColor(...GRIS_GRILLE); doc.setLineWidth(0.1);
    periodes.forEach((_, i) => doc.line(x0 + i * colW, top, x0 + i * colW, bas));
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
    const couleur = hexVersRgb(opts.couleurs?.get(ligne.lot?.id ?? '') ?? RESERVE_COULEUR_NEUTRE);
    place(ROW_H * 2);
    const nom = ligne.lot ? `Lot ${ligne.lot.lot_number}  ${ligne.lot.lot_title}` : 'Tâches générales du chantier';
    doc.setFillColor(...GRIS_FOND); doc.rect(MARGIN, y, pageW - MARGIN * 2, ROW_H, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(17, 24, 39);
    doc.text(coupe(nom, LABEL_W - 3), MARGIN + 1.5, y + ROW_H * 0.7);
    // Barre de synthèse du lot, fine.
    doc.setFillColor(...couleur);
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
      const retard = etatTache(t, aujourdhui) === 'en_retard' ? ' [Retard]' : '';
      doc.text(coupe(`${t.avancement} %${retard} ${t.libelle}`, LABEL_W - 24), MARGIN + 4, y + ROW_H * 0.7);
      doc.setFontSize(6); doc.setTextColor(90, 90, 90);
      doc.text(`${fmt(t.debut).slice(0, 5)} - ${fmt(t.fin).slice(0, 5)}`, x0 - 1.5, y + ROW_H * 0.7, { align: 'right' });
      if (t.jalon) {
        doc.setFillColor(...couleur);
        doc.circle(xDate(t.debut) + 0.5, y + ROW_H / 2, 1.3, 'F');
      } else {
        const bx = xDate(t.debut);
        const bw = Math.max(0.8, xFin(t.fin) - bx);
        doc.setFillColor(...couleur); doc.rect(bx, y + 1, bw, ROW_H - 2, 'F');
        if (t.avancement > 0) { doc.setFillColor(...GRIS_FAIT); doc.rect(bx, y + 1, bw * (t.avancement / 100), ROW_H - 2, 'F'); }
      }
      y += ROW_H;
    }
  }
  grille(topGrille, y);

  const presentes = new Set(lignes.flatMap(l => l.taches.map(t => t.id)));
  const liaisons = planning.taches.flatMap(t => (t.dependencies ?? []).map(id => ({ t, p: planning.taches.find(p => p.id === id) }))).filter(l => l.p && presentes.has(l.t.id));
  if (liaisons.length) {
    y += 5; place(8); doc.setFontSize(8); doc.setTextColor(17, 24, 39);
    doc.text('Dépendances (fin à début, sans déplacement automatique)', MARGIN, y);
    for (const { t, p } of liaisons) {
      y += 4; place(4); doc.setFontSize(7);
      doc.text(coupe(`${p!.libelle} -> ${t.libelle}${!presentes.has(p!.id) ? ' (prédécesseur hors périmètre)' : ''}${t.debut <= p!.fin ? ' : dates incohérentes' : ''}`, pageW - MARGIN * 2), MARGIN, y);
    }
  }

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
