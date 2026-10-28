// Ordre d'affichage des plans d'une affaire. Logique pure, testée sans navigateur.

export interface PlanOrdonnable {
  id: string;
  uploaded_at: string;
  sort_order?: number | null;
}

const temps = (p: PlanOrdonnable) => {
  const t = new Date(p.uploaded_at).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/**
 * Plans jamais rangés d'abord (le plus récent en tête, comme avant l'ordre manuel),
 * puis les plans rangés à la main selon leur rang. Un plan déposé après un réordonnancement
 * apparaît donc en haut de la liste, où on le cherche.
 */
export function trierPlans<T extends PlanOrdonnable>(plans: T[]): T[] {
  return [...plans].sort((a, b) => {
    const ra = a.sort_order ?? null;
    const rb = b.sort_order ?? null;
    if (ra === null && rb === null) return temps(b) - temps(a);
    if (ra === null) return -1;
    if (rb === null) return 1;
    return ra - rb || temps(b) - temps(a);
  });
}

/** Ordre obtenu en plaçant `id` au rang `vers` (0 = premier) parmi `ids`. */
export function deplacer(ids: string[], id: string, vers: number): string[] {
  const de = ids.indexOf(id);
  if (de === -1) return ids;
  const rang = Math.max(0, Math.min(vers, ids.length - 1));
  if (rang === de) return ids;
  const suite = [...ids];
  suite.splice(de, 1);
  suite.splice(rang, 0, id);
  return suite;
}

/** Applique un ordre complet aux plans : chacun reçoit son rang, les autres plans sont laissés tels quels. */
export function appliquerOrdre<T extends PlanOrdonnable>(plans: T[], ids: string[]): T[] {
  const rang = new Map(ids.map((id, i) => [id, i]));
  return plans.map(p => (rang.has(p.id) ? { ...p, sort_order: rang.get(p.id)! } : p));
}
