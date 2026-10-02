// Pont vers le processus principal Electron (electron/preload.cjs) — ne
// fait rien si absent, c'est-à-dire dans un navigateur ou sur le web.
// Centralise le type et l'accesseur partagés par les différents usages du
// pont (notifications système, emplacement des données locales...) plutôt
// que de les dupliquer dans chaque fichier consommateur.
export interface DesktopBridge {
  isDesktop: boolean;
  notify: (payload: { title: string; body?: string; url?: string }) => Promise<boolean>;
  setBadgeCount: (count: number) => Promise<boolean>;
  onNotificationClick: (callback: (url: string) => void) => () => void;
  /** Les dossiers résolus au premier lancement — voir electron/dataLocation.cjs. */
  getDataLocation: () => Promise<{ dbDataDir: string; storageDataDir: string }>;
  /** Ouvre l'un des deux dossiers dans l'explorateur de fichiers du système. */
  openDataFolder: (kind: 'db' | 'storage') => Promise<boolean>;
}

export function desktopBridge(): DesktopBridge | null {
  const bridge = (window as any).archiofficeDesktop;
  return bridge?.isDesktop ? (bridge as DesktopBridge) : null;
}

export function isDesktopClient(): boolean {
  return desktopBridge() !== null;
}
