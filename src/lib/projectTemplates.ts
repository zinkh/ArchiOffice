// Vocabulaire et petits utilitaires partagés entre l'écran des modèles de
// projet, la modale de création d'une affaire et le serveur.
import type { ProjectTemplate, TemplateMarcheType, TemplateOperationType } from '../types';

export const OPERATION_LABELS: Record<TemplateOperationType, string> = {
  neuf: 'Construction neuve',
  rehabilitation: 'Réhabilitation',
  extension: 'Extension',
  maison_individuelle: 'Maison individuelle',
  permis_seul: 'Permis de construire seul',
  autre: 'Autre',
};

export const MARCHE_LABELS: Record<TemplateMarcheType, string> = {
  prive: 'Marché privé',
  public: 'Marché public',
};

/** « 6 lots · 9 jalons · 12 tâches », en ne nommant que ce que le modèle porte. */
export function summarizeTemplate(t: Pick<ProjectTemplate, 'default_lots' | 'default_milestones' | 'default_tasks'>): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
  const parts: string[] = [];
  const lots = t.default_lots?.length ?? 0;
  const milestones = t.default_milestones?.length ?? 0;
  const tasks = t.default_tasks?.length ?? 0;
  if (lots) parts.push(plural(lots, 'lot', 'lots'));
  if (milestones) parts.push(plural(milestones, 'jalon', 'jalons'));
  if (tasks) parts.push(plural(tasks, 'tâche', 'tâches'));
  return parts.join(' · ');
}

/** Date ISO (YYYY-MM-DD) décalée de `days` jours à partir de `start`. */
export function addDaysIso(start: string, days: number): string {
  const base = /^\d{4}-\d{2}-\d{2}/.test(start) ? new Date(`${start.slice(0, 10)}T12:00:00Z`) : new Date();
  base.setUTCDate(base.getUTCDate() + Math.round(days));
  return base.toISOString().slice(0, 10);
}
