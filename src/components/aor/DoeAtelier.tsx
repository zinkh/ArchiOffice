// Atelier DOE de l'onglet AOR (assistance aux opérations de réception) : il
// remplace l'ancienne carte « Dossier des ouvrages exécutés ». Le cabinet y
//   1. sollicite les entreprises (lien personnel sans compte, e-mail) et règle
//      les relances automatiques ;
//   2. analyse et valide les documents reçus, entreprise par entreprise ;
//   3. émet un visa sur chaque dossier ;
//   4. transmet au maître d'ouvrage une archive : plans de la maîtrise d'œuvre,
//      DOE des entreprises, visas et bordereau.
// Le statut de chaque entreprise est déduit côté serveur (jamais saisi).
import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import {
  IconChevronRight, IconClipboardCheck, IconExternalLink, IconPackageExport, IconSend, IconSettings,
} from '@tabler/icons-react';
import { Card, CardHeader } from '../ui/Card';
import { Toast } from '../ui/Toast';
import { useToastWithUndo } from '../../hooks/useToastWithUndo';
import { useDoeAtelier } from '../../hooks/useDoeAtelier';
import { openSignedUrl } from '../../lib/signedStorageUrl';
import { formatOctets } from '../../lib/consultationDepot';
import { DoeArchiveDialog, DoeSettingsDialog, DoeVisaDialog, CHAMP_DOE, usePieceLabel } from './DoeDialogs';
import { DoeEntrepriseModal, StatutDoe } from './DoeEntrepriseModal';
import { cn } from '../../lib/utils';

const dateFr = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '');

export function DoeAtelier({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const labelPiece = usePieceLabel();
  const api = useDoeAtelier(projectId);
  const { etat, chargement, erreur } = api;
  const { toast, showToast } = useToastWithUndo();
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [visaPour, setVisaPour] = useState<string | null>(null);
  const [reglages, setReglages] = useState(false);
  const [archive, setArchive] = useState(false);
  const [occupe, setOccupe] = useState(false);

  const notify = (message: string, type: 'success' | 'error' = 'success') =>
    showToast(message, type, type === 'error' ? { duration: 6000 } : undefined);

  const toutSolliciter = async () => {
    setOccupe(true);
    try {
      const r = await api.toutSolliciter();
      const parties = [
        r.envoyees.length ? t('doe_all_sent', { count: r.envoyees.length }) : t('doe_all_none'),
        r.sans_adresse.length ? t('doe_all_no_email', { names: r.sans_adresse.join(', ') }) : '',
        r.echecs.length ? t('doe_all_failed', { names: r.echecs.map(e => e.entreprise).join(', ') }) : '',
      ].filter(Boolean);
      notify(parties.join(' '), r.echecs.length ? 'error' : 'success');
    } catch (e: any) {
      notify(e?.message || t('doe_error_generic'), 'error');
    } finally {
      setOccupe(false);
    }
  };

  const entrepriseOuverte = etat?.entreprises.find(e => e.key === ouvert) ?? null;
  const entrepriseVisa = etat?.entreprises.find(e => e.key === visaPour) ?? null;

  return (
    <Card>
      <CardHeader
        icon={IconClipboardCheck}
        title={t('projectdetail_doe_title')}
        description={t('doe_desc')}
        action={etat?.disponible ? (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setReglages(true)}>
              <IconSettings size={15} aria-hidden /> {t('doe_settings_open')}
            </button>
            <button type="button" className="btn btn-secondary disabled:opacity-60" disabled={occupe || etat.synthese.aSolliciter === 0} onClick={toutSolliciter}>
              <IconSend size={15} aria-hidden /> {t('doe_request_all')}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setArchive(true)}>
              <IconPackageExport size={15} aria-hidden /> {t('doe_archive_open')}
            </button>
          </div>
        ) : undefined}
      />

      {chargement && !etat && <p role="status" className="p-6 text-sm text-[var(--tblr-muted)]">{t('doe_loading')}</p>}
      {erreur && !etat && (
        <div role="alert" className="p-6 text-sm text-red-700 dark:text-red-300">
          {erreur} <button type="button" className="underline font-semibold" onClick={() => void api.recharger()}>{t('doe_retry')}</button>
        </div>
      )}
      {etat && !etat.disponible && <p role="alert" className="p-6 text-sm text-[var(--tblr-muted)]">{t('doe_unavailable')}</p>}

      {etat?.disponible && (
        <div>
          {/* Avancement */}
          <div className="px-4 sm:px-6 py-4 space-y-2 border-b border-[var(--tblr-border)]">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <Chiffre valeur={etat.synthese.entreprises} libelle={t('doe_kpi_companies')} />
              <Chiffre valeur={etat.synthese.aSolliciter} libelle={t('doe_kpi_to_request')} />
              <Chiffre valeur={etat.synthese.enAttente} libelle={t('doe_kpi_waiting')} />
              <Chiffre valeur={etat.synthese.aAnalyser} libelle={t('doe_kpi_to_analyze')} />
              <Chiffre valeur={etat.synthese.aCorriger} libelle={t('doe_kpi_to_fix')} />
              <Chiffre valeur={etat.synthese.visees} libelle={t('doe_kpi_visa')} />
            </div>
            <div role="progressbar" aria-label={t('doe_progress')} aria-valuemin={0} aria-valuemax={100}
              aria-valuenow={Math.round(etat.synthese.avancement * 100)} className="h-2 rounded-full overflow-hidden bg-[var(--tblr-border)]">
              <div className="h-full bg-[var(--tblr-primary)] transition-[width]" style={{ width: `${etat.synthese.avancement * 100}%` }} />
            </div>
            {etat.reglages.deadline_at && (
              <p className="text-xs text-[var(--tblr-muted)]">
                {t('doe_deadline', { date: dateFr(etat.reglages.deadline_at) })}
                {' · '}{etat.reglages.reminder_enabled ? t('doe_reminders_on', { days: etat.reglages.reminder_interval_days }) : t('doe_reminders_off')}
              </p>
            )}
          </div>

          {/* Entreprises */}
          {etat.entreprises.length === 0 ? (
            <p className="px-6 py-8 text-sm italic text-[var(--tblr-muted)]">{t('doe_no_companies')}</p>
          ) : (
            <ul className="divide-y divide-[var(--tblr-border)]">
              {etat.entreprises.map(e => {
                const requises = e.couverture.requises.length;
                const couvertes = requises - e.couverture.manquantes.length;
                return (
                  <li key={e.key}>
                    <button type="button" onClick={() => setOuvert(e.key)} aria-label={t('doe_open_company', { nom: e.nom })}
                      className="w-full flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-6 py-3 text-left hover:bg-[var(--tblr-surface-2)] transition-colors min-h-14">
                      <span className="flex-1 basis-56 min-w-0">
                        <span className="block font-semibold text-sm break-words">{e.nom}</span>
                        <span className="block text-xs text-[var(--tblr-muted)]">
                          {e.lots.map(l => `Lot ${l.lot_number} ${l.lot_title}`).join(' ; ') || t('doe_no_lot')}
                        </span>
                      </span>
                      <StatutDoe statut={e.statut} />
                      <span className="text-xs text-[var(--tblr-muted)] whitespace-nowrap">{t('doe_pieces_progress', { done: couvertes, total: requises })}</span>
                      <span className="text-xs text-[var(--tblr-muted)] basis-full sm:basis-48 sm:text-right">
                        {e.visa ? `${e.visa.numero} · ${t(`doe_avis_visa_${e.visa.avis}`)}`
                          : e.prochaine_relance ? t('doe_next_reminder', { date: dateFr(e.prochaine_relance) })
                          : e.request?.sent_at ? t('doe_request_sent_on', { date: dateFr(e.request.sent_at) }) : ''}
                      </span>
                      <IconChevronRight size={16} className="shrink-0 text-[var(--tblr-muted)]" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Documents sans entreprise */}
          {etat.non_affectes.length > 0 && (
            <div className="px-4 sm:px-6 py-4 border-t border-[var(--tblr-border)] space-y-2">
              <h3 className="text-sm font-bold uppercase tracking-wider">{t('projectdetail_doe_unassigned')}</h3>
              <p className="text-xs text-[var(--tblr-muted)]">{t('doe_unassigned_hint')}</p>
              <ul className="space-y-2">
                {etat.non_affectes.map(d => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <button type="button" className="flex-1 basis-56 min-w-0 text-left hover:underline break-words" onClick={() => void openSignedUrl(d.file_url)}>{d.name}</button>
                    <select aria-label={t('projectdetail_doe_company')} className={cn(CHAMP_DOE, '!w-auto')} value=""
                      onChange={ev => { if (ev.target.value) void api.modifierDocument(d.id, { entreprise_key: ev.target.value }).catch((er: any) => notify(er?.message, 'error')); }}>
                      <option value="">{t('doe_assign_company')}</option>
                      {etat.entreprises.map(e => <option key={e.key} value={e.key}>{e.nom}</option>)}
                    </select>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Archives déjà transmises */}
          {etat.archives.length > 0 && (
            <div className="px-4 sm:px-6 py-4 border-t border-[var(--tblr-border)] space-y-2">
              <h3 className="text-sm font-bold uppercase tracking-wider">{t('doe_archives_title')}</h3>
              <ul className="space-y-1">
                {etat.archives.map(a => (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-3 text-sm">
                    <button type="button" className="hover:underline text-left break-words" onClick={() => void openSignedUrl(a.file_url)}>
                      {a.name} <IconExternalLink size={12} className="inline align-baseline" aria-hidden />
                    </button>
                    <span className="text-xs text-[var(--tblr-muted)]">{dateFr(a.uploaded_at)}{a.size_bytes ? ` · ${formatOctets(a.size_bytes)}` : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Rappel des pièces attendues */}
          <p className="px-4 sm:px-6 py-3 text-xs border-t border-[var(--tblr-border)] text-[var(--tblr-muted)]">
            {t('doe_required_recap', { pieces: etat.requises.map(labelPiece).join(', ') })}
          </p>
        </div>
      )}

      <AnimatePresence>
        {reglages && etat && (
          <DoeSettingsDialog key="doe-settings" reglages={etat.reglages} requises={etat.requises}
            onClose={() => setReglages(false)} onSave={r => api.enregistrerReglages(r)} />
        )}
        {entrepriseOuverte && !entrepriseVisa && (
          <DoeEntrepriseModal key="doe-entreprise" entreprise={entrepriseOuverte} api={api} notify={notify}
            onClose={() => setOuvert(null)} onVisa={() => setVisaPour(entrepriseOuverte.key)} />
        )}
        {entrepriseVisa && (
          <DoeVisaDialog key="doe-visa" entreprise={entrepriseVisa} onClose={() => setVisaPour(null)}
            onSubmit={async (avis, observations, envoyer, email) => {
              const r = await api.emettreVisa(entrepriseVisa.key, avis, observations, envoyer, email || undefined);
              return { envoye: r.envoye, raison: r.raison, numero: r.visa.numero };
            }} />
        )}
        {archive && etat && (
          <DoeArchiveDialog key="doe-archive" etat={etat} onClose={() => setArchive(false)} onSubmit={o => api.archiver(o)} />
        )}
      </AnimatePresence>
      <Toast toast={toast} />
    </Card>
  );
}

function Chiffre({ valeur, libelle }: { valeur: number; libelle: string }) {
  return (
    <span className="whitespace-nowrap">
      <strong className="text-base">{valeur}</strong> <span className="text-xs text-[var(--tblr-muted)]">{libelle}</span>
    </span>
  );
}
