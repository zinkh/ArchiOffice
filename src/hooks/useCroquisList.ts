import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db';
import { cachedListFirst } from '../lib/offlineReadCache';
import { OFFLINE_QUEUE_CHANGED_EVENT, OFFLINE_WRITE_SYNCED_EVENT } from '../lib/offlineQueue';
import { applyPendingCroquisWrites, nextCroquisTitle, type CroquisParent } from '../lib/croquisOffline';
import {
  createCroquis,
  croquisListUrl,
  deleteCroquis,
  installCroquisSyncListener,
  readPendingCroquisWrites,
  renameCroquis,
} from '../lib/croquisSync';
import type { Croquis } from '../types';

export interface UseCroquisListResult {
  croquis: Croquis[];
  loading: boolean;
  /** Vrai quand la liste n'a pu être lue ni sur le réseau ni dans le cache (en ligne : une panne, pas une liste vide). */
  loadFailed: boolean;
  reload: () => Promise<void>;
  /** Crée un croquis vide, titré « Croquis N » faute de titre. Hors ligne, il apparaît tout de suite et part au retour du réseau. */
  create: (title?: string) => Promise<Croquis>;
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const RELOAD_DEBOUNCE_MS = 150;

/**
 * Les croquis d'une réunion ou d'un compte-rendu. Lecture « cache d'abord », écritures par la file hors ligne :
 * un croquis créé ou modifié sur un chantier sans réseau reste à l'écran, marqué « en attente d'envoi », et
 * part au retour de la connexion (voir src/lib/croquisOffline.ts).
 */
export function useCroquisList(parent: CroquisParent | null): UseCroquisListResult {
  const { t } = useTranslation();
  const [croquis, setCroquis] = useState<Croquis[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  // `pending` fait partie de la clé : quand le parent est enfin envoyé, la liste se relit auprès du serveur.
  const parentKey = parent ? `${parent.kind}:${parent.id}:${parent.pending ? 'pending' : 'sent'}` : '';
  const parentRef = useRef(parent);
  useEffect(() => { parentRef.current = parent; }, [parent]);

  const reload = useCallback(async () => {
    const current = parentRef.current;
    if (!current) {
      setCroquis([]);
      setLoading(false);
      return;
    }
    setLoadFailed(false);
    const pending = await readPendingCroquisWrites();
    const show = (rows: Croquis[]) => setCroquis(applyPendingCroquisWrites(rows, pending, current));
    const inScope = (row: Croquis) => (current.kind === 'meeting' ? row.meeting_id === current.id : row.site_report_id === current.id);
    if (current.pending) {
      // Parent pas encore envoyé : le serveur ne le connaît pas, inutile (et trompeur) de lui demander ses croquis.
      try { show((await db.croquisCache.toArray()).filter(inScope)); } catch { show([]); }
      setLoading(false);
      return;
    }
    try {
      const result = await cachedListFirst(db.croquisCache, inScope, croquisListUrl(current), show);
      if (!result.synced && !result.hadLocalData) {
        // Ni réseau ni cache : seuls les croquis en attente restent à montrer.
        show([]);
        if (navigator.onLine) setLoadFailed(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    installCroquisSyncListener();
    setLoading(true);
    void reload();
  }, [parentKey, reload]);

  // La file a changé ou une écriture est arrivée : on se relit, sans se relire à chaque photo d'un lot.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChange = (event: Event) => {
      const entity = (event as CustomEvent).detail?.entity;
      if (entity !== 'croquis' && entity !== 'croquisFile') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void reload(); }, RELOAD_DEBOUNCE_MS);
    };
    window.addEventListener(OFFLINE_WRITE_SYNCED_EVENT, onChange);
    window.addEventListener(OFFLINE_QUEUE_CHANGED_EVENT, onChange);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(OFFLINE_WRITE_SYNCED_EVENT, onChange);
      window.removeEventListener(OFFLINE_QUEUE_CHANGED_EVENT, onChange);
    };
  }, [reload]);

  const create = useCallback(async (title?: string): Promise<Croquis> => {
    const current = parentRef.current;
    if (!current) throw new Error('Aucune réunion ou aucun compte-rendu pour ce croquis.');
    const finalTitle = title?.trim() || nextCroquisTitle(croquis.map((c) => c.title), t('croquis_default_title'));
    const { row } = await createCroquis(current, { title: finalTitle });
    setCroquis((prev) => [...prev.filter((c) => c.id !== row.id), row]);
    return row;
  }, [croquis, t]);

  const rename = useCallback(async (id: string, title: string): Promise<void> => {
    const clean = title.trim();
    if (!clean) return;
    setCroquis((prev) => prev.map((c) => (c.id === id ? { ...c, title: clean } : c)));
    try {
      await renameCroquis(id, clean);
    } catch (error) {
      await reload();
      throw error;
    }
  }, [reload]);

  const remove = useCallback(async (id: string): Promise<void> => {
    setCroquis((prev) => prev.filter((c) => c.id !== id));
    try {
      await deleteCroquis(id);
    } catch (error) {
      await reload();
      throw error;
    }
  }, [reload]);

  return { croquis, loading, loadFailed, reload, create, rename, remove };
}
