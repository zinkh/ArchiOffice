import { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { ModalShell } from '../ui/ModalShell';

interface LigneDescriptionDialogProps {
  /** Numéro et désignation de l'ouvrage, rappelés dans le titre. */
  numero: string;
  designation: string;
  /** Texte technique actuel de l'ouvrage (`cctpDescription`). */
  valeur: string;
  onSave: (texte: string) => void;
  onClose: () => void;
}

/**
 * Saisie de la description technique d'un ouvrage depuis le DPGF, sans passer
 * par le CCTP. Le texte est le même (`cctpDescription`) : il se retrouve tel
 * quel dans l'éditeur du CCTP. Ctrl+Entrée enregistre ; fermer avec une saisie
 * non enregistrée demande confirmation.
 */
export function LigneDescriptionDialog({ numero, designation, valeur, onSave, onClose }: LigneDescriptionDialogProps) {
  const { t } = useTranslation();
  const [texte, setTexte] = useState(valeur);
  const champ = useRef<HTMLTextAreaElement>(null);
  const dirty = texte !== valeur;

  useEffect(() => { champ.current?.focus(); }, []);

  const enregistrer = () => { onSave(texte.trim() === '' ? '' : texte); onClose(); };

  return (
    <AnimatePresence>
      <ModalShell
        key="ligne-description"
        title={t('pro_description_title', { numero })}
        subtitle={designation}
        onClose={onClose}
        dirty={dirty}
        size="lg"
        footer={(
          <div className="flex items-center justify-between gap-3 w-full">
            <span className="hidden sm:inline text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('pro_description_hint')}</span>
            <div className="flex gap-2 ml-auto">
              <button type="button" className="btn" onClick={onClose}>{t('pro_undo')}</button>
              <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={!dirty}>{t('pro_description_save')}</button>
            </div>
          </div>
        )}
      >
        <label htmlFor="ligne-description-texte" className="sr-only">{t('pro_description_label')}</label>
        <textarea
          id="ligne-description-texte"
          ref={champ}
          value={texte}
          onChange={e => setTexte(e.target.value)}
          onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && dirty) { e.preventDefault(); enregistrer(); } }}
          rows={12}
          placeholder={t('pro_description_placeholder')}
          className="w-full min-h-[14rem] px-3 py-2 text-sm leading-relaxed rounded border outline-none focus:ring-2 focus:ring-[var(--tblr-primary)]"
          style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)', color: 'var(--tblr-text)' }}
        />
      </ModalShell>
    </AnimatePresence>
  );
}
