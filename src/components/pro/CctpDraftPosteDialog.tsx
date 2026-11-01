// ── Rédiger le texte d'un poste avec l'IA ────────────────────────────────────
// L'architecte décrit ce qu'il attend (facultatif), l'IA propose un texte, il le
// relit et le modifie au besoin, puis choisit : remplacer le texte du poste,
// l'ajouter à la suite, ou abandonner. Rien n'est écrit dans le CCTP avant ce
// choix. Chaque génération consomme des crédits IA du cabinet.
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconLoader2, IconSparkles } from '@tabler/icons-react';
import { ModalShell } from '../ui/ModalShell';
import { apiFetch } from '../../lib/api';

export interface PosteARediger {
  kind: 'lot' | 'chapitre' | 'article';
  titre: string;
  numero: string;
  lotTitre: string;
  chapitreTitre: string;
  unite: string;
  localisation: string;
  /** Texte actuel du poste, éventuellement vide. */
  texteExistant: string;
  /** Intitulés des postes du même niveau, pour ne pas les répéter. */
  voisins: string[];
}

interface Props {
  projectId: string;
  poste: PosteARediger;
  onClose: () => void;
  onApply: (texte: string, mode: 'remplacer' | 'ajouter') => void;
}

const CHAMP = 'w-full px-3 py-2 rounded-lg text-sm outline-none border focus:ring-2 focus:ring-[var(--tblr-primary)]';
const STYLE_CHAMP = { background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' };

export const CctpDraftPosteDialog: React.FC<Props> = ({ projectId, poste, onClose, onApply }) => {
  const { t } = useTranslation();
  const aDejaUnTexte = poste.texteExistant.trim().length > 0;
  const [instructions, setInstructions] = useState('');
  const [ameliorer, setAmeliorer] = useState(aDejaUnTexte);
  const [attente, setAttente] = useState(false);
  const [proposition, setProposition] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const generer = async () => {
    if (attente) return;
    setAttente(true);
    setErreur(null);
    try {
      const res = await apiFetch<{ texte: string }>(`/api/projects/${projectId}/cctp/draft-poste`, {
        method: 'POST',
        body: JSON.stringify({
          kind: poste.kind, titre: poste.titre, numero: poste.numero, lot_titre: poste.lotTitre,
          chapitre_titre: poste.chapitreTitre, unite: poste.unite, localisation: poste.localisation,
          voisins: poste.voisins, instructions, ameliorer: ameliorer && aDejaUnTexte,
          texte_existant: poste.texteExistant,
        }),
      });
      setProposition(res.texte);
    } catch (e: any) {
      setErreur(e?.message || t('pro_cctp_draft_error'));
    } finally {
      setAttente(false);
    }
  };

  const bouton = 'btn inline-flex items-center gap-2';
  return (
    <ModalShell
      title={t('pro_cctp_draft_title')}
      subtitle={`${poste.numero ? `${poste.numero} · ` : ''}${poste.titre}`}
      onClose={onClose}
      busy={attente}
      dirty={proposition !== null}
      size="lg"
      footer={proposition === null ? (
        <>
          <button type="button" className="btn" onClick={onClose} disabled={attente}>{t('cancel')}</button>
          <button type="button" className={`${bouton} btn-primary`} onClick={generer} disabled={attente}>
            {attente ? <IconLoader2 size={14} className="animate-spin" aria-hidden /> : <IconSparkles size={14} aria-hidden />}
            {t('pro_cctp_draft_generate')}
          </button>
        </>
      ) : (
        <>
          <button type="button" className="btn" onClick={onClose} disabled={attente}>{t('cancel')}</button>
          <button type="button" className={bouton} onClick={generer} disabled={attente}>
            {attente && <IconLoader2 size={14} className="animate-spin" aria-hidden />}
            {t('pro_cctp_draft_regenerate')}
          </button>
          {aDejaUnTexte && (
            <button type="button" className={bouton} onClick={() => onApply(proposition, 'ajouter')} disabled={attente || !proposition.trim()}>
              {t('pro_cctp_draft_append')}
            </button>
          )}
          <button
            type="button" className={`${bouton} btn-primary`} disabled={attente || !proposition.trim()}
            onClick={() => onApply(proposition, aDejaUnTexte ? 'remplacer' : 'ajouter')}
          >
            {aDejaUnTexte ? t('pro_cctp_draft_replace') : t('pro_cctp_draft_use')}
          </button>
        </>
      )}
    >
      <div className="p-4 sm:p-6 space-y-4">
        {proposition === null ? (
          <>
            <label className="block text-sm">
              <span className="block mb-1 font-medium" style={{ color: 'var(--tblr-text)' }}>{t('pro_cctp_draft_instructions')}</span>
              <textarea
                rows={4} value={instructions} onChange={e => setInstructions(e.target.value)}
                placeholder={t('pro_cctp_draft_instructions_placeholder')}
                className={`${CHAMP} resize-y`} style={STYLE_CHAMP}
              />
            </label>
            {aDejaUnTexte && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={ameliorer} onChange={e => setAmeliorer(e.target.checked)} />
                <span style={{ color: 'var(--tblr-text)' }}>{t('pro_cctp_draft_improve')}</span>
              </label>
            )}
            <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('pro_cctp_draft_cost_hint')}</p>
          </>
        ) : (
          <label className="block text-sm">
            <span className="block mb-1 font-medium" style={{ color: 'var(--tblr-text)' }}>{t('pro_cctp_draft_proposal')}</span>
            <textarea
              rows={16} value={proposition} onChange={e => setProposition(e.target.value)}
              className={`${CHAMP} resize-y leading-relaxed`} style={STYLE_CHAMP}
            />
            <span className="block mt-1 text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('pro_cctp_draft_review_hint')}</span>
          </label>
        )}
        {erreur && <p role="alert" className="text-sm text-red-600">{erreur}</p>}
      </div>
    </ModalShell>
  );
};
