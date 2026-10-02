// ── Exports du BPU et du DQE ─────────────────────────────────────────────────
// Trois sorties depuis une seule mise à plat, pour que l'ordre des lignes et
// les références soient identiques entre le classeur vierge envoyé aux
// candidats et la version chiffrée : c'est cette identité qui rend le
// rapprochement possible au retour.
import type { BPU, BPULot, BPUChapitre, BPULigne } from '../types/bpu';
import { natureEffective } from '../types/bpu';
import type { AgencySettings } from './proposalExport';
import { drawAgencyHeader, drawAgencyFooters, loadLogoDataUrl, tableauGris, TABLEAU_GRIS } from './pdfLetterhead';
import {
  ajouterFeuille, chargerLogo, enregistrerClasseur, nouveauClasseur, FORMAT_NOMBRE,
  type Colonne, type Cellule,
} from './xlsxLetterhead';
import { montantEnLettres } from './numberToFrenchWords';

export type ExportMode = 'bpu' | 'dqe';

/** Version du schéma des classeurs, lue au retour pour détecter un décalage. */
export const BPU_SHEET_SCHEMA = 1;
export const SHEET_BPU = 'BPU';
export const SHEET_MARCHE = 'Cadre du marché';
export const SHEET_META = '_meta';

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export interface FlatBPURow {
  kind: 'lot' | 'chapitre' | 'article';
  depth: number;
  /** Référence stable portée par la colonne A. `#L1` / `#C1.2` pour la structure. */
  ref: string;
  numero: string;
  designation: string;
  unite: string;
  quantite: number;
  prixUnitaire: number;
  prixTotal: number;
  prixEnLettres: string;
  nature: string;
  tranche: string;
  /** Identifiant interne, jamais écrit dans le fichier. */
  id?: string;
}

/**
 * Met le document à plat pour l'affichage tabulaire.
 *
 * Descend DANS les sous-articles, contrairement à flattenDPGF (proExport.ts),
 * qui les perd silencieusement : un bordereau amputé de ses sous-articles
 * partirait incomplet chez les candidats, et l'import les rapporterait ensuite
 * tous comme « non chiffrés ».
 */
export function flattenBPU(bpu: BPU): FlatBPURow[] {
  const rows: FlatBPURow[] = [];
  const trancheCode = (id?: string) => bpu.tranches.find(t => t.id === id)?.code ?? '';

  bpu.lots.forEach((lot: BPULot, li) => {
    rows.push({
      kind: 'lot', depth: 0, ref: `#L${li + 1}`, numero: lot.numero, designation: lot.titre,
      unite: '', quantite: 0, prixUnitaire: 0, prixTotal: lot.sousTotal,
      prixEnLettres: '', nature: '', tranche: trancheCode(lot.trancheId),
    });

    lot.chapitres.forEach((chap: BPUChapitre, ci) => {
      rows.push({
        kind: 'chapitre', depth: 1, ref: `#C${li + 1}.${ci + 1}`, numero: chap.numero,
        designation: chap.titre, unite: '', quantite: 0, prixUnitaire: 0, prixTotal: 0,
        prixEnLettres: '', nature: '', tranche: trancheCode(chap.trancheId ?? lot.trancheId),
      });

      const walk = (lignes: BPULigne[], depth: number) => {
        lignes.forEach(l => {
          rows.push({
            kind: 'article', depth,
            ref: l.refBpu ?? '',
            numero: l.numero, designation: l.designation, unite: l.unite,
            quantite: l.quantite, prixUnitaire: l.prixUnitaire, prixTotal: l.prixTotal,
            prixEnLettres: l.prixUnitaireLettres ?? (l.prixUnitaire > 0 ? montantEnLettres(l.prixUnitaire) : ''),
            nature: natureEffective(l),
            tranche: trancheCode(l.trancheId ?? chap.trancheId ?? lot.trancheId),
            id: l.id,
          });
          if (l.children?.length) walk(l.children, depth + 1);
        });
      };
      walk(chap.lignes, 2);
    });
  });

  return rows;
}

const TYPE_MARCHE_LABELS: Record<string, string> = {
  bons_de_commande: 'Marché à bons de commande',
  prix_unitaires: 'Marché à prix unitaires',
  mixte: 'Marché mixte (forfait + prix unitaires)',
};

function sanitize(name: string) {
  return (name || 'document').replace(/[^a-zA-Z0-9_\-]/g, '_');
}

// ── Excel ─────────────────────────────────────────────────────────────────────

export interface ExcelOptions {
  mode: ExportMode;
  /** Bordereau à remplir : la colonne P.U. part vide. */
  vierge: boolean;
  projectName?: string;
  /** Charte du cabinet (logo, coordonnées, pied de page). */
  settings?: AgencySettings;
}

/** En-têtes de colonnes, dans l'ordre exact du classeur. */
export function excelHeaders(bpu: BPU, mode: ExportMode): string[] {
  const cols = ['Réf.', 'N°', 'Désignation', 'Unité'];
  if (mode === 'dqe') cols.push('Quantité');
  cols.push('P.U. HT (€)');
  if (mode === 'dqe') cols.push('Montant HT (€)');
  if (bpu.prixEnLettres) cols.push('P.U. en lettres');
  if (bpu.tranches.length) cols.push('Tranche');
  return cols;
}

export async function exportBPUtoExcel(bpu: BPU, { mode, vierge, projectName, settings = {} }: ExcelOptions): Promise<void> {
  const [wb, logo] = await Promise.all([nouveauClasseur(), chargerLogo(settings)]);
  const rows = flattenBPU(bpu);
  const titre = mode === 'bpu' ? 'BPU — Bordereau de Prix Unitaires' : 'DQE — Détail Quantitatif Estimatif';
  const headers = excelHeaders(bpu, mode);
  const m = bpu.marche;

  // Même mise en page que le PDF : l'en-tête du cabinet, puis le rappel du cadre
  // du marché. L'import relit ce classeur par la ligne d'entête de colonnes
  // (detectHeader), pas par un numéro de ligne : tout ce qui précède est libre.
  const infos = [
    [
      TYPE_MARCHE_LABELS[m.typeMarche] ?? '',
      m.objet ? `Objet : ${m.objet}` : '',
      m.montantMiniHT != null ? `Minimum : ${fmt(m.montantMiniHT)} € HT` : '',
      m.montantMaxiHT != null ? `Maximum : ${fmt(m.montantMaxiHT)} € HT` : '',
    ].filter(Boolean).join('   ·   '),
    vierge ? 'Colonnes A à D : ne pas modifier. Renseigner uniquement la colonne des prix unitaires.' : '',
  ].filter(Boolean);

  const colonnes: Colonne[] = [
    { header: 'Réf.', width: 9 },
    { header: 'N°', width: 12 },
    { header: 'Désignation', width: 55 },
    { header: 'Unité', width: 8, align: 'center' },
  ];
  if (mode === 'dqe') colonnes.push({ header: 'Quantité', width: 12, align: 'right', numFmt: FORMAT_NOMBRE });
  colonnes.push({ header: 'P.U. HT (€)', width: 14, align: 'right', numFmt: FORMAT_NOMBRE });
  if (mode === 'dqe') colonnes.push({ header: 'Montant HT (€)', width: 16, align: 'right', numFmt: FORMAT_NOMBRE });
  if (bpu.prixEnLettres) colonnes.push({ header: 'P.U. en lettres', width: 45 });
  if (bpu.tranches.length) colonnes.push({ header: 'Tranche', width: 10 });
  // Les intitulés de colonnes sont ceux que l'import reconnaît : jamais modifiés ici.
  colonnes.forEach((c, i) => { c.header = headers[i]; });

  const feuille = ajouterFeuille(wb, {
    nom: SHEET_BPU, settings, logo,
    title: titre,
    subtitle: projectName || bpu.projectId,
    reference: `v${bpu.version}`,
    infos,
    colonnes,
  });

  for (const r of rows) {
    const indent = '  '.repeat(r.depth);
    const line: Cellule[] = [r.ref, r.numero, indent + r.designation, r.unite];
    if (mode === 'dqe') line.push(r.kind === 'article' && r.quantite ? r.quantite : '');
    // Sur un bordereau vierge, le prix est laissé au candidat.
    line.push(vierge || r.kind !== 'article' ? '' : (r.prixUnitaire || ''));
    if (mode === 'dqe') line.push(vierge || r.kind === 'chapitre' ? '' : (r.prixTotal || ''));
    if (bpu.prixEnLettres) line.push(vierge ? '' : r.prixEnLettres);
    if (bpu.tranches.length) line.push(r.tranche);
    // Pas de fusion des lignes de lot : l'import lit leur référence et leur intitulé.
    if (r.kind === 'lot') feuille.ligne(line, { gras: true, fond: 'groupe' });
    else if (r.kind === 'chapitre') feuille.ligne(line, { gras: true, fond: 'doux' });
    else feuille.ligne(line);
  }

  // Un bordereau n'a pas de total : seul le DQE chiffré en porte un.
  if (mode === 'dqe' && !vierge) {
    feuille.vide();
    const totalLine: Cellule[] = Array(colonnes.length).fill('');
    totalLine[2] = 'MONTANT ESTIMATIF HT';
    totalLine[headers.indexOf('Montant HT (€)')] = bpu.totalHT;
    feuille.total(totalLine);
  }

  // Cadre du marché sur sa propre feuille : un candidat doit le lire sans le
  // confondre avec les lignes de prix.
  const cadre = ajouterFeuille(wb, {
    nom: SHEET_MARCHE, settings, logo,
    title: 'Cadre du marché',
    subtitle: projectName || bpu.projectId,
    paysage: false,
    colonnes: [
      { header: 'Rubrique', width: 34 },
      { header: 'Valeur', width: 45 },
      { header: '', width: 14 },
    ],
  });
  const ligneCadre = (libelle: string, valeur: Cellule) => cadre.ligne([libelle, valeur ?? '']);
  ligneCadre('Type', TYPE_MARCHE_LABELS[m.typeMarche] ?? m.typeMarche);
  ligneCadre('Objet', m.objet ?? '');
  ligneCadre('Référence', m.referenceMarche ?? '');
  ligneCadre('Pouvoir adjudicateur', m.pouvoirAdjudicateur ?? '');
  ligneCadre('Montant minimum HT', m.montantMiniHT ?? '');
  ligneCadre('Montant maximum HT', m.montantMaxiHT ?? '');
  ligneCadre('Durée initiale (mois)', m.dureeInitialeMois ?? '');
  ligneCadre('Reconductions', m.nbReconductions ?? '');
  ligneCadre('Durée d’une reconduction (mois)', m.dureeReconductionMois ?? '');
  ligneCadre('Révision des prix', m.revisionPrix ?? '');
  ligneCadre('Délai de paiement (jours)', m.delaiPaiementJours ?? '');
  ligneCadre('Date limite de remise des offres', m.dateLimiteRemiseOffres ?? '');
  if (bpu.tranches.length) {
    cadre.vide();
    cadre.ligne(['Tranches'], { gras: true, fond: 'groupe' });
    cadre.ligne(['Code', 'Libellé', 'Type'], { gras: true, fond: 'doux' });
    for (const t of bpu.tranches) cadre.ligne([t.code, t.libelle, t.type]);
  }

  // Feuille technique masquée : chemin rapide de l'import, jamais indispensable.
  // Elle disparaît à un enregistrement en CSV, le rapprochement doit donc
  // savoir se passer d'elle.
  const meta = wb.addWorksheet(SHEET_META, { state: 'hidden' });
  const metaRows: Cellule[][] = [
    ['schema_version', BPU_SHEET_SCHEMA],
    ['bpu_id', bpu.id],
    ['project_id', bpu.projectId],
    ['version', bpu.version],
    ['mode', mode],
    ['exported_at', new Date().toISOString()],
    [],
    ['ref', 'numero', 'designation'],
    ...rows.filter(r => r.kind === 'article').map(r => [r.ref, r.numero, r.designation]),
  ];
  for (const r of metaRows) meta.addRow(r.map(v => v ?? ''));

  const suffixe = vierge ? '_a_remplir' : '';
  await enregistrerClasseur(wb, `${mode.toUpperCase()}_${sanitize(projectName || bpu.titre)}${suffixe}.xlsx`);
}

// ── PDF ───────────────────────────────────────────────────────────────────────

export interface PdfOptions {
  mode: ExportMode;
  projectName?: string;
  settings: AgencySettings;
  /** Bordereau à remplir : colonne P.U. vide. */
  vierge?: boolean;
}

export async function exportBPUtoPDF(bpu: BPU, { mode, projectName, settings, vierge = false }: PdfOptions): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const logo = await loadLogoDataUrl(settings.logoUrl);

  const titre = mode === 'bpu' ? 'BPU — Bordereau de Prix Unitaires' : 'DQE — Détail Quantitatif Estimatif';
  const letterhead = { title: titre, subtitle: projectName, reference: `v${bpu.version}`, margin: 14, logo };
  const startY = drawAgencyHeader(doc, settings, letterhead);

  // Rappel du cadre du marché sous l'en-tête.
  const m = bpu.marche;
  const cadre = [
    TYPE_MARCHE_LABELS[m.typeMarche] ?? '',
    m.objet ? `Objet : ${m.objet}` : '',
    m.montantMiniHT != null ? `Minimum : ${fmt(m.montantMiniHT)} € HT` : '',
    m.montantMaxiHT != null ? `Maximum : ${fmt(m.montantMaxiHT)} € HT` : '',
    m.dureeInitialeMois ? `Durée : ${m.dureeInitialeMois} mois${m.nbReconductions ? `, ${m.nbReconductions} reconduction(s)` : ''}` : '',
  ].filter(Boolean).join('   ·   ');

  let y = startY;
  if (cadre) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(107, 114, 128);
    doc.text(cadre, 14, y + 1);
    y += 6;
  }

  const rows = flattenBPU(bpu);
  const head = excelHeaders(bpu, mode);

  const body = rows.map(r => {
    const line: (string | number)[] = [r.ref, r.numero, '   '.repeat(r.depth) + r.designation, r.unite];
    if (mode === 'dqe') line.push(r.kind === 'article' && r.quantite ? fmt(r.quantite) : '');
    line.push(vierge || r.kind !== 'article' ? '' : (r.prixUnitaire ? fmt(r.prixUnitaire) : ''));
    if (mode === 'dqe') line.push(vierge || r.kind === 'chapitre' ? '' : (r.prixTotal ? fmt(r.prixTotal) : ''));
    if (bpu.prixEnLettres) line.push(vierge ? '' : r.prixEnLettres);
    if (bpu.tranches.length) line.push(r.tranche);
    return line;
  });

  autoTable(doc, {
    startY: y,
    head: [head],
    body,
    ...tableauGris(),
    // 25 mm réservés en bas pour le pied de page et la pagination.
    margin: { left: 14, right: 14, bottom: 25 },
    columnStyles: {
      0: { cellWidth: 14 },
      1: { cellWidth: 20 },
      2: { cellWidth: 'auto' },
      3: { cellWidth: 14, halign: 'center' },
    },
    didParseCell: (data: any) => {
      const r = rows[data.row.index];
      if (!r || data.section !== 'body') return;
      if (r.kind === 'lot') {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = TABLEAU_GRIS.groupe;
      } else if (r.kind === 'chapitre') {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = TABLEAU_GRIS.sousGroupe;
      }
      // Les colonnes chiffrées sont alignées à droite.
      if (data.column.index >= 4) data.cell.styles.halign = 'right';
    },
    // Un bordereau n'a pas de total : seul le DQE chiffré en porte un.
    foot: mode === 'dqe' && !vierge
      ? [[...Array(head.indexOf('Montant HT (€)')).fill(''), 'MONTANT ESTIMATIF HT', `${fmt(bpu.totalHT)} €`]
          .slice(0, head.length)]
      : undefined,
    footStyles: { ...tableauGris().footStyles, halign: 'right' },
  });

  if (mode === 'bpu') {
    const finalY = (doc as any).lastAutoTable?.finalY ?? y;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(107, 114, 128);
    doc.text(
      "Les prix unitaires ci-dessus sont fermes et s'appliquent aux quantités réellement exécutées. "
      + 'Le présent bordereau ne comporte pas de montant global.',
      14, Math.min(finalY + 6, doc.internal.pageSize.getHeight() - 20),
    );
  }

  drawAgencyFooters(doc, settings, letterhead);
  const suffixe = vierge ? '_a_remplir' : '';
  doc.save(`${mode.toUpperCase()}_${sanitize(projectName || bpu.titre)}${suffixe}.pdf`);
}
