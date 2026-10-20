// Fenêtres de l'atelier DOE : réglages (date, consignes, pièces exigées,
// relances), visa d'un dossier d'entreprise et archive transmise au maître
// d'ouvrage. À monter comme enfants directs d'un AnimatePresence (ModalShell).
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconDownload, IconAlertTriangle } from '@tabler/icons-react';
import { ModalShell } from '../ui/ModalShell';
import { openSignedUrl } from '../../lib/signedStorageUrl';
import { isValidEmail } from '../../lib/crDiffusion';
import { formatOctets } from '../../lib/consultationDepot';
import {
  DOE_PIECES, RELANCE_INTERVALLE_MAX, RELANCE_INTERVALLE_MIN, RELANCE_MAX_BORNE, avisDocument,
  type DoeAvisVisa, type DoePieceKey,
} from '../../lib/doeAtelier';
import type {
  DoeEntrepriseVue, DoeEtat, DoeReglagesVue, ReponseArchive,
} from '../../hooks/useDoeAtelier';

export const CHAMP_DOE = 'w-full px-3 py-2 text-sm border border-[var(--tblr-border)] rounded-lg bg-[var(--tblr-surface)] text-[var(--tblr-text)] focus:outline-none focus:ring-2 focus:ring-[var(--tblr-primary)]';
const LABEL_DOE = 'block text-xs font-semibold mb-1 text-[var(--tblr-muted)]';

/** Libellé traduit d'une pièce, avec le libellé français du catalogue en repli. */
export function usePieceLabel() {
  const { t } = useTranslation();
  return (key: DoePieceKey) => t(`doe_piece_${key}`, { defaultValue: DOE_PIECES.find(p => p.key === key)?.label ?? key });
}

const messageDe = (e: any, repli: string) => e?.message || repli;

// ── Réglages ─────────────────────────────────────────────────────────────────

/** Date locale « AAAA-MM-JJ » d'un horodatage ISO, pour un champ de date. */
function jourLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function DoeSettingsDialog({ reglages, requises, onClose, onSave }: {
  reglages: DoeReglagesVue;
  requises: DoePieceKey[];
  onClose: () => void;
  onSave: (r: Partial<DoeReglagesVue>) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const labelPiece = usePieceLabel();
  const [jour, setJour] = useState(jourLocal(reglages.deadline_at));
  const [consignes, setConsignes] = useState(reglages.instructions ?? '');
  const [pieces, setPieces] = useState<DoePieceKey[]>(requises);
  const [relances, setRelances] = useState(reglages.reminder_enabled);
  const [intervalle, setIntervalle] = useState(String(reglages.reminder_interval_days));
  const [maximum, setMaximum] = useState(String(reglages.reminder_max));
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const basculer = (k: DoePieceKey) => setPieces(p => (p.includes(k) ? p.filter(x => x !== k) : [...p, k]));

  const enregistrer = async () => {
    setErreur(null);
    if (!pieces.length) return setErreur(t('doe_settings_pieces_required'));
    setEnCours(true);
    try {
      await onSave({
        // Fin de journée : un dépôt « le jour J » n'est pas en retard.
        deadline_at: jour ? new Date(`${jour}T23:59:00`).toISOString() : null,
        instructions: consignes.trim() || null,
        required_pieces: pieces,
        reminder_enabled: relances,
        reminder_interval_days: Number(intervalle) || reglages.reminder_interval_days,
        reminder_max: Number(maximum),
      });
      onClose();
    } catch (e: any) {
      setErreur(messageDe(e, t('doe_error_generic')));
      setEnCours(false);
    }
  };

  return (
    <ModalShell
      size="md" title={t('doe_settings_title')} onClose={onClose} busy={enCours} bodyClassName="p-4 sm:p-6 space-y-5"
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={enCours}>{t('btn_cancel')}</button>
          <button type="button" className="btn btn-primary disabled:opacity-60" onClick={enregistrer} disabled={enCours}>{t('doe_save')}</button>
        </>
      )}
    >
      <div>
        <label className={LABEL_DOE} htmlFor="doe-deadline">{t('doe_settings_deadline')}</label>
        <input id="doe-deadline" type="date" className={CHAMP_DOE} value={jour} onChange={e => setJour(e.target.value)} />
      </div>
      <div>
        <label className={LABEL_DOE} htmlFor="doe-instructions">{t('doe_settings_instructions')}</label>
        <textarea id="doe-instructions" rows={3} maxLength={4000} className={CHAMP_DOE} value={consignes} onChange={e => setConsignes(e.target.value)} />
        <p className="text-xs mt-1 text-[var(--tblr-muted)]">{t('doe_settings_instructions_hint')}</p>
      </div>
      <fieldset>
        <legend className={LABEL_DOE}>{t('doe_settings_pieces')}</legend>
        <div className="space-y-1">
          {DOE_PIECES.filter(p => p.key !== 'autre').map(p => (
            <label key={p.key} className="flex items-start gap-2 text-sm min-h-9">
              <input type="checkbox" className="mt-1" checked={pieces.includes(p.key)} onChange={() => basculer(p.key)} />
              <span>
                <span className="font-semibold">{labelPiece(p.key)}</span>
                <span className="block text-xs text-[var(--tblr-muted)]">{t(`doe_piece_desc_${p.key}`, { defaultValue: p.description })}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className={LABEL_DOE}>{t('doe_settings_reminders')}</legend>
        <label className="flex items-center gap-2 text-sm min-h-9">
          <input type="checkbox" checked={relances} onChange={e => setRelances(e.target.checked)} />
          {t('doe_settings_reminders_on')}
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_DOE} htmlFor="doe-interval">{t('doe_settings_interval')}</label>
            <input id="doe-interval" type="number" min={RELANCE_INTERVALLE_MIN} max={RELANCE_INTERVALLE_MAX} className={CHAMP_DOE}
              value={intervalle} disabled={!relances} onChange={e => setIntervalle(e.target.value)} />
          </div>
          <div>
            <label className={LABEL_DOE} htmlFor="doe-max">{t('doe_settings_max')}</label>
            <input id="doe-max" type="number" min={0} max={RELANCE_MAX_BORNE} className={CHAMP_DOE}
              value={maximum} disabled={!relances} onChange={e => setMaximum(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-[var(--tblr-muted)]">{t('doe_settings_reminders_hint')}</p>
      </fieldset>
      {erreur && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{erreur}</p>}
    </ModalShell>
  );
}

// ── Visa ─────────────────────────────────────────────────────────────────────

export function DoeVisaDialog({ entreprise, onClose, onSubmit }: {
  entreprise: DoeEntrepriseVue;
  onClose: () => void;
  onSubmit: (avis: DoeAvisVisa, observations: string, envoyer: boolean, email: string) => Promise<{ envoye: boolean; raison?: string; numero: string }>;
}) {
  const { t } = useTranslation();
  const labelPiece = usePieceLabel();
  const manquantes = entreprise.couverture.manquantes;
  const aAnalyser = entreprise.documents.some(d => avisDocument(d.validation_status) === 'pending');
  const favorablePossible = manquantes.length === 0 && !aAnalyser;

  const observationsDocuments = useMemo(() => entreprise.documents
    .filter(d => ['rejected', 'commented'].includes(d.validation_status) && d.validation_comments)
    .map(d => `${d.name} : ${d.validation_comments}`).join('\n'), [entreprise.documents]);

  const [avis, setAvis] = useState<DoeAvisVisa>(favorablePossible ? entreprise.avis_suggere : 'defavorable');
  const [observations, setObservations] = useState(observationsDocuments);
  const [envoyer, setEnvoyer] = useState(!!entreprise.email);
  const [email, setEmail] = useState(entreprise.email ?? '');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [resultat, setResultat] = useState<{ envoye: boolean; raison?: string; numero: string } | null>(null);

  const valider = async () => {
    setErreur(null);
    if (envoyer && !isValidEmail(email)) return setErreur(t('doe_visa_email_invalid'));
    setEnCours(true);
    try {
      setResultat(await onSubmit(avis, observations, envoyer, email));
    } catch (e: any) {
      setErreur(messageDe(e, t('doe_error_generic')));
    } finally {
      setEnCours(false);
    }
  };

  const choix: DoeAvisVisa[] = ['favorable', 'avec_observations', 'defavorable'];

  return (
    <ModalShell
      size="md" title={t('doe_visa_title', { nom: entreprise.nom })} onClose={onClose} busy={enCours}
      dirty={!resultat && observations !== observationsDocuments} bodyClassName="p-4 sm:p-6 space-y-5"
      footer={resultat ? (
        <button type="button" className="btn btn-primary" onClick={onClose}>{t('doe_close')}</button>
      ) : (
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={enCours}>{t('btn_cancel')}</button>
          <button type="button" className="btn btn-primary disabled:opacity-60" onClick={valider} disabled={enCours}>{t('doe_visa_issue')}</button>
        </>
      )}
    >
      {resultat ? (
        <div role="status" className="space-y-2 text-sm">
          <p className="font-semibold">{t('doe_visa_issued', { numero: resultat.numero })}</p>
          {envoyer && (resultat.envoye
            ? <p>{t('doe_visa_sent', { email })}</p>
            : <p role="alert" className="text-amber-700 dark:text-amber-300">{resultat.raison || t('doe_visa_not_sent')}</p>)}
        </div>
      ) : (
        <>
          <div className="text-sm space-y-1">
            {manquantes.length > 0 && (
              <p className="flex gap-2 text-amber-800 dark:text-amber-200">
                <IconAlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden />
                {t('doe_visa_blocked_missing', { pieces: manquantes.map(labelPiece).join(' ; ') })}
              </p>
            )}
            {aAnalyser && (
              <p className="flex gap-2 text-amber-800 dark:text-amber-200">
                <IconAlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden />
                {t('doe_visa_blocked_pending')}
              </p>
            )}
          </div>
          <fieldset>
            <legend className={LABEL_DOE}>{t('doe_visa_avis')}</legend>
            <div className="space-y-1">
              {choix.map(a => {
                const interdit = a !== 'defavorable' && !favorablePossible;
                return (
                  <label key={a} className={`flex items-center gap-2 text-sm min-h-9 ${interdit ? 'opacity-50' : ''}`}>
                    <input type="radio" name="doe-avis" checked={avis === a} disabled={interdit} onChange={() => setAvis(a)} />
                    <span className="font-semibold">{t(`doe_avis_visa_${a}`)}</span>
                    {a === entreprise.avis_suggere && !interdit && <span className="text-xs text-[var(--tblr-muted)]">({t('doe_visa_suggested')})</span>}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div>
            <label className={LABEL_DOE} htmlFor="doe-visa-obs">{t('doe_visa_observations')}</label>
            <textarea id="doe-visa-obs" rows={4} maxLength={4000} className={CHAMP_DOE} value={observations} onChange={e => setObservations(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm min-h-9">
              <input type="checkbox" checked={envoyer} onChange={e => setEnvoyer(e.target.checked)} />
              {t('doe_visa_send')}
            </label>
            {envoyer && (
              <div>
                <label className={LABEL_DOE} htmlFor="doe-visa-email">{t('doe_email')}</label>
                <input id="doe-visa-email" type="email" className={CHAMP_DOE} value={email} onChange={e => setEmail(e.target.value)} />
                {avis === 'defavorable' && <p className="text-xs mt-1 text-[var(--tblr-muted)]">{t('doe_visa_link_hint')}</p>}
              </div>
            )}
          </div>
          {erreur && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{erreur}</p>}
        </>
      )}
    </ModalShell>
  );
}

// ── Archive pour le maître d'ouvrage ─────────────────────────────────────────

export function DoeArchiveDialog({ etat, onClose, onSubmit }: {
  etat: DoeEtat;
  onClose: () => void;
  onSubmit: (o: {
    destinataire?: string; envoyer: boolean; inclure_plans: boolean; plans_tous: boolean;
    inclure_non_vises: boolean; confirmer_partiel: boolean;
  }) => Promise<ReponseArchive>;
}) {
  const { t } = useTranslation();
  const nonVisees = etat.entreprises.filter(e => e.statut !== 'vise');
  const visees = etat.entreprises.length - nonVisees.length;

  const [destinataire, setDestinataire] = useState(etat.moa.email ?? '');
  const [envoyer, setEnvoyer] = useState(false);
  const [plans, setPlans] = useState(true);
  const [plansTous, setPlansTous] = useState(false);
  const [inclureNonVises, setInclureNonVises] = useState(false);
  const [confirme, setConfirme] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [reponse, setReponse] = useState<ReponseArchive | null>(null);

  const besoinConfirmation = nonVisees.length > 0 && !inclureNonVises;
  const rienAVoir = visees === 0 && !inclureNonVises;

  const constituer = async () => {
    setErreur(null);
    if (envoyer && !isValidEmail(destinataire)) return setErreur(t('doe_visa_email_invalid'));
    if (besoinConfirmation && !confirme) return setErreur(t('doe_archive_confirm_required'));
    setEnCours(true);
    try {
      setReponse(await onSubmit({
        destinataire: isValidEmail(destinataire) ? destinataire.trim() : undefined,
        envoyer, inclure_plans: plans, plans_tous: plansTous, inclure_non_vises: inclureNonVises, confirmer_partiel: confirme,
      }));
    } catch (e: any) {
      setErreur(messageDe(e, t('doe_error_generic')));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <ModalShell
      size="md" title={t('doe_archive_title')} subtitle={t('doe_archive_subtitle')} onClose={onClose} busy={enCours}
      bodyClassName="p-4 sm:p-6 space-y-5"
      footer={reponse ? (
        <button type="button" className="btn btn-primary" onClick={onClose}>{t('doe_close')}</button>
      ) : (
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={enCours}>{t('btn_cancel')}</button>
          <button type="button" className="btn btn-primary disabled:opacity-60" onClick={constituer} disabled={enCours || rienAVoir}>
            {enCours ? t('doe_archive_building') : t('doe_archive_build')}
          </button>
        </>
      )}
    >
      {reponse ? (
        <div role="status" className="space-y-3 text-sm">
          <p className="font-semibold">{t('doe_archive_ready', { count: reponse.fichiers })}</p>
          <p className="text-[var(--tblr-muted)]">{reponse.document.name}{reponse.document.size_bytes ? ` · ${formatOctets(reponse.document.size_bytes)}` : ''}</p>
          <button type="button" className="btn btn-secondary" onClick={() => void openSignedUrl(reponse.document.file_url)}>
            <IconDownload size={15} aria-hidden /> {t('doe_archive_download')}
          </button>
          {envoyer && (reponse.envoye
            ? <p>{t('doe_archive_sent', { email: destinataire })}</p>
            : <p role="alert" className="text-amber-700 dark:text-amber-300">{reponse.raison || t('doe_visa_not_sent')}</p>)}
          {reponse.ignores.length > 0 && (
            <div role="alert" className="text-amber-800 dark:text-amber-200">
              <p className="font-semibold">{t('doe_archive_ignored')}</p>
              <ul className="list-disc pl-5">{reponse.ignores.map(n => <li key={n}>{n}</li>)}</ul>
            </div>
          )}
          {reponse.reserves.length > 0 && (
            <div>
              <p className="font-semibold">{t('doe_archive_reserves')}</p>
              <ul className="list-disc pl-5 text-[var(--tblr-muted)]">{reponse.reserves.map(r => <li key={r}>{r}</li>)}</ul>
            </div>
          )}
        </div>
      ) : (
        <>
          <p className="text-sm text-[var(--tblr-muted)]">{t('doe_archive_content', { visees, total: etat.entreprises.length })}</p>
          {nonVisees.length > 0 && (
            <div className="text-sm rounded-lg p-3 border border-[var(--tblr-border)] bg-[var(--tblr-surface-2)] space-y-2">
              <p className="flex gap-2 font-semibold"><IconAlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden />{t('doe_archive_not_visa', { count: nonVisees.length })}</p>
              <ul className="list-disc pl-5">{nonVisees.map(e => <li key={e.key}>{e.nom}</li>)}</ul>
              <label className="flex items-center gap-2 min-h-9">
                <input type="checkbox" checked={inclureNonVises} onChange={e => setInclureNonVises(e.target.checked)} />
                {t('doe_archive_include_not_visa')}
              </label>
              {!inclureNonVises && (
                <label className="flex items-center gap-2 min-h-9">
                  <input type="checkbox" checked={confirme} onChange={e => setConfirme(e.target.checked)} />
                  {t('doe_archive_confirm_partial')}
                </label>
              )}
            </div>
          )}
          <fieldset className="space-y-1">
            <label className="flex items-center gap-2 text-sm min-h-9">
              <input type="checkbox" checked={plans} onChange={e => setPlans(e.target.checked)} />
              {t('doe_archive_plans')}
            </label>
            {plans && (
              <label className="flex items-center gap-2 text-sm min-h-9 pl-6">
                <input type="checkbox" checked={plansTous} onChange={e => setPlansTous(e.target.checked)} />
                {t('doe_archive_plans_all')}
              </label>
            )}
          </fieldset>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm min-h-9">
              <input type="checkbox" checked={envoyer} onChange={e => setEnvoyer(e.target.checked)} />
              {t('doe_archive_send')}
            </label>
            {(envoyer || etat.moa.email) && (
              <div>
                <label className={LABEL_DOE} htmlFor="doe-archive-email">{t('doe_archive_recipient', { nom: etat.moa.nom ?? '' })}</label>
                <input id="doe-archive-email" type="email" className={CHAMP_DOE} value={destinataire} onChange={e => setDestinataire(e.target.value)} />
                <p className="text-xs mt-1 text-[var(--tblr-muted)]">{t('doe_archive_send_hint')}</p>
              </div>
            )}
          </div>
          {rienAVoir && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">{t('doe_archive_nothing')}</p>}
          {erreur && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{erreur}</p>}
        </>
      )}
    </ModalShell>
  );
}
