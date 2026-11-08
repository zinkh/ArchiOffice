// Date, heure et auteur de la dernière modification d'un lot, d'un chapitre ou d'un article du CCTP.
// Les champs `modifieLe` / `modifiePar` sont posés par le serveur à l'enregistrement (src/lib/modifications.ts) ;
// un élément jamais modifié depuis la mise en place n'en porte pas et n'affiche rien.
//  - `compact` : l'heure (ou le jour) à droite d'une ligne de l'arbre, la phrase complète en infobulle ;
//  - sinon : la phrase complète, sous le titre de l'élément sélectionné.
import { useTranslation } from 'react-i18next';
import { IconClockEdit } from '@tabler/icons-react';
import type { ModifiableNoeud } from '../../types/dpgf';

export function IndicateurModification({ noeud, compact = false }: { noeud?: ModifiableNoeud | null; compact?: boolean }) {
  const { t, i18n } = useTranslation();
  if (!noeud?.modifieLe) return null;
  const quand = new Date(noeud.modifieLe);
  if (Number.isNaN(quand.getTime())) return null;

  const langue = i18n?.language;
  const auteur = noeud.modifiePar?.trim();
  const date = quand.toLocaleDateString(langue, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const heure = quand.toLocaleTimeString(langue, { hour: '2-digit', minute: '2-digit' });
  const phrase = auteur
    ? t('pro_modifie_complet', { date, heure, auteur })
    : t('pro_modifie_sans_auteur', { date, heure });

  if (compact) {
    // Aujourd'hui : l'heure seule ; sinon le jour et le mois. La phrase complète est dans l'infobulle.
    const aujourdhui = quand.toDateString() === new Date().toDateString();
    const court = aujourdhui ? heure : quand.toLocaleDateString(langue, { day: '2-digit', month: '2-digit' });
    return (
      <span
        title={phrase}
        aria-label={phrase}
        className="hidden lg:inline shrink-0 ml-1 text-[0.6875rem] tabular-nums text-zinc-400 dark:text-zinc-500 font-normal not-italic"
      >
        {court}
      </span>
    );
  }

  return (
    <p className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400" data-testid="indicateur-modification">
      <IconClockEdit size={14} aria-hidden className="shrink-0" />
      <span>{phrase}</span>
    </p>
  );
}
