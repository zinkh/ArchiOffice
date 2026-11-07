import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirmDialog } from '../ui/ConfirmDialog';
import { liensRompus, resumeSuppression, suiveursEnCascade } from './selectionOps';
import type { LotLike } from './treeOps';

/**
 * Validation avant suppression dans les vues du PRO (CCTP, DPGF, BPU/DQE,
 * estimation). La fenêtre dit ce qui part avec la sélection : un chapitre
 * emporte ses articles, un article ses sous-articles. Le focus démarre sur
 * « Annuler ». À monter une fois par atelier : `{dialog}` dans le rendu.
 */
export function useConfirmerSuppression() {
  const { t } = useTranslation();
  const { confirm, choose, dialog } = useConfirmDialog();

  /** Ce que la fenêtre dit : ce qui part avec la sélection, et les articles dont la quantité suivait ce qui part. */
  const decrire = useCallback((lots: LotLike[], keys: string[]) => {
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
    return { message, aDesSuiveurs: suiveurs.length > 0 };
  }, [t]);

  /** `keys` : clés positionnelles des éléments sélectionnés (voir treeOps.rowKey). */
  const confirmerSuppression = useCallback((lots: LotLike[], keys: string[]): Promise<boolean> => {
    return confirm({
      title: t('pro_confirm_delete_title', { count: keys.length }),
      message: decrire(lots, keys).message,
      confirmLabel: t('pro_delete'),
      cancelLabel: t('pro_undo'),
      tone: 'danger',
    });
  }, [confirm, decrire, t]);

  /**
   * Comme `confirmerSuppression`, mais quand des articles suivent la quantité de ce qu'on supprime, la fenêtre
   * propose aussi de les supprimer avec lui (et ceux qui les suivent, jusqu'au bout de la chaîne). Rend les clés à
   * supprimer : celles reçues, plus celles des suiveurs si c'est le choix fait ; `null` si on renonce. Sans
   * suiveur, c'est la fenêtre habituelle.
   */
  const confirmerSuppressionAvecLiens = useCallback(async (lots: LotLike[], keys: string[]): Promise<string[] | null> => {
    const { message, aDesSuiveurs } = decrire(lots, keys);
    const base = [...keys];
    if (!aDesSuiveurs) {
      const ok = await confirm({
        title: t('pro_confirm_delete_title', { count: base.length }), message,
        confirmLabel: t('pro_delete'), cancelLabel: t('pro_undo'), tone: 'danger',
      });
      return ok ? base : null;
    }
    const { cles, lignes } = suiveursEnCascade(lots, base);
    const choix = await choose({
      title: t('pro_confirm_delete_title', { count: base.length }),
      message,
      confirmLabel: t('pro_delete_and_freeze'),
      alternatives: cles.length ? [{ id: 'avec_suiveurs', label: t('pro_delete_with_followers', { count: lignes.length }) }] : [],
      cancelLabel: t('pro_undo'),
      tone: 'danger',
    });
    if (choix === 'confirm') return base;
    if (choix === 'avec_suiveurs') return [...base, ...cles];
    return null;
  }, [choose, confirm, decrire, t]);

  return { confirmerSuppression, confirmerSuppressionAvecLiens, dialog };
}
