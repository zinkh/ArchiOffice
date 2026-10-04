// Navigation de la fiche affaire : dix onglets regroupés par famille.
//
// La barre alignait jusqu'à dix onglets en mission chantier (INFOS, Tâches,
// HONOS, PRO, ACT, VISA, DET, RDT, AOR, Correspondance), au-delà de ce qu'on
// parcourt d'un coup d'œil. Les onglets restent les mêmes (même identifiant,
// même contenu, mêmes liens `?tab=`) : seule leur présentation est regroupée,
// le chantier passant sous une seule entrée avec ses quatre missions en
// second niveau.

export type ProjectTabId =
  | 'INFOS' | 'TACHES' | 'HONOS' | 'PRO' | 'ACT'
  | 'VISA' | 'DET' | 'RDT' | 'AOR' | 'CORRESPONDANCE';

export type ProjectTabGroupId =
  | 'INFOS' | 'TACHES' | 'HONOS' | 'ETUDES' | 'CONSULTATION' | 'CHANTIER' | 'CORRESPONDANCE';

export interface ProjectTabGroup {
  id: ProjectTabGroupId;
  tabs: ProjectTabId[];
}

export const PROJECT_TAB_GROUPS: readonly ProjectTabGroup[] = [
  { id: 'INFOS', tabs: ['INFOS'] },
  // Hors du filtre chantier : des tâches existent dès la phase études.
  { id: 'TACHES', tabs: ['TACHES'] },
  { id: 'HONOS', tabs: ['HONOS'] },
  { id: 'ETUDES', tabs: ['PRO'] },
  { id: 'CONSULTATION', tabs: ['ACT'] },
  { id: 'CHANTIER', tabs: ['VISA', 'DET', 'RDT', 'AOR'] },
  { id: 'CORRESPONDANCE', tabs: ['CORRESPONDANCE'] },
];

/** Onglets qui n'existent qu'en mission chantier (`project.is_chantier`). */
export const CHANTIER_ONLY_TABS: readonly ProjectTabId[] = ['ACT', 'VISA', 'DET', 'RDT', 'AOR'];

export const DEFAULT_PROJECT_TAB: ProjectTabId = 'INFOS';

const ALL_TABS = new Set<string>(PROJECT_TAB_GROUPS.flatMap(g => g.tabs));

export function isProjectTab(id: string | null | undefined): id is ProjectTabId {
  return !!id && ALL_TABS.has(id);
}

export function groupOfTab(tab: string): ProjectTabGroup | undefined {
  return PROJECT_TAB_GROUPS.find(g => (g.tabs as string[]).includes(tab));
}

/**
 * Les familles à afficher, chacune réduite à ses onglets visibles. Une
 * famille sans onglet visible disparaît, plutôt que de mener à un écran vide.
 */
export function visibleTabGroups(isVisible: (tab: ProjectTabId) => boolean): ProjectTabGroup[] {
  return PROJECT_TAB_GROUPS
    .map(g => ({ id: g.id, tabs: g.tabs.filter(isVisible) }))
    .filter(g => g.tabs.length > 0);
}

/**
 * Onglet ouvert quand on choisit une famille : celui qu'on y consulte déjà,
 * à défaut le dernier consulté dans cette famille (revenir au chantier rouvre
 * la DET qu'on venait de quitter), sinon le premier de la famille.
 */
export function tabForGroup(group: ProjectTabGroup, currentTab: string, lastVisited?: string): ProjectTabId {
  const tabs = group.tabs as string[];
  if (tabs.includes(currentTab)) return currentTab as ProjectTabId;
  if (lastVisited && tabs.includes(lastVisited)) return lastVisited as ProjectTabId;
  return group.tabs[0];
}
