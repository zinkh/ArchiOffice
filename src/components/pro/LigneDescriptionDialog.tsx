import { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { ModalShell } from '../ui/ModalShell';
import type { FicheTechnique } from '../../types/dpgf';
import { FichesTechniquesEditor } from './FichesTechniquesEditor';

interface LigneDescriptionDialogProps {
  /** Numéro et désignation de l'ouvrage, rappelés dans le titre. */
  numero: string;
  designation: string;
  /** Texte technique actuel de l'ouvrage (`cctpDescription`). */
  valeur: string;
  /** Reçoit le texte technique et la désignation (le titre de l'article), éventuellement modifiée. */
  onSave: (texte: string, designation: string) => void;
  /** Affaire et fiches techniques du poste ; les fiches s'enregistrent tout de suite (le fichier est déjà déposé). */
  projectId?: string;
  fiches?: FicheTechnique[];
  onFichesChange?: (fiches: FicheTechnique[]) => void;
  /** Ouvre l'article dans l'onglet CCTP (la saisie en cours est enregistrée d'abord). */
  onOpenCctp?: () => void;
  onClose: () => void;
}

/**
 * Saisie du titre (la désignation) et de la description technique d'un ouvrage
 * depuis le DPGF, sans passer par le CCTP. Le texte est le même (`cctpDescription`) : il se retrouve tel
 * quel dans l'éditeur du CCTP. Ctrl+Entrée enregistre ; fermer avec une saisie
 * non enregistrée demande confirmation.
 */
export function LigneDescriptionDialog({ numero, designation, valeur, onSave, projectId, fiches, onFichesChange, onOpenCctp, onClose }: LigneDescriptionDialogProps) {
  const { t } = useTranslation();
  const [texte, setTexte] = useState(valeur);
  const [titre, setTitre] = useState(designation);
  const champ = useRef<HTMLTextAreaElement>(null);
  const titreVide = titre.trim() === '';
  const dirty = texte !== valeur || titre.trim() !== designation.trim();

  useEffect(() => { champ.current?.focus(); }, []);

  const enregistrer = () => {
    if (titreVide) return;
    onSave(texte.trim() === '' ? '' : texte, titre.trim());
    onClose();
  };
  const ouvrirCctp = () => {
    if (dirty && !titreVide) onSave(texte.trim() === '' ? '' : texte, titre.trim());
    onOpenCctp?.();
  };

  return (
    <AnimatePresence>
      <ModalShell
        key="ligne-description"
        title={t('pro_description_title', { numero })}
        subtitle={designation}
        onClose={onClose}
        dirty={dirty}
        size="lg"
        bodyClassName="p-4 sm:p-6"
        footer={(
          <div className="flex items-center justify-between gap-3 w-full">
            <span className="hidden sm:inline text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('pro_description_hint')}</span>
            {onOpenCctp && (
              <button type="button" className="text-xs underline" style={{ color: 'var(--tblr-primary)' }} onClick={ouvrirCctp}>
                {t('pro_description_open_cctp')}
              </button>
            )}
            <div className="flex gap-2 ml-auto">
              <button type="button" className="btn" onClick={onClose}>{t('pro_undo')}</button>
              <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={!dirty || titreVide}>{t('pro_description_save')}</button>
            </div>
          </div>
        )}
      >
        <label htmlFor="ligne-description-titre" className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>{t('pro_description_title_label')}</label>
        <input
          id="ligne-description-titre"
          type="text"
          value={titre}
          onChange={e => setTitre(e.target.value)}
          onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && dirty && !titreVide) { e.preventDefault(); enregistrer(); } }}
          aria-invalid={titreVide || undefined}
          className="w-full mb-3 px-3 py-2 text-sm rounded border outline-none focus:ring-2 focus:ring-[var(--tblr-primary)]"
          style={{ borderColor: titreVide ? '#b91c1c' : 'var(--tblr-border)', background: 'var(--tblr-surface)', color: 'var(--tblr-text)' }}
        />
        {titreVide && <p role="alert" className="-mt-2 mb-3 text-xs text-red-700 dark:text-red-400">{t('pro_description_title_required')}</p>}
        <label htmlFor="ligne-description-texte" className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>{t('pro_description_label')}</label>
        <textarea
          id="ligne-description-texte"
          ref={champ}
          value={texte}
          onChange={e => setTexte(e.target.value)}
          onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && dirty && !titreVide) { e.preventDefault(); enregistrer(); } }}
          rows={12}
          placeholder={t('pro_description_placeholder')}
          className="w-full min-h-[14rem] px-3 py-2 text-sm leading-relaxed rounded border outline-none focus:ring-2 focus:ring-[var(--tblr-primary)]"
          style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)', color: 'var(--tblr-text)' }}
        />
        {projectId && onFichesChange && (
          <div className="mt-4">
            <FichesTechniquesEditor projectId={projectId} fiches={fiches ?? []} onChange={onFichesChange} />
          </div>
        )}
      </ModalShell>
    </AnimatePresence>
  );
}
