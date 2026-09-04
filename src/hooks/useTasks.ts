import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import type { Task, Project, TeamMember, TaskStatus } from '../types';

export interface UseTasksOptions {
  /** Filtre serveur. 'none' cible les tâches sans projet. */
  projectId?: string | 'none';
  assigneeId?: string;
  withProjects?: boolean;
  withTeam?: boolean;
  /** Ne charge rien tant que false — utile en attendant l'identité de l'utilisateur. */
  enabled?: boolean;
}

export interface UseTasksResult {
  tasks: Task[];
  projects: Project[];
  team: TeamMember[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  createTask: (input: Partial<Task>) => Promise<void>;
  updateTask: (id: string, patch: Partial<Task>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  moveTask: (id: string, status: TaskStatus) => Promise<void>;
}

// Une réponse d'écriture n'est exploitable que si c'est bien une ligne : en
// build desktop hors ligne, src/lib/sync.ts renvoie { success, offline, id }
// à la place. Plutôt que de fusionner ce leurre dans l'état, on recharge.
function isTaskRow(value: any): value is Task {
  return !!value && typeof value.id === 'string' && typeof value.title === 'string';
}

/**
 * Source unique pour la lecture et l'écriture des tâches, partagée par le
 * Kanban, l'onglet Tâches d'un projet et le widget du tableau de bord.
 * Tout passe par `apiFetch`, qui lève sur une réponse non-2xx : c'est ce qui
 * remplace les `fetch` bruts sans contrôle de `res.ok` qui laissaient
 * l'interface afficher un déplacement jamais enregistré.
 */
export function useTasks(options: UseTasksOptions = {}): UseTasksResult {
  const { projectId, assigneeId, withProjects, withTeam, enabled = true } = options;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (projectId) params.set('project_id', projectId);
      if (assigneeId) params.set('assignee_id', assigneeId);
      const qs = params.toString();
      const [tasksData, projectsData, teamData] = await Promise.all([
        apiFetch<Task[]>(`/api/tasks${qs ? `?${qs}` : ''}`),
        withProjects ? apiFetch<Project[]>('/api/projects') : Promise.resolve<Project[]>([]),
        withTeam ? apiFetch<TeamMember[]>('/api/team') : Promise.resolve<TeamMember[]>([]),
      ]);
      setTasks(Array.isArray(tasksData) ? tasksData : []);
      if (withProjects) setProjects(Array.isArray(projectsData) ? projectsData : []);
      if (withTeam) setTeam(Array.isArray(teamData) ? teamData : []);
    } catch (err: any) {
      console.error('Failed to load tasks:', err);
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [enabled, projectId, assigneeId, withProjects, withTeam]);

  useEffect(() => { reload(); }, [reload]);

  const createTask = useCallback(async (input: Partial<Task>) => {
    const created = await apiFetch<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(input) });
    if (isTaskRow(created)) setTasks(prev => [...prev, created]);
    else await reload();
  }, [reload]);

  const updateTask = useCallback(async (id: string, patch: Partial<Task>) => {
    const updated = await apiFetch<Task>(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
    if (isTaskRow(updated)) setTasks(prev => prev.map(t => (t.id === id ? updated : t)));
    else await reload();
  }, [reload]);

  const deleteTask = useCallback(async (id: string) => {
    await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });
    setTasks(prev => prev.filter(t => t.id !== id));
  }, []);

  // Déplacement Kanban : patch minimal, avec affichage optimiste et retour
  // en arrière si l'écriture échoue. Le `progress` n'est plus écrasé par une
  // valeur forfaitaire propre à la colonne — une tâche à 60 % déposée dans
  // « En cours » y restait à 25 %. Seul le passage en « Terminé » force
  // 100 %, « terminé à 60 % » n'ayant pas de sens ; l'inverse ne se produit
  // jamais.
  const moveTask = useCallback(async (id: string, status: TaskStatus) => {
    const original = tasks.find(t => t.id === id);
    if (!original || original.status === status) return;
    const patch: Partial<Task> = status === 'done' ? { status, progress: 100 } : { status };
    setTasks(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)));
    try {
      const updated = await apiFetch<Task>(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
      if (isTaskRow(updated)) setTasks(prev => prev.map(t => (t.id === id ? updated : t)));
    } catch (err: any) {
      setTasks(prev => prev.map(t => (t.id === id ? original : t)));
      setError(err?.message || String(err));
      throw err;
    }
  }, [tasks]);

  return { tasks, projects, team, loading, error, reload, createTask, updateTask, deleteTask, moveTask };
}
