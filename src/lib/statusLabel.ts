import i18n from '../i18n';
// Libellé affiché pour un statut de workflow stocké en base — plusieurs
// ressources historiques (devis, appels d'offres, projets, factures) stockent
// encore leur statut en anglais ("Draft", "In Progress", "Accepted"...),
// affiché jusqu'ici tel quel à l'écran à côté de libellés déjà en français
// ailleurs sur la même page ("Brouillon", "Signé"). On NE renomme PAS la
// valeur stockée (risque de casser les données/filtres existants) : ce
// helper ne fait que choisir le libellé FR à l'affichage, quelle que soit
// la casse d'origine ("Draft", "DRAFT", "draft").
const STATUS_LABELS_FR: Record<string, string> = {
  draft: 'Brouillon',
  sent: 'Envoyé',
  accepted: 'Accepté',
  rejected: 'Refusé',
  planning: 'Planification',
  'in progress': 'En cours',
  completed: 'Terminé',
  'on hold': 'En pause',
  paid: 'Payée',
  overdue: 'En retard',
  submitted: 'Soumis',
  won: 'Gagné',
  lost: 'Perdu',
};

const STATUS_LABELS_EN: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  rejected: 'Rejected',
  planning: 'Planning',
  'in progress': 'In progress',
  completed: 'Completed',
  'on hold': 'On hold',
  paid: 'Paid',
  overdue: 'Overdue',
  submitted: 'Submitted',
  won: 'Won',
  lost: 'Lost',
};

export function statusLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const labels = i18n.language?.startsWith('en') ? STATUS_LABELS_EN : STATUS_LABELS_FR;
  return labels[value.toLowerCase()] || value;
}
