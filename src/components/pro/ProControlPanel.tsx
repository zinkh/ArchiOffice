import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconX, IconAlertTriangle, IconCircleX, IconChevronRight } from '@tabler/icons-react';
import { validateProDocument, type ProIssue } from '../../lib/proValidation';
import { trouvaillePourId } from '../../lib/proRecherche';
import type { DPGF } from '../../types/dpgf';

interface ProControlPanelProps {
  dpgf: DPGF;
  onClose: () => void;
  /** Ouvre l'article dans l'atelier (le plus proche : CCTP, DPGF ou estimation affiché, sinon CCTP). */
  onGoTo: (articleId: string) => void;
  /** Article actuellement montré, pour le repérer dans la liste. */
  activeId?: string | null;
}

interface GroupeArticle { id: string; numero: string; libelle: string; issues: ProIssue[] }
interface GroupeLot { cle: string; titre: string; articles: GroupeArticle[]; erreurs: number; avertissements: number }

/** Libellé court d'une anomalie : celui du code, sinon la fin du message sans le préfixe de l'article. */
const finDeMessage = (m: string) => (m.includes(' : ') ? m.split(' : ').slice(1).join(' : ') : m);

/**
 * Volet latéral du rapport de contrôle : les anomalies classées par lot puis par
 * article, recalculées à chaque modification du document (une anomalie corrigée
 * disparaît). Non bloquant : l'atelier reste utilisable à côté.
 */
export const ProControlPanel: React.FC<ProControlPanelProps> = ({ dpgf, onClose, onGoTo, activeId }) => {
  const { t } = useTranslation();
  const [erreursSeulement, setErreursSeulement] = useState(false);

  const issues = useMemo(() => validateProDocument(dpgf), [dpgf]);
  const erreurs = issues.filter(i => i.severity === 'error').length;
  const avertissements = issues.length - erreurs;

  const groupes = useMemo<GroupeLot[]>(() => {
    const visibles = erreursSeulement ? issues.filter(i => i.severity === 'error') : issues;
    const parLot = new Map<string, GroupeLot>();
    const lotsOrdre = new Map(dpgf.lots.map((l, i) => [l.id, i]));
    const document: GroupeLot = { cle: '__document', titre: t('pro_control_document'), articles: [], erreurs: 0, avertissements: 0 };

    for (const issue of visibles) {
      const cible = issue.articleId ? trouvaillePourId(dpgf, issue.articleId) : null;
      const lot = cible ? dpgf.lots[cible.lotIdx] : null;
      let groupe = document;
      if (lot) {
        const existant = parLot.get(lot.id);
        groupe = existant ?? { cle: lot.id, titre: `${lot.numero} ${lot.titre}`.trim(), articles: [], erreurs: 0, avertissements: 0 };
        if (!existant) parLot.set(lot.id, groupe);
      }
      if (issue.severity === 'error') groupe.erreurs++; else groupe.avertissements++;
      const idArticle = cible?.id ?? `__${issue.code}`;
      let article = groupe.articles.find(a => a.id === idArticle);
      if (!article) {
        article = { id: idArticle, numero: cible?.numero ?? '', libelle: cible?.libelle ?? '', issues: [] };
        groupe.articles.push(article);
      }
      article.issues.push(issue);
    }
    const lots = [...parLot.values()].sort((a, b) => (lotsOrdre.get(a.cle) ?? 0) - (lotsOrdre.get(b.cle) ?? 0));
    return document.articles.length ? [...lots, document] : lots;
  }, [issues, erreursSeulement, dpgf, t]);

  return (
    <aside
      aria-label={t('pro_control_title')}
      className="fixed inset-y-0 right-0 z-40 w-full sm:w-[26rem] max-w-full flex flex-col border-l shadow-2xl bg-white dark:bg-zinc-900"
      style={{ borderColor: 'var(--tblr-border)' }}
    >
      <div className="flex items-start justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--tblr-border)' }}>
        <div className="min-w-0">
          <h3 className="font-semibold">{t('pro_control_title')}</h3>
          <p className="text-xs mt-0.5 flex flex-wrap gap-x-3">
            <span className="inline-flex items-center gap-1 text-red-600"><IconCircleX size={14} aria-hidden />{t('pro_control_errors', { count: erreurs })}</span>
            <span className="inline-flex items-center gap-1 text-amber-600"><IconAlertTriangle size={14} aria-hidden />{t('pro_control_warnings', { count: avertissements })}</span>
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label={t('pro_control_close')} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
          <IconX size={18} />
        </button>
      </div>

      <div className="px-4 py-2 border-b text-xs text-zinc-500 space-y-2" style={{ borderColor: 'var(--tblr-border)' }}>
        <p>{t('pro_control_hint')}</p>
        <div role="group" className="inline-flex rounded-md border overflow-hidden" style={{ borderColor: 'var(--tblr-border)' }}>
          {([false, true] as const).map(seulement => (
            <button
              key={String(seulement)}
              type="button"
              aria-pressed={erreursSeulement === seulement}
              onClick={() => setErreursSeulement(seulement)}
              className={`px-2.5 py-1 ${erreursSeulement === seulement ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
            >
              {t(seulement ? 'pro_control_filter_errors' : 'pro_control_filter_all')}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {groupes.length === 0 && (
          <p className="p-4 text-sm text-zinc-500">{t('pro_control_all_fixed')}</p>
        )}
        {groupes.map(lot => (
          <section key={lot.cle} aria-label={lot.titre}>
            <h4 className="sticky top-0 z-10 flex items-center justify-between gap-2 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide border-b bg-zinc-100 dark:bg-zinc-800" style={{ borderColor: 'var(--tblr-border)' }}>
              <span className="truncate">{lot.titre}</span>
              <span className="shrink-0 font-normal normal-case flex gap-2">
                {lot.erreurs > 0 && <span className="text-red-600">{lot.erreurs}</span>}
                {lot.avertissements > 0 && <span className="text-amber-600">{lot.avertissements}</span>}
              </span>
            </h4>
            <ul className="divide-y" style={{ borderColor: 'var(--tblr-border)' }}>
              {lot.articles.map(article => {
                const navigable = !article.id.startsWith('__');
                const contenu = (
                  <>
                    <span className="block min-w-0 flex-1">
                      <span className="block text-sm font-medium truncate">
                        {navigable ? `${article.numero || '—'} ${article.libelle || '(sans désignation)'}` : t('pro_control_document')}
                      </span>
                      <span className="block mt-0.5 space-y-0.5">
                        {article.issues.map((issue, i) => (
                          <span key={i} className="flex items-start gap-1.5 text-xs">
                            {issue.severity === 'error'
                              ? <IconCircleX size={13} className="mt-0.5 shrink-0 text-red-600" aria-label="Erreur" />
                              : <IconAlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600" aria-label="Avertissement" />}
                            <span>{t(`pro_control_code_${issue.code}`, { defaultValue: finDeMessage(issue.message) })}</span>
                          </span>
                        ))}
                      </span>
                    </span>
                    {navigable && <IconChevronRight size={16} className="shrink-0 text-zinc-400" aria-hidden />}
                  </>
                );
                return (
                  <li key={article.id}>
                    {navigable ? (
                      <button
                        type="button"
                        onClick={() => onGoTo(article.id)}
                        aria-current={activeId === article.id ? 'true' : undefined}
                        className={`w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 ${activeId === article.id ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`}
                      >
                        {contenu}
                      </button>
                    ) : (
                      <div className="flex items-center gap-2 px-4 py-2">{contenu}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
};
