// ── Exporter des postes du CCTP vers la bibliothèque ─────────────────────────
// Rien à saisir : la fenêtre liste ce qui va partir, repris du CCTP (voir
// cctpExportOps). Un article devient un OUVRAGE, un lot ou un chapitre une
// CLAUSE dont le texte réunit le sien et celui de ses sous-éléments. L'architecte
// décoche ce qu'il ne veut pas, relit au besoin (aperçu en lecture seule) et
// valide. Un élément déjà exporté ou sans texte est décoché d'office. Chaque
// élément est envoyé seul : un titre de clause déjà pris est signalé sans
// empêcher les autres. Rien n'est modifié dans le CCTP : l'export copie.
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconCheck, IconAlertTriangle, IconLoader2 } from '@tabler/icons-react';
import { ModalShell } from '../ui/ModalShell';
import { apiFetch } from '../../lib/api';
import { corpsExport } from '../../lib/bibliothequeClauses';
import { estVide, inclusParDefaut, type ElementExport, type TypeExport } from './cctpExportOps';
import type { ArticleBibliotheque } from '../../types/library';

export interface ResultatExport {
  /** Éléments créés dans la bibliothèque, avec l'article ou la clause obtenu. */
  crees: { cle: string; type: TypeExport; id: string; titre: string }[];
  /** Titres de clause déjà présents : rien n'a été créé. */
  existants: string[];
  erreurs: { titre: string; message: string }[];
}

interface Props {
  /** Les éléments à exporter, avec ou sans le contenu de leurs sous-éléments. */
  construire: (avecSousElements: boolean) => ElementExport[];
  onClose: () => void;
  /** Appelé une fois l'envoi terminé, pour relier les ouvrages exportés à leur article. */
  onDone: (resultat: ResultatExport) => void;
}

type EtatLigne = 'cree' | 'existe' | 'erreur';

const longueur = (n: number) => (n < 1000 ? String(n) : `${(n / 1000).toFixed(1).replace('.', ',')}k`);
const intituleAffiche = (e: ElementExport) => [e.numero, e.titre].filter(Boolean).join(' · ');

const ResultatLigne: React.FC<{ etat: EtatLigne; message?: string }> = ({ etat, message }) => {
  const { t } = useTranslation();
  if (etat === 'cree') {
    return <span className="inline-flex items-center gap-1 text-xs text-green-700" role="status"><IconCheck size={14} aria-hidden />{t('pro_cctp_export_created')}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-amber-700" role="status" title={message}>
      <IconAlertTriangle size={14} aria-hidden />{etat === 'existe' ? t('pro_cctp_export_exists') : t('pro_cctp_export_failed')}
    </span>
  );
};

export const CctpExportLibraryDialog: React.FC<Props> = ({ construire, onClose, onDone }) => {
  const { t } = useTranslation();
  const [avecSous, setAvecSous] = useState(true);
  // Choix explicites de l'architecte ; sans choix, la valeur par défaut de l'élément.
  const [choix, setChoix] = useState<Record<string, boolean>>({});
  const [types, setTypes] = useState<Record<string, TypeExport>>({});
  const [envoi, setEnvoi] = useState(false);
  const [etats, setEtats] = useState<Record<string, { etat: EtatLigne; message?: string }>>({});
  const [termine, setTermine] = useState(false);

  const elements = useMemo(() => construire(avecSous), [construire, avecSous]);
  const typeDe = (e: ElementExport): TypeExport => types[e.cle] ?? e.type;
  const inclus = (e: ElementExport): boolean => choix[e.cle] ?? inclusParDefaut(e, typeDe(e));
  const aExporter = elements.filter(e => inclus(e) && !estVide(e, typeDe(e)));

  const exporter = async () => {
    if (!aExporter.length || envoi) return;
    setEnvoi(true);
    const resultat: ResultatExport = { crees: [], existants: [], erreurs: [] };
    const suivi: typeof etats = {};
    // Un par un : le serveur refuse un titre de clause déjà pris sans arrêter les autres.
    for (const e of aExporter) {
      const type = typeDe(e);
      try {
        const corps = corpsExport({ type, designation: e.titre, unite: e.unite, prix_unitaire: e.prix_unitaire, description: e.description });
        const article = await apiFetch<ArticleBibliotheque>('/api/price-library', { method: 'POST', body: JSON.stringify(corps) });
        resultat.crees.push({ cle: e.cle, type, id: article.id, titre: e.titre });
        suivi[e.cle] = { etat: 'cree' };
      } catch (err: any) {
        if (err?.status === 409) {
          resultat.existants.push(e.titre);
          suivi[e.cle] = { etat: 'existe', message: err.message };
        } else {
          resultat.erreurs.push({ titre: e.titre, message: err?.message || t('pro_cctp_export_library_error') });
          suivi[e.cle] = { etat: 'erreur', message: err?.message };
        }
      }
      setEtats({ ...suivi });
    }
    setEnvoi(false);
    setTermine(true);
    onDone(resultat);
  };

  return (
    <ModalShell
      title={t('pro_cctp_export_library')}
      subtitle={t('pro_cctp_export_library_hint')}
      onClose={onClose}
      busy={envoi}
      size="lg"
      footer={termine ? (
        <button type="button" className="btn btn-primary" onClick={onClose}>{t('pro_cctp_export_close')}</button>
      ) : (
        <>
          <button type="button" className="btn" onClick={onClose} disabled={envoi}>{t('cancel')}</button>
          <button type="button" className="btn btn-primary inline-flex items-center gap-2" onClick={exporter} disabled={!aExporter.length || envoi}>
            {envoi && <IconLoader2 size={14} className="animate-spin" aria-hidden />}
            {t('pro_cctp_export_library_confirm', { count: aExporter.length })}
          </button>
        </>
      )}
    >
      <div className="p-4 sm:p-6 space-y-4">
        {!termine && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={avecSous} onChange={e => setAvecSous(e.target.checked)} disabled={envoi} />
            <span>
              <span className="font-medium" style={{ color: 'var(--tblr-text)' }}>{t('pro_cctp_export_with_children')}</span>
              <span className="block text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('pro_cctp_export_with_children_hint')}</span>
            </span>
          </label>
        )}

        {elements.length === 0 && <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('pro_cctp_export_nothing')}</p>}

        <ul className="rounded-lg border divide-y" style={{ borderColor: 'var(--tblr-border)' }}>
          {elements.map(e => {
            const type = typeDe(e);
            const vide = estVide(e, type);
            const etat = etats[e.cle];
            return (
              <li key={e.cle} className="p-3 space-y-1.5" style={{ borderColor: 'var(--tblr-border)' }}>
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox" className="mt-1" aria-label={t('pro_cctp_select_row', { nom: e.titre })}
                    checked={inclus(e) && !vide} disabled={vide || envoi || termine}
                    onChange={ev => setChoix(c => ({ ...c, [e.cle]: ev.target.checked }))}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate" style={{ color: 'var(--tblr-text)' }}>{intituleAffiche(e)}</span>
                      <span className="text-[0.6875rem] uppercase font-bold tracking-wide" style={{ color: 'var(--tblr-muted)' }}>{t(`pro_cctp_export_kind_${e.kind}`)}</span>
                    </div>
                    <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>
                      {vide
                        ? t('pro_cctp_export_no_text')
                        : t('pro_cctp_export_size', { chars: longueur(e.description.length), chapitres: e.nbChapitres, articles: e.nbArticles })}
                      {e.dejaLie && ` · ${t('pro_cctp_export_already')}`}
                    </p>
                  </div>
                  {e.kind === 'article' && !termine && (
                    <select
                      value={type} disabled={envoi} aria-label={t('pro_cctp_export_library_as')}
                      onChange={ev => setTypes(m => ({ ...m, [e.cle]: ev.target.value as TypeExport }))}
                      className="px-2 py-1 rounded border text-xs"
                      style={{ background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
                    >
                      <option value="ouvrage">{t('pro_cctp_export_library_ouvrage')}</option>
                      <option value="clause">{t('pro_cctp_export_library_clause')}</option>
                    </select>
                  )}
                  {e.kind !== 'article' && !termine && (
                    <span className="text-xs px-2 py-1 rounded border" style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}>
                      {t('pro_cctp_export_library_clause')}
                    </span>
                  )}
                  {etat && <ResultatLigne etat={etat.etat} message={etat.message} />}
                </div>
                {!vide && (
                  <details className="text-xs">
                    <summary className="cursor-pointer" style={{ color: 'var(--tblr-muted)' }}>{t('pro_cctp_export_preview')}</summary>
                    <pre className="mt-1 p-2 rounded whitespace-pre-wrap max-h-48 overflow-y-auto" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)' }}>
                      {e.description.slice(0, 2000)}{e.description.length > 2000 ? '…' : ''}
                    </pre>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </ModalShell>
  );
};
