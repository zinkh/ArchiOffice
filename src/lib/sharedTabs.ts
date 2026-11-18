// Onglets de la fiche affaire tels que les voit un confrère invité.
//
// La fiche d'un confrère reprend la vraie navigation d'ArchiOffice (familles, puis onglets),
// mais chaque onglet n'existe que si le cabinet a accordé l'atelier correspondant : ce qui
// n'est pas accordé est invisible (refus par défaut, comme côté serveur).
import type { ProjectTabId } from './projectTabs';

export type SharedKind = 'lots' | 'tasks' | 'documents' | 'cctp' | 'dpgf' | 'act' | 'reports' | 'reserves' | 'gpa';

export interface SharedGrantLike { kind: string; access: 'read' | 'comment' | 'write' }

/** Atelier accordé -> onglet de la fiche qui le porte (CCTP et DPGF vivent tous deux sous PRO). */
const TAB_BY_KIND: Record<SharedKind, ProjectTabId> = {
  lots: 'INFOS',
  documents: 'INFOS',
  tasks: 'TACHES',
  cctp: 'PRO',
  dpgf: 'PRO',
  act: 'ACT',
  reports: 'RDT',
  reserves: 'AOR',
  gpa: 'GPA',
};

/** « Infos » est toujours là : c'est la fiche de l'affaire elle-même. */
export function sharedVisibleTabs(grants: readonly SharedGrantLike[]): Set<ProjectTabId> {
  const tabs = new Set<ProjectTabId>(['INFOS']);
  for (const grant of grants) {
    const tab = TAB_BY_KIND[grant.kind as SharedKind];
    if (tab) tabs.add(tab);
  }
  return tabs;
}

/** Premier onglet à ouvrir : celui demandé s'il est visible, sinon « Infos ». */
export function sharedInitialTab(wanted: string | null | undefined, visible: ReadonlySet<ProjectTabId>): ProjectTabId {
  return wanted && (visible as ReadonlySet<string>).has(wanted) ? (wanted as ProjectTabId) : 'INFOS';
}

/** Sous-onglets du dossier PRO accordés : le CCTP et le DPGF sont deux ateliers distincts. */
export function sharedProSubTabs(grants: readonly SharedGrantLike[]): Array<'cctp' | 'dpgf'> {
  return (['cctp', 'dpgf'] as const).filter(kind => grants.some(g => g.kind === kind));
}
