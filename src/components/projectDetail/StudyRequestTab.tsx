// Onglet de consultation de la fiche affaire : étude de sol (DIAG), contrôle
// technique (CT) ou coordination SPS (CSPS). Le formulaire reprend les données de
// l'affaire ; le message s'ouvre dans le composeur de messagerie, où l'architecte
// relit et envoie. Un envoi confirmé est consigné dans l'historique de l'affaire.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconSend, IconAlertTriangle, IconCheck } from '@tabler/icons-react';
import { apiFetch } from '../../lib/api';
import { useStudyList } from '../../hooks/useStudyList';
import { useMailAccounts } from '../../hooks/useMailAccounts';
import { useSettings } from '../../hooks/useSettings';
import MailComposeModal from '../MailComposeModal';
import type { Contact, Project } from '../../types';
import {
  STUDY_KIND_DEFS, STUDY_RECIPIENT_FILTER, buildStudyRequestBody, buildStudySubject, parseEmailList,
  studyProjetFromProject, type StudyKind, type StudyValue, type StudyRequest, type StudyFieldDef,
} from '../../lib/studyRequests';

interface StudyRequestRecord {
  id: string;
  kind: StudyKind;
  subject: string;
  recipients: string[];
  etudes: string[];
  sent_at: string;
}

interface Props {
  kind: StudyKind;
  project: Project;
}

type Erreur = { cle: string; valeurs?: Record<string, string> };
type Notice = { ok: boolean; texte: string };

const CHAMP = 'mt-1 w-full min-h-11 rounded-lg border border-[var(--tblr-border)] bg-[var(--tblr-bg)] px-3 py-2 text-sm text-[var(--tblr-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tblr-primary)]';
const TITRE_SECTION = 'text-[0.6875rem] font-bold uppercase tracking-wider';

function Ligne({ label, valeur, aPreciser }: { label: string; valeur?: string | null; aPreciser: string }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-2 text-sm">
      <dt style={{ color: 'var(--tblr-muted)' }}>{label}</dt>
      <dd className="min-w-0 break-words" style={{ color: valeur?.trim() ? 'var(--tblr-text)' : 'var(--tblr-muted)' }}>
        {valeur?.trim() || aPreciser}
      </dd>
    </div>
  );
}

export function StudyRequestTab(props: Props) {
  return <StudyRequestForm key={`${props.project.id}:${props.kind}`} {...props} />;
}

function StudyRequestForm({ kind, project }: Props) {
  const { t, i18n } = useTranslation();
  const def = STUDY_KIND_DEFS[kind];
  const p = def.prefix;
  const { accounts, loading: comptesEnChargement } = useMailAccounts();
  const { settings } = useSettings();
  const agence = settings as unknown as { agencyName?: string; email?: string } | null;

  const contactsState = useStudyList<Contact>('/api/contacts');
  const historyState = useStudyList<StudyRequestRecord>(`/api/projects/${project.id}/study-requests?kind=${kind}`);
  const contacts = contactsState.data;
  const historique = historyState.data;
  const [etudes, setEtudes] = useState<string[]>([]);
  const [values, setValues] = useState<Record<string, StudyValue>>({});
  const [contactIds, setContactIds] = useState<string[]>([]);
  const [autresEmails, setAutresEmails] = useState('');
  const [erreurs, setErreurs] = useState<Erreur[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [composeOuvert, setComposeOuvert] = useState(false);
  const [message, setMessage] = useState<{ id: string; sujet: string; corps: string; destinataires: string[] } | null>(null);

  const projet = useMemo(() => studyProjetFromProject(project), [project]);

  // Une catégorie est exigée : un contact sans catégorie n'est jamais proposé d'office.
  const destinataires = useMemo(
    () => contacts.filter(c => c.email && STUDY_RECIPIENT_FILTER[kind](c)),
    [contacts, kind],
  );

  const basculer = (liste: string[], valeurBascule: string, mettreAJour: (v: string[]) => void) =>
    mettreAJour(liste.includes(valeurBascule) ? liste.filter(x => x !== valeurBascule) : [...liste, valeurBascule]);

  const setValeur = (id: string, v: StudyValue) => setValues(prev => ({ ...prev, [id]: v }));

  const champ = (f: StudyFieldDef) => {
    const label = t(`study_${p}_field_${f.id}`);
    const v = values[f.id];
    if (f.type === 'checkbox') {
      return (
        <label key={f.id} className="flex min-h-11 items-center gap-3 self-end text-sm">
          <input type="checkbox" className="size-4" checked={v === true} onChange={e => setValeur(f.id, e.target.checked)} />
          {label}
        </label>
      );
    }
    const str = typeof v === 'string' ? v : '';
    const className = f.type === 'textarea' ? 'md:col-span-2' : '';
    return (
      <label key={f.id} className={`block text-sm ${className}`}>
        <span className="font-semibold" style={{ color: 'var(--tblr-text)' }}>{label}</span>
        {f.type === 'textarea'
          ? <textarea rows={3} className={CHAMP} value={str} onChange={e => setValeur(f.id, e.target.value)} />
          : <input type={f.type} min={f.type === 'number' ? 0 : undefined} step={f.type === 'number' ? 'any' : undefined} className={CHAMP} value={str} onChange={e => setValeur(f.id, e.target.value)} />}
      </label>
    );
  };

  const preparerEmail = () => {
    const saisies = parseEmailList(autresEmails);
    const adressesChoisies = destinataires.filter(c => contactIds.includes(c.id)).map(c => c.email);
    const adresses = [...new Set([...adressesChoisies, ...saisies.valides])];
    const nouvellesErreurs: Erreur[] = [];
    if (etudes.length === 0) nouvellesErreurs.push({ cle: 'study_common_error_no_study' });
    if (adresses.length === 0) nouvellesErreurs.push({ cle: 'study_common_error_no_recipient' });
    if (saisies.invalides.length > 0) nouvellesErreurs.push({ cle: 'study_common_error_invalid', valeurs: { liste: saisies.invalides.join(', ') } });
    setErreurs(nouvellesErreurs);
    if (nouvellesErreurs.length > 0) return;

    const demande: StudyRequest = {
      projet,
      moeNom: agence?.agencyName,
      moeEmail: agence?.email,
      etudes,
      values,
    };
    setNotice(null);
    setMessage({
      id: crypto.randomUUID(),
      sujet: buildStudySubject(kind, projet),
      corps: buildStudyRequestBody(kind, demande),
      destinataires: adresses,
    });
    setComposeOuvert(true);
  };

  // Appelé seulement quand le composeur confirme l'envoi : c'est alors seulement
  // que la demande entre dans l'historique de l'affaire.
  const consigner = async () => {
    setComposeOuvert(false);
    if (!message) return;
    try {
      await apiFetch(`/api/projects/${project.id}/study-requests`, {
        method: 'POST',
        body: JSON.stringify({
          id: message.id,
          kind,
          subject: message.sujet,
          recipients: message.destinataires,
          etudes,
          payload: { values },
        }),
      });
      setNotice({ ok: true, texte: t('study_common_sent') });
    } catch {
      setNotice({ ok: false, texte: t('study_common_log_error') });
    }
    setEtudes([]);
    setValues({});
    setContactIds([]);
    setAutresEmails('');
    historyState.retry();
  };

  const dateLisible = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const lecture = (state: { status: string; retry: () => void }, errorKey: string) => (
    <div role={state.status === 'error' ? 'alert' : 'status'} className="flex flex-wrap items-center gap-3 text-sm text-[var(--tblr-muted)]">
      <p>{t(state.status === 'error' ? errorKey : 'study_common_loading')}</p>
      {state.status === 'error' && <button type="button" onClick={state.retry} className="min-h-11 rounded-lg border border-[var(--tblr-border)] px-3 font-semibold text-[var(--tblr-text)]">{t('study_common_retry')}</button>}
    </div>
  );

  const aPreciser = t('study_common_a_preciser');
  const groupesRendus = def.groupes.map(g => ({ id: g.id, champs: g.champs.map(id => def.champs.find(c => c.id === id)).filter((c): c is StudyFieldDef => !!c) }));

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <header className="space-y-1">
        <h2 className="text-lg font-bold" style={{ color: 'var(--tblr-text)' }}>{t(`study_${p}_title`)}</h2>
        <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t(`study_${p}_intro`)}</p>
      </header>

      {notice && (
        <div role="status" className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${notice.ok ? 'border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300' : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'}`}>
          {notice.ok ? <IconCheck size={18} aria-hidden className="mt-0.5 shrink-0" /> : <IconAlertTriangle size={18} aria-hidden className="mt-0.5 shrink-0" />}
          <span>{notice.texte}</span>
        </div>
      )}

      <section className="rounded-xl border border-[var(--tblr-border)] p-4" aria-labelledby={`${p}-faits`}>
        <h3 id={`${p}-faits`} className={TITRE_SECTION} style={{ color: 'var(--tblr-muted)' }}>{t('study_common_facts_title')}</h3>
        <dl className="mt-3 grid gap-2 md:grid-cols-2">
          {def.faits.map(f => (
            <Ligne key={f} label={t(`study_fact_${f}`)} valeur={projet[f]} aPreciser={aPreciser} />
          ))}
        </dl>
      </section>

      <section className="space-y-3" aria-labelledby={`${p}-etudes`}>
        <h3 id={`${p}-etudes`} className={TITRE_SECTION} style={{ color: 'var(--tblr-muted)' }}>{t(`study_${p}_section_studies`)}</h3>
        <div className="grid gap-2 md:grid-cols-2">
          {def.etudes.map(e => (
            <label key={e.id} className="flex min-h-11 items-start gap-3 rounded-lg border border-[var(--tblr-border)] p-3 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={etudes.includes(e.id)} onChange={() => basculer(etudes, e.id, setEtudes)} />
              <span>{t(`study_${p}_study_${e.id}`)}</span>
            </label>
          ))}
        </div>
      </section>

      {groupesRendus.map(g => (
        <section key={g.id} className="space-y-3" aria-label={t(`study_${p}_group_${g.id}`)}>
          <h3 className={TITRE_SECTION} style={{ color: 'var(--tblr-muted)' }}>{t(`study_${p}_group_${g.id}`)}</h3>
          <div className="grid gap-3 md:grid-cols-2">{g.champs.map(champ)}</div>
        </section>
      ))}

      <section className="space-y-3" aria-labelledby={`${p}-destinataires`}>
        <h3 id={`${p}-destinataires`} className={TITRE_SECTION} style={{ color: 'var(--tblr-muted)' }}>{t('study_common_recipients_title')}</h3>
        {contactsState.status !== 'success' ? lecture(contactsState, 'study_common_contacts_load_error') : destinataires.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('study_common_recipients_empty')}</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {destinataires.map(c => {
              const nom = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company_name || c.email;
              return (
                <label key={c.id} className="flex min-h-11 items-center gap-3 rounded-lg border border-[var(--tblr-border)] p-3 text-sm">
                  <input type="checkbox" className="size-4 shrink-0" checked={contactIds.includes(c.id)} onChange={() => basculer(contactIds, c.id, setContactIds)} />
                  <span className="min-w-0 break-words">
                    <span className="font-semibold">{nom}</span>
                    {c.company_name && nom !== c.company_name && <span style={{ color: 'var(--tblr-muted)' }}> · {c.company_name}</span>}
                    <span className="block text-xs" style={{ color: 'var(--tblr-muted)' }}>{c.email}</span>
                  </span>
                </label>
              );
            })}
          </div>
        )}
        <label className="block text-sm">
          <span className="font-semibold" style={{ color: 'var(--tblr-text)' }}>{t('study_common_other_emails')}</span>
          <input className={CHAMP} type="text" inputMode="email" autoComplete="off" value={autresEmails} onChange={e => setAutresEmails(e.target.value)} />
        </label>
      </section>

      {erreurs.length > 0 && (
        <div role="alert" className="flex gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          <IconAlertTriangle size={18} aria-hidden className="mt-0.5 shrink-0" />
          <ul className="space-y-1">
            {erreurs.map(e => <li key={e.cle}>{t(e.cle, e.valeurs)}</li>)}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[var(--tblr-border)] pt-4">
        <button
          type="button"
          onClick={preparerEmail}
          disabled={comptesEnChargement}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--tblr-primary)] px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
        >
          <IconSend size={16} aria-hidden /> {t('study_common_prepare')}
        </button>
      </div>

      <section className="space-y-3" aria-labelledby={`${p}-historique`}>
        <h3 id={`${p}-historique`} className={TITRE_SECTION} style={{ color: 'var(--tblr-muted)' }}>{t('study_common_history_title')}</h3>
        {historyState.status !== 'success' ? lecture(historyState, 'study_common_history_load_error') : historique.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('study_common_history_empty')}</p>
        ) : (
          <ul className="space-y-2">
            {historique.map(h => (
              <li key={h.id} className="rounded-lg border border-[var(--tblr-border)] p-3 text-sm">
                <p className="font-semibold break-words">{h.subject}</p>
                <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('study_common_history_sent_on', { date: dateLisible(h.sent_at) })}</p>
                <p className="text-xs break-words" style={{ color: 'var(--tblr-muted)' }}>{t('study_common_history_to', { liste: h.recipients.join(', ') })}</p>
                <p className="text-xs break-words" style={{ color: 'var(--tblr-muted)' }}>
                  {t('study_common_history_studies', { liste: h.etudes.map(e => t(`study_${p}_study_${e}`)).join(' ; ') })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {composeOuvert && message && !comptesEnChargement && (
        <MailComposeModal
          accounts={accounts}
          initial={{ to: message.destinataires.join(', '), subject: message.sujet, body: message.corps }}
          onSent={consigner}
          onClose={() => setComposeOuvert(false)}
        />
      )}
    </div>
  );
}

export default StudyRequestTab;
