// ── Export groupé du dossier PRO ─────────────────────────────────────────────
// Un seul point d'entrée pour produire, d'après un même périmètre (lots,
// bâtiments, phases), n'importe quelle combinaison de CCTP, DPGF, DQE, BPU et
// estimation. Les exporteurs de chaque document ne changent pas : on leur donne
// une sortie qui collecte les fichiers au lieu de les télécharger, puis
// `livrer()` les remet en un fichier ou en un ZIP.
import type { DPGF } from '../types/dpgf';
import type { BPU } from '../types/bpu';
import type { AgencySettings } from './proposalExport';
import type { ContexteCctp } from './cctpVariables';
import { articlesSansBatiment, batimentsParOrdre } from './batimentsArticles';
import { exportCctpDocx, exportCctpPdf } from './cctpExport';
import { exportBPUtoExcel, exportBPUtoPDF } from './bpuExport';
import {
  exportDPGFtoExcel, exportDPGFtoPDF, exportEstimationtoExcel, exportEstimationtoPDF,
} from './proExport';
import { compterArticles, filtrerPourExport, type ExportSelection } from './exportPerimetre';
import type { FichierExporte, Sortie } from './exportSortie';

export type DocumentDossier = 'cctp' | 'dpgf' | 'dqe' | 'bpu' | 'estimation';

/** `autre` : Word pour le CCTP, Excel pour les autres documents. */
export type FormatChoisi = 'pdf' | 'autre' | 'both';

export const DOCUMENTS_DOSSIER: DocumentDossier[] = ['cctp', 'dpgf', 'dqe', 'bpu', 'estimation'];

export interface DemandeDossier {
  dpgf: DPGF;
  /** Bordereau déjà préparé (références attribuées) ; `null` s'il n'est pas chargé. */
  bpu: BPU | null;
  documents: Partial<Record<DocumentDossier, FormatChoisi>>;
  selection: ExportSelection;
  /** DPGF, DQE et BPU : avec leurs prix (usage interne). L'estimation en a toujours. */
  avecPrix: boolean;
  /** DPGF avec prix : ajoute la colonne de TVA des postes à taux dédié (masquée par défaut). */
  avecTva?: boolean;
  /** CCTP : un fichier par bâtiment, même sans sélection de bâtiments. */
  cctpParBatiment: boolean;
  projectName?: string;
  /** Rappel du périmètre, imprimé sous le titre ; vide pour tout le document. */
  perimetre?: string;
  settings: AgencySettings;
  contexte?: ContexteCctp;
}

export type Avertissement =
  | { code: 'vide'; document: DocumentDossier }
  | { code: 'sans_batiment'; count: number };

export interface ResultatDossier {
  fichiers: FichierExporte[];
  avertissements: Avertissement[];
}

const formats = (choix: FormatChoisi): Array<'pdf' | 'autre'> =>
  choix === 'both' ? ['pdf', 'autre'] : [choix];

/** Nombre de fichiers que produira la demande (aperçu de la fenêtre). */
export function compterFichiers(
  d: Pick<DemandeDossier, 'documents' | 'selection' | 'cctpParBatiment' | 'dpgf'>,
): number {
  let n = 0;
  for (const doc of DOCUMENTS_DOSSIER) {
    const choix = d.documents[doc];
    if (!choix) continue;
    const versions = doc === 'cctp' ? Math.max(1, batimentsCctp(d).length) : 1;
    n += versions * formats(choix).length;
  }
  return n;
}

/** Bâtiments pour lesquels le CCTP est produit séparément (vide : une seule opération). */
export function batimentsCctp(d: Pick<DemandeDossier, 'dpgf' | 'selection' | 'cctpParBatiment'>) {
  if (!d.dpgf.multiBatiments) return [];
  if (!d.cctpParBatiment && d.selection.batimentCodes === null) return [];
  const retenus = d.selection.batimentCodes ? new Set(d.selection.batimentCodes) : null;
  return batimentsParOrdre(d.dpgf.batiments).filter(b => !retenus || retenus.has(b.code));
}

export async function produireDossier(d: DemandeDossier): Promise<ResultatDossier> {
  const fichiers: FichierExporte[] = [];
  const avertissements: Avertissement[] = [];
  const sortie: Sortie = (nom, blob) => { fichiers.push({ nom, blob }); };
  const etiquette = d.perimetre ? `${d.projectName ?? d.dpgf.titre} - ${d.perimetre}` : d.projectName;
  const settings = d.settings;
  const prix = { avecPrix: d.avecPrix, avecTva: d.avecTva, sortie };

  for (const doc of DOCUMENTS_DOSSIER) {
    const choix = d.documents[doc];
    if (!choix) continue;
    const fmts = formats(choix);

    if (doc === 'cctp') {
      const source = filtrerPourExport(d.dpgf, d.selection, { cctp: true });
      if (compterArticles(source) === 0 && source.lots.length === 0) { avertissements.push({ code: 'vide', document: doc }); continue; }
      const contexte = { operation: d.projectName, agence: settings.agencyName, ...d.contexte };
      const batiments = batimentsCctp(d);
      if (batiments.length) {
        const orphelins = articlesSansBatiment(source).length;
        if (orphelins) avertissements.push({ code: 'sans_batiment', count: orphelins });
      }
      for (const batiment of batiments.length ? batiments : [undefined]) {
        const opts = { projectName: etiquette, settings, batiment, contexte, sortie };
        for (const f of fmts) await (f === 'pdf' ? exportCctpPdf(source, opts) : exportCctpDocx(source, opts));
      }
      continue;
    }

    if (doc === 'dpgf' || doc === 'estimation') {
      const source = filtrerPourExport(d.dpgf, d.selection);
      if (compterArticles(source) === 0) { avertissements.push({ code: 'vide', document: doc }); continue; }
      for (const f of fmts) {
        if (doc === 'dpgf') {
          await (f === 'pdf' ? exportDPGFtoPDF : exportDPGFtoExcel)(source, etiquette, 'lot', settings, prix);
        } else {
          await (f === 'pdf' ? exportEstimationtoPDF : exportEstimationtoExcel)(source, etiquette, settings, sortie);
        }
      }
      continue;
    }

    // BPU et DQE : le bordereau est vierge (sans prix) tant que les prix ne sont pas demandés.
    if (!d.bpu) { avertissements.push({ code: 'vide', document: doc }); continue; }
    const source = filtrerPourExport(d.bpu, d.selection);
    if (compterArticles(source) === 0) { avertissements.push({ code: 'vide', document: doc }); continue; }
    const opts = { mode: doc, vierge: !d.avecPrix, projectName: etiquette, settings, sortie } as const;
    for (const f of fmts) await (f === 'pdf' ? exportBPUtoPDF(source, opts) : exportBPUtoExcel(source, opts));
  }
  return { fichiers, avertissements };
}
