import { useTranslation } from 'react-i18next';
import type { NatureArticle } from '../../types/dpgf';

const CLASSE = 'shrink-0 text-[0.6875rem] font-semibold px-1.5 rounded border';
const STYLE = { borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' };
const REPERES = { pse: 'PSE', option: 'OPT', variante: 'VAR' } as const;

/** Repères « PSE », « OPT », « VAR » et « PM » d'un article, à côté de sa désignation. */
export function StatutBadges({ pourMemoire, nature }: { pourMemoire?: boolean; nature?: NatureArticle }) {
  const { t } = useTranslation();
  const hors = nature && nature !== 'base' ? nature : null;
  if (!pourMemoire && !hors) return null;
  return (
    <>
      {hors && <span title={t(`pro_badge_${hors}`)} className={CLASSE} style={STYLE}>{REPERES[hors]}</span>}
      {pourMemoire && <span title={t('pro_badge_pm')} className={CLASSE} style={STYLE}>PM</span>}
    </>
  );
}
