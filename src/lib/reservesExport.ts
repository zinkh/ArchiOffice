// ── Export PDF d'une liste de réserves ───────────────────────────────────────
// Le même document que celui qu'une entreprise reçoit après une visite de
// levée de réserves : une page de garde avec le récapitulatif, un plan par
// niveau avec les repères numérotés, puis une fiche par réserve (champs,
// commentaire, extrait de plan autour du repère, photos). En-tête, pied de
// page et pagination « P1|2 » du cabinet (pdfLetterhead.ts), présentation en
// nuances de gris — le statut est le seul élément mis en évidence.
import type { AgencySettings } from './proposalExport';
import { verifierAnnulation } from './annulation';
import { drawAgencyHeader, drawAgencyFooters, loadLogoDataUrl } from './pdfLetterhead';
import { renderPlanWithMarkers, renderPlanExcerpt, loadPhotoDataUrl } from './planRender';
import type { Reserve, GpaReserve, Plan, ReservePhoto } from '../types';
import { groupReservesByLot, type LotGroup, type LotRef } from './reserveDiffusion';
import { construireLegende, couleursParCle, couleurDe, responsableDe, hexVersRgb } from './reserveCouleurs';

type ReserveLike = Reserve | GpaReserve;

export interface ReservesExportProject {
  name: string;
  project_code?: string;
  address?: string;
  adresse_terrain?: string;
  cp_ville_terrain?: string;
  client?: string;
}

/**
 * Contenu du PDF, trois blocs indépendants : la liste récapitulative (sans le détail), le détail de chaque
 * réserve (champs, extrait de plan, photos) et les plans en annexe avec leurs pastilles. La page de garde
 * (identification de l'opération et chiffres) est toujours imprimée.
 */
export interface ReservesExportContent {
  liste: boolean;
  details: boolean;
  plans: boolean;
}

export const DEFAULT_RESERVES_CONTENT: ReservesExportContent = { liste: true, details: true, plans: true };

export interface ReservesExportOptions {
  /** Blocs imprimés ; tous par défaut. */
  content?: Partial<ReservesExportContent>;
  /** « Réserves » ou « Réserves GPA » — le titre du document. */
  title: string;
  onProgress?: (message: string) => void;
  /** Lots de l'opération : le document est classé par lot, dans l'ordre des numéros de lot. */
  lots?: LotRef[];
  /** Périmètre choisi (intitulés de lot) : une réserve est rangée sous le premier de ses lots retenus. */
  allowedLots?: string[] | null;
  /** Mention de la page de garde : « Lots : 02 · Plâtrerie », « Entreprise : Martin SARL »... */
  scopeLabel?: string;
  /** « blob » : rend le PDF sans le télécharger (envoi par e-mail). Le Blob est rendu dans les deux cas. */
  output?: 'download' | 'blob';
  /**
   * Couleur de chaque entreprise ou lot, telle qu'à l'écran (calculée sur toutes les réserves de l'affaire).
   * Sans elle, les couleurs sont attribuées sur les seules réserves imprimées.
   */
  couleurs?: Map<string, string>;
  /** Annulation demandée : l'export s'arrête à la fiche ou au plan suivant et lève `ExportAnnule`. */
  signal?: AbortSignal;
}

/** Nom du fichier PDF : titre, code et nom de l'opération, puis le suffixe (entreprise, lot...). */
export function reservesPdfFilename(title: string, project: { name: string; project_code?: string }, suffix?: string): string {
  return `${sanitize(title)}_${sanitize(project.project_code || '')}_${sanitize(project.name)}${suffix ? `_${sanitize(suffix)}` : ''}.pdf`;
}

const GRIS_TEXTE: [number, number, number] = [17, 24, 39];
const GRIS_DOUX: [number, number, number] = [107, 114, 128];
const GRIS_FILET: [number, number, number] = [209, 213, 219];
const GRIS_FOND: [number, number, number] = [243, 244, 246];

const MARGIN = 14;
const FOOTER_RESERVE = 18; // hauteur réservée au pied de page
const THUMB_W = 42;
const THUMB_H = 42;
const THUMB_GAP = 4;

const sanitize = (s: string) => (s || 'reserves').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_');

export function parseJsonList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [String(parsed)];
  } catch {
    return value.split(',').map(s => s.trim()).filter(Boolean);
  }
}

const fmtDate = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('fr-FR');
};

const fmtDateTime = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};

export function reserveIsOverdue(r: ReserveLike, today = new Date()): number {
  if (r.status === 'Levée' || r.status === 'Quitus Transmis' || r.status === 'Pour mémoire' || !r.due_date) return 0;
  const t = new Date(today); t.setHours(0, 0, 0, 0);
  const d = new Date(r.due_date); d.setHours(0, 0, 0, 0);
  if (isNaN(d.getTime()) || d >= t) return 0;
  return Math.floor((t.getTime() - d.getTime()) / 86400000);
}

interface Thumb {
  dataUrl: string;
  width: number;
  height: number;
  caption: string;
}

export async function exportReservesToPDF(
  reserves: ReserveLike[],
  plans: Plan[],
  project: ReservesExportProject,
  settings: AgencySettings,
  opts: ReservesExportOptions,
): Promise<Blob> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'),
  ]);
  const progress = opts.onProgress || (() => {});
  const content = { ...DEFAULT_RESERVES_CONTENT, ...opts.content };
  // Classé par lot (ordre des numéros de lot, « Sans lot » en dernier), puis par numéro de réserve.
  const allowed = opts.allowedLots ? new Set(opts.allowedLots) : null;
  const groups: LotGroup<ReserveLike>[] = groupReservesByLot(reserves, opts.lots ?? [], allowed);
  const sorted = groups.flatMap(g => g.rows);
  const groupOfId = new Map(groups.flatMap(g => g.rows.map(r => [r.id, g] as const)));
  // Couleur par responsable : celle de l'écran quand elle est fournie, pour qu'un PDF filtré par lot garde les mêmes couleurs.
  const couleursTable = opts.couleurs ?? couleursParCle(construireLegende(reserves));

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  verifierAnnulation(opts.signal);
  const logo = await loadLogoDataUrl(settings.logoUrl);
  const letterhead = {
    title: `Liste de ${opts.title.toLowerCase()}`,
    subtitle: project.name,
    reference: project.project_code,
    margin: MARGIN,
    logo,
  };

  const pageW = () => doc.internal.pageSize.getWidth();
  const pageH = () => doc.internal.pageSize.getHeight();
  const contentW = () => pageW() - MARGIN * 2;

  // ── Page de garde ──────────────────────────────────────────────────────
  let y = drawAgencyHeader(doc, settings, letterhead);
  y += 4;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...GRIS_TEXTE);
  doc.text(`Liste de ${opts.title.toLowerCase()}`, MARGIN, y);
  y += 9;

  const adresse = project.address || [project.adresse_terrain, project.cp_ville_terrain].filter(Boolean).join(' ');
  const infos: [string, string][] = [
    ['Projet', [project.project_code, project.name].filter(Boolean).join(' - ')],
    ['Adresse chantier', adresse],
    ["Maître d'ouvrage", project.client || ''],
    ...(opts.scopeLabel ? [['Périmètre', opts.scopeLabel]] : []),
    ["Date d'édition", new Date().toLocaleDateString('fr-FR')],
  ].filter(([, v]) => v) as [string, string][];
  doc.setFontSize(9.5);
  for (const [label, value] of infos) {
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...GRIS_DOUX);
    doc.text(`${label} :`, MARGIN, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...GRIS_TEXTE);
    const lines = doc.splitTextToSize(value, contentW() - 40) as string[];
    doc.text(lines, MARGIN + 40, y);
    y += 5 * Math.max(1, lines.length);
  }
  y += 3;

  const counts = {
    total: sorted.length,
    ouvertes: sorted.filter(r => r.status === 'A faire' || r.status === 'En cours').length,
    retard: sorted.filter(r => reserveIsOverdue(r) > 0).length,
    levees: sorted.filter(r => r.status === 'Levée' || r.status === 'Quitus Transmis').length,
  };
  autoTable(doc, {
    startY: y,
    head: [['Réserves', 'Ouvertes', 'En retard', 'Levées']],
    body: [[String(counts.total), String(counts.ouvertes), String(counts.retard), String(counts.levees)]],
    styles: { fontSize: 9, textColor: GRIS_TEXTE, halign: 'center' },
    headStyles: { fillColor: [60, 60, 60], textColor: 255, fontStyle: 'bold' },
    margin: { left: MARGIN, right: MARGIN },
    tableWidth: 110,
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // Légende des couleurs : une pastille par entreprise (à défaut par lot) avec son nombre de réserves.
  const legendeExport = construireLegende(sorted).map(l => ({ ...l, couleur: couleursTable.get(l.cle) ?? l.couleur }));
  if (legendeExport.length > 0) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...GRIS_TEXTE);
    doc.text('Légende des couleurs', MARGIN, y);
    y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    let x = MARGIN;
    for (const l of legendeExport) {
      const texte = (doc.splitTextToSize(`${l.nom} (${l.total})`, contentW() - 6) as string[])[0];
      const w = doc.getTextWidth(texte) + 9;
      if (x > MARGIN && x + w > pageW() - MARGIN) { x = MARGIN; y += 5; }
      if (y + 5 > pageH() - FOOTER_RESERVE) {
        doc.addPage('a4', 'portrait');
        y = drawAgencyHeader(doc, settings, letterhead);
        x = MARGIN;
      }
      doc.setFillColor(...hexVersRgb(l.couleur));
      doc.rect(x, y - 2.6, 3, 3, 'F');
      doc.setTextColor(...GRIS_TEXTE);
      doc.text(texte, x + 4.5, y);
      x += w + 3;
    }
    y += 8;
  }

  const planById = new Map(plans.map(p => [p.id, p]));
  const summaryBody: any[][] = [];
  // Liseré de couleur au bord de la cellule « N° », une entrée par ligne du corps (null : ligne de lot ou sans responsable).
  const rowColors: ([number, number, number] | null)[] = [];
  for (const g of groups) {
    rowColors.push(null);
    summaryBody.push([{
      content: `${g.label} (${g.rows.length} réserve${g.rows.length > 1 ? 's' : ''})`,
      colSpan: 6,
      // `halign: 'left'` : sans lui, la cellule étendue hérite de la colonne des numéros, alignée à droite.
      styles: { halign: 'left', fontStyle: 'bold', fillColor: [229, 231, 235], textColor: GRIS_TEXTE },
    }]);
    for (const r of g.rows) {
      const retard = reserveIsOverdue(r);
      rowColors.push(responsableDe(r) ? hexVersRgb(couleurDe(r, couleursTable)) : null);
      summaryBody.push([
        String(r.number ?? ''),
        r.title || '',
        [r.batiment, r.local].filter(Boolean).join(' / '),
        parseJsonList(r.entreprises).join(', '),
        `${fmtDate(r.due_date)}${retard ? ` (+${retard} j)` : ''}`,
        r.status,
      ]);
    }
  }
  if (content.liste) autoTable(doc, {
    startY: y,
    head: [['N°', 'Intitulé', 'Localisation', 'En charge', 'Échéance', 'Statut']],
    body: summaryBody,
    styles: { fontSize: 8, textColor: GRIS_TEXTE, cellPadding: 1.6, overflow: 'linebreak' },
    headStyles: { fillColor: [60, 60, 60], textColor: 255, fontStyle: 'bold', fontSize: 8 },
    columnStyles: { 0: { cellWidth: 10, halign: 'right' }, 1: { cellWidth: 62 }, 4: { cellWidth: 24 }, 5: { cellWidth: 26, fontStyle: 'bold' } },
    margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_RESERVE },
    didDrawCell: (data: any) => {
      if (data.section !== 'body' || data.column.index !== 0) return;
      const couleur = rowColors[data.row.index];
      if (!couleur) return;
      doc.setFillColor(...couleur);
      doc.rect(data.cell.x, data.cell.y, 1.8, data.cell.height, 'F');
    },
  });

  // ── Une fiche par réserve ──────────────────────────────────────────────
  if (content.details && sorted.length > 0) {
    doc.addPage('a4', 'portrait');
    y = drawAgencyHeader(doc, settings, letterhead);
  }

  const ensureRoom = (needed: number) => {
    if (y + needed > pageH() - FOOTER_RESERVE) {
      doc.addPage('a4', 'portrait');
      y = drawAgencyHeader(doc, settings, letterhead);
    }
  };

  let currentGroup = '';
  for (let i = 0; content.details && i < sorted.length; i++) {
    verifierAnnulation(opts.signal);
    const r = sorted[i];
    progress(`Fiche ${i + 1} / ${sorted.length}…`);

    // Bandeau du lot à chaque changement de lot.
    const group = groupOfId.get(r.id);
    if (group && group.key !== currentGroup) {
      currentGroup = group.key;
      ensureRoom(22);
      doc.setFillColor(...GRIS_FOND);
      doc.rect(MARGIN, y - 1, contentW(), 8, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...GRIS_TEXTE);
      doc.text(`${group.label}`, MARGIN + 2, y + 4.5);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...GRIS_DOUX);
      doc.text(`${group.rows.length} réserve${group.rows.length > 1 ? 's' : ''}`, pageW() - MARGIN - 2, y + 4.5, { align: 'right' });
      y += 11;
    }

    const thumbs: Thumb[] = [];
    const plan = r.plan_id ? planById.get(r.plan_id) : undefined;
    if (plan && r.x != null && r.y != null) {
      try {
        const dataUrl = await renderPlanExcerpt(plan.file_url, r.x, r.y, String(r.number ?? ''), {
          couleur: responsableDe(r) ? couleurDe(r, couleursTable) : undefined,
        });
        thumbs.push({ dataUrl, width: 1, height: 1, caption: plan.name });
      } catch (err) {
        console.error('[reservesExport] Extrait de plan impossible :', err);
      }
    }
    for (const photo of (r.photos || []) as ReservePhoto[]) {
      const loaded = await loadPhotoDataUrl(photo.file_url);
      if (loaded) thumbs.push({ ...loaded, caption: photo.caption || `Photo ${fmtDateTime(photo.uploaded_at)}` });
    }

    // Hauteur du bloc, pour ne jamais couper une fiche entre deux pages
    // quand elle tient sur une.
    const retard = reserveIsOverdue(r);
    const fields: [string, string][] = [
      ['Statut', `${r.status}${retard ? ` — en retard de ${retard} j` : ''}`],
      ['Lot', parseJsonList(r.lots).join(', ')],
      ['En charge', parseJsonList(r.entreprises).join(', ')],
      ['Bâtiment', r.batiment || ''],
      ['Local', r.local || ''],
      ['Créée le', fmtDate(r.created_at)],
      ["Date d'échéance", fmtDate(r.due_date)],
    ].filter(([, v]) => v) as [string, string][];
    doc.setFontSize(11);
    const titleLines = doc.splitTextToSize(r.title || '(sans titre)', contentW() - 16) as string[];
    doc.setFontSize(9);
    const descLines = r.description ? (doc.splitTextToSize(r.description, contentW() - 4) as string[]) : [];
    const reponseLines = r.reponse ? (doc.splitTextToSize(r.reponse, contentW() - 4) as string[]) : [];
    const thumbRows = Math.ceil(thumbs.length / 4);
    const blockH = 6 + titleLines.length * 5 + fields.length * 4.6 + (descLines.length ? descLines.length * 4 + 3 : 0)
      + (reponseLines.length ? reponseLines.length * 4 + 7 : 0)
      + thumbRows * (THUMB_H + 9) + 6;
    ensureRoom(Math.min(blockH, pageH() - FOOTER_RESERVE - 40));

    // Numéro et intitulé, avec le liseré de la couleur du responsable
    const responsable = responsableDe(r);
    const couleurFiche = responsable ? hexVersRgb(couleurDe(r, couleursTable)) : null;
    // La pastille se pose sur la ligne qui nomme le responsable : l'entreprise, à défaut le lot.
    const champCouleur = responsable?.kind === 'lot' ? 'Lot' : 'En charge';
    doc.setFillColor(...GRIS_FOND);
    doc.rect(MARGIN, y - 1, 14, 7, 'F');
    if (couleurFiche) {
      doc.setFillColor(...couleurFiche);
      doc.rect(MARGIN, y - 1, 2.2, 7, 'F');
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...GRIS_TEXTE);
    doc.text(String(r.number ?? ''), MARGIN + 7, y + 4, { align: 'center' });
    doc.setFontSize(11);
    doc.text(titleLines, MARGIN + 16, y + 4);
    y += 6 + titleLines.length * 5;

    // Champs
    doc.setFontSize(9);
    for (const [label, value] of fields) {
      ensureRoom(5);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...GRIS_DOUX);
      doc.text(`${label} :`, MARGIN + 2, y);
      doc.setFont('helvetica', label === 'Statut' ? 'bold' : 'normal'); doc.setTextColor(...GRIS_TEXTE);
      const lines = doc.splitTextToSize(value, contentW() - 36) as string[];
      if (couleurFiche && label === champCouleur) {
        doc.setFillColor(...couleurFiche);
        doc.rect(MARGIN + 30.4, y - 2.6, 2.8, 2.8, 'F');
      }
      doc.text(lines, MARGIN + 34, y);
      y += 4.6 * Math.max(1, lines.length);
    }

    // Commentaire
    if (descLines.length) {
      ensureRoom(descLines.length * 4 + 3);
      y += 1;
      doc.setFont('helvetica', 'italic'); doc.setTextColor(...GRIS_TEXTE);
      doc.text(descLines, MARGIN + 2, y);
      y += descLines.length * 4 + 2;
    }

    // Suivi / réponse (levée jugée insatisfaisante, réponse de l'entreprise...)
    if (reponseLines.length) {
      ensureRoom(reponseLines.length * 4 + 7);
      y += 1;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...GRIS_DOUX);
      doc.text('Suivi / réponse :', MARGIN + 2, y);
      y += 4;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GRIS_TEXTE);
      doc.text(reponseLines, MARGIN + 2, y);
      y += reponseLines.length * 4 + 2;
    }

    // Vignettes : extrait de plan puis photos, quatre par ligne
    if (thumbs.length) {
      y += 2;
      let col = 0;
      for (const t of thumbs) {
        if (col === 4) { col = 0; y += THUMB_H + 9; }
        if (col === 0) ensureRoom(THUMB_H + 9);
        const x = MARGIN + col * (THUMB_W + THUMB_GAP);
        const ratio = t.width && t.height ? t.width / t.height : 1;
        let w = THUMB_W, h = THUMB_W / ratio;
        if (h > THUMB_H) { h = THUMB_H; w = THUMB_H * ratio; }
        try {
          doc.addImage(t.dataUrl, 'JPEG', x + (THUMB_W - w) / 2, y + (THUMB_H - h) / 2, w, h);
        } catch { /* une image illisible ne doit pas emporter l'export */ }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...GRIS_DOUX);
        const cap = doc.splitTextToSize(t.caption, THUMB_W) as string[];
        doc.text(cap.slice(0, 2), x + THUMB_W / 2, y + THUMB_H + 3, { align: 'center' });
        col++;
      }
      y += THUMB_H + 9;
    }

    // Filet de séparation
    y += 2;
    doc.setDrawColor(...GRIS_FILET); doc.setLineWidth(0.25);
    doc.line(MARGIN, y, pageW() - MARGIN, y);
    y += 6;
  }

  // ── Annexe : un plan par page avec les pastilles numérotées des réserves ─
  if (content.plans) {
    const planIds = [...new Set(sorted.filter(r => r.plan_id && r.x != null && r.y != null).map(r => r.plan_id as string))]
      .filter(id => planById.has(id));
    for (const planId of planIds) {
      verifierAnnulation(opts.signal);
      const plan = planById.get(planId)!;
      progress(`Rendu du plan ${plan.name}…`);
      const markers = sorted
        .filter(r => r.plan_id === planId && r.x != null && r.y != null)
        .map(r => ({
          x: r.x as number, y: r.y as number, label: String(r.number ?? ''),
          couleur: responsableDe(r) ? couleurDe(r, couleursTable) : undefined,
        }));
      let image: { dataUrl: string; width: number; height: number };
      try {
        image = await renderPlanWithMarkers(plan.file_url, markers);
      } catch (err) {
        console.error('[reservesExport] Plan illisible :', plan.name, err);
        continue;
      }
      const landscape = image.width > image.height;
      doc.addPage('a4', landscape ? 'landscape' : 'portrait');
      let py = drawAgencyHeader(doc, settings, { ...letterhead, subtitle: plan.name });
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...GRIS_TEXTE);
      doc.text(`Annexe : ${plan.name}`, MARGIN, py + 2);
      py += 6;
      const availW = contentW();
      const availH = pageH() - py - FOOTER_RESERVE;
      const scale = Math.min(availW / image.width, availH / image.height);
      const w = image.width * scale;
      const h = image.height * scale;
      doc.addImage(image.dataUrl, 'JPEG', MARGIN + (availW - w) / 2, py, w, h);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...GRIS_DOUX);
      doc.text(`Repères : ${markers.map(m => m.label).join(' ; ')}`, MARGIN, Math.min(py + h + 4, pageH() - FOOTER_RESERVE + 2));
    }
  }

  progress('Finalisation…');
  drawAgencyFooters(doc, settings, letterhead);
  verifierAnnulation(opts.signal);
  const blob = doc.output('blob') as Blob;
  if (opts.output !== 'blob') doc.save(reservesPdfFilename(opts.title, project));
  return blob;
}
