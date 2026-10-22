// ── Export PDF d'une fiche de travaux modificatifs (FTM) ─────────────────────
// Pièce remise à l'entreprise et au maître d'ouvrage : français, charte du cabinet
// (en-tête, pied, pagination « P1|2 », nuances de gris), trois cadres de visa.
import { drawAgencyHeader, drawAgencyFooters, fetchAgencySettings, loadLogoDataUrl, tableauGris } from './pdfLetterhead';

export interface FtmPdfFiche {
  numero: string;
  title: string;
  objet?: string | null;
  origine?: string | null;
  motif?: string | null;
  description?: string | null;
  incidence_delai_jours?: number | null;
  incidences_delais_details?: string | null;
  montant_estime_ht?: number | null;
  montant_accepte_ht?: number | null;
  status: string;
  date_emission?: string | null;
  date_decision?: string | null;
}

export interface FtmPdfContext {
  project: { name: string; project_code?: string; address?: string; client?: string };
  /** Noms des entreprises concernées (déjà résolus depuis les marchés). */
  entreprises: string[];
  devis: Array<{ entreprise?: string | null; reference?: string | null; objet: string; montant_ht?: number | null; date_reception?: string | null; statut: string }>;
  /** OS émis pour cette fiche, s'il existe. */
  ordre?: { numero: string; titre: string } | null;
}

export const FTM_STATUT_LABELS: Record<string, string> = { brouillon: 'Brouillon', emise: 'Émise', validee: 'Validée', refusee: 'Refusée' };
export const FTM_ORIGINE_LABELS: Record<string, string> = {
  maitrise_ouvrage: "Maîtrise d'ouvrage", maitrise_oeuvre: "Maîtrise d'œuvre", entreprise: 'Entreprise', aleas: 'Aléas de chantier', autres: 'Autres',
};
export const DEVIS_STATUT_LABELS: Record<string, string> = { recu: 'Reçu', en_analyse: 'En analyse', accepte: 'Accepté', refuse: 'Refusé' };

const MARGIN = 14;

/** Montant sans l'espace fine de fr-FR, absente des polices de jsPDF (sortirait « 12 /500 »). */
export function euros(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(n)).replace(/[  ]/g, ' ');
}

const jour = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('fr-FR');
};

/** Lignes des deux tableaux de la fiche : lues par l'export et par les tests, jamais divergentes. */
export function buildFtmRows(f: FtmPdfFiche, ctx: FtmPdfContext): { identification: string[][]; incidences: string[][]; totalDevis: number } {
  const ref = [ctx.project.project_code, ctx.project.name].filter(Boolean).join(' · ');
  const jours = Number(f.incidence_delai_jours) || 0;
  const delai = jours > 0
    ? `${jours} jour${jours > 1 ? 's' : ''}${f.incidences_delais_details ? ` : ${f.incidences_delais_details}` : ''}`
    : 'Sans incidence sur le délai';
  return {
    identification: [
      ['Affaire', ref || '—'],
      ['Maître d\'ouvrage', ctx.project.client || '—'],
      ['Fiche', f.numero],
      ['Entreprise(s) concernée(s)', ctx.entreprises.length ? ctx.entreprises.join(' ; ') : '—'],
      ['Origine de la demande', (f.origine && FTM_ORIGINE_LABELS[f.origine]) || '—'],
      ['État', FTM_STATUT_LABELS[f.status] ?? f.status],
      ['Date d\'émission', jour(f.date_emission)],
      ['Date de décision', jour(f.date_decision)],
    ],
    incidences: [
      ['Montant estimé HT', euros(f.montant_estime_ht)],
      ['Montant accepté HT', euros(f.montant_accepte_ht)],
      ['Incidence sur le délai', delai],
      ['Ordre de service émis', ctx.ordre ? `OS ${ctx.ordre.numero}${ctx.ordre.titre ? ` · ${ctx.ordre.titre}` : ''}` : '—'],
    ],
    totalDevis: ctx.devis.reduce((s, d) => s + (Number(d.montant_ht) || 0), 0),
  };
}

export async function exportFtmToPDF(f: FtmPdfFiche, ctx: FtmPdfContext): Promise<{ blob: Blob; filename: string }> {
  const [{ default: jsPDF }, { default: autoTable }, settings] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), fetchAgencySettings(),
  ]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const logo = await loadLogoDataUrl(settings.logoUrl);
  const letterhead = {
    title: 'Fiche de travaux modificatifs',
    subtitle: `${f.numero}${ctx.project.name ? ` · ${ctx.project.name}` : ''}`,
    reference: FTM_STATUT_LABELS[f.status] ?? f.status,
    date: f.date_emission || undefined,
    margin: MARGIN, logo,
  };
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const larg = pageW - MARGIN * 2;
  const base = tableauGris(MARGIN);
  const rows = buildFtmRows(f, ctx);
  const lastY = () => (doc as any).lastAutoTable.finalY as number;

  doc.setTextColor(17, 24, 39);
  let y = drawAgencyHeader(doc, settings, letterhead) + 2;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  const titre = doc.splitTextToSize(f.title, larg) as string[];
  doc.text(titre, MARGIN, y); y += 5.5 * titre.length + 2;

  autoTable(doc, {
    ...base, startY: y, theme: 'grid', body: rows.identification,
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 55, fillColor: [243, 244, 246] } },
    styles: { ...base.styles, fontSize: 9, cellPadding: 2 },
  });
  y = lastY() + 6;

  const bloc = (titreBloc: string, texte?: string | null) => {
    if (!texte) return;
    const lignes = doc.splitTextToSize(texte, larg) as string[];
    if (y + 12 > pageH - 20) { doc.addPage(); y = 22; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(17, 24, 39);
    doc.text(titreBloc.toUpperCase(), MARGIN, y); y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(30, 30, 30);
    for (const l of lignes) {
      if (y > pageH - 20) { doc.addPage(); y = 22; }
      doc.text(l, MARGIN, y); y += 4.6;
    }
    y += 3;
  };
  bloc('Objet', f.objet);
  bloc('Motif de la modification', f.motif);
  bloc('Description des travaux', f.description);

  if (y + 30 > pageH - 20) { doc.addPage(); y = 22; }
  autoTable(doc, {
    ...base, startY: y, theme: 'grid', head: [['Incidences', '']], body: rows.incidences,
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 55 } },
    styles: { ...base.styles, fontSize: 9, cellPadding: 2 },
  });
  y = lastY() + 6;

  if (ctx.devis.length) {
    if (y + 30 > pageH - 20) { doc.addPage(); y = 22; }
    autoTable(doc, {
      ...base, startY: y,
      head: [['Devis reçu', 'Entreprise', 'Réf.', 'Reçu le', 'État', 'Montant HT']],
      body: ctx.devis.map(d => [d.objet, d.entreprise || '—', d.reference || '—', jour(d.date_reception), DEVIS_STATUT_LABELS[d.statut] ?? d.statut, euros(d.montant_ht)]),
      foot: [[{ content: 'Total des devis HT', colSpan: 5, styles: { halign: 'right' } }, euros(rows.totalDevis)]],
      columnStyles: { 5: { halign: 'right', cellWidth: 28 }, 3: { cellWidth: 22 }, 4: { cellWidth: 22 } },
      styles: { ...base.styles, fontSize: 8.5, overflow: 'linebreak', valign: 'top' },
    });
    y = lastY() + 8;
  }

  // Visas : maître d'œuvre, entreprise(s), maître d'ouvrage.
  const hauteur = 32;
  if (y + hauteur + 6 > pageH - 18) { doc.addPage(); y = 22; }
  const w = (larg - 8) / 3;
  const cadres = ["Maître d'œuvre", ctx.entreprises.length > 1 ? 'Entreprises' : 'Entreprise', "Maître d'ouvrage"];
  cadres.forEach((nom, i) => {
    const x = MARGIN + i * (w + 4);
    doc.setDrawColor(120, 120, 120); doc.setLineWidth(0.3); doc.rect(x, y, w, hauteur);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(17, 24, 39);
    doc.text(nom, x + w / 2, y + 5, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(75, 85, 99);
    doc.text('Bon pour accord, date et signature :', x + 2, y + 11);
  });

  drawAgencyFooters(doc, settings, letterhead);
  const code = f.numero.replace(/[^A-Za-z0-9-]+/g, '-');
  return { blob: doc.output('blob'), filename: `${code}_${(ctx.project.name || 'fiche').replace(/\s+/g, '_')}.pdf` };
}
