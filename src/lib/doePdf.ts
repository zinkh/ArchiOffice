// ── Atelier DOE : rendu PDF du visa et du bordereau de transmission ──────────
// Un seul rendu, appelé par le serveur (visa déposé comme document de l'affaire,
// bordereau joint à l'archive du maître d'ouvrage). Charte du cabinet : en-tête
// avec logo, tableaux en nuances de gris, pied de page et pagination « P1|2 ».
// Les avis (favorable, avec observations, défavorable) sont du texte : aucune
// couleur n'est nécessaire.
//
// Comme certificatPaiementPdf.ts, ce module ne charge ni jsPDF ni le logo :
// l'appelant les fournit.
import { drawAgencyHeader, drawAgencyFooters, tableauGris, type LetterheadOptions } from './pdfLetterhead';
import {
  dateFr, finY, paragraphe, tableauFiche, type OperationInfo, type RenduPdf,
} from './certificatPaiementPdf';
import {
  DOE_AVIS_DOCUMENT_LABELS, DOE_AVIS_VISA_LABELS,
  type DoeAvisDocument, type DoeAvisVisa, type DoePieceKey,
} from './doeAtelier';

const MARGE = 14;

export interface DocumentVise {
  nom: string;
  avis: DoeAvisDocument;
  commentaire?: string | null;
  recu_le?: string | null;
}

export interface PieceVisee {
  piece: DoePieceKey;
  label: string;
  requise: boolean;
  statut: 'validee' | 'en_attente' | 'manquante';
  documents: DocumentVise[];
}

export interface VisaDoePdf {
  numero: string;
  issued_at: string;
  avis: DoeAvisVisa;
  observations?: string | null;
  entreprise: string;
  lots: string[];
  pieces: PieceVisee[];
  /** Nom de la personne qui a émis le visa. */
  emisPar?: string | null;
}

const STATUT_PIECE: Record<PieceVisee['statut'], string> = {
  validee: 'Reçue et favorable',
  en_attente: 'Reçue, non validée',
  manquante: 'Manquante',
};

/** Date et heure en français, sans l'espace fine insécable que les polices de jsPDF ne rendent pas. */
function dateHeure(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
    .replace(/[  ]/g, ' ');
}

export function rendreVisaDoe(r: RenduPdf, visa: VisaDoePdf, operation: OperationInfo = {}): void {
  const options: LetterheadOptions = {
    title: `VISA DU DOE N° ${visa.numero}`,
    subtitle: visa.entreprise,
    reference: operation.code ?? undefined,
    date: dateFr(visa.issued_at) || new Date().toLocaleDateString('fr-FR'),
    margin: MARGE,
    logo: r.logo,
  };
  let y = drawAgencyHeader(r.pdf, r.settings, options);

  y = tableauFiche(r, y, 'Opération', ([
    ['Affaire', [operation.code, operation.nom].filter(Boolean).join(' · ')],
    ['Adresse', operation.adresse ?? ''],
    ["Maître d'ouvrage", operation.maitreOuvrage ?? ''],
  ] as [string, string][]).filter(([, v]) => v));

  y = tableauFiche(r, y, 'Dossier visé', ([
    ['Entreprise', visa.entreprise],
    [visa.lots.length > 1 ? 'Lots' : 'Lot', visa.lots.join(' ; ')],
    ['Visa émis le', dateHeure(visa.issued_at)],
    ['Émis par', visa.emisPar ?? ''],
    ['AVIS', DOE_AVIS_VISA_LABELS[visa.avis].toUpperCase()],
  ] as [string, string][]).filter(([, v]) => v));

  // Les pièces attendues, une ligne par pièce, puis le détail des documents.
  const corps: any[] = [];
  for (const p of visa.pieces) {
    corps.push([
      { content: `${p.label}${p.requise ? '' : ' (facultative)'}`, styles: { fontStyle: 'bold' } },
      { content: STATUT_PIECE[p.statut], styles: { fontStyle: 'bold' } },
      '',
    ]);
    for (const d of p.documents) {
      corps.push([
        { content: `   ${d.nom}`, styles: { textColor: [75, 85, 99] } },
        DOE_AVIS_DOCUMENT_LABELS[d.avis],
        d.commentaire || '',
      ]);
    }
  }
  r.autoTable(r.pdf, {
    ...tableauGris(MARGE),
    startY: y,
    head: [['Pièce attendue / document', 'Situation', 'Observations']],
    body: corps,
    styles: { ...tableauGris(MARGE).styles, fontSize: 7.5, cellPadding: 1.6 },
    columnStyles: { 0: { cellWidth: 78 }, 1: { cellWidth: 34 } },
    alternateRowStyles: {},
  });
  y = finY(r.pdf, y) + 6;

  if (visa.observations?.trim()) y = paragraphe(r, y, "Observations du maître d'œuvre", visa.observations.trim());

  blocSignatureVisa(r, y + 2, options.date ?? '');
  drawAgencyFooters(r.pdf, r.settings, options);
}

function blocSignatureVisa(r: RenduPdf, y: number, date: string): void {
  const pdf = r.pdf;
  const pageW = pdf.internal.pageSize.getWidth();
  if (y + 36 > pdf.internal.pageSize.getHeight() - 18) { pdf.addPage(); y = 20; }
  const w = (pageW - MARGE * 2 - 8) / 2;
  const cases: [number, string, string][] = [
    [MARGE, "Le maître d'œuvre", [r.settings.architectName, r.settings.agencyName].filter(Boolean).join('\n')],
    [MARGE + w + 8, "L'entreprise", 'Prise de connaissance'],
  ];
  pdf.setDrawColor(209, 213, 219); pdf.setLineWidth(0.3);
  for (const [x, titre, sous] of cases) {
    pdf.rect(x, y, w, 30);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(17, 24, 39);
    pdf.text(titre, x + 3, y + 5);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(107, 114, 128);
    pdf.text(sous, x + 3, y + 9.5);
  }
  pdf.text(`Date et signature${date ? `, le ${date}` : ''}`, MARGE + 3, y + 27);
}

// ── Bordereau de transmission au maître d'ouvrage ────────────────────────────

export interface LigneBordereau {
  dossier: string;
  entreprise: string;
  lot: string;
  document: string;
  avis: string;
}

export interface VisaBordereau {
  numero: string;
  entreprise: string;
  avis: DoeAvisVisa;
  issued_at: string;
}

export interface BordereauDoePdf {
  destinataire?: string | null;
  date: string;
  lignes: LigneBordereau[];
  visas: VisaBordereau[];
  /** Entreprises dont le dossier n'est pas visé et que l'archive ne contient donc pas, ou contient sans visa. */
  reserves: string[];
}

export function rendreBordereauDoe(r: RenduPdf, b: BordereauDoePdf, operation: OperationInfo = {}): void {
  const options: LetterheadOptions = {
    title: 'BORDEREAU DE TRANSMISSION',
    subtitle: 'Dossier des ouvrages exécutés',
    reference: operation.code ?? undefined,
    date: dateFr(b.date) || new Date().toLocaleDateString('fr-FR'),
    margin: MARGE,
    logo: r.logo,
  };
  let y = drawAgencyHeader(r.pdf, r.settings, options);

  y = tableauFiche(r, y, 'Transmission', ([
    ['Affaire', [operation.code, operation.nom].filter(Boolean).join(' · ')],
    ['Adresse', operation.adresse ?? ''],
    ["Maître d'ouvrage", operation.maitreOuvrage ?? ''],
    ['Destinataire', b.destinataire ?? ''],
    ['Documents transmis', String(b.lignes.length)],
  ] as [string, string][]).filter(([, v]) => v));

  if (b.visas.length) {
    r.autoTable(r.pdf, {
      ...tableauGris(MARGE),
      startY: y,
      head: [['Visa', 'Entreprise', 'Avis', 'Émis le']],
      body: b.visas.map(v => [v.numero, v.entreprise, DOE_AVIS_VISA_LABELS[v.avis], dateFr(v.issued_at)]),
      styles: { ...tableauGris(MARGE).styles, fontSize: 8, cellPadding: 1.6 },
    });
    y = finY(r.pdf, y) + 6;
  }

  if (b.reserves.length) {
    y = paragraphe(r, y, 'Réserves sur cette transmission', b.reserves.map(x => `- ${x}`).join('\n'));
  }

  r.autoTable(r.pdf, {
    ...tableauGris(MARGE),
    startY: y,
    head: [['Dossier', 'Entreprise', 'Lot', 'Document', 'Avis']],
    body: b.lignes.map(l => [l.dossier, l.entreprise, l.lot, l.document, l.avis]),
    styles: { ...tableauGris(MARGE).styles, fontSize: 7.5, cellPadding: 1.5 },
    columnStyles: { 0: { cellWidth: 28 }, 1: { cellWidth: 32 }, 2: { cellWidth: 26 }, 4: { cellWidth: 26 } },
  });
  drawAgencyFooters(r.pdf, r.settings, options);
}
