/**
 * Chapitres créés d'office dans chaque lot d'un CCTP / DPGF. Les deux premiers
 * portent le texte du CCTP seul : ils sont masqués du DPGF (`cctpOnly`) tant que
 * la case « Visible dans le DPGF » n'est pas cochée dans l'éditeur du CCTP.
 * Les chapitres sont numérotés « 1 », « 2 », « 3 » dans chaque lot, jamais
 * préfixés par le numéro du lot.
 */
export const CHAPITRES_PAR_DEFAUT: readonly { titre: string; cctpOnly: boolean }[] = [
  { titre: 'PRESCRIPTIONS GENERALES', cctpOnly: true },
  { titre: 'PRESCRIPTIONS TECHNIQUES', cctpOnly: true },
  { titre: 'DESCRIPTION DES OUVRAGES', cctpOnly: false },
];

/** Numéro d'un chapitre au rang `index` (0-based) de son lot : « 1 », « 2 »... */
export const numeroDeChapitre = (index: number): string => String(index + 1);

export function chapitresParDefaut(newId: () => string) {
  return CHAPITRES_PAR_DEFAUT.map((c, i) => ({
    id: newId(),
    numero: numeroDeChapitre(i),
    titre: c.titre,
    lignes: [] as any[],
    cctpOnly: c.cctpOnly,
    cctpDescription: '',
  }));
}
