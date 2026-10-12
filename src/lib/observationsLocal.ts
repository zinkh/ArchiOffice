/**
 * Liste locale des observations : ajouts, suppressions et relectures du serveur
 * peuvent se croiser (une relecture lancée avant une suppression revient après
 * elle). Fonctions pures pour garder la liste affichée cohérente.
 */

/** Remplace la ligne de même identifiant, sinon l'ajoute : une création n'apparaît jamais deux fois. */
export function upsertById<T extends { id: string }>(list: T[], row: T): T[] {
  const i = list.findIndex(r => r.id === row.id);
  if (i < 0) return [...list, row];
  const next = [...list];
  next[i] = { ...next[i], ...row };
  return next;
}

/**
 * Applique une relecture du serveur à la liste affichée : les lignes supprimées
 * ici (`supprimes`) ne reviennent pas, les lignes créées ici mais pas encore
 * connues du serveur (`creees`) ne disparaissent pas, et un identifiant n'est
 * jamais présent deux fois.
 */
export function reconcileRemote<T extends { id: string }>(
  remote: T[], local: T[], supprimes: ReadonlySet<string>, creees: ReadonlySet<string>,
): T[] {
  const vus = new Set<string>();
  const out: T[] = [];
  for (const r of remote) {
    if (supprimes.has(r.id) || vus.has(r.id)) continue;
    vus.add(r.id);
    out.push(r);
  }
  for (const l of local) {
    if (creees.has(l.id) && !supprimes.has(l.id) && !vus.has(l.id)) { vus.add(l.id); out.push(l); }
  }
  return out;
}
