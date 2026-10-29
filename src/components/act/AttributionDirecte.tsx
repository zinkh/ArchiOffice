import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconAlertTriangle, IconUserCheck, IconX } from '@tabler/icons-react';
import type { Contact } from '../../types';
import { contactDisplayName } from '../../lib/projectIntervenants';

interface Props {
  /** Fiches « Entreprise » du cabinet. */
  contacts: Contact[];
  /** Le lot est déjà attribué sans offre. */
  attribueSansOffre: boolean;
  /** Le lot a une attribution issue d'une offre : la désignation la remplacerait. */
  attribueParOffre: boolean;
  marchePublic: boolean;
  enCours: boolean;
  erreur: string | null;
  onAttribuer: (contact: Contact) => void;
  onRetirer: () => void;
}

const BOUTON = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 pointer-coarse:min-h-11';
const BOUTON_PRIMAIRE = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[var(--tblr-primary)] text-white hover:opacity-90 disabled:opacity-50 pointer-coarse:min-h-11';

/** Désigner une entreprise pour un lot sans offre ni montant (ACT, phase d'analyse). */
export default function AttributionDirecte({
  contacts, attribueSansOffre, attribueParOffre, marchePublic, enCours, erreur, onAttribuer, onRetirer,
}: Props) {
  const { t } = useTranslation();
  const uid = useId();
  const [ouvert, setOuvert] = useState(false);
  const [choix, setChoix] = useState('');

  const contact = contacts.find(c => c.id === choix);
  const options = [...contacts].sort((a, b) => contactDisplayName(a).localeCompare(contactDisplayName(b), 'fr'));

  const confirmer = () => {
    if (!contact) return;
    onAttribuer(contact);
    setOuvert(false);
    setChoix('');
  };

  return (
    <div className="px-5 py-3 border-b border-[var(--tblr-border)] bg-[var(--tblr-surface-2)] space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {attribueSansOffre && (
          <span className="text-[0.6875rem] px-2 py-0.5 rounded-full bg-[var(--tblr-primary-lt)] text-[var(--tblr-primary)] font-bold">
            {t('attribution_directe_badge')}
          </span>
        )}
        {!ouvert && (
          <button type="button" className={BOUTON} onClick={() => setOuvert(true)} disabled={enCours}>
            <IconUserCheck size={14} aria-hidden="true" />
            {attribueSansOffre ? t('attribution_directe_change') : t('attribution_directe_open')}
          </button>
        )}
        {attribueSansOffre && !ouvert && (
          <button type="button" className={BOUTON} onClick={onRetirer} disabled={enCours}>
            <IconX size={14} aria-hidden="true" /> {t('attribution_directe_remove')}
          </button>
        )}
        {!ouvert && !attribueSansOffre && (
          <span className="text-[0.6875rem] text-[var(--tblr-muted)]">{t('attribution_directe_hint')}</span>
        )}
      </div>

      {ouvert && (
        <div className="space-y-2">
          {marchePublic && (
            <div role="alert" className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 p-3 text-xs text-amber-800 dark:text-amber-200">
              <IconAlertTriangle size={16} className="shrink-0" aria-hidden="true" />
              <span>{t('attribution_directe_public_warning')}</span>
            </div>
          )}
          {attribueParOffre && !attribueSansOffre && (
            <p className="text-xs text-[var(--tblr-muted)]">{t('attribution_directe_replaces_offer')}</p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[14rem]">
              <label htmlFor={`${uid}-entreprise`} className="block text-[0.6875rem] font-bold uppercase text-[var(--tblr-muted)] mb-1">
                {t('attribution_directe_company')}
              </label>
              <select
                id={`${uid}-entreprise`}
                value={choix}
                onChange={e => setChoix(e.target.value)}
                className="w-full h-10 text-sm px-3 border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">{t('attribution_directe_choose')}</option>
                {options.map(c => <option key={c.id} value={c.id}>{contactDisplayName(c) || c.id}</option>)}
              </select>
            </div>
            <button type="button" className={BOUTON_PRIMAIRE} onClick={confirmer} disabled={!contact || enCours}>
              {t('attribution_directe_confirm')}
            </button>
            <button type="button" className={BOUTON} onClick={() => { setOuvert(false); setChoix(''); }}>
              {t('attribution_directe_cancel')}
            </button>
          </div>
          {options.length === 0 && <p className="text-xs text-[var(--tblr-muted)]">{t('attribution_directe_no_company')}</p>}
        </div>
      )}

      {erreur && <p role="alert" className="text-xs text-red-600">{erreur}</p>}
    </div>
  );
}
