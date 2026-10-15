import { useState, useEffect, useCallback, useRef } from 'react';
import type { AgencySettings } from '../lib/proposalExport';
import { getActiveTenantId } from '../lib/activeTenant';

const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000];

function cacheKey(): string {
  return `archioffice:settings:${getActiveTenantId() || 'default'}`;
}

/**
 * Dernier réglage lu pour le cabinet actif. `/api/settings` ne renvoie jamais de
 * secret (seulement « configuré ou non »), donc ce cache local ne garde rien de sensible.
 */
function readCachedSettings(): AgencySettings | null {
  try {
    const raw = localStorage.getItem(cacheKey());
    return raw ? (JSON.parse(raw) as AgencySettings) : null;
  } catch {
    return null;
  }
}

function writeCachedSettings(settings: AgencySettings): void {
  try {
    localStorage.setItem(cacheKey(), JSON.stringify(settings));
  } catch {
    // Stockage plein ou bloqué : le cache est un confort, jamais une condition.
  }
}

/**
 * Réglages du cabinet. Une seule lecture au montage laissait `settings` à null pour
 * toute la vie de la page quand elle s'ouvrait hors ligne ou pendant une coupure :
 * l'export PDF et la diffusion d'un compte-rendu restaient alors bloqués même après le
 * retour du réseau. On relit donc au retour de la connexion et de l'onglet, avec des
 * tentatives espacées, et on repart du dernier réglage connu en attendant.
 */
export function useSettings() {
  const [settings, setSettings] = useState<AgencySettings | null>(() => readCachedSettings());
  const [loading, setLoading] = useState(true);
  const loadedRef = useRef(false);
  const inFlightRef = useRef(false);

  const load = useCallback(async (): Promise<boolean> => {
    if (inFlightRef.current) return false;
    inFlightRef.current = true;
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || data.error) throw new Error('Réponse de réglages invalide');
      loadedRef.current = true;
      setSettings(data);
      writeCachedSettings(data);
      return true;
    } catch (err) {
      console.error('Failed to fetch settings:', err);
      return false;
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const attempt = async (index: number) => {
      if (cancelled || loadedRef.current) return;
      const ok = await load();
      if (ok || cancelled) return;
      const delay = RETRY_DELAYS_MS[Math.min(index, RETRY_DELAYS_MS.length - 1)];
      timer = setTimeout(() => void attempt(index + 1), delay);
    };

    // Un retour du réseau relit sans attendre le prochain délai, même si une lecture
    // plus ancienne avait réussi : un nom ou un logo a pu changer entre-temps.
    const refreshNow = () => {
      if (!navigator.onLine) return;
      if (timer) clearTimeout(timer);
      loadedRef.current = false;
      void attempt(0);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !loadedRef.current) refreshNow();
    };

    void attempt(0);
    window.addEventListener('online', refreshNow);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('online', refreshNow);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  return { settings, loading };
}
