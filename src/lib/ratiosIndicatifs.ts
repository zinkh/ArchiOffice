// Ratios de coût des travaux (€ HT par m²) proposés à titre INDICATIF dans le formulaire d'une
// proposition. Ce sont des ordres de grandeur à ajuster selon le programme, le site et le niveau de
// prestation : la saisie manuelle reste toujours possible. Logique pure, testée dans
// `__tests__/ratiosIndicatifs.test.ts`.

export type RatioKind = 'neuf' | 'rehabilitation' | 'extension';

export interface RatioIndicatif {
  id: string;
  kind: RatioKind;
  label: string;
  /** €/m² HT, ordre de grandeur. */
  value: number;
}

export const RATIOS_INDICATIFS: RatioIndicatif[] = [
  { id: 'neuf_maison', kind: 'neuf', label: 'Maison individuelle', value: 1800 },
  { id: 'neuf_logement', kind: 'neuf', label: 'Logement collectif', value: 1900 },
  { id: 'neuf_tertiaire', kind: 'neuf', label: 'Bureaux, tertiaire', value: 2200 },
  { id: 'neuf_erp', kind: 'neuf', label: 'ERP, commerce', value: 2400 },
  { id: 'neuf_equipement', kind: 'neuf', label: 'Équipement public, scolaire', value: 2800 },
  { id: 'rehab_legere', kind: 'rehabilitation', label: 'Rénovation légère (second œuvre)', value: 600 },
  { id: 'rehab_energetique', kind: 'rehabilitation', label: 'Rénovation énergétique', value: 900 },
  { id: 'rehab_lourde', kind: 'rehabilitation', label: 'Rénovation lourde', value: 1300 },
  { id: 'rehab_restructuration', kind: 'rehabilitation', label: 'Restructuration complète', value: 1800 },
  { id: 'ext_simple', kind: 'extension', label: 'Extension simple', value: 1780 },
  { id: 'ext_soignee', kind: 'extension', label: 'Extension soignée (grandes ouvertures, finitions)', value: 2200 },
  { id: 'ext_surelevation', kind: 'extension', label: 'Surélévation', value: 2400 },
];

export const RATIO_MANUEL = 'manuel';

/** Ratios proposés pour un champ. */
export function ratiosPour(kind: RatioKind): RatioIndicatif[] {
  return RATIOS_INDICATIFS.filter(r => r.kind === kind);
}

/** Identifiant du ratio indicatif dont la valeur est exactement celle saisie, sinon la saisie manuelle. */
export function ratioCorrespondant(kind: RatioKind, value: number | null | undefined): string {
  const found = ratiosPour(kind).find(r => r.value === Number(value));
  return found ? found.id : RATIO_MANUEL;
}

/**
 * Texte imprimé sous le montant des travaux : « ratio appliqué » de chaque surface, puis le
 * commentaire libre de la personne. Une valeur à 0 n'est pas citée ; rien d'appliqué : chaîne vide.
 */
export function libelleRatios(
  p: { nature: 'neuf' | 'rehabilitation'; ratioRehab: number; ratioExtension: number; commentaire?: string | null },
  fmt: (n: number) => string = n => String(n),
): string {
  const parts: string[] = [];
  if (p.nature === 'neuf') {
    if (p.ratioExtension > 0) parts.push(`construction neuve ${fmt(p.ratioExtension)} €/m²`);
  } else {
    if (p.ratioRehab > 0) parts.push(`réhabilitation ${fmt(p.ratioRehab)} €/m²`);
    if (p.ratioExtension > 0) parts.push(`extension ${fmt(p.ratioExtension)} €/m²`);
  }
  if (parts.length === 0) return '';
  const comment = (p.commentaire ?? '').trim();
  return `Ratio appliqué : ${parts.join(', ')}${comment ? `. ${comment}` : ''}`;
}
