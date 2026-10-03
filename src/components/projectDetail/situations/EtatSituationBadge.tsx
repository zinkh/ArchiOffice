import { useTranslation } from 'react-i18next';

// Valeurs stockées inchangées (Brouillon, Validée, Payée) : seul l'affichage
// dit ce qu'elles veulent dire pour l'architecte.
// Couleurs d'état du système (--tblr-*), voile à 14 % : lisibles et justes
// dans les deux thèmes, sans classes Tailwind propres à un seul.
const ETATS: Record<string, { cle: string; couleur: string }> = {
  Brouillon: { cle: 'situations_travaux_state_received', couleur: 'var(--tblr-warning)' },
  Validée: { cle: 'situations_travaux_state_certified', couleur: 'var(--tblr-primary)' },
  Payée: { cle: 'situations_travaux_state_paid', couleur: 'var(--tblr-success)' },
};

export function EtatSituationBadge({ etat }: { etat: string }) {
  const { t } = useTranslation();
  const e = ETATS[etat] ?? ETATS.Brouillon;
  return (
    <span
      className="tblr-badge whitespace-nowrap"
      style={{ color: e.couleur, background: `color-mix(in srgb, ${e.couleur} 14%, transparent)` }}
    >
      {t(e.cle)}
    </span>
  );
}
