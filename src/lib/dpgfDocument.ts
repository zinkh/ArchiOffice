// Accès API du document CCTP / DPGF avec sa révision.
//
// Le serveur rend, avec le document, `_rev` : la révision stockée (dpgfs.revision, incrémentée par un
// déclencheur SQL à chaque changement du document). L'enregistrement la renvoie en `?baseRev=` ; si le
// document a changé entre-temps (approbation d'une proposition d'un confrère, agent IA, autre onglet),
// le serveur répond 409 DOC_STALE et n'écrit rien. La révision est tenue ici, par affaire, et n'entre
// jamais dans le document ni dans la copie locale.
import { apiFetch } from './api';
import { loadProDoc } from '../hooks/useAutosavedDoc';
import type { DPGF } from '../types/dpgf';

const revisions = new Map<string, number>();

/** La révision connue d'une affaire (tests et diagnostic). */
export const revisionConnue = (projectId: string): number | undefined => revisions.get(projectId);

export async function loadDPGF(projectId: string): Promise<DPGF | null> {
  const doc = await loadProDoc<DPGF & { _rev?: number }>(`/api/projects/${projectId}/dpgf`);
  if (!doc) { revisions.delete(projectId); return null; }
  const { _rev, ...document } = doc;
  if (typeof _rev === 'number') revisions.set(projectId, _rev); else revisions.delete(projectId);
  return document as DPGF;
}

export async function saveDPGF(projectId: string, data: DPGF): Promise<void> {
  const rev = revisions.get(projectId);
  const saved = await apiFetch<{ _rev?: number }>(
    `/api/projects/${projectId}/dpgf${rev === undefined ? '' : `?baseRev=${rev}`}`,
    { method: 'POST', body: JSON.stringify(data) },
  );
  if (typeof saved?._rev === 'number') revisions.set(projectId, saved._rev);
}

/** Met une version de côté dans l'historique du dossier (restaurable) : la stockée, ou celle donnée. */
export async function figerVersion(projectId: string, label: string, document?: DPGF): Promise<void> {
  await apiFetch(`/api/projects/${projectId}/dpgf/versions`, {
    method: 'POST', body: JSON.stringify({ label, ...(document ? { document } : {}) }),
  });
}
