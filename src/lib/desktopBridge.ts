// Pont vers le processus principal Electron (electron/preload.cjs) — ne
// fait rien si absent, c'est-à-dire dans un navigateur ou sur le web.
// Centralise le type et l'accesseur partagés par les différents usages du
// pont (notifications système, emplacement des données locales...) plutôt
// que de les dupliquer dans chaque fichier consommateur.
export interface DesktopBridge {
  isDesktop: boolean;
  /** Native picker, then snapshot into the active cabinet inbox. No file path or credential crosses this bridge. */
  retryDriveTransfers?: () => Promise<{ retried: number }>;
  getDriveStatus?: () => Promise<{ state: string; pending: number; blocked: number; conflicts: number }>;
  enqueueDriveFile?: () => Promise<{ queued: boolean; jobId?: string }>;
  notify: (payload: { title: string; body?: string; url?: string }) => Promise<boolean>;
  setBadgeCount: (count: number) => Promise<boolean>;
  onNotificationClick: (callback: (url: string) => void) => () => void;
  /** Les dossiers résolus au premier lancement — voir electron/dataLocation.cjs. */
  getDataLocation: () => Promise<{ dbDataDir: string; storageDataDir: string }>;
  /** Ouvre l'un des deux dossiers dans l'explorateur de fichiers du système. */
  openDataFolder: (kind: 'db' | 'storage') => Promise<boolean>;
  /** Sélectionne un fichier du cabinet dans l'explorateur. La clé vient de
   *  GET /api/storage/local-file ; aucun chemin de disque ne passe par le renderer. */
  revealFile: (ref: LocalFileRef) => Promise<boolean>;
  /** Ouvre un fichier dans son application associée, sauf type pouvant lancer un programme. */
  openFile: (ref: LocalFileRef) => Promise<OpenFileResult>;
}

/** Clé de stockage d'un fichier du cabinet (jamais un chemin de disque). */
export interface LocalFileRef {
  bucket: string;
  path: string;
}

export type OpenFileResult = 'ok' | 'introuvable' | 'type_non_ouvrable' | 'echec';

export function desktopBridge(): DesktopBridge | null {
  const bridge = (window as any).archiofficeDesktop;
  return bridge?.isDesktop ? (bridge as DesktopBridge) : null;
}

export function isDesktopClient(): boolean {
  return desktopBridge() !== null;
}
