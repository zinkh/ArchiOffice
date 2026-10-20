// Résolution des données du panneau d'affichage d'un permis (PC ou DP) depuis
// la fiche du permis, l'affaire et l'identité du cabinet. Aucune valeur
// inventée : un champ inconnu reste null et, s'il est obligatoire pour la
// version définitive, est listé dans `missingRequired`.
import { cleanText, formatSurface, parseAmount } from '../referencesDossier/format';
import { loadAgency } from '../referencesDossier/data';
import type { PermisEtat, PermisPanelData } from './types';

type Db = any;

function frDate(iso: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

function positiveInt(v: unknown): number | null {
  const n = parseAmount(v);
  return n !== null && Number.isInteger(n) ? n : null;
}

export const PERMIS_REQUIRED_LABELS = {
  beneficiaire: 'Bénéficiaire',
  architecte: 'Architecte',
  numero: 'Numéro du permis',
  dateDelivrance: 'Date de délivrance',
  natureProjet: 'Nature du projet',
  superficieTerrainM2: 'Superficie du terrain',
  mairie: 'Mairie (adresse de consultation du dossier)',
} as const;

export interface LoadedPermis {
  data: PermisPanelData;
  status: string;
  projectId: string;
}

export async function loadPermisPanel(
  db: Db, tenantId: string, permitId: string, requestedEtat?: PermisEtat | null,
): Promise<LoadedPermis | { error: 'not_found' | 'unsupported_type' }> {
  const { data: permit } = await db.from('permits').select('*').eq('id', permitId).eq('tenant_id', tenantId).maybeSingle();
  if (!permit) return { error: 'not_found' };
  if (permit.type !== 'PC' && permit.type !== 'DP') return { error: 'unsupported_type' };
  const { data: project } = await db.from('projects').select('*').eq('id', permit.project_id).eq('tenant_id', tenantId).maybeSingle();
  if (!project) return { error: 'not_found' };
  const agency = await loadAgency(db, tenantId);

  let clientName: string | null = null;
  if (project.client_id) {
    const { data: c } = await db.from('contacts').select('company_name, first_name, last_name').eq('id', project.client_id).eq('tenant_id', tenantId).maybeSingle();
    clientName = cleanText(c?.company_name) ?? cleanText(`${c?.first_name ?? ''} ${c?.last_name ?? ''}`);
  }
  const beneficiaire = clientName ?? cleanText(project.is_entreprise ? project.nom_societe : null) ?? cleanText(project.client);

  const architecte = agency.manager
    ? `${agency.manager}, architecte, ${agency.name}${agency.oaNumber ? `, Ordre des architectes ${agency.oaNumber}` : ''}`
    : agency.name;

  const adresseTerrain = [cleanText(project.adresse_terrain), cleanText(project.cp_ville_terrain)].filter(Boolean).join(', ') || cleanText(project.address);
  const etat: PermisEtat = requestedEtat ?? (permit.status === 'accorde' && permit.decision_date ? 'definitif' : 'brouillon');

  const data: PermisPanelData = {
    agency,
    permitType: permit.type,
    etat,
    beneficiaire,
    architecte,
    numero: cleanText(permit.numero_decision) ?? cleanText(permit.reference),
    dateDelivrance: frDate(permit.decision_date),
    natureProjet: cleanText(permit.nature_projet) ?? cleanText(project.programme),
    adresseTerrain,
    superficieTerrainM2: parseAmount(permit.superficie_terrain_m2) ?? parseAmount(project.surface_parcelle),
    surfacePlancherM2: parseAmount(permit.surface_plancher_m2) ?? parseAmount(project.surface_plancher),
    nombreLogements: positiveInt(permit.nombre_logements),
    hauteurM: parseAmount(permit.hauteur_m),
    mairieNom: cleanText(permit.mairie_nom),
    mairieAdresse: cleanText(permit.mairie_adresse),
    missingRequired: [],
    warnings: [],
  };

  const L = PERMIS_REQUIRED_LABELS;
  const missing: string[] = [];
  if (!data.beneficiaire) missing.push(L.beneficiaire);
  if (!data.architecte) missing.push(L.architecte);
  if (!data.numero) missing.push(L.numero);
  if (!data.dateDelivrance) missing.push(L.dateDelivrance);
  if (!data.natureProjet) missing.push(L.natureProjet);
  if (data.superficieTerrainM2 === null) missing.push(L.superficieTerrainM2);
  if (!data.mairieAdresse && !data.mairieNom) missing.push(L.mairie);
  data.missingRequired = missing;

  if (permit.type === 'PC') {
    if (data.surfacePlancherM2 === null) data.warnings.push('Surface de plancher non renseignée : à vérifier selon la nature du projet.');
    if (data.hauteurM === null) data.warnings.push('Hauteur de la construction non renseignée : mention à vérifier, une hauteur absente ou erronée peut empêcher le délai de recours de courir.');
  }
  return { data, status: permit.status ?? 'en_instruction', projectId: permit.project_id };
}

export { formatSurface };
