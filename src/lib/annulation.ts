// ── Annulation d'un export en cours ──────────────────────────────────────────
// Les exports (PDF, Word, Excel, ZIP) sont longs : lecture des plans, des photos,
// un fichier par lot. On ne peut pas interrompre un fichier déjà en cours de
// fabrication, mais l'export s'arrête au prochain point de contrôle (entre deux
// fichiers, deux fiches, deux plans) et rien n'est livré.

export class ExportAnnule extends Error {
  constructor() {
    super('Export annulé');
    this.name = 'ExportAnnule';
  }
}

/** Interrompt l'export si l'annulation a été demandée. */
export function verifierAnnulation(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ExportAnnule();
}

export const estAnnulation = (e: unknown): boolean => e instanceof ExportAnnule || (e as Error | undefined)?.name === 'AbortError';
