import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirmDialog } from '../ui/ConfirmDialog';
import type { LiensDeCopie, ModeLiens } from '../../lib/quantitesLiees';

/**
 * Alerte avant de copier, coller ou dupliquer des articles dont la quantité en suit une autre : que deviennent
 * ces liens dans les copies ? Sans lien à signaler, aucune fenêtre. À monter une fois par atelier : `{dialog}`
 * dans le rendu.
 *
 * Les choix dépendent de ce qui est copié : liens entre copies seulement (les copies se suivent entre elles ou
 * deviennent indépendantes), liens vers des articles restés en place seulement (la copie les suit toujours ou
 * devient indépendante), ou les deux (trois choix, dont « conserver entre copies seulement »).
 */
export function useChoisirLiensCopie() {
  const { t } = useTranslation();
  const { choose, dialog } = useConfirmDialog();

  /** Rend le mode à appliquer aux liens, `'tout'` quand il n'y a rien à signaler, ou `null` si on renonce à copier. */
  const choisirLiens = useCallback(async (liens: LiensDeCopie): Promise<ModeLiens | null> => {
    if (!liens.suiveurs.length) return 'tout';
    const total = liens.suiveurs.length;
    const liste = liens.suiveurs.slice(0, 5).map(l => `${l.numero} ${l.designation}`.trim()).join(', ')
      + (total > 5 ? t('pro_confirm_delete_links_more', { count: total - 5 }) : '');
    const mixte = liens.internes > 0 && liens.externes > 0;
    const explication = mixte
      ? t('pro_copy_links_mixed', { internes: liens.internes, externes: liens.externes })
      : liens.internes > 0 ? t('pro_copy_links_internal') : t('pro_copy_links_external');
    const confirmLabel = mixte ? t('pro_copy_links_keep_all') : liens.internes > 0 ? t('pro_copy_links_keep') : t('pro_copy_links_keep_origin');
    const alternatives = mixte
      ? [{ id: 'internes', label: t('pro_copy_links_keep_internal') }, { id: 'rompre', label: t('pro_copy_links_break_all') }]
      : [{ id: 'rompre', label: t('pro_copy_links_break_all') }];
    const choix = await choose({
      title: t('pro_copy_links_title', { count: total }),
      message: (
        <>
          <p>{liste}.</p>
          <p className="mt-2">{explication}</p>
        </>
      ),
      confirmLabel,
      alternatives,
      cancelLabel: t('pro_undo'),
      tone: 'primary',
    });
    return choix === 'confirm' ? 'tout' : choix === 'internes' ? 'internes' : choix === 'rompre' ? 'rompre' : null;
  }, [choose, t]);

  return { choisirLiens, dialog };
}
