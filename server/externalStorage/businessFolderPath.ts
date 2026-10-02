// Le chemin logique d'un fichier métier sur l'espace de stockage du cabinet :
//
//     <racine>/<code affaire> - <nom affaire>/<Phase>/<fichier>
//
// La racine est portée par la connexion (`root_folder_path`) ; ces fonctions ne
// rendent que ce qui vient après elle.
//
// Les phases sont celles que l'application manipule déjà (`DocumentPhase` dans
// src/types.ts : ESQ, APS, APD, PC, PRO, DCE, ACT, VISA, DET, AOR, Général) et
// que l'écran Documents affiche comme second niveau d'arborescence. L'architecte
// retrouve donc dans son drive exactement le classement qu'il voit dans
// l'application — rien de plus à saisir.
import { sanitizeFolderSegment } from './folderNaming';

/** Le minimum qu'une route doit lire sur `projects` pour nommer le dossier. */
export interface FolderProject {
  project_code?: string | null;
  name?: string | null;
}

/** « 26014 - Villa Martin », ou « Villa Martin » si l'affaire n'a pas de numéro. */
export function projectFolderName(project: FolderProject | null | undefined): string {
  const code = (project?.project_code ?? '').trim();
  const name = (project?.name ?? '').trim();
  if (code && name) return sanitizeFolderSegment(`${code} - ${name}`);
  return sanitizeFolderSegment(code || name);
}

/** Les documents sans affaire se regroupent ici, à la racine — même intitulé que
 *  la phase par défaut, et que le nœud « non assignés » de l'écran Documents. */
const SANS_AFFAIRE = 'Général';

export function buildDocumentFolderPath(
  project: FolderProject | null | undefined,
  phase: string | null | undefined,
): string[] {
  const phaseSegment = sanitizeFolderSegment(phase || SANS_AFFAIRE);
  if (!project) return [SANS_AFFAIRE, phaseSegment];
  return [projectFolderName(project), phaseSegment];
}

/** Un plan n'a pas de phase — il va dans son propre sous-dossier de l'affaire. */
export function buildPlanFolderPath(project: FolderProject | null | undefined): string[] {
  if (!project) return [SANS_AFFAIRE, 'Plans'];
  return [projectFolderName(project), 'Plans'];
}

/** Un visa non plus, mais « VISA » est déjà l'une des phases connues : le visa
 *  tombe donc naturellement dans le même dossier que les documents de cette
 *  phase, plutôt que d'en ouvrir un treizième. */
export function buildVisaFolderPath(project: FolderProject | null | undefined): string[] {
  if (!project) return [SANS_AFFAIRE, 'VISA'];
  return [projectFolderName(project), 'VISA'];
}
