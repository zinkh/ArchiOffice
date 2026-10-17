import { useState, useEffect, useCallback } from 'react';
import { db, type PendingWrite } from '../db';
import { cachedListFirst } from '../lib/offlineReadCache';
import { queuedJsonRequest } from '../lib/offlineQueue';
import { overlayPendingPhoneCalls, sortPhoneCalls } from '../lib/phoneCalls';
import type { PhoneCall, Task } from '../types';

export interface UsePhoneCallsOptions {
  /** Limite la liste aux appels d'une affaire (onglet Correspondance de la fiche). */
  projectId?: string;
  /** Ne charge rien tant que false. */
  enabled?: boolean;
}

export interface SaveResult {
  /** true = gardé sur l'appareil, il partira au retour du réseau. */
  queued: boolean;
}

export interface UsePhoneCallsResult {
  calls: PhoneCall[];
  loading: boolean;
  /** true quand la liste n'a pu être lue ni sur le réseau ni dans le cache. */
  loadFailed: boolean;
  reload: () => Promise<void>;
  createCall: (input: Partial<PhoneCall>) => Promise<SaveResult>;
  updateCall: (id: string, patch: Partial<PhoneCall>) => Promise<SaveResult>;
  deleteCall: (id: string) => Promise<SaveResult>;
  /** Crée la tâche de suivi. Hors ligne, la demande est gardée et rejouée au retour du réseau. */
  createTaskFromCall: (id: string) => Promise<TaskResult>;
}

export interface TaskResult {
  queued: boolean;
  /** Présente seulement quand le serveur a répondu tout de suite. */
  task?: Task;
}

const LIST_LIMIT = 500;

async function readPendingWrites(): Promise<PendingWrite[]> {
  try { return (await db.pendingWrites.toArray()).filter(w => w.entity === 'phoneCall'); }
  catch { return []; }
}

/**
 * Source unique pour le journal des appels : l'écran, la fiche affaire et le
 * tableau de bord passent tous par ici. Lecture « cache d'abord », écriture par
 * la file hors ligne : un appel noté sur un chantier sans réseau reste à
 * l'écran (marqué « en attente d'envoi ») et part au retour de la connexion.
 */
export function usePhoneCalls(options: UsePhoneCallsOptions = {}): UsePhoneCallsResult {
  const { projectId, enabled = true } = options;
  const [calls, setCalls] = useState<PhoneCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const reload = useCallback(async () => {
    if (!enabled) { setLoading(false); return; }
    setLoadFailed(false);
    const pending = await readPendingWrites();
    const show = (rows: PhoneCall[]) => setCalls(sortPhoneCalls(overlayPendingPhoneCalls(rows, pending)));
    const query = new URLSearchParams({ limit: String(LIST_LIMIT) });
    if (projectId) query.set('project_id', projectId);
    const inScope = (row: PhoneCall) => !projectId || row.project_id === projectId;
    try {
      const result = await cachedListFirst(db.phoneCallsCache, inScope, `/api/phone-calls?${query}`, show);
      if (!result.synced && !result.hadLocalData) {
        // Ni réseau ni cache : seules les saisies en attente restent à montrer.
        show([]);
        // En ligne, c'est une panne et non une liste vide.
        if (navigator.onLine) setLoadFailed(true);
      }
    } finally {
      setLoading(false);
    }
  }, [enabled, projectId]);

  useEffect(() => { reload(); }, [reload]);

  const cachePut = (row: PhoneCall) => { db.phoneCallsCache.put(row).catch(() => undefined); };

  const createCall = useCallback(async (input: Partial<PhoneCall>): Promise<SaveResult> => {
    const id = input.id || crypto.randomUUID();
    const body = { ...input, id };
    const result = await queuedJsonRequest<PhoneCall>({ entity: 'phoneCall', id, method: 'POST', url: '/api/phone-calls', body });
    if (result.queued || !result.data) {
      setCalls(prev => sortPhoneCalls([{ ...(body as PhoneCall), pendingSync: true }, ...prev.filter(c => c.id !== id)]));
    } else {
      cachePut(result.data);
      setCalls(prev => sortPhoneCalls([result.data as PhoneCall, ...prev.filter(c => c.id !== id)]));
    }
    return { queued: result.queued };
  }, []);

  const updateCall = useCallback(async (id: string, patch: Partial<PhoneCall>): Promise<SaveResult> => {
    let previous: PhoneCall | undefined;
    setCalls(prev => {
      previous = prev.find(c => c.id === id);
      return sortPhoneCalls(prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
    });
    try {
      // Un identifiant de file propre à chaque modification : deux changements
      // successifs ne doivent pas s'écraser dans la file (le second perdrait les
      // champs du premier). L'ordre de rejeu est celui de la date de mise en file.
      const result = await queuedJsonRequest<PhoneCall>({
        entity: 'phoneCall', id: `update:${id}:${Date.now()}`, method: 'PUT', url: `/api/phone-calls/${id}`, body: patch,
      });
      if (result.queued) {
        setCalls(prev => prev.map(c => (c.id === id ? { ...c, pendingSync: true } : c)));
      } else if (result.data) {
        cachePut(result.data);
        setCalls(prev => sortPhoneCalls(prev.map(c => (c.id === id ? (result.data as PhoneCall) : c))));
      }
      return { queued: result.queued };
    } catch (err) {
      // Refus définitif du serveur : l'écran revient à ce qui est réellement enregistré.
      if (previous) setCalls(prev => prev.map(c => (c.id === id ? (previous as PhoneCall) : c)));
      throw err;
    }
  }, []);

  const deleteCall = useCallback(async (id: string): Promise<SaveResult> => {
    let previous: PhoneCall[] = [];
    setCalls(prev => { previous = prev; return prev.filter(c => c.id !== id); });
    try {
      const result = await queuedJsonRequest({ entity: 'phoneCall', id: `delete:${id}`, method: 'DELETE', url: `/api/phone-calls/${id}` });
      db.phoneCallsCache.delete(id).catch(() => undefined);
      return { queued: result.queued };
    } catch (err) {
      setCalls(previous);
      throw err;
    }
  }, []);

  const createTaskFromCall = useCallback(async (id: string): Promise<TaskResult> => {
    // L'identifiant de la tâche est généré ici : l'appel peut ainsi montrer sa
    // tâche tout de suite, et le serveur reconnaît un rejeu de la file.
    const taskId = crypto.randomUUID();
    const result = await queuedJsonRequest<{ task: Task; call: PhoneCall }>({
      // Identifiant de file propre à l'appel : une seconde demande n'ajoute pas une seconde entrée.
      entity: 'phoneCall', id: `task:${id}`, method: 'POST', url: `/api/phone-calls/${id}/task`, body: { task_id: taskId },
    });
    if (result.queued || !result.data?.call) {
      setCalls(prev => prev.map(c => (c.id === id && !c.task_id
        ? { ...c, task_id: taskId, status: c.status === 'a_traiter' ? 'en_cours' : c.status, pendingSync: true }
        : c)));
      return { queued: true };
    }
    cachePut(result.data.call);
    setCalls(prev => prev.map(c => (c.id === id ? (result.data as { call: PhoneCall }).call : c)));
    return { queued: false, task: result.data.task };
  }, []);

  return { calls, loading, loadFailed, reload, createCall, updateCall, deleteCall, createTaskFromCall };
}
