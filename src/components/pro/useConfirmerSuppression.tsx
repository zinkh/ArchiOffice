import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirmDialog } from '../ui/ConfirmDialog';
import { liensRompus, resumeSuppression } from './selectionOps';
import type { LotLike } from './treeOps';

/**
 * Validation avant suppression dans les vues du PRO (CCTP, DPGF, BPU/DQE,
 * estimation). La fenêtre dit ce qui part avec la sélection : un chapitre
 * emporte ses articles, un article ses sous-articles. Le focus démarre sur
 * « Annuler ». À monter une fois par atelier : `{dialog}` dans le rendu.
 */
export function useConfirmerSuppression() {
  const { t } = useTranslation();
  const { confirm, dialog } = useConfirmDialog();

  /** `keys` : clés positionnelles des éléments sélectionnés (voir treeOps.rowKey). */
  const confirmerSuppression = useCallback((lots: LotLike[], keys: string[]): Promise<boolean> => {
    const r = resumeSuppression(lots, keys);
    const parts = [
      r.lots ? t('pro_confirm_delete_lots', { count: r.lots }) : '',
      r.chapitres ? t('pro_confirm_delete_chapters', { count: r.chapitres }) : '',
      r.articles ? t('pro_confirm_delete_articles', { count: r.articles }) : '',
    ].filter(Boolean);
    const detail = parts.length ? t('pro_confirm_delete_message', { detail: parts.join(', ') }) : undefined;
    // Des articles qui suivaient la quantité de ce qu'on supprime la garderont, figée : la fenêtre le dit d'abord.
    const suiveurs = liensRompus(lots, keys).flatMap(r => r.suiveurs);
    const liste = suiveurs.slice(0, 5).map(l => `${l.numero} ${l.designation}`.trim()).join(', ')
      + (suiveurs.length > 5 ? t('pro_confirm_delete_links_more', { count: suiveurs.length - 5 }) : '');
    const message = suiveurs.length
      ? (
        <>
          {detail && <p>{detail}</p>}
          <p className={detail ? 'mt-2' : undefined}>{t('pro_confirm_delete_links', { count: suiveurs.length, liste })}</p>
        </>
      )
      : detail;
    return confirm({
      title: t('pro_confirm_delete_title', { count: keys.length }),
      message,
      confirmLabel: t('pro_delete'),
      cancelLabel: t('pro_undo'),
      tone: 'danger',
    });
  }, [confirm, t]);

  return { confirmerSuppression, dialog };
}
