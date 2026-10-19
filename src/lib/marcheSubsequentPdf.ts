// ── Marché subséquent : rendu PDF ────────────────────────────────────────────
// Pièce remise à l'entreprise titulaire et au pouvoir adjudicateur : l'objet de
// la commande, les lignes (articles du bordereau de l'accord-cadre, quantités
// et prix), les totaux et la situation du plafond de l'accord-cadre. Charte du
// cabinet : en-tête avec logo en première page, tableaux en nuances de gris,
// pied de page et pagination « P1|2 ».
//
// Comme certificatPaiementPdf.ts, ce module ne charge ni jsPDF ni le logo :
// l'appelant les fournit (navigateur ou Node).
import { drawAgencyHeader, drawAgencyFooters, tableauGris, type LetterheadOptions } from './pdfLetterhead';
import { dateFr, euros, finY, tableauFiche, tableauMontants, type OperationInfo, type RenduPdf } from './certificatPaiementPdf';
import {
  LIBELLE_MODE_EXECUTION, conditionsDe, consommation, montantLigne, totalLignes,
  type LigneCommande, type MarcheAccordCadreChamps,
} from './accordCadre';

const MARGE = 14;
const TVA_DEFAUT = 20;

export type MarcheContrat = MarcheAccordCadreChamps & {
  entreprise_nom: string;
  entreprise_siret?: string | null;
  lot_numero?: string | null;
  lot_titre?: string | null;
  montant_ht?: number | string | null;
  tva_rate?: number | string | null;
  duree_mois?: number | null;
  notes?: string | null;
};

const lotLibelle = (m: MarcheContrat): string =>
  [m.lot_numero ? `Lot ${m.lot_numero}` : '', m.lot_titre ?? ''].filter(Boolean).join(' · ');

const quantite = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 3 }).replace(/[  ]/g, ' ');

/** Montant HT d'un marché subséquent : le total de ses lignes, à défaut son montant enregistré. */
export function montantSubsequentHT(sub: MarcheContrat): number {
  const lignes = sub.lignes_commande ?? [];
  return lignes.length ? totalLignes(lignes) : Number(sub.montant_ht) || 0;
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

/** Deux cases : le titulaire et le pouvoir adjudicateur, qui signent tous deux le marché. */
function blocSignatures(r: RenduPdf, y: number, titulaire: string, adjudicateur: string, date: string): void {
  const pdf = r.pdf;
  const pageW = pdf.internal.pageSize.getWidth();
  if (y + 38 > pdf.internal.pageSize.getHeight() - 18) { pdf.addPage(); y = 20; }
  const w = (pageW - MARGE * 2 - 8) / 2;
  const cases: [number, string, string][] = [
    [MARGE, 'Le titulaire', titulaire],
    [MARGE + w + 8, 'Le pouvoir adjudicateur', adjudicateur],
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
  pdf.text(`Date et signature${date ? `, le ${date}` : ''}`, MARGE + 3, y + 29);
}

function tableauLignes(r: RenduPdf, y: number, lignes: LigneCommande[], totalHT: number): number {
  const base = tableauGris(MARGE);
  r.autoTable(r.pdf, {
    ...base,
    startY: y,
    head: [['Réf.', 'Désignation', 'U', 'Qté', 'P.U. HT', 'Montant HT']],
    body: lignes.map((l, i) => [
      l.refBpu || String(i + 1), l.designation, l.unite, quantite(l.quantite), euros(l.prixUnitaire), euros(montantLigne(l)),
    ]),
    foot: [['', 'Total HT', '', '', '', euros(totalHT)]],
    styles: { ...base.styles, cellPadding: 1.4 },
    columnStyles: {
      0: { cellWidth: 16 }, 2: { cellWidth: 10 }, 3: { halign: 'right', cellWidth: 18 },
      4: { halign: 'right', cellWidth: 26 }, 5: { halign: 'right', cellWidth: 28 },
    },
    footStyles: { ...base.headStyles, fontStyle: 'bold', halign: 'right' },
    showFoot: 'lastPage',
  });
  return finY(r.pdf, y) + 5;
}

/**
 * Marché subséquent n° N d'un accord-cadre. `autres` : les subséquents de
 * l'accord-cadre (celui qu'on rend, repéré par son `id`, est écarté), pour la
 * situation du plafond avant et après ce marché.
 */
export function rendreMarcheSubsequent(
  r: RenduPdf,
  accordCadre: MarcheContrat,
  sub: MarcheContrat & { id?: string },
  autres: { montant_ht?: number | string | null; statut?: string | null; id?: string }[],
  operation: OperationInfo = {},
): void {
  const n = sub.numero_subsequent ?? 0;
  const lignes = sub.lignes_commande ?? [];
  const totalHT = montantSubsequentHT(sub);
  const tvaPct = Number(sub.tva_rate ?? accordCadre.tva_rate ?? TVA_DEFAUT);
  const tva = Math.round(totalHT * tvaPct) / 100;
  const dateNotification = dateFr(sub.date_notification);
  const conditions = conditionsDe(accordCadre);

  const options: LetterheadOptions = {
    title: `MARCHÉ SUBSÉQUENT N° ${n}`,
    subtitle: `${accordCadre.entreprise_nom}${lotLibelle(accordCadre) ? ` · ${lotLibelle(accordCadre)}` : ''}`,
    reference: operation.code ?? undefined,
    date: dateNotification || new Date().toLocaleDateString('fr-FR'),
    margin: MARGE,
    logo: r.logo,
  };
  let y = drawAgencyHeader(r.pdf, r.settings, options);

  const lignesOperation = ([
    ['Affaire', [operation.code, operation.nom].filter(Boolean).join(' · ')],
    ['Adresse', operation.adresse ?? ''],
    ["Maître d'ouvrage", operation.maitreOuvrage ?? ''],
  ] as [string, string][]).filter(([, v]) => v);
  if (lignesOperation.length) y = tableauFiche(r, y, 'Opération', lignesOperation);

  y = tableauFiche(r, y, 'Accord-cadre', ([
    ['Titulaire', accordCadre.entreprise_nom],
    ['SIRET', accordCadre.entreprise_siret ?? ''],
    ['Lot', lotLibelle(accordCadre)],
    ["Mode d'exécution", accordCadre.mode_execution ? LIBELLE_MODE_EXECUTION[accordCadre.mode_execution] : ''],
    ['Signé le', accordCadre.statut_signature === 'signe' ? dateFr(accordCadre.date_signature) : ''],
    ["Fin de l'accord-cadre", dateFr(conditions.dateFin)],
  ] as [string, string][]).filter(([, v]) => v));

  y = tableauFiche(r, y, `Marché subséquent n° ${n}`, ([
    ['Objet', sub.objet ?? ''],
    ['Notifié le', dateNotification],
    ['Durée', sub.duree_mois ? `${sub.duree_mois} mois` : ''],
  ] as [string, string][]).filter(([, v]) => v));

  if (lignes.length) y = tableauLignes(r, y, lignes, totalHT);

  y = tableauMontants(r, y, 'Montant du marché subséquent', [
    ['Total HT', euros(totalHT), true],
    [`TVA ${tvaPct.toLocaleString('fr-FR')} %`, euros(tva)],
    ['Total TTC', euros(totalHT + tva), true],
  ]);

  // Situation du plafond : ce que l'accord-cadre a déjà commandé, avec et sans ce marché.
  const avant = consommation(
    conditions,
    autres.filter((a) => !sub.id || a.id !== sub.id).map((a) => ({ montant_ht: Number(a.montant_ht) || 0, statut: a.statut })),
  ).cumulHT;
  const lignesPlafond: [string, string, boolean?][] = [];
  if (conditions.montantMaxiHT !== null) lignesPlafond.push(["Montant maximum HT de l'accord-cadre", euros(conditions.montantMaxiHT)]);
  lignesPlafond.push(['Déjà commandé avant ce marché HT', euros(avant)]);
  lignesPlafond.push(['Ce marché subséquent HT', euros(totalHT)]);
  lignesPlafond.push(['Total commandé après ce marché HT', euros(avant + totalHT), true]);
  if (conditions.montantMaxiHT !== null) lignesPlafond.push(['Reste disponible HT', euros(Math.max(conditions.montantMaxiHT - avant - totalHT, 0)), true]);
  y = tableauMontants(r, y, "Situation de l'accord-cadre", lignesPlafond);

  if (sub.notes) y = paragraphe(r, y, 'Observations', sub.notes);
  blocSignatures(
    r, y + 2,
    [accordCadre.entreprise_nom, accordCadre.entreprise_siret ? `SIRET ${accordCadre.entreprise_siret}` : ''].filter(Boolean).join('\n'),
    operation.maitreOuvrage ?? '',
    dateNotification,
  );
  drawAgencyFooters(r.pdf, r.settings, options);
}
