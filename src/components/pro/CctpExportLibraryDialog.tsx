// ── Exporter un poste du CCTP vers la bibliothèque ───────────────────────────
// Un article devient un OUVRAGE de la bibliothèque (désignation, unité, prix,
// description technique) ; un lot ou un chapitre, qui porte surtout du texte
// (prescriptions générales...), devient plutôt une CLAUSE GÉNÉRALE. L'architecte
// peut choisir l'inverse pour un article. Rien n'est modifié dans le CCTP :
// l'export copie, il ne déplace pas.
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconLoader2 } from '@tabler/icons-react';
import { ModalShell } from '../ui/ModalShell';
import { apiFetch } from '../../lib/api';
import { corpsExport, type ExportBibliotheque } from '../../lib/bibliothequeClauses';
import type { ArticleBibliotheque } from '../../types/library';

interface Props {
  /** Valeurs de départ, reprises du poste sélectionné. */
  initial: ExportBibliotheque;
  /** Seul un article peut devenir un ouvrage (il porte unité et prix). */
  peutEtreOuvrage: boolean;
  onClose: () => void;
  onDone: (article: ArticleBibliotheque, type: ExportBibliotheque['type']) => void;
}

const CHAMP = 'w-full px-3 py-2 rounded-lg text-sm outline-none border focus:ring-2 focus:ring-[var(--tblr-primary)]';
const STYLE_CHAMP = { background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' };

export const CctpExportLibraryDialog: React.FC<Props> = ({ initial, peutEtreOuvrage, onClose, onDone }) => {
  const { t } = useTranslation();
  const [type, setType] = useState<ExportBibliotheque['type']>(peutEtreOuvrage ? initial.type : 'clause');
  const [designation, setDesignation] = useState(initial.designation);
  const [unite, setUnite] = useState(initial.unite ?? '');
  const [prix, setPrix] = useState(String(initial.prix_unitaire ?? 0));
  const [description, setDescription] = useState(initial.description ?? '');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  // Une clause est un texte : sans texte elle n'a pas de raison d'être.
  const valide = designation.trim().length > 0 && (type === 'ouvrage' || description.trim().length > 0);

  const exporter = async () => {
    if (!valide || envoi) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const corps = corpsExport({
        type, designation, unite, prix_unitaire: Number(prix.replace(',', '.')) || 0, description,
      });
      const article = await apiFetch<ArticleBibliotheque>('/api/price-library', { method: 'POST', body: JSON.stringify(corps) });
      onDone(article, type);
    } catch (e: any) {
      // 409 : une clause porte déjà ce titre, le serveur le dit en français.
      setErreur(e?.message || t('pro_cctp_export_library_error'));
      setEnvoi(false);
    }
  };

  return (
    <ModalShell
      title={t('pro_cctp_export_library')}
      subtitle={t('pro_cctp_export_library_hint')}
      onClose={onClose}
      busy={envoi}
      size="md"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={envoi}>{t('cancel')}</button>
          <button type="button" className="btn btn-primary inline-flex items-center gap-2" onClick={exporter} disabled={!valide || envoi}>
            {envoi && <IconLoader2 size={14} className="animate-spin" aria-hidden />}
            {t('pro_cctp_export_library_confirm')}
          </button>
        </>
      }
    >
      <div className="p-4 sm:p-6 space-y-4">
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('pro_cctp_export_library_as')}</legend>
          {([['ouvrage', 'pro_cctp_export_library_ouvrage', 'pro_cctp_export_library_ouvrage_hint'], ['clause', 'pro_cctp_export_library_clause', 'pro_cctp_export_library_clause_hint']] as const).map(([valeur, libelle, aide]) => (
            <label key={valeur} className={`flex items-start gap-2 text-sm ${valeur === 'ouvrage' && !peutEtreOuvrage ? 'opacity-50' : ''}`}>
              <input
                type="radio" name="export-type" className="mt-1" checked={type === valeur}
                disabled={valeur === 'ouvrage' && !peutEtreOuvrage}
                onChange={() => setType(valeur)}
              />
              <span>
                <span className="font-medium" style={{ color: 'var(--tblr-text)' }}>{t(libelle)}</span>
                <span className="block text-xs" style={{ color: 'var(--tblr-muted)' }}>{t(aide)}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <label className="block text-sm">
          <span className="block mb-1 font-medium" style={{ color: 'var(--tblr-text)' }}>{t('library_designation')}</span>
          <input type="text" value={designation} onChange={e => setDesignation(e.target.value)} className={CHAMP} style={STYLE_CHAMP} />
        </label>

        {type === 'ouvrage' && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="block mb-1 font-medium" style={{ color: 'var(--tblr-text)' }}>{t('library_unit')}</span>
              <input type="text" value={unite} onChange={e => setUnite(e.target.value)} placeholder={t('library_unit_placeholder')} className={CHAMP} style={STYLE_CHAMP} />
            </label>
            <label className="block text-sm">
              <span className="block mb-1 font-medium" style={{ color: 'var(--tblr-text)' }}>{t('library_unit_price')}</span>
              <input type="text" inputMode="decimal" value={prix} onChange={e => setPrix(e.target.value)} className={`${CHAMP} tabular-nums`} style={STYLE_CHAMP} />
            </label>
          </div>
        )}

        <label className="block text-sm">
          <span className="block mb-1 font-medium" style={{ color: 'var(--tblr-text)' }}>
            {type === 'clause' ? t('library_clause_text') : t('library_description')}
          </span>
          <textarea rows={8} value={description} onChange={e => setDescription(e.target.value)} className={`${CHAMP} resize-y leading-relaxed`} style={STYLE_CHAMP} />
        </label>

        {erreur && <p role="alert" className="text-sm text-red-600">{erreur}</p>}
      </div>
    </ModalShell>
  );
};
