// Adaptateur chantier vers les exporteurs communs au planning des tâches internes.
import type { Project } from '../types';
import { exportGanttProjectXml, exportMsProjectXml, type ProjectXmlFormat } from './projectPlanningXml';
import type { PlanningXmlTask } from './projectPlanningXmlShared';
import { bornesPlanning, joursEntre, planningParLot, sanitizePlanning, type LotPlanifiable, type PlanningChantier, type TachePlanning } from './planningChantier';

export function exportPlanningChantierXml(project: Project, planning: PlanningChantier, lots: LotPlanifiable[], format: ProjectXmlFormat, couleurs = new Map<string, string>()): string {
  const propre = sanitizePlanning(planning);
  const bornes = bornesPlanning(propre);
  const ids = new Set(propre.taches.map(t => t.id));
  // Délais des liens. Les exports gardent un calendrier de sept jours et des dates fixes : en jours ouvrés,
  // le décalage écrit est l'écart calendaire réel entre les deux tâches, jamais un nombre de jours ouvrés.
  const decalages = (t: TachePlanning): Record<string, number> | undefined => {
    const lags = Object.fromEntries(Object.entries(t.delais ?? {}).map(([id, delai]) => {
      const precedent = propre.taches.find(p => p.id === id);
      return [id, propre.calendrier?.joursOuvres && precedent ? Math.max(0, joursEntre(precedent.fin, t.debut) - 1) : delai];
    }));
    return Object.keys(lags).length ? lags : undefined;
  };
  const tasks: PlanningXmlTask[] = planningParLot(propre, lots).flatMap((ligne, i) => {
    let parent = `chantier-group-${i}`;
    while (ids.has(parent)) parent += '-';
    const groupe: PlanningXmlTask = { id: parent, project_id: project.id,
      title: ligne.lot ? `Lot ${ligne.lot.lot_number} · ${ligne.lot.lot_title}` : 'Tâches générales',
      start_date: ligne.debut, end_date: ligne.fin, progress: ligne.avancement, dependencies: [], xmlMilestone: false,
      xmlColor: couleurs.get(ligne.lot?.id ?? '') };
    return [groupe, ...ligne.taches.map(t => ({ id: t.id, project_id: project.id, title: t.libelle,
      start_date: t.debut, end_date: t.fin, progress: t.avancement, dependencies: t.dependencies ?? [],
      xmlParentId: parent, xmlMilestone: !!t.jalon, xmlColor: groupe.xmlColor, xmlLags: decalages(t) }))];
  });
  const operation = { ...project, start_date: bornes?.debut ?? project.start_date, end_date: bornes?.fin ?? project.end_date };
  return format === 'msproject' ? exportMsProjectXml(operation, tasks, [], { calendarDays: true }) : exportGanttProjectXml(operation, tasks, [], { calendarDays: true });
}
