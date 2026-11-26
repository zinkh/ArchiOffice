// Envois de messages en arrière-plan. La fenêtre « Nouveau message » se referme
// dès que l'envoi est lancé : l'envoi continue ici, hors de tout composant,
// pendant que la personne travaille ailleurs, et la zone de progression
// (BackgroundSendTray, montée une fois dans App.tsx) en montre l'avancement.
//
// Tout vit en mémoire de la page : fermer l'onglet interrompt un envoi en cours
// (le tray demande alors confirmation au navigateur). Rien n'est enregistré.
//
// Le magasin est externe à React (useSyncExternalStore) : chaque changement
// remplace le tableau, jamais de mutation en place.

export type SendJobStatus = 'running' | 'sent' | 'error';

export interface SendJob {
  id: string;
  /** Objet du message, pour reconnaître l'envoi dans la liste. */
  label: string;
  status: SendJobStatus;
  /** Étape en cours, déjà traduite (« Préparation des pièces jointes (2/5) »). */
  step: string;
  done: number;
  total: number;
  error?: string;
}

/** Rapport d'avancement donné au traitement d'envoi. */
export type SendProgress = (step: string, done: number, total: number) => void;

interface StartOptions {
  label: string;
  /** Texte de la première étape, affiché avant le premier rapport. */
  step: string;
  run: (progress: SendProgress) => Promise<void>;
  onSent?: () => void;
  /** Message d'erreur lisible à partir de l'exception (jetons expirés, etc.). */
  describeError: (err: unknown) => string;
}

/** Durée d'affichage d'un envoi réussi avant retrait automatique. */
export const SENT_VISIBLE_MS = 6000;

let jobs: SendJob[] = [];
const listeners = new Set<() => void>();
const options = new Map<string, StartOptions>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

const emit = () => listeners.forEach(l => l());
const patch = (id: string, change: Partial<SendJob>) => {
  jobs = jobs.map(j => (j.id === id ? { ...j, ...change } : j));
  emit();
};

export const subscribeSends = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const getSendJobs = (): SendJob[] => jobs;
export const hasRunningSends = (): boolean => jobs.some(j => j.status === 'running');

async function execute(id: string): Promise<void> {
  const opt = options.get(id);
  if (!opt) return;
  patch(id, { status: 'running', error: undefined, step: opt.step, done: 0, total: 1 });
  try {
    await opt.run((step, done, total) => patch(id, { step, done, total }));
    patch(id, { status: 'sent', done: jobs.find(j => j.id === id)?.total ?? 1 });
    try { opt.onSent?.(); } catch { /* le message est parti : un rappel défaillant ne doit pas le faire passer pour un échec */ }
    timers.set(id, setTimeout(() => dismissSend(id), SENT_VISIBLE_MS));
  } catch (err) {
    patch(id, { status: 'error', error: opt.describeError(err) });
  }
}

/** Lance un envoi en arrière-plan ; rend son identifiant. */
export function startBackgroundSend(opt: StartOptions): string {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `send-${Date.now()}-${Math.random()}`;
  options.set(id, opt);
  jobs = [...jobs, { id, label: opt.label, status: 'running', step: opt.step, done: 0, total: 1 }];
  emit();
  void execute(id);
  return id;
}

/** Relance un envoi en échec, avec exactement le même message. */
export function retrySend(id: string): void {
  if (jobs.find(j => j.id === id)?.status !== 'error') return;
  void execute(id);
}

/** Retire un envoi de la liste (réussi ou en échec). Un envoi en cours ne se retire pas. */
export function dismissSend(id: string): void {
  if (jobs.find(j => j.id === id)?.status === 'running') return;
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  options.delete(id);
  jobs = jobs.filter(j => j.id !== id);
  emit();
}

/** Réservé aux tests : repart d'un état vide. */
export function resetSendsForTests(): void {
  timers.forEach(t => clearTimeout(t));
  timers.clear();
  options.clear();
  jobs = [];
  emit();
}
