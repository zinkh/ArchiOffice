// ── Certificat de paiement et décompte de clôture : rendu PDF ────────────────
// Un seul rendu, appelé par l'écran (téléchargement) et par le serveur (pièce
// jointe déposée sur Chorus Pro / Super PDP) : le document qui part chez le
// maître d'ouvrage est le même des deux côtés. Charte du cabinet : en-tête avec
// logo, tableaux en nuances de gris, pied de page et pagination « P1|2 ».
//
// Ce module ne charge rien lui-même (ni jsPDF, ni le logo) : l'appelant fournit
// le document, autoTable et le logo déjà lu, parce que le navigateur et Node ne
// les obtiennent pas de la même façon.
import type { AgencySettings } from './proposalExport';
import { drawAgencyHeader, drawAgencyFooters, tableauGris, TABLEAU_GRIS, type LetterheadOptions } from './pdfLetterhead';
import {
  calculerCertificat, calculerDecompteCloture, estCertifiee, situationsDuMarche,
  type MarcheTravaux, type SituationTravaux,
} from './certificatPaiement';

export interface OperationInfo {
  nom?: string | null;
  code?: string | null;
  adresse?: string | null;
  maitreOuvrage?: string | null;
}

export interface RenduPdf {
  pdf: any;
  autoTable: (pdf: any, options: Record<string, any>) => void;
  settings: AgencySettings;
  logo?: LetterheadOptions['logo'];
}

const MARGE = 14;

/**
 * Montant en euros. Intl sépare les milliers par une espace fine insécable
 * (U+202F) que les polices standard de jsPDF rendent par « / » : on la
 * remplace par une espace ordinaire.
 */
export function euros(n: number): string {
  return `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
    .replace(/[  ]/g, ' ');
}

const signe = (n: number): string => (n < 0 ? `- ${euros(-n)}` : euros(n));
const moins = (n: number): string => (n === 0 ? euros(0) : `- ${euros(n)}`);

function dateFr(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR');
}

const lotLibelle = (m: MarcheTravaux): string =>
  [m.lot_numero ? `Lot ${m.lot_numero}` : '', m.lot_titre ?? ''].filter(Boolean).join(' · ');

const finY = (pdf: any, repli: number): number => (pdf as any).lastAutoTable?.finalY ?? repli;

/** Tableau à deux colonnes libellé / valeur, sans entête. */
function tableauFiche(r: RenduPdf, y: number, titre: string, lignes: [string, string][]): number {
  r.autoTable(r.pdf, {
    ...tableauGris(MARGE),
    startY: y,
    head: [[{ content: titre, colSpan: 2 }]],
    body: lignes,
    styles: { ...tableauGris(MARGE).styles, cellPadding: 1.2 },
    headStyles: { ...tableauGris(MARGE).headStyles, cellPadding: 1.5 },
    columnStyles: { 0: { cellWidth: 62, textColor: [107, 114, 128] }, 1: { fontStyle: 'bold' } },
    alternateRowStyles: {},
  });
  return finY(r.pdf, y) + 3;
}

function blocIdentite(r: RenduPdf, y: number, marche: MarcheTravaux, operation: OperationInfo): number {
  const lignesOperation: [string, string][] = [
    ['Affaire', [operation.code, operation.nom].filter(Boolean).join(' · ')],
    ['Adresse', operation.adresse ?? ''],
    ["Maître d'ouvrage", operation.maitreOuvrage ?? ''],
  ].filter(([, v]) => v) as [string, string][];
  const lignesMarche: [string, string][] = [
    ['Entreprise', marche.entreprise_nom],
    ['SIRET', marche.entreprise_siret ?? ''],
    ['Lot', lotLibelle(marche)],
    ['Montant du marché HT', Number(marche.montant_ht) ? euros(Number(marche.montant_ht)) : ''],
  ].filter(([, v]) => v) as [string, string][];
  if (lignesOperation.length) y = tableauFiche(r, y, 'Opération', lignesOperation);
  return tableauFiche(r, y, 'Marché', lignesMarche);
}

/** Tableau de montants : libellé à gauche, montant à droite, lignes clés en gras. */
function tableauMontants(r: RenduPdf, y: number, titre: string, lignes: [string, string, boolean?][]): number {
  r.autoTable(r.pdf, {
    ...tableauGris(MARGE),
    startY: y,
    head: [[titre, { content: 'Montant', styles: { halign: 'right' } }]],
    body: lignes.map(([l, v]) => [l, v]),
    styles: { ...tableauGris(MARGE).styles, cellPadding: 1.6 },
    columnStyles: { 1: { halign: 'right', cellWidth: 48 } },
    didParseCell: (data: any) => {
      if (data.section !== 'body') return;
      if (lignes[data.row.index]?.[2]) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = TABLEAU_GRIS.groupe;
      }
    },
  });
  return finY(r.pdf, y) + 5;
}

function paragraphe(r: RenduPdf, y: number, titre: string, texte: string): number {
  const pdf = r.pdf;
  const largeur = pdf.internal.pageSize.getWidth() - MARGE * 2;
  const lignes = pdf.splitTextToSize(texte, largeur) as string[];
  if (y + 8 + lignes.length * 4 > pdf.internal.pageSize.getHeight() - 22) { pdf.addPage(); y = 20; }
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(17, 24, 39);
  pdf.text(titre, MARGE, y);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5);
  pdf.text(lignes, MARGE, y + 5);
  return y + 7 + lignes.length * 4;
}

function blocSignature(r: RenduPdf, y: number, dateDocument: string): void {
  const pdf = r.pdf;
  const pageW = pdf.internal.pageSize.getWidth();
  if (y + 38 > pdf.internal.pageSize.getHeight() - 18) { pdf.addPage(); y = 20; }
  const w = (pageW - MARGE * 2 - 8) / 2;
  const cases: [number, string, string][] = [
    [MARGE, "L'architecte", [r.settings.architectName, r.settings.agencyName].filter(Boolean).join('\n')],
    [MARGE + w + 8, "Le maître d'ouvrage", 'Bon pour paiement'],
  ];
  pdf.setDrawColor(209, 213, 219); pdf.setLineWidth(0.3);
  for (const [x, titre, sous] of cases) {
    pdf.rect(x, y, w, 32);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(17, 24, 39);
    pdf.text(titre, x + 3, y + 5);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(107, 114, 128);
    pdf.text(sous, x + 3, y + 9.5);
  }
  pdf.setFontSize(7.5); pdf.setTextColor(107, 114, 128);
  pdf.text(`Date et signature${dateDocument ? `, le ${dateDocument}` : ''}`, MARGE + 3, y + 29);
}

/** Certificat de paiement d'une situation, à partir de toutes les situations de son marché. */
export function rendreCertificatPaiement(
  r: RenduPdf,
  situation: SituationTravaux,
  marche: MarcheTravaux,
  situationsMarche: SituationTravaux[],
  operation: OperationInfo = {},
): void {
  const liste = situationsDuMarche(situationsMarche, marche.id);
  const c = calculerCertificat(situation, marche, liste);
  const dateCertificat = dateFr(situation.date_certificat) || new Date().toLocaleDateString('fr-FR');
  const options: LetterheadOptions = {
    title: `CERTIFICAT DE PAIEMENT N° ${c.numero}`,
    subtitle: `${marche.entreprise_nom}${lotLibelle(marche) ? ` · ${lotLibelle(marche)}` : ''}`,
    reference: operation.code ?? undefined,
    date: dateCertificat,
    margin: MARGE,
    logo: r.logo,
  };
  let y = drawAgencyHeader(r.pdf, r.settings, options);
  y = blocIdentite(r, y, marche, operation);

  y = tableauFiche(r, y, `Situation de travaux n° ${c.numero}`, ([
    ["Référence de l'entreprise", situation.reference_entreprise ?? ''],
    ['Date de la situation', dateFr(situation.date_situation)],
    ['Reçue le', dateFr(situation.date_reception_situation)],
    ['Avancement du marché', c.avancementPct === null ? '' : `${c.avancementPct.toLocaleString('fr-FR')} %`],
  ] as [string, string][]).filter(([, v]) => v));

  y = tableauMontants(r, y, 'Travaux exécutés (cumul depuis le début du marché)', [
    ["Cumul HT présenté par l'entreprise", euros(c.cumulPresenteHt)],
    ...(c.ecartHt !== 0 ? [["Écart retenu par l'architecte", signe(-c.ecartHt)] as [string, string]] : []),
    ["Cumul HT admis par l'architecte", euros(c.cumulAdmisHt), true],
    ['Cumul HT admis au certificat précédent', moins(c.cumulPrecedentHt)],
    ['Travaux de la période HT', signe(c.periodeHt), true],
  ]);

  y = tableauMontants(r, y, 'Montant de la période', [
    ['Travaux de la période HT', signe(c.periodeHt)],
    ...(c.revisionHt !== 0 ? [
      [`Révision des prix (coefficient ${c.revisionCoeff.toLocaleString('fr-FR', { maximumFractionDigits: 6 })})`, signe(c.revisionHt)] as [string, string],
      ['Total HT révisé', signe(c.periodeHtRevise), true] as [string, string, boolean],
    ] : []),
    [`TVA ${c.tvaRate.toLocaleString('fr-FR')} %`, signe(c.tva)],
    ['Total TTC de la période', signe(c.periodeTtc), true],
    [`Retenue de garantie ${c.retenuePct.toLocaleString('fr-FR')} %`, moins(c.retenue)],
    ...(c.avanceRemboursement ? [["Remboursement de l'avance", moins(c.avanceRemboursement)] as [string, string]] : []),
    ...(c.penalites ? [['Pénalités de retard', moins(c.penalites)] as [string, string]] : []),
    ['NET À PAYER TTC', signe(c.netAPayer), true],
  ]);

  if (c.cumulNetPrecedent) {
    y = tableauMontants(r, y, 'Récapitulatif', [
      ['Certificats antérieurs (nets cumulés)', euros(c.cumulNetPrecedent)],
      ['Total certifié, ce certificat compris', euros(c.cumulNetPrecedent + c.netAPayer), true],
    ]);
  }
  if (situation.penalites_notes) y = paragraphe(r, y, 'Pénalités', situation.penalites_notes);
  if (situation.notes_moe) y = paragraphe(r, y, "Observations de l'architecte", situation.notes_moe);

  blocSignature(r, y + 2, dateCertificat);
  drawAgencyFooters(r.pdf, r.settings, options);
}

/** Décompte de clôture d'un marché : total HT, toutes les situations, TVA, reste à payer TTC. */
export function rendreDecompteCloture(
  r: RenduPdf,
  marche: MarcheTravaux,
  situationsMarche: SituationTravaux[],
  operation: OperationInfo = {},
): void {
  const d = calculerDecompteCloture(marche, situationsMarche);
  const liste = situationsDuMarche(situationsMarche, marche.id);
  const options: LetterheadOptions = {
    title: 'DÉCOMPTE DE CLÔTURE',
    subtitle: `${marche.entreprise_nom}${lotLibelle(marche) ? ` · ${lotLibelle(marche)}` : ''}`,
    reference: operation.code ?? undefined,
    margin: MARGE,
    logo: r.logo,
  };
  let y = drawAgencyHeader(r.pdf, r.settings, options);
  y = blocIdentite(r, y, marche, operation);

  r.autoTable(r.pdf, {
    ...tableauGris(MARGE),
    startY: y,
    head: [['N°', 'Référence', 'Date', 'Cumul HT admis', 'Période HT', 'TTC', 'Retenue', 'Net certifié', 'État']],
    body: d.certificats.map((c, i) => [
      String(c.numero),
      liste[i].reference_entreprise ?? '',
      dateFr(liste[i].date_situation),
      euros(c.cumulAdmisHt),
      signe(c.periodeHt),
      signe(c.periodeTtc),
      moins(c.retenue),
      estCertifiee(liste[i]) ? signe(c.netAPayer) : 'Non certifié',
      liste[i].etat === 'Payée' ? 'Payée' : estCertifiee(liste[i]) ? 'Certifiée' : 'Reçue',
    ]),
    styles: { ...tableauGris(MARGE).styles, fontSize: 7.5 },
    columnStyles: {
      0: { cellWidth: 9 }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' },
      6: { halign: 'right' }, 7: { halign: 'right' },
    },
  });
  y = finY(r.pdf, y) + 5;

  y = tableauMontants(r, y, 'Décompte', [
    ['Total HT des travaux exécutés', euros(d.totalHt), true],
    ...(d.montantMarcheHt ? [[`Écart avec le marché (${euros(d.montantMarcheHt)} HT)`, signe(d.ecartMarcheHt)] as [string, string]] : []),
    ...(d.totalRevisionHt ? [
      ['Révision des prix', signe(d.totalRevisionHt)] as [string, string],
      ['Total HT révisé', euros(d.totalHtRevise), true] as [string, string, boolean],
    ] : []),
    ['TVA', euros(d.tva)],
    ['Total TTC', euros(d.totalTtc), true],
    ...(d.totalPenalites ? [['Pénalités de retard', moins(d.totalPenalites)] as [string, string]] : []),
    ...(d.avanceVersee ? [['Avance versée', moins(d.avanceVersee)] as [string, string]] : []),
    ['Certificats de paiement établis (nets)', moins(d.dejaCertifie)],
    ['Retenue de garantie (libérable à la fin du délai de garantie)', moins(d.totalRetenue)],
    ['RESTE À PAYER TTC', signe(d.resteAPayerTtc), true],
  ]);

  const nonCertifiees = liste.filter((s) => !estCertifiee(s)).length;
  if (nonCertifiees) {
    y = paragraphe(r, y, 'À noter', `${nonCertifiees} situation${nonCertifiees > 1 ? 's' : ''} sans certificat de paiement : leur montant est compris dans le reste à payer.`);
  }
  blocSignature(r, y + 2, new Date().toLocaleDateString('fr-FR'));
  drawAgencyFooters(r.pdf, r.settings, options);
}
