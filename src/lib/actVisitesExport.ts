// ── Visites de site : liste des entreprises venues et tableau d'émargement ──
// Deux documents à la charte du cabinet (en-tête, tableaux en gris, pied « P1|2 ») :
//  - la LISTE des entreprises ayant fait la visite, avec la date (PDF et Excel) ;
//  - le TABLEAU D'ÉMARGEMENT à imprimer et à faire signer sur place (PDF), une page par créneau.
// La logique de sélection est pure et testée (`planEmargement`, `entreprisesAyantVisite`).
import type { AgencySettings } from './proposalExport';
import { entreprisesAyantVisite, libelleVisite, type CreneauVisite, type VisiteSite } from './actVisites';
import { telephoneEntreprise } from './actEntreprises';
import type { EntrepriseConsulteeExport, LotRef } from './actExport';
import { drawAgencyFooters, drawAgencyHeader, loadLogoDataUrl, tableauGris, TABLEAU_GRIS } from './pdfLetterhead';
import { ajouterFeuille, chargerLogo, enregistrerClasseur, nouveauClasseur } from './xlsxLetterhead';

type ContactTelephone = Parameters<typeof telephoneEntreprise>[1];

/** Lignes vierges ajoutées à chaque feuille : entreprises venues sans rendez-vous, ou représentants en plus. */
export const LIGNES_VIERGES_EMARGEMENT = 4;

const lotsDe = (ids: string[], lots: LotRef[]) =>
  ids.map(id => lots.find(l => l.id === id)).filter((l): l is LotRef => !!l).map(l => `Lot ${l.lot_number}`).join(', ');

const dateCourte = (dateHeure: string) => {
  const d = new Date(dateHeure);
  return Number.isNaN(d.getTime()) ? dateHeure : d.toLocaleDateString('fr-FR');
};
const heureCourte = (dateHeure: string) => {
  const d = new Date(dateHeure);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};
const nomFichier = (prefixe: string, projectName: string, extension: string) =>
  `${prefixe}_${projectName.replace(/\s+/g, '_')}.${extension}`;

export interface FeuilleEmargement {
  /** Créneau concerné ; absent quand aucun créneau n'est défini (feuille générale). */
  creneau?: CreneauVisite;
  entreprises: EntrepriseConsulteeExport[];
}

/**
 * Une feuille par créneau, avec les entreprises qui y sont inscrites (celles qui ne répondent pas sont
 * écartées). Sans aucun créneau défini, une feuille générale reprend toutes les entreprises consultées.
 */
export function planEmargement(entreprises: EntrepriseConsulteeExport[], creneaux: CreneauVisite[]): FeuilleEmargement[] {
  const actives = entreprises.filter(e => !e.ne_repond_pas);
  const nom = (a: EntrepriseConsulteeExport, b: EntrepriseConsulteeExport) => a.nom.localeCompare(b.nom, 'fr');
  if (creneaux.length === 0) return [{ entreprises: [...actives].sort(nom) }];
  return [...creneaux]
    .sort((a, b) => a.date_heure.localeCompare(b.date_heure))
    .map(creneau => ({ creneau, entreprises: actives.filter(e => e.visite_creneau_id === creneau.id).sort(nom) }));
}

// ── Liste des entreprises ayant fait la visite ──────────────────────────────

const ENTETES_VISITES = ['Date de visite', 'Heure', 'Entreprise', 'Lots', 'Email', 'Téléphone'];

function lignesVisites(
  entreprises: EntrepriseConsulteeExport[], lots: LotRef[], creneaux: CreneauVisite[], contacts: ContactTelephone,
): string[][] {
  return entreprisesAyantVisite(entreprises, creneaux).map(({ entreprise: e, creneau }) => [
    dateCourte(creneau.date_heure), heureCourte(creneau.date_heure), e.nom,
    lotsDe(e.lots_ids, lots), e.email || '', telephoneEntreprise(e, contacts),
  ]);
}

export async function exportVisitesEffectueesToExcel(
  entreprises: EntrepriseConsulteeExport[], lots: LotRef[], creneaux: CreneauVisite[],
  settings: AgencySettings, projectName: string, contacts: ContactTelephone = [],
): Promise<void> {
  const [wb, logo] = await Promise.all([nouveauClasseur(), chargerLogo(settings)]);
  const feuille = ajouterFeuille(wb, {
    nom: 'Visites effectuées', settings, logo,
    title: 'Entreprises ayant effectué la visite', subtitle: projectName,
    colonnes: [
      { header: ENTETES_VISITES[0], width: 16, align: 'center' },
      { header: ENTETES_VISITES[1], width: 10, align: 'center' },
      { header: ENTETES_VISITES[2], width: 36 },
      { header: ENTETES_VISITES[3], width: 20 },
      { header: ENTETES_VISITES[4], width: 32 },
      { header: ENTETES_VISITES[5], width: 18 },
    ],
  });
  for (const ligne of lignesVisites(entreprises, lots, creneaux, contacts)) feuille.ligne(ligne);
  await enregistrerClasseur(wb, nomFichier('Visites_effectuees', projectName, 'xlsx'));
}

export async function exportVisitesEffectueesToPDF(
  entreprises: EntrepriseConsulteeExport[], lots: LotRef[], creneaux: CreneauVisite[],
  settings: AgencySettings, projectName: string, contacts: ContactTelephone = [],
): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }, logo] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), loadLogoDataUrl(settings.logoUrl),
  ]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const margin = 14;
  const titre = 'Entreprises ayant effectué la visite';
  const y = drawAgencyHeader(doc, settings, { title: titre, subtitle: projectName, logo, margin });
  const lignes = lignesVisites(entreprises, lots, creneaux, contacts);
  autoTable(doc, {
    ...tableauGris(margin), startY: y,
    head: [ENTETES_VISITES],
    body: lignes.length ? lignes : [[{ content: 'Aucune entreprise n\'est pointée « présente » à la visite.', colSpan: ENTETES_VISITES.length, styles: { halign: 'center' } }]],
    columnStyles: { 0: { halign: 'center', cellWidth: 24 }, 1: { halign: 'center', cellWidth: 14 } },
  });
  drawAgencyFooters(doc, settings, { title: titre, margin });
  doc.save(nomFichier('Visites_effectuees', projectName, 'pdf'));
}

// ── Tableau d'émargement ────────────────────────────────────────────────────

const ENTETES_EMARGEMENT = ['N°', 'Entreprise', 'Lots', 'Nom et prénom du représentant', 'Fonction', 'Téléphone', 'Signature'];

export async function exportEmargementVisiteToPDF(
  entreprises: EntrepriseConsulteeExport[], lots: LotRef[], creneaux: CreneauVisite[],
  settings: AgencySettings, projectName: string, site?: VisiteSite,
): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }, logo] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), loadLogoDataUrl(settings.logoUrl),
  ]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const margin = 14;
  const titre = 'Tableau d\'émargement de la visite de site';
  const pageW = doc.internal.pageSize.getWidth();
  const lieu = site?.lieu?.trim();

  planEmargement(entreprises, creneaux).forEach((feuille, index) => {
    if (index > 0) doc.addPage();
    let y = drawAgencyHeader(doc, settings, { title: titre, subtitle: projectName, logo, margin });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...TABLEAU_GRIS.texte);
    doc.text(feuille.creneau ? `Visite du ${libelleVisite(feuille.creneau.date_heure)}` : 'Visite de site', margin, y + 3);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    // Sans créneau, la date est à écrire à la main.
    const detail = [lieu && `Lieu : ${lieu}`, !feuille.creneau && 'Date de la visite : ____ / ____ / ________']
      .filter((x): x is string => !!x);
    if (detail.length) doc.text(detail.join('    '), margin, y + 8.5, { maxWidth: pageW - margin * 2 });
    y += 12;

    const lignes: (string | number)[][] = feuille.entreprises.map((e, i) => [i + 1, e.nom, lotsDe(e.lots_ids, lots), '', '', '', '']);
    const base = lignes.length;
    for (let i = 0; i < LIGNES_VIERGES_EMARGEMENT; i++) lignes.push([base + i + 1, '', '', '', '', '', '']);
    autoTable(doc, {
      ...tableauGris(margin), startY: y,
      head: [ENTETES_EMARGEMENT], body: lignes,
      styles: { fontSize: 9, textColor: TABLEAU_GRIS.texte, cellPadding: 2, minCellHeight: 13, valign: 'middle', lineColor: [150, 150, 150], lineWidth: 0.2 },
      alternateRowStyles: {},
      columnStyles: { 0: { halign: 'center', cellWidth: 10 }, 1: { cellWidth: 55 }, 2: { cellWidth: 28 }, 3: { cellWidth: 55 }, 4: { cellWidth: 30 }, 5: { cellWidth: 30 } },
    });
  });
  drawAgencyFooters(doc, settings, { title: titre, margin });
  doc.save(nomFichier('Emargement_visite', projectName, 'pdf'));
}
