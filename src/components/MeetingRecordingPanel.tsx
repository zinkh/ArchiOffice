import { useEffect, useRef, useState } from 'react';
import { IconMicrophone, IconPlayerStop, IconLoader2 } from '@tabler/icons-react';
import { useUser } from '../UserContext';
import { apiFetch } from '../lib/api';
import { MeetingRecorder, TRANSCRIPTION_MAX_BYTES } from '../lib/meetingRecorder';
import { recordingDraftKey, recordingDrafts, type MeetingRecordingDraft } from '../lib/meetingRecordingDrafts';

interface Props {
  kind: 'meeting' | 'siteReport';
  parentId: string;
  onInsert: (notes: string, insertionId: string) => Promise<void>;
}

export default function MeetingRecordingPanel(props: Props) {
  const { currentUser, activeTenantId, tenantPlan, isTrialExpired } = useUser();
  if (!currentUser) return null;
  const draftKey = recordingDraftKey(currentUser.id, activeTenantId, props.kind, props.parentId);
  // Changing account, cabinet or meeting releases the microphone and isolates the draft.
  return <RecordingPanel key={draftKey} {...props} draftKey={draftKey} canGenerate={tenantPlan === 'enterprise' && !isTrialExpired} />;
}

export function RecordingPanel({ kind, onInsert, draftKey, canGenerate }: Props & { draftKey: string; canGenerate: boolean }) {
  const [draft, setDraft] = useState<MeetingRecordingDraft>(() => ({
    key: draftKey, segments: [], transcripts: [], transcript: '', notes: '', insertionId: crypto.randomUUID(),
  }));
  const draftRef = useRef(draft);
  const [loaded, setLoaded] = useState(false);
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [audioUrls, setAudioUrls] = useState<string[]>([]);
  const [online, setOnline] = useState(navigator.onLine);
  const recorderRef = useRef<MeetingRecorder | null>(null);
  const mounted = useRef(true);
  const pendingWrites = useRef<Promise<unknown>>(Promise.resolve());
  const operation = useRef<AbortController | null>(null);
  const startingRef = useRef(false);
  const busyRef = useRef(false);
  const supported = typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  function update(patch: Partial<MeetingRecordingDraft>) {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    if (mounted.current) setDraft(next);
    // Serialize saves so the last audio/text snapshot always wins.
    pendingWrites.current = pendingWrites.current.catch(() => {}).then(() => recordingDrafts.put(next)).catch(() => {
      if (mounted.current) setStorageError('Sauvegarde sur cet appareil impossible. Téléchargez l’audio avant de quitter cette page.');
    });
  }

  useEffect(() => {
    mounted.current = true;
    recordingDrafts.get(draftKey).then(saved => {
      if (!mounted.current) return;
      if (saved) { draftRef.current = saved; setDraft(saved); }
    }).catch(() => setStorageError('Stockage local indisponible. Téléchargez l’audio avant de quitter cette page.'))
      .finally(() => { if (mounted.current) setLoaded(true); });
    const onConnectivity = () => setOnline(navigator.onLine);
    const onPageHide = () => recorderRef.current?.stop();
    window.addEventListener('online', onConnectivity);
    window.addEventListener('offline', onConnectivity);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      mounted.current = false;
      operation.current?.abort();
      recorderRef.current?.stop();
      window.removeEventListener('online', onConnectivity);
      window.removeEventListener('offline', onConnectivity);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [draftKey]);

  useEffect(() => {
    if (!recording) return;
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    const preventClose = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventClose);
    return () => { clearInterval(timer); window.removeEventListener('beforeunload', preventClose); };
  }, [recording]);

  useEffect(() => {
    if (recording || starting) { setAudioUrls([]); return; }
    const urls = draft.segments.map(segment => URL.createObjectURL(segment));
    setAudioUrls(urls);
    return () => urls.forEach(url => URL.revokeObjectURL(url));
  }, [draft.segments, recording, starting]);

  async function start() {
    if (startingRef.current || recorderRef.current || draftRef.current.segments.length) return;
    startingRef.current = true;
    setStarting(true); setError(''); setElapsed(0);
    const recorder = new MeetingRecorder(
      segments => update({ segments }),
      () => { recorderRef.current = null; if (mounted.current) { setRecording(false); setStarting(false); } },
      message => { if (mounted.current) setError(message); },
    );
    recorderRef.current = recorder;
    try {
      await recorder.start();
      if (mounted.current && recorderRef.current === recorder) setRecording(true);
    } catch (e: any) {
      if (mounted.current) setError(e?.name === 'NotAllowedError'
        ? 'Accès au microphone refusé. Autorisez le micro dans les réglages du navigateur.'
        : e?.name === 'NotFoundError' ? 'Aucun microphone détecté.' : 'Impossible d’ouvrir le microphone. Vérifiez sa disponibilité.');
    } finally {
      startingRef.current = false;
      if (mounted.current) setStarting(false);
    }
  }

  async function generate() {
    if (busyRef.current) return;
    busyRef.current = true;
    setError('');
    const controller = new AbortController();
    operation.current = controller;
    try {
      let transcript = draftRef.current.transcript;
      if (!transcript.trim()) {
        const transcripts = [...draftRef.current.transcripts];
        for (let i = 0; i < draftRef.current.segments.length; i++) {
          if (transcripts[i] !== undefined) continue;
          const segment = draftRef.current.segments[i];
          if (segment.size > TRANSCRIPTION_MAX_BYTES) throw new Error(`Séquence ${i + 1} trop volumineuse. Téléchargez-la pour la conserver.`);
          setBusy(`Transcription ${i + 1}/${draftRef.current.segments.length}…`);
          const result = await apiFetch<{ text: string }>('/api/agents/transcribe?lang=fr-FR', {
            method: 'POST', headers: { 'Content-Type': segment.type || 'audio/webm' }, body: segment, signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          if (typeof result.text !== 'string') throw new Error('Réponse de transcription invalide. Réessayez.');
          transcripts[i] = result.text;
          update({ transcripts: [...transcripts] });
        }
        transcript = transcripts.filter(Boolean).join('\n\n');
        update({ transcript });
      }
      if (!transcript.trim()) throw new Error('Aucune parole reconnue. Réécoutez l’audio avant de recommencer.');
      setBusy('Préparation des notes…');
      const result = await apiFetch<{ notes: string }>('/api/meeting-notes/generate', {
        method: 'POST', body: JSON.stringify({ transcript, kind }), signal: controller.signal,
      });
      if (!controller.signal.aborted) update({ notes: result.notes });
    } catch (e: any) {
      if (!controller.signal.aborted && mounted.current) setError(e.message || 'Conversion impossible. Vous pouvez réessayer ; l’audio est conservé.');
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy('');
    }
  }

  async function insert(text: string) {
    if (busyRef.current || draftRef.current.inserted || !text.trim()) return;
    busyRef.current = true; setBusy('Ajout des notes…'); setError('');
    try {
      await onInsert(text.trim(), draftRef.current.insertionId);
      update({ inserted: true });
    } catch (e: any) {
      if (mounted.current) setError(e.message || 'Ajout impossible. Le brouillon reste disponible.');
    } finally { busyRef.current = false; if (mounted.current) setBusy(''); }
  }

  function discard() {
    if (!window.confirm('Supprimer l’audio et le brouillon sur cet appareil ? Les notes déjà ajoutées à la réunion seront conservées.')) return;
    update({ segments: [], transcripts: [], transcript: '', notes: '', inserted: false, insertionId: crypto.randomUUID() });
    setError('');
  }

  const locked = !!busy || recording || starting || !loaded;
  const hasDraft = draft.segments.length > 0 || !!draft.transcript || !!draft.notes;
  const button = 'inline-flex items-center justify-center gap-2 min-h-11 px-3 py-2 rounded-lg text-sm border border-[var(--tblr-border)] disabled:opacity-50';
  return <section aria-label="Enregistrement de la réunion" className="mb-5 p-4 rounded-xl border border-[var(--tblr-border)] bg-[var(--tblr-surface-2)] space-y-3">
    <div className="flex items-center gap-2 font-semibold text-sm"><IconMicrophone size={18} /> Enregistrer la réunion</div>
    <p className="text-sm text-[var(--tblr-muted)]">Microphone du téléphone ou de l’ordinateur. Informez les participants avant de commencer. Gardez cette page ouverte et l’écran allumé pendant l’enregistrement.</p>
    <p className="text-xs text-[var(--tblr-muted)]">L’audio reste sur cet appareil jusqu’à sa suppression. La conversion envoie l’audio au service IA du cabinet et utilise ses crédits IA. Les notes sont à relire avant ajout.</p>
    {!canGenerate && <p className="text-sm">La transcription et la préparation des notes nécessitent le plan Enterprise et des crédits IA.</p>}
    {!online && <p role="status" className="text-sm">Hors ligne : vous pouvez enregistrer. La conversion sera disponible au retour de la connexion.</p>}
    {!supported && <p className="text-sm">Microphone indisponible ici. Ouvrez ArchiOffice en HTTPS dans un navigateur compatible.</p>}
    <div className="flex flex-wrap items-center gap-2">
      {!hasDraft && !recording && <button type="button" className={button} disabled={locked || !supported} onClick={start}><IconMicrophone size={16} />{starting ? 'Autorisation du microphone…' : 'Démarrer l’enregistrement'}</button>}
      {recording && <><span role="status" className="text-sm font-medium">● Enregistrement · {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span><button type="button" className={button} onClick={() => recorderRef.current?.stop()}><IconPlayerStop size={16} /> Arrêter</button></>}
      {busy && <span role="status" className="text-sm inline-flex gap-2 items-center"><IconLoader2 size={16} className="animate-spin" />{busy}</span>}
    </div>
    {recording && <p className="text-xs text-[var(--tblr-muted)]">Découpage automatique en séquences de 5 minutes ; la réunion continue d’être enregistrée.</p>}
    {!recording && audioUrls.map((url, index) => <div key={url} className="space-y-1">
      <div className="text-xs flex flex-wrap gap-3"><span>Séquence {index + 1}</span><a className="underline" href={url} download={`reunion-${kind}-${index + 1}.${draft.segments[index]?.type.includes('mp4') ? 'm4a' : draft.segments[index]?.type.includes('ogg') ? 'ogg' : 'webm'}`}>Télécharger l’audio</a></div>
      <audio controls preload="metadata" src={url} aria-label={`Écouter la séquence ${index + 1}`} className="w-full max-w-full" />
    </div>)}
    {hasDraft && <>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={locked || !online || !canGenerate || draft.inserted} onClick={generate}>{draft.transcript ? 'Préparer les notes depuis la transcription' : 'Transcrire et préparer les notes'}</button>
        <button type="button" className={button} disabled={locked} onClick={discard}>Supprimer le brouillon audio</button>
      </div>
      {(draft.transcript || draft.transcripts.some(t => t !== undefined)) && <details>
        <summary className="cursor-pointer text-sm">Transcription — consulter et corriger</summary>
        <textarea aria-label="Transcription de la réunion" rows={6} className="w-full mt-2 p-3 rounded-lg border border-[var(--tblr-border)] bg-[var(--tblr-surface)] text-sm" value={draft.transcript || draft.transcripts.filter(Boolean).join('\n\n')}
          disabled={locked || draft.inserted || (!draft.transcript && draft.transcripts.filter(t => t !== undefined).length < draft.segments.length)} onChange={e => update({ transcript: e.target.value })} />
        {!draft.notes && draft.transcript && <button type="button" className={button} disabled={locked || draft.inserted} onClick={() => insert(draftRef.current.transcript)}>Ajouter la transcription seule</button>}
      </details>}
      {draft.notes && <div className="space-y-2">
        <label className="block text-sm font-medium">Notes proposées — à relire
          <textarea rows={10} className="w-full mt-2 p-3 rounded-lg border border-[var(--tblr-border)] bg-[var(--tblr-surface)] text-sm" value={draft.notes} disabled={locked || draft.inserted} onChange={e => update({ notes: e.target.value })} />
        </label>
        <button type="button" className={button} disabled={locked || draft.inserted || !draft.notes.trim()} onClick={() => insert(draftRef.current.notes)}>{kind === 'siteReport' ? 'Ajouter aux rubriques du compte rendu' : 'Ajouter aux notes de réunion'}</button>
      </div>}
    </>}
    {draft.inserted && <p role="status" className="text-sm">Notes ajoutées. Vous pouvez supprimer ce brouillon pour enregistrer la suite.</p>}
    {storageError && <p role="alert" className="text-sm text-red-600">{storageError}</p>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  </section>;
}
