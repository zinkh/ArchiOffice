// Accès API du document CCTP / DPGF avec sa révision.
//
// Le serveur rend, avec le document, `_rev` : la révision stockée (dpgfs.revision, incrémentée par un
// déclencheur SQL à chaque changement du document). L'enregistrement la renvoie en `?baseRev=` ; si le
// document a changé entre-temps (approbation d'une proposition d'un confrère, agent IA, autre onglet),
// le serveur répond 409 DOC_STALE et n'écrit rien. La révision est tenue ici, par affaire, et n'entre
// jamais dans le document ni dans la copie locale.
import { apiFetch } from './api';
import { loadProDoc, DELAI_ENREGISTREMENT_MS } from '../hooks/useAutosavedDoc';
import type { DPGF } from '../types/dpgf';

const revisions = new Map<string, number>();

/**
 * Signal qui COUPE la requête d'enregistrement un peu avant le délai du hook (`DELAI_ENREGISTREMENT_MS`) :
 * une requête qui ne répond jamais ne reste pas en l'air pendant que le hook en relance une autre (qui
 * serait alors refusée comme conflit avec la précédente). Sans `AbortSignal.timeout` (navigateur ancien),
 * seul le délai du hook s'applique.
 */
export function signalEnregistrement(): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(DELAI_ENREGISTREMENT_MS - 2_000)
    : undefined;
}

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
    { method: 'POST', body: JSON.stringify(data), signal: signalEnregistrement() },
  );
  if (typeof saved?._rev === 'number') revisions.set(projectId, saved._rev);
}

/**
 * Fige le document AFFICHÉ (enregistré ou non) en instantané automatique. Le serveur pose le libellé, limite
 * la fréquence (un par 9 minutes), ignore un document identique au précédent et ne garde que les 48 derniers.
 */
export async function instantaneAutomatique(projectId: string, document: DPGF): Promise<void> {
  await apiFetch(`/api/projects/${projectId}/dpgf/versions`, {
    method: 'POST', body: JSON.stringify({ auto: true, document }),
  });
}

/** Met une version de côté dans l'historique du dossier (restaurable) : la stockée, ou celle donnée. */
export async function figerVersion(projectId: string, label: string, document?: DPGF): Promise<void> {
  await apiFetch(`/api/projects/${projectId}/dpgf/versions`, {
    method: 'POST', body: JSON.stringify({ label, ...(document ? { document } : {}) }),
  });
}
