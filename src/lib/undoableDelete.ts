// Suppression différée, annulable : l'élément disparaît tout de suite de
// l'écran, la requête DELETE ne part qu'à la fin du délai d'annulation.
//
// Une suppression confirmée par une boîte du navigateur était définitive
// d'un clic de travers : une note d'honoraires, un avenant ou un OS
// disparaissait sans retour possible. Ici, « Annuler » remet l'élément à sa
// place sans qu'aucune requête soit partie.
//
// Une seule suppression est en attente à la fois : en lancer une seconde
// valide d'abord la première (le message « Annuler » ne peut en désigner
// qu'une). `flush()` valide sans attendre : à la fermeture de la page ou au
// démontage de l'écran, une suppression demandée n'est jamais perdue.

export interface PendingDelete {
  /** Envoie la suppression au serveur ; rend faux (ou lève) en cas d'échec. */
  commit: () => Promise<boolean>;
  /** Remet l'élément dans la liste affichée. */
  restore: () => void;
  /** Appelé quand le serveur refuse la suppression, après `restore()`. */
  onFailure?: () => void;
}

export const UNDO_DELETE_DELAY_MS = 6000;

export class UndoableDeleteQueue {
  private pending: PendingDelete | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly delayMs: number = UNDO_DELETE_DELAY_MS) {}

  get hasPending(): boolean {
    return this.pending !== null;
  }

  /** Programme une suppression ; une suppression déjà en attente part tout de suite. */
  schedule(item: PendingDelete): void {
    void this.flush();
    this.pending = item;
    this.timer = setTimeout(() => { void this.flush(); }, this.delayMs);
  }

  /** Annule la suppression en attente et remet l'élément. Rend vrai s'il y en avait une. */
  undo(): boolean {
    const item = this.take();
    if (!item) return false;
    item.restore();
    return true;
  }

  /** Envoie tout de suite la suppression en attente. */
  async flush(): Promise<void> {
    const item = this.take();
    if (!item) return;
    let ok = false;
    try {
      ok = await item.commit();
    } catch {
      ok = false;
    }
    if (!ok) {
      item.restore();
      item.onFailure?.();
    }
  }

  private take(): PendingDelete | null {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const item = this.pending;
    this.pending = null;
    return item;
  }
}
