// Export PDF du planning de chantier (Gantt par lot), à la charte du cabinet :
// en-tête avec logo sur la première page, nuances de gris, pied et « P1|2 ».
// Complet, ou limité à un lot pour remettre à chaque entreprise SON planning.
import { estOuvreDuPlanning, reperesCalendrierPlanning } from './planningChantierCalendrier';
import { hexVersRgb, RESERVE_COULEUR_NEUTRE } from './reserveCouleurs';
import type { AgencySettings } from './proposalExport';
import { drawAgencyHeader, drawAgencyFooters, loadLogoDataUrl } from './pdfLetterhead';
import {
  CALENDRIER_PLANNING, AFFICHAGE_PLANNING, periodesPlanning, positionPlanning, ajouterJours, etatTache, type AffichagePlanning,
  aujourdhuiIso, bornesPlanning, planningParLot, incoherencesDependances,
  type LotPlanifiable, type PlanningChantier, type PeriodePlanning,
} from './planningChantier';

export interface PlanningPdf { blob: Blob; filename: string }

export type FormatPdfPlanning = 'a4' | 'a3';
/** Plage de dates AAAA-MM-JJ à imprimer ; une borne absente laisse le planning ouvert de ce côté. */
export interface PlagePdfPlanning { debut?: string; fin?: string }

export interface PlanningPdfOptions {
  project: { name: string; project_code?: string; address?: string };
  /** Limite le document au planning d'un lot (remis à son entreprise). */
  lotId?: string;
  affichage?: AffichagePlanning;
  couleurs?: Map<string, string>;
  /** A4 par défaut ; A3 agrandit la page et les caractères (plannings longs). */
  format?: FormatPdfPlanning;
  plage?: PlagePdfPlanning;
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

export interface BandeAxePlanning { libelle: string; court: string; debut: number; fin: number }

/**
 * Bandeau d'axe au-dessus des périodes : mois pour des semaines, année pour des mois.
 * Aucun bandeau en calendrier relatif (S1, M1) : les dates y sont une origine, pas un calendrier.
 * Une semaine appartient au mois de son jeudi, comme la numérotation ISO.
 */
export function bandesAxePlanning(periodes: PeriodePlanning[], affichage: AffichagePlanning): BandeAxePlanning[] {
  if (affichage.relatif) return [];
  const hebdo = affichage.echelle === 'semaines';
  const bandes: BandeAxePlanning[] = [];
  let cle = '';
  periodes.forEach((p, i) => {
    const ref = hebdo ? ajouterJours(p.debut, 3) : p.debut;
    const k = hebdo ? ref.slice(0, 7) : ref.slice(0, 4);
    if (k !== cle) {
      cle = k;
      const m = Number(ref.slice(5, 7)) - 1;
      bandes.push(hebdo
        ? { libelle: `${MOIS[m]} ${ref.slice(0, 4)}`, court: `${MOIS_COURTS[m]} ${ref.slice(2, 4)}`, debut: i, fin: i + 1 }
        : { libelle: ref.slice(0, 4), court: ref.slice(2, 4), debut: i, fin: i + 1 });
    } else bandes[bandes.length - 1].fin = i + 1;
  });
  return bandes;
}

/** Périodes qui rencontrent la plage ; la numérotation (S1, M1) reste celle du planning complet. */
export function periodesDansPlage(periodes: PeriodePlanning[], plage?: PlagePdfPlanning): PeriodePlanning[] {
  return periodes.filter(p => (!plage?.debut || p.fin >= plage.debut) && (!plage?.fin || p.debut <= plage.fin));
}
export const tacheDansPlage = (t: { debut: string; fin: string }, plage?: PlagePdfPlanning): boolean =>
  (!plage?.debut || t.fin >= plage.debut) && (!plage?.fin || t.debut <= plage.fin);

const MARGIN = 12;
const GRIS_FOND = [236, 236, 236] as const;
const GRIS_BARRE = [150, 150, 150] as const;
const GRIS_FAIT = [45, 45, 45] as const;
const GRIS_GRILLE = [215, 215, 215] as const;
const GRIS_REPERE = [170, 170, 170] as const;

const fmt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const nettoyer = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');

export async function exportPlanningToPDF(
  planning: PlanningChantier,
  lots: LotPlanifiable[],
  settings: AgencySettings,
  opts: PlanningPdfOptions,
): Promise<PlanningPdf> {
  const { default: jsPDF } = await import('jspdf');
  const format = opts.format === 'a3' ? 'a3' : 'a4';
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format });
  // A3 : même mise en page, caractères et lignes agrandis d'un quart.
  const K = format === 'a3' ? 1.25 : 1;
  const ROW_H = 5.2 * K;
  const taille = (pt: number) => doc.setFontSize(pt * K);
  const plage = opts.plage;
  const lot = opts.lotId ? lots.find(l => l.id === opts.lotId) : undefined;
  const affichage = opts.affichage ?? AFFICHAGE_PLANNING;
  // La largeur des périodes est un zoom écran. Le PDF ajuste toujours toutes les périodes.
  const LABEL_W = Math.min(140 * K, Math.max(40 * K, 78 * K * affichage.largeurLibelles / AFFICHAGE_PLANNING.largeurLibelles));
  const lignes = planningParLot(planning, lots)
    .filter(l => (!opts.lotId || l.lot?.id === opts.lotId) && (affichage.generales || l.lot))
    .map(l => ({ ...l, taches: l.taches.filter(t => tacheDansPlage(t, plage)) }))
    .filter(l => l.taches.length);
  const bornes = bornesPlanning({ ...planning, taches: lignes.flatMap(l => l.taches) });

  const titre = lot ? `Planning de chantier, lot ${lot.lot_number} ${lot.lot_title}` : 'Planning de chantier';
  const logo = await loadLogoDataUrl(settings.logoUrl);
  const letterhead = { title: titre, subtitle: opts.project.name, reference: opts.project.project_code, margin: MARGIN, logo };
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const filename = `Planning_${nettoyer(opts.project.project_code || '')}_${nettoyer(opts.project.name)}${lot ? `_lot${nettoyer(lot.lot_number)}` : ''}.pdf`;

  let y = drawAgencyHeader(doc, settings, letterhead) + 2;
  doc.setFont('helvetica', 'bold'); taille(14); doc.setTextColor(17, 24, 39);
  doc.text(titre, MARGIN, y);
  y += 5.5 * K;
  doc.setFont('helvetica', 'normal'); taille(9); doc.setTextColor(75, 85, 99);
  const resume = [
    [opts.project.project_code, opts.project.name].filter(Boolean).join(' - '),
    opts.project.address,
    bornes ? `Du ${fmt(bornes.debut)} au ${fmt(bornes.fin)}` : null,
    plage?.debut || plage?.fin ? `Période imprimée : ${plage.debut ? `du ${fmt(plage.debut)}` : 'depuis le début'} ${plage.fin ? `au ${fmt(plage.fin)}` : 'jusqu’à la fin'}` : null,
    lot?.contact_name ? `Entreprise : ${lot.contact_name}` : null,
    `Tous les lots dépliés ; tâches générales ${affichage.generales ? 'incluses' : 'masquées'}.`,
    affichage.relatif ? `Origine S1 / M1 : ${bornesPlanning(planning)?.debut ?? ''}` : 'Dates calendaires',
    planning.calendrier?.joursOuvres ? 'Délais et décalages calculés en jours ouvrés' : null,
    `Édité le ${new Date().toLocaleDateString('fr-FR')}`,
  ].filter(Boolean).join('   ·   ');
  const resumeLignes = doc.splitTextToSize(resume, pageW - MARGIN * 2) as string[];
  doc.text(resumeLignes, MARGIN, y);
  y += resumeLignes.length * 4.5 * K + 3;

  // Origine du planning complet, même pour un export limité à un lot ou à une plage.
  const total = bornesPlanning(planning);
  const periodes = total ? periodesDansPlage(periodesPlanning(total.debut, total.fin, affichage), plage) : [];
  if (!bornes || !lignes.length || !periodes.length) {
    doc.setFont('helvetica', 'italic');
    doc.text(plage?.debut || plage?.fin ? 'Aucune tâche planifiée sur cette période.' : 'Aucune tâche planifiée.', MARGIN, y);
    drawAgencyFooters(doc, settings, letterhead);
    return { blob: doc.output('blob'), filename };
  }

  const x0 = MARGIN + LABEL_W;
  const colW = (pageW - MARGIN - x0) / periodes.length;
  const premierLundi = periodes[0].debut;
  const derniereFin = periodes[periodes.length - 1].fin;
  const xDate = (iso: string) => x0 + positionPlanning(iso, periodes) * colW;
  const xFin = (iso: string) => xDate(ajouterJours(iso, 1));
  const aujourdhui = aujourdhuiIso();
  const aujourdhuiVisible = aujourdhui >= premierLundi && aujourdhui <= derniereFin;
  const reperes = reperesCalendrierPlanning(planning.calendrier ?? CALENDRIER_PLANNING, periodes[0].debut, periodes[periodes.length - 1].fin, affichage);
  const bandes = reperes.map(r => ({ r, bx: xDate(r.debut), bw: Math.max(0.2, xFin(r.fin) - xDate(r.debut)) }));
  const bandesAxe = bandesAxePlanning(periodes, affichage);
  const debutsDeBande = new Set(bandesAxe.map(b => b.debut));
  const hachures = (bx: number, top: number, bw: number, h: number) => {
    doc.setDrawColor(195, 200, 207); doc.setLineWidth(0.1);
    for (let offset = -h; offset < bw; offset += 2) {
      const a = Math.max(0, offset), b = Math.min(bw, offset + h);
      doc.line(bx + a, top + h - (a - offset), bx + b, top + h - (b - offset));
    }
  };
  const peindreCalendrier = (top: number, h: number) => {
    for (const { r, bx, bw } of bandes) {
      if (r.type === 'ferie') { doc.setFillColor(225, 236, 250); doc.rect(bx, top, bw, h, 'F'); }
      else hachures(bx, top, bw, h);
    }
  };

  /** Meilleur libellé de bandeau qui tient dans sa largeur. */
  const libelleBande = (b: BandeAxePlanning, largeur: number) =>
    [b.libelle, b.court].find(l => doc.getTextWidth(l) + 1.5 <= largeur) ?? '';

  /** Axe : repère « Aujourd'hui », bandeau mois ou année, périodes, calendrier. Redessiné en tête de chaque page. */
  const axe = (top: number): number => {
    const hRepere = aujourdhuiVisible ? 3.6 * K : 0;
    const hBandeau = bandesAxe.length ? 4.2 * K : 0;
    const hPeriodes = 9 * K;
    const haut = top + hRepere;
    doc.setFillColor(...GRIS_FOND);
    doc.rect(MARGIN, haut, pageW - MARGIN * 2, hBandeau + hPeriodes, 'F');
    doc.setFont('helvetica', 'bold'); taille(7); doc.setTextColor(17, 24, 39);
    doc.text('Lot / tâche', MARGIN + 1.5, haut + hBandeau + 5.6 * K);
    if (bandesAxe.length) {
      doc.setDrawColor(...GRIS_GRILLE); doc.setLineWidth(0.1);
      doc.setFont('helvetica', 'bold'); taille(6);
      for (const b of bandesAxe) {
        const bx = x0 + b.debut * colW, bw = (b.fin - b.debut) * colW;
        doc.line(bx, haut, bx, haut + hBandeau + hPeriodes);
        doc.text(libelleBande(b, bw), bx + 0.8, haut + hBandeau - 1.2 * K);
      }
    }
    doc.setFont('helvetica', 'normal'); taille(5.5); doc.setTextColor(17, 24, 39);
    // Éviter la superposition des libellés pour un planning long.
    const pas = Math.max(1, Math.ceil(15 * K / colW));
    periodes.forEach((p, i) => {
      if (i % pas === 0) doc.text(p.libelle, x0 + i * colW + 0.5, haut + hBandeau + 5.6 * K);
    });
    peindreCalendrier(haut + hBandeau + 7 * K, 2 * K);
    if (aujourdhuiVisible) {
      const libelle = 'Aujourd’hui';
      doc.setFont('helvetica', 'bold'); taille(5.5);
      const w = doc.getTextWidth(libelle) + 2.4;
      const px = Math.min(pageW - MARGIN - w, Math.max(MARGIN, xDate(aujourdhui) - w / 2));
      doc.setFillColor(60, 60, 60); doc.rect(px, top, w, hRepere - 0.4, 'F');
      doc.setTextColor(255, 255, 255); doc.text(libelle, px + 1.2, top + hRepere - 1.1 * K);
      doc.setTextColor(17, 24, 39);
      doc.setDrawColor(60, 60, 60); doc.setLineWidth(0.35);
      doc.line(xDate(aujourdhui), top + hRepere - 0.4, xDate(aujourdhui), haut + hBandeau + hPeriodes);
    }
    return haut + hBandeau + hPeriodes;
  };

  const grille = (top: number, bas: number) => {
    periodes.forEach((_, i) => {
      // Trait plus marqué au début de chaque mois (ou année), pour lire l'échelle sans l'axe.
      const debutDeBande = i > 0 && debutsDeBande.has(i);
      const [r, g, b] = debutDeBande ? GRIS_REPERE : GRIS_GRILLE;
      doc.setDrawColor(r, g, b);
      doc.setLineWidth(debutDeBande ? 0.22 : 0.1);
      doc.line(x0 + i * colW, top, x0 + i * colW, bas);
    });
    if (aujourdhuiVisible) {
      doc.setDrawColor(60, 60, 60); doc.setLineWidth(0.35);
      doc.line(xDate(aujourdhui), top, xDate(aujourdhui), bas);
    }
  };

  y = axe(y);
  let topGrille = y;
  let dansGrille = true;
  /** Lot en cours d'impression : rappelé en tête d'une page qui prolonge sa liste de tâches. */
  let lotCourant: string | null = null;
  const ligneSuite = () => {
    doc.setFillColor(...GRIS_FOND); doc.rect(MARGIN, y, pageW - MARGIN * 2, ROW_H, 'F');
    peindreCalendrier(y, ROW_H);
    doc.setFont('helvetica', 'bolditalic'); taille(7.5); doc.setTextColor(17, 24, 39);
    doc.text(coupe(`${lotCourant} (suite)`, LABEL_W - 3), MARGIN + 1.5, y + ROW_H * 0.7);
    y += ROW_H;
  };
  const place = (h: number) => {
    if (y + h <= pageH - 16) return;
    if (dansGrille) grille(topGrille, y);
    doc.addPage();
    const haut = drawAgencyHeader(doc, settings, letterhead) + 2;
    y = dansGrille ? axe(haut) : haut;
    topGrille = y;
    if (dansGrille && lotCourant) ligneSuite();
  };
  function coupe(texte: string, largeur: number) { return (doc.splitTextToSize(texte, largeur) as string[])[0] ?? ''; }

  for (const ligne of lignes) {
    const couleur = hexVersRgb(opts.couleurs?.get(ligne.lot?.id ?? '') ?? RESERVE_COULEUR_NEUTRE);
    // Un titre de lot n'est jamais seul en bas de page : il emporte avec lui son entreprise et sa première tâche.
    lotCourant = null;
    place(ROW_H + (ligne.lot?.contact_name ? ROW_H * 0.85 : 0) + ROW_H);
    const nom = ligne.lot ? `Lot ${ligne.lot.lot_number}  ${ligne.lot.lot_title}` : 'Tâches générales du chantier';
    doc.setFillColor(...GRIS_FOND); doc.rect(MARGIN, y, pageW - MARGIN * 2, ROW_H, 'F');
    peindreCalendrier(y, ROW_H);
    doc.setFont('helvetica', 'bold'); taille(7.5); doc.setTextColor(17, 24, 39);
    doc.text(coupe(nom, LABEL_W - 3), MARGIN + 1.5, y + ROW_H * 0.7);
    // Barre de synthèse du lot, fine.
    doc.setFillColor(...couleur);
    doc.rect(xDate(ligne.debut), y + ROW_H * 0.38, Math.max(0.8, xFin(ligne.fin) - xDate(ligne.debut)), ROW_H * 0.24, 'F');
    y += ROW_H;
    if (ligne.lot?.contact_name) {
      doc.setFont('helvetica', 'italic'); taille(6.5); doc.setTextColor(90, 90, 90);
      doc.text(coupe(ligne.lot.contact_name, LABEL_W - 6), MARGIN + 4, y + ROW_H * 0.6);
      y += ROW_H * 0.85;
    }
    lotCourant = nom;
    for (const t of ligne.taches) {
      place(ROW_H);
      peindreCalendrier(y, ROW_H);
      doc.setFont('helvetica', 'normal'); taille(7); doc.setTextColor(17, 24, 39);
      const retard = etatTache(t, aujourdhui) === 'en_retard' ? ' [Retard]' : '';
      doc.text(coupe(`${affichage.avancement ? `${t.avancement} % ` : ''}${retard} ${t.libelle}`, LABEL_W - 24 * K), MARGIN + 4, y + ROW_H * 0.7);
      taille(6); doc.setTextColor(90, 90, 90);
      doc.text(`${fmt(t.debut).slice(0, 5)} - ${fmt(t.fin).slice(0, 5)}`, x0 - 1.5, y + ROW_H * 0.7, { align: 'right' });
      if (t.jalon) {
        doc.setFillColor(...couleur);
        doc.circle(xDate(t.debut) + 0.5, y + ROW_H / 2, 1.3 * K, 'F');
      } else {
        const bx = xDate(t.debut);
        const bw = Math.max(0.8, xFin(t.fin) - bx);
        doc.setFillColor(...couleur); doc.rect(bx, y + 1, bw, ROW_H - 2, 'F');
        if (affichage.avancement && t.avancement > 0) { doc.setFillColor(...GRIS_FAIT); doc.rect(bx, y + 1, bw * (t.avancement / 100), ROW_H - 2, 'F'); }
      }
      y += ROW_H;
    }
  }
  lotCourant = null;
  grille(topGrille, y);
  dansGrille = false;

  const presentes = new Set(lignes.flatMap(l => l.taches.map(t => t.id)));
  const liaisons = planning.taches.flatMap(t => (t.dependencies ?? []).map(id => ({ t, p: planning.taches.find(p => p.id === id) }))).filter(l => l.p && presentes.has(l.t.id));
  if (liaisons.length) {
    // Même critère que l'écran : écart insuffisant, délai du lien et jours ouvrés compris.
    const ouvre = estOuvreDuPlanning(planning.calendrier);
    const incoherentes = new Set(incoherencesDependances(planning.taches, ouvre).map(c => `${c.precedent.id}:${c.tache.id}`));
    const unite = planning.calendrier?.joursOuvres ? 'ouvré' : 'calendaire';
    y += 5; place(8); taille(8); doc.setTextColor(17, 24, 39);
    doc.text('Dépendances (fin à début, dates modifiables)', MARGIN, y);
    for (const { t, p } of liaisons) {
      const delai = t.delais?.[p!.id] ?? 0;
      y += 4; place(4); taille(7);
      doc.text(coupe(`${p!.libelle} -> ${t.libelle}${delai ? ` (délai ${delai} jour${delai > 1 ? 's' : ''} ${unite}${delai > 1 ? 's' : ''})` : ''}${!presentes.has(p!.id) ? ' (prédécesseur hors périmètre)' : ''}${incoherentes.has(`${p!.id}:${t.id}`) ? ' : dates incohérentes' : ''}`, pageW - MARGIN * 2), MARGIN, y);
    }
  }

  if (reperes.length) {
    y += 5; place(8); doc.setFont('helvetica', 'bold'); taille(8); doc.setTextColor(17, 24, 39);
    doc.text('Calendrier : jours fériés en bleu, congés hachurés (dates inchangées)', MARGIN, y);
    doc.setFont('helvetica', 'normal'); taille(7);
    for (const r of reperes) {
      y += 4; place(4);
      doc.text(coupe(`${fmt(r.debut)}${r.fin !== r.debut ? ` - ${fmt(r.fin)}` : ''} : ${r.libelle}`, pageW - MARGIN * 2), MARGIN, y);
    }
  }

  if (planning.hypotheses.length && !opts.lotId) {
    y += 4; place(8);
    doc.setFont('helvetica', 'bold'); taille(8); doc.setTextColor(17, 24, 39);
    doc.text('Hypothèses retenues', MARGIN, y);
    doc.setFont('helvetica', 'normal'); taille(7.5); doc.setTextColor(75, 85, 99);
    for (const h of planning.hypotheses) {
      y += 4; place(4);
      doc.text(coupe(`- ${h}`, pageW - MARGIN * 2), MARGIN, y);
    }
  }

  // Légende : seulement ce qui figure sur le document.
  const enRetard = lignes.some(l => l.taches.some(t => etatTache(t, aujourdhui) === 'en_retard'));
  const elements: { texte: string; dessiner: (x: number, yy: number) => void; largeur: number }[] = [
    { texte: 'Prévu', largeur: 8, dessiner: (x, yy) => { doc.setFillColor(...GRIS_BARRE); doc.rect(x, yy - 2.5, 8, 3, 'F'); } },
  ];
  if (affichage.avancement) elements.push({ texte: 'Réalisé', largeur: 8, dessiner: (x, yy) => { doc.setFillColor(...GRIS_FAIT); doc.rect(x, yy - 2.5, 8, 3, 'F'); } });
  elements.push({ texte: 'Jalon', largeur: 3, dessiner: (x, yy) => { doc.setFillColor(...GRIS_BARRE); doc.circle(x + 1.3, yy - 1, 1.3, 'F'); } });
  if (enRetard) elements.push({ texte: '[Retard] tâche en retard', largeur: 0, dessiner: () => undefined });
  if (reperes.some(r => r.type === 'ferie')) elements.push({ texte: 'Jour férié', largeur: 8, dessiner: (x, yy) => { doc.setFillColor(225, 236, 250); doc.rect(x, yy - 2.5, 8, 3, 'F'); } });
  if (reperes.some(r => r.type !== 'ferie')) elements.push({ texte: 'Congé ou fermeture', largeur: 8, dessiner: (x, yy) => { doc.setDrawColor(195, 200, 207); doc.setLineWidth(0.1); doc.rect(x, yy - 2.5, 8, 3, 'S'); hachures(x, yy - 2.5, 8, 3); } });
  if (aujourdhuiVisible) elements.push({ texte: 'Aujourd’hui', largeur: 0, dessiner: (x, yy) => { doc.setDrawColor(60, 60, 60); doc.setLineWidth(0.35); doc.line(x + 1, yy - 3, x + 1, yy + 0.6); } });
  y += 7; place(6);
  doc.setFont('helvetica', 'normal'); taille(7); doc.setTextColor(75, 85, 99);
  let xl = MARGIN;
  for (const e of elements) {
    const bloc = (e.largeur || 2) + 2 + doc.getTextWidth(e.texte) + 6;
    if (xl > MARGIN && xl + bloc > pageW - MARGIN) { y += 5 * K; place(5 * K); xl = MARGIN; }
    e.dessiner(xl, y);
    doc.text(e.texte, xl + (e.largeur || 2) + 2, y);
    xl += bloc;
  }

  drawAgencyFooters(doc, settings, letterhead);
  return { blob: doc.output('blob'), filename };
}
