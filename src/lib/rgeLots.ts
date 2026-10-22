// Lots qui exigent d'ordinaire une entreprise RGE (aides à la rénovation
// énergétique) : isolation et chauffage. Valeur de DÉPART à la création d'un
// lot (modèle de projet, ajout dans la liste), toujours modifiable par la case
// « RGE exigé » ; un lot existant n'est jamais requalifié.
const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function rgeExigeParDefaut(titre: string | null | undefined): boolean {
  const t = strip(titre ?? '');
  // Une isolation phonique ou acoustique n'ouvre pas droit aux aides énergétiques.
  if (/phonique|acoustique/.test(t)) return false;
  return /isolation|chauffage/.test(t);
}
