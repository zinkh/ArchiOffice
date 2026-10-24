// Le dossier logique d'un document selon ce à quoi il se rattache.
//
// Extrait de routes/documents.ts pour que DEUX appelants rangent au même endroit :
// le dépôt d'un document (documents.ts) et la migration des fichiers existants vers
// l'arborescence lisible (server/storageTreeMigration.ts). Deux copies de cette
// règle finiraient par diverger, et un fichier migré n'atterrirait plus là où un
// dépôt neuf irait.
import { buildDocumentFolderPath, type FolderProject } from './businessFolderPath';

// Le sous-dossier d'une pièce jointe rattachée à autre chose qu'un projet
// (permis, réunion, réserve...) : la plupart de ces ressources portent
// elles-mêmes un project_id, donc le fichier va nicher dans le dossier de
// l'affaire. Sinon (contacts, devis, appels d'offres, qui n'ont pas encore
// d'affaire) il tombe dans un sous-dossier nommé d'après la ressource, à la
// racine « Général », comme un document sans affaire.
export const RESOURCE_FOLDER_LABELS: Record<string, string> = {
  contacts: 'Contacts', proposals: 'Devis', tenders: "Appels d'offres",
  permits: 'Permis', meetings: 'Réunions', receptions: 'Réceptions', reserves: 'Réserves',
  contrats_moe: 'Contrats MOE', ordres_de_service: 'Ordres de service', visas: 'VISA',
  notes_honoraires: "Notes d'honoraires", marches_entreprises: 'Marchés entreprises',
  tasks: 'Tâches', milestones: 'Jalons', agents: 'Bibliothèque de connaissances',
  agency_library: 'Bibliothèque notes méthodologiques',
};

export interface DocumentFolderResolver {
  /** Numéro et nom de l'affaire, ou null (sans affaire, ou affaire d'un autre cabinet). */
  loadFolderProject: (projectId: string | null, tenantId: string) => Promise<FolderProject | null>;
  /** Dossier d'une pièce jointe rattachée à une ressource (un projet compris). */
  folderPathForResource: (resourceType: string, resourceId: string | null, tenantId: string) => Promise<string[]>;
}

export function createDocumentFolderResolver(supabaseAdmin: any): DocumentFolderResolver {
  // Le numéro et le nom de l'affaire nomment son dossier (« 26014 - Villa Martin »).
  // Lecture sautée pour un document sans affaire.
  async function loadFolderProject(projectId: string | null, tenantId: string) {
    if (!projectId) return null;
    const { data } = await supabaseAdmin.from('projects')
      .select('project_code, name').eq('id', projectId).eq('tenant_id', tenantId).maybeSingle();
    return (data as any) || null;
  }

  async function folderPathForResource(resourceType: string, resourceId: string | null, tenantId: string): Promise<string[]> {
    if (resourceType === 'projects') return buildDocumentFolderPath(await loadFolderProject(resourceId, tenantId), null);
    if (!resourceId || resourceType === 'agency_library') return buildDocumentFolderPath(null, RESOURCE_FOLDER_LABELS[resourceType] || resourceType);
    const { data } = await supabaseAdmin.from(resourceType).select('project_id').eq('id', resourceId).eq('tenant_id', tenantId).maybeSingle();
    const linkedProjectId = (data as any)?.project_id || null;
    const project = linkedProjectId ? await loadFolderProject(linkedProjectId, tenantId) : null;
    return buildDocumentFolderPath(project, RESOURCE_FOLDER_LABELS[resourceType] || resourceType);
  }

  return { loadFolderProject, folderPathForResource };
}
