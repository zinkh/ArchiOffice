// Affaire créée à l'acceptation d'une proposition : UNE seule correspondance, pure et testée,
// pour que rien de ce que la proposition porte ne reste en route.
//
//  - les champs communs aux deux tables sont recopiés tels quels (`COPIED_FIELDS`) ;
//  - les chiffres (budget, rémunération, surface) viennent de `projectFinancials` ;
//  - la nature des travaux de la déclaration MAF se déduit de la nature de l'opération ;
//  - `source_proposal_id` garde le lien : honoraires, planning, étude de faisabilité, pièces et
//    suivi de signature restent lisibles sur la proposition d'origine (archivée, jamais supprimée).
// Une valeur absente est omise : on n'écrit jamais « undefined », ni une chaîne vide inventée.
import { operationNature } from './proposalSurfaces';

/** Colonnes présentes à l'identique dans `proposals` et `projects`. */
export const COPIED_FIELDS = [
  // Identité et client
  'reference', 'project_code', 'client_id', 'client_email', 'projet_detail', 'is_entreprise', 'nom_societe', 'rcs',
  'representant', 'qualite', 'adresse_client', 'cp_client', 'ville_client', 'telephone', 'portable', 'email_client',
  // Terrain
  'adresse_terrain', 'cp_ville_terrain', 'ban_id_terrain', 'city_code_terrain', 'ref_cadastrale', 'zone_plu',
  'surface_parcelle', 'parcelles_selection',
  // Opération, surfaces et ERP
  'operation_nature', 'surface_existante', 'surface_rehabilitee', 'is_erp', 'nom_etablissement', 'avant_trav', 'apres_trav',
  'type_et_cat', 'type_projet', 'categorie_projet', 'surface_plancher', 'surface_plancher_ext', 'surface_erp', 'surface_ert',
  'effectif_public', 'effectif_personnel', 'illustrations',
  // Suivi du dossier et MAF
  'ind', 'date_modification', 'maf_intercalaire', 'taux_mission', 'part_interet',
] as const;

export interface ProposalForProject {
  id?: string;
  title?: string | null;
  description?: string | null;
  amount?: number | string | null;
  construction_cost?: number | string | null;
  surface_plancher?: string | null;
  adresse_terrain?: string | null;
  cp_ville_terrain?: string | null;
  operation_nature?: string | null;
  type_projet?: string | null;
  surface_plancher_ext?: string | null;
  ratio_rehab?: number | null;
  ratio_extension?: number | null;
  [key: string]: unknown;
}

/** Chiffres de l'affaire : les honoraires sont la rémunération, le budget est celui des travaux. */
export function projectFinancials(p: { amount?: number | string | null; construction_cost?: number | string | null; surface_plancher?: string | null }) {
  const works = Number(p.construction_cost);
  const fees = Number(p.amount);
  const surface = String(p.surface_plancher ?? '').trim();
  return {
    budget: works > 0 ? works : (fees > 0 ? fees : null),
    construction_cost: works > 0 ? works : null,
    remuneration: fees > 0 ? fees : null,
    surface: surface || null,
  };
}

/** Libellés de la déclaration MAF (`NATURE_TRAVAUX_OPTIONS`) : neuf, réhabilitation. */
export function natureTravauxMaf(p: ProposalForProject): string {
  return operationNature(p) === 'neuf' ? 'Neuf' : 'Réhabilitation';
}

export interface ProjectRowContext { projectId: string; tenantId: string; clientName: string; today: Date }

export function projectRowFromProposal(p: ProposalForProject, ctx: ProjectRowContext): Record<string, unknown> {
  const copied: Record<string, unknown> = {};
  for (const field of COPIED_FIELDS) {
    const value = p[field];
    if (value !== undefined && value !== null && value !== '') copied[field] = value;
  }
  const start = ctx.today.toISOString().split('T')[0];
  const end = new Date(ctx.today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  return {
    ...copied,
    id: ctx.projectId, tenant_id: ctx.tenantId,
    name: p.title, client: ctx.clientName, status: 'Planning',
    ...projectFinancials(p),
    description: p.description ?? null,
    start_date: start, end_date: end,
    address: p.adresse_terrain ? `${p.adresse_terrain}, ${p.cp_ville_terrain || ''}` : '',
    nature_travaux_maf: natureTravauxMaf(p),
    source_proposal_id: p.id ?? null,
  };
}
