// Annexe « fiches techniques » transmise avec le CCTP (case à cocher de la fenêtre Exporter, décochée par
// défaut : les fiches ne partent jamais d'elles-mêmes). Forme choisie : un DOSSIER « Annexe - Fiches
// techniques » dans l'archive de l'export, qui contient les fichiers d'origine, nommés d'après leur poste,
// et un index PDF à la charte du cabinet (poste, fiche, observation).
//
// Une fiche anonymisée (marques masquées pour l'IA et dans le CCTP) est jointe TELLE QUELLE : son fichier
// d'origine contient les marques. L'export le dit (avertissement `annexe_marques`) et l'index le précise.
import type { DPGF, Ligne } from '../types/dpgf';
import type { AgencySettings } from './proposalExport';
import { nomSur, type FichierExporte } from './exportSortie';
import { estPhoto } from './fichePhoto';

export const DOSSIER_ANNEXE = 'Annexe - Fiches techniques';

export interface EntreeAnnexe {
  lot: string;
  numero: string;
  designation: string;
  nom: string;
  fileUrl: string;
  anonymiser: boolean;
  /** Chemin du fichier dans l'archive (identique pour une fiche citée par plusieurs postes). */
  chemin: string;
}

export interface ResultatAnnexe {
  fichiers: FichierExporte[];
  entrees: EntreeAnnexe[];
  /** Fiches dont le fichier n'a pas pu être lu : listées dans l'index, non jointes. */
  manquantes: string[];
  /** Fiches jointes qui portent des marques malgré l'anonymisation demandée. */
  avecMarques: number;
}

/** Les fiches des postes du CCTP exporté, dans l'ordre du document. Un même fichier garde un seul chemin. */
export function planAnnexe(source: Pick<DPGF, 'lots'>): EntreeAnnexe[] {
  const entrees: EntreeAnnexe[] = [];
  const cheminDe = new Map<string, string>();
  const pris = new Set<string>();
  const marche = (lignes: Ligne[], lot: string) => lignes.forEach(l => {
    for (const f of l.fichesTechniques ?? []) {
      // Une photo alimente la description du poste : elle n'est pas une fiche technique à transmettre.
      if (!f.fileUrl || estPhoto(f.nom)) continue;
      const cle = f.documentId || f.fileUrl;
      let chemin = cheminDe.get(cle);
      if (!chemin) {
        const base = `${DOSSIER_ANNEXE}/${nomSur(`${l.numero} ${l.designation.slice(0, 40)} ${f.nom}`)}`;
        chemin = base;
        for (let n = 2; pris.has(chemin.toLowerCase()); n++) {
          const point = base.lastIndexOf('.');
          chemin = point > base.lastIndexOf('/') ? `${base.slice(0, point)} (${n})${base.slice(point)}` : `${base} (${n})`;
        }
        pris.add(chemin.toLowerCase());
        cheminDe.set(cle, chemin);
      }
      entrees.push({ lot, numero: l.numero, designation: l.designation, nom: f.nom, fileUrl: f.fileUrl, anonymiser: !!f.anonymiser, chemin });
    }
    if (l.children?.length) marche(l.children, lot);
  });
  for (const lot of source.lots) for (const chap of lot.chapitres) marche(chap.lignes, `${lot.numero} ${lot.titre}`.trim());
  return entrees;
}

/** Index PDF de l'annexe, à la charte (en-tête, tableau gris, pied de page « P1|2 »). */
export async function indexAnnexePdf(
  entrees: EntreeAnnexe[], manquantes: Set<string>, settings: AgencySettings, projet?: string,
): Promise<Blob> {
  const [{ default: jsPDF }, { default: autoTable }, lh] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), import('./pdfLetterhead'),
  ]);
  const MARGE = 14;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const logo = await lh.loadLogoDataUrl(settings.logoUrl);
  const entete = { title: 'Annexe - Fiches techniques', margin: MARGE, logo };
  let y = lh.drawAgencyHeader(doc, settings, entete) + 2;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(17, 24, 39);
  doc.text('Annexe : fiches techniques', MARGE, y);
  y += 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(75, 85, 99);
  doc.text([projet, `${entrees.length} fiche${entrees.length > 1 ? 's' : ''} rattachée${entrees.length > 1 ? 's' : ''} aux postes du CCTP`].filter(Boolean).join('   ·   '), MARGE, y);
  y += 6;

  const base = lh.tableauGris(MARGE);
  autoTable(doc, {
    ...base,
    startY: y,
    head: [['Poste', 'Désignation', 'Fiche technique', 'Observation']],
    body: entrees.length
      ? entrees.map(e => [
        e.numero, e.designation, e.chemin.slice(DOSSIER_ANNEXE.length + 1),
        [manquantes.has(e.chemin) ? 'Fichier non joint' : '', e.anonymiser ? 'Contient des marques' : ''].filter(Boolean).join(' ; '),
      ])
      : [[{ content: 'Aucune fiche technique.', colSpan: 4, styles: { fontStyle: 'italic' } }]],
    styles: { ...base.styles, fontSize: 8, cellPadding: 1.8, overflow: 'linebreak', valign: 'top' },
    columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 52 }, 3: { cellWidth: 34 } },
  });
  lh.drawAgencyFooters(doc, settings, entete);
  return doc.output('blob');
}

/**
 * Construit le dossier d'annexe : fichiers d'origine puis index PDF. `lireFichier` rend le contenu d'un fichier
 * (référence de stockage) ou lève une erreur : une fiche illisible est listée à l'index et signalée, sans
 * empêcher l'export du reste.
 */
export async function produireAnnexe(
  source: Pick<DPGF, 'lots'>,
  opts: { settings: AgencySettings; projet?: string; lireFichier: (fileUrl: string) => Promise<Blob>; avecIndex?: boolean },
): Promise<ResultatAnnexe> {
  const entrees = planAnnexe(source);
  const fichiers: FichierExporte[] = [];
  const manquantes = new Set<string>();
  const lus = new Set<string>();
  for (const e of entrees) {
    if (lus.has(e.chemin) || manquantes.has(e.chemin)) continue;
    try {
      fichiers.push({ nom: e.chemin, blob: await opts.lireFichier(e.fileUrl) });
      lus.add(e.chemin);
    } catch {
      manquantes.add(e.chemin);
    }
  }
  if (entrees.length && opts.avecIndex !== false) {
    fichiers.push({ nom: `${DOSSIER_ANNEXE}/Index des fiches techniques.pdf`, blob: await indexAnnexePdf(entrees, manquantes, opts.settings, opts.projet) });
  }
  return {
    fichiers, entrees,
    manquantes: [...new Set(entrees.filter(e => manquantes.has(e.chemin)).map(e => e.nom))],
    avecMarques: new Set(entrees.filter(e => e.anonymiser && lus.has(e.chemin)).map(e => e.chemin)).size,
  };
}
