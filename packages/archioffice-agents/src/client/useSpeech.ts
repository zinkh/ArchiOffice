// ── Synthèse vocale des réponses du chat ─────────────────────────────────────
// Un haut-parleur sur chaque message : on clique, le texte déjà affiché est
// lu à voix haute. Contrairement à la dictée, rien à faire relire ici — le
// texte a déjà été validé par un humain avant d'arriver dans le chat (tapé
// par l'utilisateur, ou une réponse d'agent déjà affichée à l'écran) : la
// synthèse ne fait que le prononcer, elle ne décide de rien.
//
// Deux moteurs derrière la même interface, pour la même raison que la
// dictée (voir useDictation.ts) : aucun ne couvre tous les postes.
//
// | | « navigateur » | « serveur » |
// |---|---|---|
// | Mécanique | `speechSynthesis` (Web Speech API) | `POST /api/agents/speak`, lu via `<audio>` |
// | Où | partout où des voix système sont installées | là où il n'y en a pas |
// | Coût | nul | jetons IA du cabinet |
//
// Le moteur navigateur passe en premier : gratuit, sans latence réseau. Le
// serveur prend le relais quand il échoue — pas seulement quand il est
// absent. `speechSynthesis` existe dans le Chromium d'Electron mais peut n'y
// exposer aucune voix : `speak()` avale alors la consigne sans jamais
// déclencher ni `start` ni `error`. Un silence au-delà d'un court délai vaut
// une panne, exactement comme la reconnaissance vocale y échoue en 'network'
// pour la même raison (le moteur est lié au navigateur, pas à l'application).
import { useCallback, useEffect, useRef, useState } from 'react';
import { getAccessToken } from '@/src/lib/authToken';

export type SpeechEngine = 'browser' | 'server';
/** 'loading' : la voix se prépare (le serveur transcode, ou le navigateur n'a
 *  pas encore confirmé qu'il a pris la consigne). 'speaking' : ça parle. */
export type SpeechStatus = 'idle' | 'loading' | 'speaking';

export interface UseSpeechOptions {
  /** Étiquette BCP-47, alignée sur la langue de l'interface. */
  language?: string;
  /** Rattache la dépense de synthèse à un agent dans le suivi de consommation. */
  agentId?: string | null;
}

export interface Speech {
  /** Toujours vrai : le moteur serveur répond à tout poste ayant accès à
   *  l'API (seule l'absence de clé Gemini y échoue, révélée à l'appel plutôt
   *  qu'en amont — un bouton lecture n'a pas à anticiper la configuration de
   *  l'instance). */
  supported: boolean;
  engine: SpeechEngine | null;
  /** L'identifiant du message en cours de lecture ou de préparation, `null`
   *  sinon. Sert au bouton de chaque message pour savoir s'il doit afficher
   *  « lire » ou « arrêter ». */
  activeId: string | null;
  status: SpeechStatus;
  error: string | null;
  /** Lit ce texte à voix haute sous cet identifiant. Une lecture déjà en
   *  cours, la sienne ou celle d'un autre message, s'arrête d'abord : deux
   *  voix qui se chevauchent ne servent à personne. */
  speak: (id: string, text: string) => void;
  stop: () => void;
  /** Bascule play/stop pour ce message précis — ce que le bouton de chaque
   *  message appelle. */
  toggle: (id: string, text: string) => void;
}

/** Délai au-delà duquel l'absence de `start` (ou d'`error`) du moteur
 *  navigateur vaut une panne plutôt qu'une lenteur — voir l'en-tête. */
const BROWSER_START_TIMEOUT_MS = 500;

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
}

export function useSpeech({ language = 'fr-FR', agentId }: UseSpeechOptions): Speech {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<SpeechStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  // Basculé pour de bon dès la première panne du moteur navigateur, pour ne
  // pas refaire échouer la première tentative de chaque clic suivant.
  const [browserEngineBroken, setBrowserEngineBroken] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef = useRef(false);
  // Identifie chaque lecture demandée : une réponse serveur ou un événement
  // du moteur navigateur qui arrive après qu'une lecture plus récente (ou un
  // stop()) a pris sa place ne doit plus toucher l'état.
  const requestIdRef = useRef(0);

  const browserAvailable = !!synth() && !browserEngineBroken;
  const engine: SpeechEngine = browserAvailable ? 'browser' : 'server';

  const clearStartTimer = () => {
    if (startTimerRef.current) { clearTimeout(startTimerRef.current); startTimerRef.current = null; }
  };

  /** Coupe toute lecture en cours (navigateur ou audio serveur) sans changer
   *  `activeId`/`status` — utilisé en tête de `speak()`, où l'appelant pose
   *  lui-même le nouvel état juste après. */
  const cancelCurrent = useCallback(() => {
    clearStartTimer();
    synth()?.cancel();
    utteranceRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    requestIdRef.current += 1; // invalide toute réponse serveur encore en vol
    cancelCurrent();
    setActiveId(null);
    setStatus('idle');
  }, [cancelCurrent]);

  const speakServer = useCallback(async (id: string, text: string, requestId: number) => {
    if (requestId === requestIdRef.current) setStatus('loading');
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/agents/speak', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ text, language, agent_id: agentId }),
      });
      if (requestId !== requestIdRef.current) return; // une lecture plus récente (ou un stop) a déjà pris la main
      if (!res.ok) {
        let message = `Erreur ${res.status}`;
        let code: string | undefined;
        try { const body = await res.json(); if (body?.error) message = body.error; code = body?.code; } catch { /* pas de JSON */ }
        const err: any = new Error(message);
        err.code = code;
        throw err;
      }

      const blob = await res.blob();
      if (requestId !== requestIdRef.current) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (requestId === requestIdRef.current) { setActiveId(null); setStatus('idle'); }
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        if (requestId === requestIdRef.current) { setError('engine'); setActiveId(null); setStatus('idle'); }
      };
      setStatus('speaking');
      await audio.play();
    } catch (e: any) {
      if (requestId !== requestIdRef.current) return;
      setError(e?.code === 'NO_TOKENS' ? 'tokens' : (e?.code === 'ENTERPRISE_REQUIRED' ? 'enterprise' : 'engine'));
      setActiveId(null);
      setStatus('idle');
    }
  }, [language, agentId]);

  const speak = useCallback((id: string, text: string) => {
    const clean = text.trim();
    if (!clean) return;
    cancelCurrent();
    const requestId = ++requestIdRef.current;
    setError(null);
    setActiveId(id);
    setStatus('loading');

    if (browserAvailable) {
      const s = synth()!;
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.lang = language;
      utteranceRef.current = utterance;
      startedRef.current = false;

      utterance.onstart = () => {
        startedRef.current = true;
        clearStartTimer();
        if (requestId === requestIdRef.current) setStatus('speaking');
      };
      utterance.onend = () => {
        if (requestId === requestIdRef.current) { setActiveId(null); setStatus('idle'); }
      };
      utterance.onerror = (event: any) => {
        clearStartTimer();
        // 'interrupted'/'canceled' : c'est notre propre cancelCurrent() (une
        // nouvelle lecture, ou stop()) — pas une panne à répercuter.
        if (event?.error === 'interrupted' || event?.error === 'canceled') return;
        setBrowserEngineBroken(true);
        void speakServer(id, clean, requestId);
      };

      s.speak(utterance);
      // Un moteur cassé n'émet parfois ni 'start' ni 'error' : il avale la
      // consigne en silence (voir l'en-tête du fichier).
      startTimerRef.current = setTimeout(() => {
        if (requestId === requestIdRef.current && !startedRef.current) {
          setBrowserEngineBroken(true);
          void speakServer(id, clean, requestId);
        }
      }, BROWSER_START_TIMEOUT_MS);
      return;
    }

    void speakServer(id, clean, requestId);
  }, [browserAvailable, language, cancelCurrent, speakServer]);

  const toggle = useCallback((id: string, text: string) => {
    if (activeId === id && status !== 'idle') { stop(); return; }
    speak(id, text);
  }, [activeId, status, stop, speak]);

  // Une lecture ne doit pas continuer derrière un composant démonté (panneau
  // refermé, navigation).
  useEffect(() => () => { requestIdRef.current += 1; cancelCurrent(); }, [cancelCurrent]);

  return { supported: true, engine, activeId, status, error, speak, stop, toggle };
}
