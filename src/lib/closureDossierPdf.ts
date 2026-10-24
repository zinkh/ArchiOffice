// ── Archivage d'une affaire : rendu PDF du dossier de clôture ───────────────
// Un seul rendu, appelé par le serveur (téléchargement à la demande, dépôt
// automatique sur l'espace du cabinet à l'archivage). Charte du cabinet :
// en-tête avec logo, tableaux en nuances de gris, pied de page et pagination
// « P1|2 ». Aucune couleur : un contrôle en alerte se lit dans son libellé.
//
// Comme doePdf.ts, ce module ne charge ni jsPDF ni le logo : l'appelant les fournit.
import { drawAgencyHeader, drawAgencyFooters, tableauGris, type LetterheadOptions } from './pdfLetterhead';
import {
  dateFr, euros, finY, paragraphe, tableauFiche, type OperationInfo, type RenduPdf,
} from './certificatPaiementPdf';

const MARGE = 14;

/** Au-delà, la liste des pièces est tronquée et le dit : un PDF de 40 pages n'est pas un index. */
export const CLOTURE_MAX_DOCUMENTS = 300;

export type EtatControle = 'ok' | 'warning' | 'unknown';

export interface ControleCloture {
  label: string;
  state: EtatControle;
  detail?: string | null;
}

export interface FactureCloture {
  numero: string;
  date?: string | null;
  totalTtc: number;
  statut: string;
}

export interface DocumentCloture {
  nom: string;
  categorie?: string | null;
  phase?: string | null;
  date?: string | null;
}

export interface DossierClotureData {
  archivedAt: string;
  retentionUntil?: string | null;
  motif?: string | null;
  archivePar?: string | null;
  controles: ControleCloture[];
  factures: FactureCloture[];
  reserves: { total: number; levees: number };
  documents: DocumentCloture[];
}

const LIBELLE_CONTROLE: Record<EtatControle, string> = {
  ok: 'Conforme',
  warning: 'En alerte',
  unknown: 'Non vérifiable',
};

const LIBELLE_STATUT_FACTURE: Record<string, string> = {
  Paid: 'Payée',
  Sent: 'Envoyée',
  Draft: 'Brouillon',
  Overdue: 'En retard',
};

export const libelleStatutFacture = (statut: string): string => LIBELLE_STATUT_FACTURE[statut] ?? statut;

/** Totaux des factures de l'affaire : tout ce qui n'est pas « Payée » reste à encaisser. */
export function totauxFactures(factures: FactureCloture[]): { total: number; paye: number; reste: number } {
  const somme = (liste: FactureCloture[]) => liste.reduce((s, f) => s + (Number.isFinite(f.totalTtc) ? f.totalTtc : 0), 0);
  const total = somme(factures);
  const paye = somme(factures.filter(f => f.statut === 'Paid'));
  return { total, paye, reste: total - paye };
}

export function rendreDossierCloture(r: RenduPdf, d: DossierClotureData, operation: OperationInfo = {}): void {
  const options: LetterheadOptions = {
    title: 'DOSSIER DE CLÔTURE',
    subtitle: operation.nom ?? undefined,
    reference: operation.code ?? undefined,
    date: dateFr(d.archivedAt) || new Date().toLocaleDateString('fr-FR'),
    margin: MARGE,
    logo: r.logo,
  };
  let y = drawAgencyHeader(r.pdf, r.settings, options);

  y = tableauFiche(r, y, 'Opération', ([
    ['Affaire', [operation.code, operation.nom].filter(Boolean).join(' · ')],
    ['Adresse', operation.adresse ?? ''],
    ["Maître d'ouvrage", operation.maitreOuvrage ?? ''],
  ] as [string, string][]).filter(([, v]) => v));

  y = tableauFiche(r, y, 'Archivage', ([
    ['Archivée le', dateFr(d.archivedAt)],
    ['Archivée par', d.archivePar ?? ''],
    ['Conservation jusqu’au', dateFr(d.retentionUntil)],
    ['Motif', d.motif ?? ''],
  ] as [string, string][]).filter(([, v]) => v));

  r.autoTable(r.pdf, {
    ...tableauGris(MARGE),
    startY: y,
    head: [['Contrôle de clôture', 'Situation', 'Observation']],
    body: d.controles.map(c => [c.label, LIBELLE_CONTROLE[c.state], c.detail ?? '']),
    styles: { ...tableauGris(MARGE).styles, fontSize: 8, cellPadding: 1.6 },
    columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 30 } },
  });
  y = finY(r.pdf, y) + 6;

  const totaux = totauxFactures(d.factures);
  if (d.factures.length) {
    r.autoTable(r.pdf, {
      ...tableauGris(MARGE),
      startY: y,
      head: [['Facture', 'Émise le', 'Montant TTC', 'Situation']],
      body: [
        ...d.factures.map(f => [f.numero || '-', dateFr(f.date), euros(f.totalTtc), libelleStatutFacture(f.statut)]),
        [
          { content: 'Total', styles: { fontStyle: 'bold' } }, '',
          { content: euros(totaux.total), styles: { fontStyle: 'bold' } },
          { content: totaux.reste > 0 ? `Reste à encaisser : ${euros(totaux.reste)}` : 'Soldé', styles: { fontStyle: 'bold' } },
        ],
      ],
      styles: { ...tableauGris(MARGE).styles, fontSize: 8, cellPadding: 1.6 },
    });
    y = finY(r.pdf, y) + 6;
  } else {
    y = paragraphe(r, y, 'Factures', 'Aucune facture rattachée à cette affaire.');
  }

  y = paragraphe(r, y, 'Réserves', d.reserves.total
    ? `${d.reserves.levees} réserve(s) levée(s) sur ${d.reserves.total}.`
    : 'Aucune réserve enregistrée.');

  const visibles = d.documents.slice(0, CLOTURE_MAX_DOCUMENTS);
  if (visibles.length) {
    r.autoTable(r.pdf, {
      ...tableauGris(MARGE),
      startY: y,
      head: [['Pièce conservée', 'Catégorie', 'Phase', 'Déposée le']],
      body: visibles.map(doc => [doc.nom, doc.categorie ?? '', doc.phase ?? '', dateFr(doc.date)]),
      styles: { ...tableauGris(MARGE).styles, fontSize: 7.5, cellPadding: 1.4 },
      columnStyles: { 1: { cellWidth: 32 }, 2: { cellWidth: 20 }, 3: { cellWidth: 24 } },
    });
    if (d.documents.length > visibles.length) {
      paragraphe(r, finY(r.pdf, y) + 4, 'Liste tronquée',
        `${d.documents.length - visibles.length} autre(s) pièce(s) ne figurent pas dans cet index.`);
    }
  } else {
    paragraphe(r, y, 'Pièces conservées', 'Aucun document rattaché à cette affaire.');
  }

  drawAgencyFooters(r.pdf, r.settings, options);
}
