// ── Dictée vocale pour le chat des agents ────────────────────────────────────
// Un micro dans la barre de saisie : on parle, le texte reconnu se dépose dans
// la zone de texte, et c'est l'utilisateur qui relit puis envoie. La dictée
// n'envoie JAMAIS d'elle-même — un agent qui écrit dans la base ne doit pas
// agir sur une phrase que personne n'a relue, et une reconnaissance vocale se
// trompe.
//
// Deux moteurs derrière la même interface, parce qu'aucun ne couvre tous les
// postes :
//
// | | « navigateur » | « serveur » |
// |---|---|---|
// | Mécanique | SpeechRecognition (Web Speech API) | MediaRecorder puis POST /api/agents/transcribe |
// | Où | Chrome, Edge, Safari | partout où l'on peut enregistrer : Firefox, client Electron |
// | Restitution | au fil de la parole | à l'arrêt de l'enregistrement |
// | Coût | nul | jetons IA du cabinet (audio, voir pricing.ts) |
//
// Le moteur navigateur passe en premier quand il existe : gratuit, immédiat,
// et il montre les mots pendant qu'on parle. Le moteur serveur prend le relais
// là où il n'existe pas — et là où il existe mais ne fonctionne pas : dans le
// Chromium d'Electron, `webkitSpeechRecognition` est bien présent mais échoue
// en 'network', parce que le service de reconnaissance de Google est lié à un
// navigateur et pas à une application (exactement la raison pour laquelle le
// client de bureau relève ses notifications au lieu de recevoir du Web Push).
// D'où la bascule sur erreur, et pas seulement sur absence.
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/src/lib/api';

export type DictationEngine = 'browser' | 'server';
/** 'listening' : le micro est ouvert. 'transcribing' : plus de micro, on
 *  attend le texte (moteur serveur seulement — le moteur navigateur restitue
 *  au fil de l'eau et n'a pas cet état). */
export type DictationStatus = 'idle' | 'listening' | 'transcribing';

export interface UseDictationOptions {
  /** Étiquette BCP-47, alignée sur la langue de l'interface. */
  language?: string;
  /** Appelé pour chaque bribe reconnue comme définitive. Le texte arrive nu,
   *  à charge de l'appelant de le raccorder à ce qui est déjà saisi. */
  onTranscript: (text: string) => void;
  /** Rattache la dépense de transcription à un agent dans le suivi de
   *  consommation. */
  agentId?: string | null;
}

export interface Dictation {
  /** Faux quand le poste ne sait ni reconnaître ni enregistrer : le bouton
   *  micro ne s'affiche pas plutôt que de s'afficher inerte. */
  supported: boolean;
  engine: DictationEngine | null;
  status: DictationStatus;
  /** Les mots en cours de reconnaissance, pas encore définitifs (moteur
   *  navigateur). Affichés en gris sous la zone de saisie pour qu'on voie que
   *  la machine entend, sans polluer le texte que l'on relira. */
  interim: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

/** Durée maximale d'un enregistrement serveur. Une dictée de plus de trois
 *  minutes n'est plus une instruction mais un oubli d'arrêter le micro, et
 *  chaque seconde enregistrée se facture. */
const MAX_RECORDING_MS = 3 * 60 * 1000;

function speechRecognitionCtor(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

function canRecord(): boolean {
  return typeof window !== 'undefined'
    && typeof (window as any).MediaRecorder !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia;
}

/** Le premier conteneur que le navigateur sait produire. Chromium et Firefox
 *  donnent du webm/opus, Safari du mp4 ; `undefined` laisse le navigateur
 *  choisir, et le type réel est relu sur le Blob obtenu. */
function preferredMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  const MR: any = (window as any).MediaRecorder;
  if (!MR?.isTypeSupported) return undefined;
  return candidates.find(t => MR.isTypeSupported(t));
}

export function useDictation({ language = 'fr-FR', onTranscript, agentId }: UseDictationOptions): Dictation {
  const [status, setStatus] = useState<DictationStatus>('idle');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Le moteur navigateur peut se révéler inutilisable seulement à l'usage
  // (voir l'en-tête) : cet état retient la bascule pour le reste de la
  // session, au lieu de refaire échouer la première tentative à chaque clic.
  const [browserEngineBroken, setBrowserEngineBroken] = useState(false);

  const recognitionRef = useRef<any>(null);
  const recorderRef = useRef<any>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Distingue « le moteur s'est arrêté tout seul » (silence prolongé, ce que
  // Chrome fait même en mode continu) de « l'utilisateur a coupé le micro ».
  const wantListeningRef = useRef(false);
  // Évite qu'un rendu ne fige une ancienne version du callback dans les
  // gestionnaires d'événements posés une fois pour toutes.
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const agentIdRef = useRef(agentId);
  agentIdRef.current = agentId;

  const browserAvailable = !!speechRecognitionCtor() && !browserEngineBroken;
  const serverAvailable = canRecord();
  const engine: DictationEngine | null = browserAvailable ? 'browser' : (serverAvailable ? 'server' : null);

  const releaseMicrophone = useCallback(() => {
    // Sans cela l'indicateur d'enregistrement du navigateur (et la diode du
    // portable) reste allumé après la dictée.
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null; }
  }, []);

  // ── Moteur navigateur ──────────────────────────────────────────────────────

  const startBrowser = useCallback(() => {
    const Ctor = speechRecognitionCtor();
    if (!Ctor) return false;
    const recognition = new Ctor();
    recognition.lang = language;
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      let pending = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) onTranscriptRef.current(text.trim());
        else pending += text;
      }
      setInterim(pending.trim());
    };

    recognition.onerror = (event: any) => {
      const code = event?.error;
      // 'no-speech' et 'aborted' ne sont pas des pannes : l'un dit qu'on n'a
      // rien dit, l'autre que l'on vient de couper. Les afficher en rouge
      // ferait passer un usage normal pour une erreur.
      if (code === 'no-speech' || code === 'aborted') return;
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        wantListeningRef.current = false;
        setError('permission');
        setStatus('idle');
        return;
      }
      // 'network' : le service de reconnaissance est hors d'atteinte — le cas
      // du client de bureau. On abandonne ce moteur pour de bon et on
      // recommence avec l'enregistrement, sans rien demander à l'utilisateur.
      if (code === 'network' && canRecord()) {
        setBrowserEngineBroken(true);
        return;
      }
      wantListeningRef.current = false;
      setError('engine');
      setStatus('idle');
    };

    recognition.onend = () => {
      // Chrome referme la session après quelques secondes de silence, même en
      // mode continu : tant que le micro n'a pas été coupé volontairement, on
      // rouvre, sinon une pause dans la phrase interromprait la dictée.
      if (wantListeningRef.current && recognitionRef.current === recognition) {
        try { recognition.start(); return; } catch { /* déjà relancée */ }
      }
      recognitionRef.current = null;
      setInterim('');
      setStatus(prev => (prev === 'listening' ? 'idle' : prev));
    };

    recognitionRef.current = recognition;
    recognition.start();
    return true;
  }, [language]);

  // ── Moteur serveur ─────────────────────────────────────────────────────────

  const sendRecording = useCallback(async (blob: Blob) => {
    // Un enregistrement quasi vide (clic malencontreux) ne vaut pas un appel
    // facturé : quelques centaines d'octets, c'est un conteneur sans parole.
    if (blob.size < 1200) { setStatus('idle'); return; }
    setStatus('transcribing');
    try {
      const query = new URLSearchParams({ lang: language });
      if (agentIdRef.current) query.set('agent_id', agentIdRef.current);
      const res = await apiFetch<{ text: string }>(`/api/agents/transcribe?${query.toString()}`, {
        method: 'POST',
        body: blob,
        headers: { 'Content-Type': blob.type || 'audio/webm' },
      });
      const text = (res?.text || '').trim();
      if (text) onTranscriptRef.current(text);
    } catch (e: any) {
      setError(e?.code === 'NO_TOKENS' ? 'tokens' : (e?.message || 'engine'));
    } finally {
      setStatus('idle');
    }
  }, [language]);

  const startServer = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      // L'utilisateur a pu recliquer pour couper pendant que la boîte de
      // permission était ouverte : dans ce cas on relâche et on n'enregistre
      // pas, plutôt que d'ouvrir un micro que plus personne n'attend.
      if (!wantListeningRef.current) { releaseMicrophone(); return; }

      const mimeType = preferredMimeType();
      const recorder = new (window as any).MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e: any) => { if (e.data?.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        releaseMicrophone();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' });
        chunksRef.current = [];
        recorderRef.current = null;
        void sendRecording(blob);
      };
      recorderRef.current = recorder;
      recorder.start();
      setStatus('listening');
      autoStopRef.current = setTimeout(() => { wantListeningRef.current = false; recorder.stop(); }, MAX_RECORDING_MS);
    } catch {
      // getUserMedia n'échoue en pratique que sur un refus de permission ou
      // un poste sans micro — les deux se règlent au même endroit.
      wantListeningRef.current = false;
      releaseMicrophone();
      setError('permission');
      setStatus('idle');
    }
  }, [releaseMicrophone, sendRecording]);

  // ── Interface commune ──────────────────────────────────────────────────────

  const stop = useCallback(() => {
    wantListeningRef.current = false;
    if (recognitionRef.current) {
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      try { recognition.stop(); } catch { /* déjà arrêtée */ }
      setInterim('');
      setStatus('idle');
    }
    // L'arrêt du magnétophone déclenche onstop, qui envoie l'enregistrement et
    // fait passer l'état à 'transcribing' : rien à forcer ici.
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    else releaseMicrophone();
  }, [releaseMicrophone]);

  const start = useCallback(() => {
    if (!engine) return;
    setError(null);
    wantListeningRef.current = true;
    if (engine === 'browser') {
      try {
        if (startBrowser()) { setStatus('listening'); return; }
      } catch {
        // Le constructeur existe mais refuse de démarrer : on ne perd pas la
        // dictée pour autant, le moteur serveur est là.
        setBrowserEngineBroken(true);
      }
      if (canRecord()) { void startServer(); return; }
      wantListeningRef.current = false;
      setError('engine');
      return;
    }
    void startServer();
  }, [engine, startBrowser, startServer]);

  // La bascule décidée en cours de session (moteur navigateur cassé) reprend
  // la dictée là où elle a échoué, sans que l'utilisateur ait à recliquer.
  useEffect(() => {
    if (browserEngineBroken && wantListeningRef.current && !recorderRef.current) void startServer();
  }, [browserEngineBroken, startServer]);

  const toggle = useCallback(() => {
    if (status === 'listening') stop();
    else if (status === 'idle') start();
    // Pendant 'transcribing' le micro est déjà coupé et la réponse arrive :
    // un clic de plus n'a rien à interrompre.
  }, [status, start, stop]);

  // Un composant démonté (panneau refermé, navigation) ne doit pas laisser le
  // micro ouvert derrière lui.
  useEffect(() => () => {
    wantListeningRef.current = false;
    try { recognitionRef.current?.stop(); } catch { /* rien à arrêter */ }
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    releaseMicrophone();
  }, [releaseMicrophone]);

  return {
    supported: !!engine,
    engine,
    status,
    interim,
    error,
    start,
    stop,
    toggle,
  };
}
