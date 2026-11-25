import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { StorageUsage } from '../lib/storageUsage';

const REFRESH_MS = 10 * 60 * 1000;

/**
 * Espace de stockage du cabinet (GET /api/billing/storage), partagé par le cartouche de la barre latérale
 * et l'onglet « Stockage » des paramètres. Rafraîchi toutes les 10 minutes et au retour sur l'onglet.
 * Silencieux en cas d'échec : `null`, jamais un message d'erreur permanent.
 */
export function useStorageUsage(): StorageUsage | null {
  const [usage, setUsage] = useState<StorageUsage | null>(null);

  const load = useCallback(() => {
    apiFetch<StorageUsage>('/api/billing/storage').then(setUsage).catch(() => { /* lecture facultative */ });
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  return usage;
}
