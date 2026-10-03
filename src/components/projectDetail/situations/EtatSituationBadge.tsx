import { useTranslation } from 'react-i18next';
import { cn } from '../../../lib/utils';

// Valeurs stockées inchangées (Brouillon, Validée, Payée) : seul l'affichage
// dit ce qu'elles veulent dire pour l'architecte.
const ETATS: Record<string, { cle: string; classe: string }> = {
  Brouillon: { cle: 'situations_travaux_state_received', classe: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  Validée: { cle: 'situations_travaux_state_certified', classe: 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200' },
  Payée: { cle: 'situations_travaux_state_paid', classe: 'bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
};

export function EtatSituationBadge({ etat }: { etat: string }) {
  const { t } = useTranslation();
  const e = ETATS[etat] ?? ETATS.Brouillon;
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[0.6875rem] font-bold whitespace-nowrap', e.classe)}>
      {t(e.cle)}
    </span>
  );
}
