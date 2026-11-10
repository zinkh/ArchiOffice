// Tranches fermes et conditionnelles d'une proposition ou d'un appel d'offres.
//
// Les tranches vivent dans le JSON `fee_distribution` déjà porté par `proposals` et
// `tenders` : `{ tranches: [...], missions: [{ ..., tranche_id }] }`. Aucune migration.
// Un document sans `tranches` se comporte exactement comme avant (mode tranches
// désactivé) : ses missions sont toutes lues comme appartenant à une tranche ferme
// implicite. Pur, sans DOM : partagé avec le serveur (validation) et les exports.
import type { FeeDistributionMission } from './feeDistribution';

export type TrancheType = 'ferme' | 'conditionnelle';

export interface Tranche {
  id: string;
  label: string;
  type: TrancheType;
  /** Condition d'affermissement d'une tranche conditionnelle (texte libre). */
  condition?: string;
}

/** Contenu du contrat MOE créé à l'acceptation : la tranche ferme seule, ou toutes les tranches. */
export type PerimetreContrat = 'ferme' | 'toutes';

export interface DonneesTranches {
  tranches?: Tranche[];
  /** Choix fait à la saisie, lu à l'acceptation de la proposition ; absent = toutes. */
  contrat_tranches?: PerimetreContrat;
  missions: Array<FeeDistributionMission & { tranche_id?: string }>;
  [cle: string]: unknown;
}

export const TRANCHE_FERME_ID = 'tranche-ferme';
export const TRANCHE_FERME_LIBELLE = 'Tranche ferme';
export const TRANCHE_CONDITIONNELLE_LIBELLE = 'Tranche conditionnelle';

const arrondi = (n: number): number => Math.round(n * 100) / 100;

function nouvelId(prefixe: string, existants: Set<string>): string {
  let i = existants.size + 1;
  let id = `${prefixe}-${i}`;
  while (existants.has(id)) { i += 1; id = `${prefixe}-${i}`; }
  return id;
}

/** Lecture tolérante : JSON invalide ou absent donne `null`, jamais d'exception. */
export function lireDonnees(json: string | null | undefined): DonneesTranches | null {
  if (!json) return null;
  try {
    const d = JSON.parse(json);
    if (!d || typeof d !== 'object' || !Array.isArray(d.missions)) return null;
    return d as DonneesTranches;
  } catch {
    return null;
  }
}

/** Le mode tranches est actif dès qu'une liste de tranches non vide est enregistrée. */
export function tranchesActives(data: Pick<DonneesTranches, 'tranches'> | null | undefined): boolean {
  return Array.isArray(data?.tranches) && data!.tranches!.length > 0;
}

/** Liste des tranches, avec une tranche ferme implicite quand le mode est inactif. */
export function listeTranches(data: Pick<DonneesTranches, 'tranches'> | null | undefined): Tranche[] {
  if (tranchesActives(data)) return data!.tranches!;
  return [{ id: TRANCHE_FERME_ID, label: TRANCHE_FERME_LIBELLE, type: 'ferme' }];
}

/** La première tranche ferme : elle reçoit les missions orphelines. */
export function trancheParDefaut(tranches: Tranche[]): Tranche {
  return tranches.find(t => t.type === 'ferme') ?? tranches[0];
}

/** Tranche d'une mission : une référence absente ou inconnue retombe sur la tranche ferme. */
export function trancheDeMission(
  mission: { tranche_id?: string },
  tranches: Tranche[],
): Tranche {
  return tranches.find(t => t.id === mission.tranche_id) ?? trancheParDefaut(tranches);
}

export function missionsDeTranche<M extends { tranche_id?: string }>(
  missions: M[],
  tranche: Tranche,
  tranches: Tranche[],
): M[] {
  return missions.filter(m => trancheDeMission(m, tranches).id === tranche.id);
}

/** Active le mode tranches : une tranche ferme, toutes les missions y sont rattachées. */
export function activerTranches(data: DonneesTranches): DonneesTranches {
  if (tranchesActives(data)) return data;
  const ferme: Tranche = { id: TRANCHE_FERME_ID, label: TRANCHE_FERME_LIBELLE, type: 'ferme' };
  return { ...data, tranches: [ferme], missions: data.missions.map(m => ({ ...m, tranche_id: ferme.id })) };
}

/** Désactive le mode tranches. Refusé (données inchangées) tant qu'une conditionnelle existe. */
export function desactiverTranches(data: DonneesTranches): DonneesTranches {
  if (!tranchesActives(data)) return data;
  if (data.tranches!.some(t => t.type === 'conditionnelle')) return data;
  const { tranches: _t, ...reste } = data;
  return { ...reste, missions: data.missions.map(({ tranche_id: _id, ...m }) => m) } as DonneesTranches;
}

export function ajouterTranche(data: DonneesTranches, type: TrancheType): DonneesTranches {
  const base = activerTranches(data);
  const tranches = base.tranches!;
  const id = nouvelId('tranche', new Set(tranches.map(t => t.id)));
  const memeType = tranches.filter(t => t.type === type).length;
  const label = type === 'ferme'
    ? `${TRANCHE_FERME_LIBELLE} ${memeType + 1}`
    : `${TRANCHE_CONDITIONNELLE_LIBELLE} ${memeType + 1}`;
  return { ...base, tranches: [...tranches, { id, label, type, ...(type === 'conditionnelle' ? { condition: '' } : {}) }] };
}

export function modifierTranche(
  data: DonneesTranches,
  trancheId: string,
  patch: Partial<Pick<Tranche, 'label' | 'type' | 'condition'>>,
): DonneesTranches {
  if (!tranchesActives(data)) return data;
  const tranches = data.tranches!.map(t => (t.id === trancheId ? { ...t, ...patch } : t));
  // Il doit toujours rester une tranche ferme : sinon la modification est refusée.
  if (!tranches.some(t => t.type === 'ferme')) return data;
  return { ...data, tranches };
}

/** Supprime une tranche : ses missions passent dans la première tranche ferme restante. */
export function supprimerTranche(data: DonneesTranches, trancheId: string): DonneesTranches {
  if (!tranchesActives(data)) return data;
  const restantes = data.tranches!.filter(t => t.id !== trancheId);
  if (restantes.length === data.tranches!.length) return data;
  if (!restantes.some(t => t.type === 'ferme')) return data;
  const cible = trancheParDefaut(restantes);
  return {
    ...data,
    tranches: restantes,
    missions: data.missions.map(m => (m.tranche_id === trancheId ? { ...m, tranche_id: cible.id } : m)),
  };
}

export function deplacerTranche(data: DonneesTranches, trancheId: string, sens: -1 | 1): DonneesTranches {
  if (!tranchesActives(data)) return data;
  const tranches = [...data.tranches!];
  const i = tranches.findIndex(t => t.id === trancheId);
  const j = i + sens;
  if (i < 0 || j < 0 || j >= tranches.length) return data;
  [tranches[i], tranches[j]] = [tranches[j], tranches[i]];
  return { ...data, tranches };
}

export function affecterMission(data: DonneesTranches, missionId: string, trancheId: string): DonneesTranches {
  if (!listeTranches(data).some(t => t.id === trancheId)) return data;
  return { ...data, missions: data.missions.map(m => (m.id === missionId ? { ...m, tranche_id: trancheId } : m)) };
}

/**
 * Répartit une mission sur une autre tranche en dupliquant sa ligne : même désignation,
 * même catégorie, mêmes parts d'intervenants, montant à saisir (0 au départ). L'id de la
 * copie est unique ; le montant de la ligne d'origine n'est pas modifié.
 */
export function dupliquerMissionSurTranche(
  data: DonneesTranches,
  missionId: string,
  trancheId: string,
): DonneesTranches {
  const source = data.missions.find(m => m.id === missionId);
  if (!source || !listeTranches(data).some(t => t.id === trancheId)) return data;
  const base = activerTranches(data);
  const ids = new Set(base.missions.map(m => m.id));
  const racine = missionId.split('__')[0];
  let id = `${racine}__${trancheId}`;
  let n = 2;
  while (ids.has(id)) { id = `${racine}__${trancheId}-${n}`; n += 1; }
  const copie = { ...source, id, tranche_id: trancheId, amount: 0, percentages: { ...(source.percentages ?? {}) } };
  const index = base.missions.findIndex(m => m.id === missionId);
  const missions = [...base.missions];
  missions.splice(index + 1, 0, copie);
  return { ...base, missions };
}

export interface TotalTranche {
  tranche: Tranche;
  total: number;
}

export interface TotauxTranches {
  parTranche: TotalTranche[];
  ferme: number;
  conditionnel: number;
  global: number;
}

/** Totaux HT par tranche, total ferme, total conditionnel et total global. */
export function totauxParTranche(data: DonneesTranches | null | undefined): TotauxTranches {
  const missions = data?.missions ?? [];
  const tranches = listeTranches(data);
  const parTranche = tranches.map(tranche => ({
    tranche,
    total: arrondi(missionsDeTranche(missions, tranche, tranches).reduce((s, m) => s + (m.amount || 0), 0)),
  }));
  const somme = (type: TrancheType) => arrondi(parTranche.filter(p => p.tranche.type === type).reduce((s, p) => s + p.total, 0));
  const ferme = somme('ferme');
  const conditionnel = somme('conditionnelle');
  return { parTranche, ferme, conditionnel, global: arrondi(ferme + conditionnel) };
}

/** Copie des données réduite aux missions des tranches fermes (contrat « ferme seule »). */
export function donneesFermeSeule(data: DonneesTranches): DonneesTranches {
  if (!tranchesActives(data)) return data;
  const tranches = data.tranches!;
  const fermes = tranches.filter(t => t.type === 'ferme');
  return {
    ...data,
    tranches: fermes,
    missions: data.missions.filter(m => trancheDeMission(m, tranches).type === 'ferme'),
  };
}

/**
 * Contrôle d'un JSON reçu par le serveur. Renvoie un message d'erreur, ou `null` si les
 * tranches sont cohérentes (ou absentes : ancien format, toujours accepté).
 */
export function validerTranches(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { tranches?: unknown; missions?: unknown };
  if (d.tranches === undefined) return null;
  if (!Array.isArray(d.tranches)) return 'tranches doit être une liste';
  if (d.tranches.length === 0) return null;
  if (d.tranches.length > 20) return 'trop de tranches (20 au plus)';
  const ids = new Set<string>();
  for (const t of d.tranches as Array<Partial<Tranche>>) {
    if (!t || typeof t.id !== 'string' || !t.id) return 'identifiant de tranche manquant';
    if (ids.has(t.id)) return `identifiant de tranche en double : ${t.id}`;
    ids.add(t.id);
    if (t.type !== 'ferme' && t.type !== 'conditionnelle') return `type de tranche invalide : ${String(t.type)}`;
    if (typeof t.label !== 'string' || !t.label.trim()) return 'libellé de tranche manquant';
  }
  if (!(d.tranches as Tranche[]).some(t => t.type === 'ferme')) return 'au moins une tranche ferme est requise';
  const missions = Array.isArray(d.missions) ? (d.missions as Array<{ id?: string; tranche_id?: string }>) : [];
  const missionIds = new Set<string>();
  for (const m of missions) {
    if (m.id) {
      if (missionIds.has(m.id)) return `identifiant de mission en double : ${m.id}`;
      missionIds.add(m.id);
    }
    if (m.tranche_id !== undefined && !ids.has(m.tranche_id)) return `mission rattachée à une tranche inconnue : ${m.tranche_id}`;
  }
  return null;
}

/** Variante pour une valeur brute reçue d'un formulaire : texte JSON attendu. Illisible = acceptée (hors périmètre). */
export function erreurTranchesJson(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    return validerTranches(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Données à reprendre dans le contrat selon le choix : ferme seule ou toutes les tranches. */
export function donneesPourContrat(data: DonneesTranches): DonneesTranches {
  return data.contrat_tranches === 'ferme' ? donneesFermeSeule(data) : data;
}
