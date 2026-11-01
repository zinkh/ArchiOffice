// ── Marqueur de rédaction : pastille d'arbre et champ de la fiche ─────────────
// Voir lib/marqueurRedaction. Rendu seulement : l'éditeur du CCTP décide quand
// et comment poser le marqueur (nom de l'auteur compris).
import React from 'react';
import { useTranslation } from 'react-i18next';
import { IconPencil, IconAlertTriangle } from '@tabler/icons-react';
import type { MarqueurRedaction, StatutRedaction } from '../../types/dpgf';
import { ancienMarqueur, estParAgent, libelleMarqueur } from '../../lib/marqueurRedaction';

export const PastilleMarqueur: React.FC<{ marqueur?: MarqueurRedaction }> = ({ marqueur }) => {
  const { t } = useTranslation();
  if (!marqueur) return null;
  const enCours = marqueur.statut === 'en_cours';
  const Icone = enCours ? IconPencil : IconAlertTriangle;
  const texte = enCours ? t('pro_cctp_marker_en_cours') : t('pro_cctp_marker_incomplet');
  return (
    <span
      className={`inline-flex items-center gap-0.5 shrink-0 text-[0.6875rem] font-semibold ${enCours ? 'text-blue-600' : 'text-amber-600'}`}
      title={libelleMarqueur(marqueur)} aria-label={`${texte}${marqueur.par ? ` (${marqueur.par})` : ''}`}
    >
      <Icone size={12} aria-hidden />
      {estParAgent(marqueur.par) && <span aria-hidden>IA</span>}
    </span>
  );
};

interface ChampProps {
  marqueur?: MarqueurRedaction;
  onChange: (statut: StatutRedaction | undefined, note?: string) => void;
}

export const ChampMarqueur: React.FC<ChampProps> = ({ marqueur, onChange }) => {
  const { t } = useTranslation();
  const [note, setNote] = React.useState(marqueur?.note ?? '');
  React.useEffect(() => { setNote(marqueur?.note ?? ''); }, [marqueur?.note]);
  const ancien = ancienMarqueur(marqueur);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
      <label className="inline-flex items-center gap-1.5">
        <span style={{ color: 'var(--tblr-muted)' }}>{t('pro_cctp_marker_label')}</span>
        <select
          value={marqueur?.statut ?? ''}
          onChange={e => onChange((e.target.value || undefined) as StatutRedaction | undefined, note)}
          className="px-2 py-1 rounded border text-xs"
          style={{ background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
        >
          <option value="">{t('pro_cctp_marker_none')}</option>
          <option value="incomplet">{t('pro_cctp_marker_incomplet')}</option>
          <option value="en_cours">{t('pro_cctp_marker_en_cours')}</option>
        </select>
      </label>
      {marqueur && (
        <input
          type="text" value={note} maxLength={300} aria-label={t('pro_cctp_marker_note')} placeholder={t('pro_cctp_marker_note')}
          onChange={e => setNote(e.target.value)}
          onBlur={() => { if (note.trim() !== (marqueur.note ?? '')) onChange(marqueur.statut, note); }}
          className="flex-1 min-w-40 px-2 py-1 rounded border text-xs"
          style={{ background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
        />
      )}
      {marqueur && (
        <span style={{ color: 'var(--tblr-muted)' }}>
          {marqueur.par ? t('pro_cctp_marker_by', { nom: marqueur.par }) : ''}
          {ancien ? ` · ${t('pro_cctp_marker_old')}` : ''}
        </span>
      )}
    </div>
  );
};
