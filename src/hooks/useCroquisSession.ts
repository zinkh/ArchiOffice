import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createAutosaver, type Autosaver, type AutosaveStatus } from '../lib/croquis/autosave';
import { backgroundFromBlob, type LoadedBackground } from '../lib/croquis/background';
import { renderSceneToCanvas } from '../lib/croquis/render';
import { OFFLINE_WRITE_SYNCED_EVENT } from '../lib/offlineQueue';
import { emptyScene, sanitizeScene, serializeScene } from '../lib/croquis/scene';
import {
  DEFAULT_BG_OPACITY,
  croquisWriteId,
  indexPendingCroquis,
  resolveCroquisState,
  sceneEquals,
} from '../lib/croquisOffline';
import {
  clearCroquisBackground,
  clearCroquisDraft,
  importCroquisBackground,
  installCroquisSyncListener,
  loadCroquisDraft,
  loadCroquisImage,
  persistCroquisScene,
  readPendingCroquisWrites,
  saveCroquisDraft,
  saveCroquisPreview,
} from '../lib/croquisSync';
import type { Croquis } from '../types';
import type { CroquisBackground, CroquisScene } from '../types/croquis';

export interface CroquisSession {
  /** L'état est résolu (brouillon, file ou serveur) : on peut monter l'éditeur. Avant, il serait monté avec une feuille vide. */
  ready: boolean;
  initialScene: CroquisScene;
  background: CroquisBackground | null;
  bgOpacity: number;
  status: AutosaveStatus;
  /** « Enregistré », « Hors ligne : en attente d'envoi »... ; vide au repos. */
  statusLabel: string;
  onSceneChange: (scene: CroquisScene) => void;
  onBgOpacityChange: (opacity: number) => void;
  onBackgroundImport: (loaded: LoadedBackground) => void;
  onBackgroundClear: () => void;
  /** Enregistre tout de suite et prépare l'aperçu : à appeler à la fermeture de l'éditeur. */
  finish: () => Promise<void>;
}

const PREVIEW_DELAY_MS = 4000;
const PREVIEW_MAX_SIDE = 1600;

/**
 * Tout ce qu'il faut pour ouvrir UN croquis dans l'éditeur et l'enregistrer : état de départ (brouillon non
 * parti > écriture en file > serveur), fond relu depuis l'appareil ou le serveur, enregistrement automatique
 * après une pause (1 s), à la mise en arrière-plan de la page et à la fermeture, et aperçu PNG pour les exports.
 */
export function useCroquisSession(row: Croquis | null): CroquisSession {
  const { t } = useTranslation();
  const id = row?.id ?? null;
  const [ready, setReady] = useState(false);
  const [initialScene, setInitialScene] = useState<CroquisScene>(emptyScene());
  const [background, setBackground] = useState<CroquisBackground | null>(null);
  const [bgOpacity, setBgOpacity] = useState(DEFAULT_BG_OPACITY);
  const [status, setStatus] = useState<AutosaveStatus>('idle');

  const saverRef = useRef<Autosaver | null>(null);
  const backgroundRef = useRef<CroquisBackground | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPreviewKeyRef = useRef('');
  const buildPreviewRef = useRef<() => Promise<void>>(async () => undefined);
  const schedulePreviewRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!row) return undefined;
    const croquisId = row.id;
    let cancelled = false;
    setReady(false);
    setStatus('idle');
    installCroquisSyncListener();

    const buildPreview = async () => {
      const saver = saverRef.current;
      if (!saver) return;
      const current = saver.current();
      const bg = backgroundRef.current;
      // Un croquis vide sur feuille blanche n'a rien à montrer : les exports le sautent d'après sa scène.
      if (current.scene.elements.length === 0 && !bg) return;
      const key = `${serializeScene(current.scene)}|${current.bgOpacity}|${bg ? `${bg.width}x${bg.height}` : ''}`;
      if (key === lastPreviewKeyRef.current) return;
      const canvas = renderSceneToCanvas({ elements: current.scene.elements, background: bg, bgOpacity: current.bgOpacity, maxSide: PREVIEW_MAX_SIDE });
      if (!canvas) return;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) return;
      lastPreviewKeyRef.current = key;
      await saveCroquisPreview(croquisId, blob);
    };
    const schedulePreview = () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      previewTimerRef.current = setTimeout(() => { void buildPreview().catch(() => undefined); }, PREVIEW_DELAY_MS);
    };
    buildPreviewRef.current = buildPreview;
    schedulePreviewRef.current = schedulePreview;

    void (async () => {
      const pending = indexPendingCroquis(await readPendingCroquisWrites()).get(croquisId);
      const draft = loadCroquisDraft(croquisId);
      const resolved = resolveCroquisState(row, pending, draft);

      let bg: CroquisBackground | null = null;
      if (!pending?.backgroundClear) {
        const blob = await loadCroquisImage(row, 'bg').catch(() => null);
        if (blob) bg = await backgroundFromBlob(blob).catch(() => null);
      }
      if (cancelled) return;

      const saver = createAutosaver(
        { scene: resolved.scene, bgOpacity: resolved.bgOpacity },
        {
          persist: (state) => persistCroquisScene(croquisId, state.scene, state.bgOpacity),
          onStatus: setStatus,
          onPersisted: (state) => {
            clearCroquisDraft(croquisId, state);
            schedulePreview();
          },
        },
        // Un brouillon n'est jamais parti : il faut le renvoyer, la file ne le connaît pas.
        { resendInitial: resolved.source === 'draft' },
      );
      saverRef.current = saver;
      backgroundRef.current = bg;
      lastPreviewKeyRef.current = '';
      setInitialScene(resolved.scene);
      setBgOpacity(resolved.bgOpacity);
      setBackground(bg);
      setReady(true);
      if (resolved.source === 'draft') void saver.flush();
    })();

    // Une écriture rejouée a pu en effacer une plus récente de la file (même identifiant, remplacée pendant
    // l'envoi) : si le serveur n'a pas ce que l'écran montre, on le renvoie.
    const onSynced = (event: Event) => {
      const detail = (event as CustomEvent).detail as { id?: string; data?: { scene?: unknown; bg_opacity?: number } } | undefined;
      if (detail?.id !== croquisWriteId('scene', croquisId)) return;
      const saved = sanitizeScene(detail.data?.scene);
      const saver = saverRef.current;
      if (!saver || !saved) return;
      const current = saver.current();
      const savedOpacity = typeof detail.data?.bg_opacity === 'number' ? detail.data.bg_opacity : current.bgOpacity;
      if (!sceneEquals(saved, current.scene) || Math.abs(savedOpacity - current.bgOpacity) > 0.001) {
        saver.markUnsaved();
        void saver.flush();
      }
    };
    // Mise en arrière-plan, fermeture de l'onglet, retour du réseau : on n'attend plus la pause.
    const flushNow = () => { void saverRef.current?.flush(); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushNow(); };
    window.addEventListener(OFFLINE_WRITE_SYNCED_EVENT, onSynced);
    window.addEventListener('pagehide', flushNow);
    window.addEventListener('online', flushNow);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      window.removeEventListener(OFFLINE_WRITE_SYNCED_EVENT, onSynced);
      window.removeEventListener('pagehide', flushNow);
      window.removeEventListener('online', flushNow);
      document.removeEventListener('visibilitychange', onVisibility);
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      const saver = saverRef.current;
      saverRef.current = null;
      if (saver) {
        // L'envoi part tout de suite ; l'enregistreur n'accepte plus de modification.
        void saver.flush();
        saver.dispose();
      }
    };
    // L'éditeur ne se relit que pour un autre croquis : la ligne change d'identité à chaque relecture de la liste.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const onSceneChange = useCallback((scene: CroquisScene) => {
    const saver = saverRef.current;
    if (!saver || !id) return;
    const next = { scene, bgOpacity: saver.current().bgOpacity };
    saveCroquisDraft(id, next.scene, next.bgOpacity);
    saver.update(next);
  }, [id]);

  const onBgOpacityChange = useCallback((opacity: number) => {
    setBgOpacity(opacity);
    const saver = saverRef.current;
    if (!saver || !id) return;
    const next = { scene: saver.current().scene, bgOpacity: opacity };
    saveCroquisDraft(id, next.scene, next.bgOpacity);
    saver.update(next);
  }, [id]);

  const onBackgroundImport = useCallback((loaded: LoadedBackground) => {
    if (!id) return;
    backgroundRef.current = loaded.background;
    setBackground(loaded.background);
    setStatus('saving');
    importCroquisBackground(id, loaded)
      .then(() => {
        setStatus(navigator.onLine ? 'saved' : 'queued');
        schedulePreviewRef.current();
      })
      .catch(() => setStatus('error'));
  }, [id]);

  const onBackgroundClear = useCallback(() => {
    if (!id) return;
    backgroundRef.current = null;
    setBackground(null);
    setStatus('saving');
    clearCroquisBackground(id)
      .then(() => {
        setStatus(navigator.onLine ? 'saved' : 'queued');
        schedulePreviewRef.current();
      })
      .catch(() => setStatus('error'));
  }, [id]);

  const finish = useCallback(async () => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    await saverRef.current?.flush();
    await buildPreviewRef.current().catch(() => undefined);
  }, []);

  return {
    ready,
    initialScene,
    background,
    bgOpacity,
    status,
    statusLabel: status === 'idle' ? '' : t(`croquis_status_${status}`),
    onSceneChange,
    onBgOpacityChange,
    onBackgroundImport,
    onBackgroundClear,
    finish,
  };
}
