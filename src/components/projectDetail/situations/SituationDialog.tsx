import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconAlertTriangle, IconDownload, IconFileCertificate, IconCash, IconArrowBackUp, IconTrash } from '@tabler/icons-react';
import {
  calculerCertificat, estCertifiee, num, situationsDuMarche,
  type MarcheTravaux, type SituationTravaux,
} from '../../../lib/certificatPaiement';
import { DialogShell, Champ, inputClass, boutonPrincipal, boutonSecondaire, formatEuros } from './DialogShell';
import { FactureEntrepriseLink, type Plateforme, type SituationLiee } from './FactureEntrepriseLink';
import { EtatSituationBadge } from './EtatSituationBadge';

interface Form {
  reference_entreprise: string;
  date_situation: string;
  date_reception_situation: string;
  montant_presente_ht: string;
  montant_admis_ht: string;
  revision_coeff: string;
  avance_remboursement: string;
  penalites_ht: string;
  penalites_notes: string;
  notes_moe: string;
  date_certificat: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function formDepuis(sit: SituationTravaux): Form {
  return {
    reference_entreprise: s(sit.reference_entreprise),
    date_situation: s(sit.date_situation).slice(0, 10),
    date_reception_situation: s(sit.date_reception_situation),
    montant_presente_ht: s(sit.montant_presente_ht),
    montant_admis_ht: s(sit.montant_admis_ht),
    revision_coeff: num(sit.revision_coeff) && num(sit.revision_coeff) !== 1 ? s(sit.revision_coeff) : '',
    avance_remboursement: num(sit.avance_remboursement) ? s(sit.avance_remboursement) : '',
    penalites_ht: num(sit.penalites_ht) ? s(sit.penalites_ht) : '',
    penalites_notes: s(sit.penalites_notes),
    notes_moe: s(sit.notes_moe),
    date_certificat: s(sit.date_certificat) || today(),
  };
}

/** Corps envoyé à l'API : chaînes vides en null, montants en nombres côté serveur. */
function corps(f: Form): Record<string, unknown> {
  return {
    reference_entreprise: f.reference_entreprise,
    date_situation: f.date_situation || null,
    date_reception_situation: f.date_reception_situation,
    montant_presente_ht: f.montant_presente_ht,
    montant_admis_ht: f.montant_admis_ht,
    revision_coeff: f.revision_coeff || 1,
    avance_remboursement: f.avance_remboursement || 0,
    penalites_ht: f.penalites_ht || 0,
    penalites_notes: f.penalites_notes,
    notes_moe: f.notes_moe,
  };
}

export function SituationDialog({
  situation, marche, situations, plateforme, clientSiret,
  onClose, onSave, onDownload, onDelete, onLinked,
}: {
  situation: SituationLiee | null;
  marche: MarcheTravaux | null;
  /** Toutes les situations de l'affaire : le calcul ne garde que celles du marché. */
  situations: SituationTravaux[];
  plateforme: Plateforme | null;
  clientSiret?: string;
  onClose: () => void;
  onSave: (id: string, body: Record<string, unknown>) => Promise<SituationLiee>;
  onDownload: (s: SituationTravaux) => Promise<void>;
  onDelete: (s: SituationTravaux) => Promise<boolean>;
  onLinked: (s: SituationLiee) => void;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    setForm(situation ? formDepuis(situation) : null);
    setErreur('');
  }, [situation?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const verrouillee = !!situation && estCertifiee(situation);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  // Le certificat se recalcule à chaque frappe : l'architecte voit le net à
  // payer bouger pendant qu'il corrige le cumul admis.
  const brouillon: SituationTravaux | null = useMemo(() => {
    if (!situation || !form) return null;
    return {
      ...situation,
      ...form,
      revision_coeff: form.revision_coeff || 1,
      montant_admis_ht: form.montant_admis_ht,
    };
  }, [situation, form]);
  const anterieures = useMemo(
    () => (marche ? situationsDuMarche(situations, marche.id) : []),
    [situations, marche],
  );
  const certificat = brouillon ? calculerCertificat(brouillon, marche, anterieures) : null;

  if (!situation || !form || !certificat) return null;

  const montantMarche = num(marche?.montant_ht);
  const alertes: string[] = [];
  if (form.montant_presente_ht === '') alertes.push(t('situations_travaux_alert_no_amount'));
  if (certificat.periodeHt < 0) alertes.push(t('situations_travaux_alert_negative'));
  if (montantMarche > 0 && certificat.cumulAdmisHt > montantMarche) {
    alertes.push(t('situations_travaux_alert_over_contract', { amount: formatEuros(certificat.cumulAdmisHt - montantMarche) }));
  }

  const action = async (cle: string, travail: () => Promise<void>) => {
    setBusy(cle); setErreur('');
    try { await travail(); } catch (e: any) { setErreur(e?.message || t('situations_travaux_save_failed')); } finally { setBusy(null); }
  };

  const enregistrer = () => action('save', async () => { await onSave(situation.id, corps(form)); });
  const etablir = () => action('certify', async () => {
    const saved = await onSave(situation.id, { ...corps(form), etat: 'Validée', date_certificat: form.date_certificat || today() });
    await onDownload(saved);
  });
  const changerEtat = (etat: 'Brouillon' | 'Payée') => action(etat, async () => { await onSave(situation.id, { etat }); });
  const supprimer = () => action('delete', async () => { if (await onDelete(situation)) onClose(); });

  const id = (k: string) => `${uid}-${k}`;
  const montantInput = (k: keyof Form, label: string, hint?: string) => (
    <Champ label={label} htmlFor={id(k)} hint={hint}>
      <input
        id={id(k)} type="number" step="any" inputMode="decimal" disabled={verrouillee}
        className={inputClass + ' tabular-nums'} value={form[k]} onChange={(e) => set(k, e.target.value)}
      />
    </Champ>
  );

  const ligne = (label: string, valeur: number, opts: { fort?: boolean; moins?: boolean } = {}) => (
    <div className={`flex items-baseline justify-between gap-4 py-1 ${opts.fort ? 'font-bold text-[var(--tblr-text)]' : 'text-[var(--tblr-muted)]'}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums whitespace-nowrap text-[var(--tblr-text)]">
        {opts.moins && valeur !== 0 ? `− ${formatEuros(valeur)}` : formatEuros(valeur)}
      </dd>
    </div>
  );

  return (
    <DialogShell
      open
      wide
      busy={!!busy}
      onClose={onClose}
      title={t('situations_travaux_situation_title', { n: situation.numero_situation })}
      subtitle={[marche?.lot_numero ? t('situations_travaux_lot_short', { n: marche.lot_numero }) : '', marche?.lot_titre, marche?.entreprise_nom].filter(Boolean).join(' · ')}
      footer={(
        <>
          <button type="button" onClick={supprimer} disabled={!!busy || verrouillee} className={boutonSecondaire + ' mr-auto text-red-600'}>
            <IconTrash size={14} /> {t('situations_travaux_delete')}
          </button>
          {verrouillee ? (
            <>
              <button type="button" className={boutonSecondaire} onClick={() => changerEtat('Brouillon')} disabled={!!busy}>
                <IconArrowBackUp size={14} /> {t('situations_travaux_reopen')}
              </button>
              {situation.etat !== 'Payée' && (
                <button type="button" className={boutonSecondaire} onClick={() => changerEtat('Payée')} disabled={!!busy}>
                  <IconCash size={14} /> {t('situations_travaux_mark_paid')}
                </button>
              )}
              <button type="button" className={boutonPrincipal} onClick={() => action('dl', () => onDownload(situation))} disabled={!!busy}>
                <IconDownload size={14} /> {t('situations_travaux_download_certificate')}
              </button>
            </>
          ) : (
            <>
              <button type="button" className={boutonSecondaire} onClick={enregistrer} disabled={!!busy}>
                {busy === 'save' ? t('situations_travaux_saving') : t('situations_travaux_save')}
              </button>
              <button type="button" className={boutonPrincipal} onClick={etablir} disabled={!!busy || form.montant_presente_ht === ''}>
                <IconFileCertificate size={14} />
                {busy === 'certify' ? t('situations_travaux_saving') : t('situations_travaux_issue_certificate')}
              </button>
            </>
          )}
        </>
      )}
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_22rem] gap-6">
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <EtatSituationBadge etat={situation.etat} />
            {verrouillee && <p className="text-xs text-[var(--tblr-muted)]">{t('situations_travaux_locked_hint')}</p>}
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-bold text-[var(--tblr-text)] mb-2">{t('situations_travaux_section_received')}</legend>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Champ label={t('situations_travaux_company_ref')} htmlFor={id('ref')}>
                <input id={id('ref')} disabled={verrouillee} className={inputClass} value={form.reference_entreprise} onChange={(e) => set('reference_entreprise', e.target.value)} />
              </Champ>
              <Champ label={t('situations_travaux_situation_date')} htmlFor={id('date')}>
                <input id={id('date')} type="date" disabled={verrouillee} className={inputClass} value={form.date_situation} onChange={(e) => set('date_situation', e.target.value)} />
              </Champ>
              <Champ label={t('situations_travaux_received_on')} htmlFor={id('recu')}>
                <input id={id('recu')} type="date" disabled={verrouillee} className={inputClass} value={form.date_reception_situation} onChange={(e) => set('date_reception_situation', e.target.value)} />
              </Champ>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {montantInput('montant_presente_ht', t('situations_travaux_presented_ht'), t('situations_travaux_presented_ht_hint'))}
              {montantInput('montant_admis_ht', t('situations_travaux_admitted_ht'), t('situations_travaux_admitted_ht_hint'))}
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-bold text-[var(--tblr-text)] mb-2">{t('situations_travaux_section_adjustments')}</legend>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {marche?.revision_active && montantInput('revision_coeff', t('situations_travaux_revision_coeff'), t('situations_travaux_revision_coeff_hint'))}
              {montantInput('avance_remboursement', t('situations_travaux_advance_repayment'))}
              {montantInput('penalites_ht', t('situations_travaux_penalties'))}
            </div>
            {num(form.penalites_ht) > 0 && (
              <Champ label={t('situations_travaux_penalties_reason')} htmlFor={id('penr')}>
                <input id={id('penr')} disabled={verrouillee} className={inputClass} value={form.penalites_notes} onChange={(e) => set('penalites_notes', e.target.value)} />
              </Champ>
            )}
            <Champ label={t('situations_travaux_observations')} htmlFor={id('obs')} hint={t('situations_travaux_observations_hint')}>
              <textarea id={id('obs')} rows={3} disabled={verrouillee} className={inputClass} value={form.notes_moe} onChange={(e) => set('notes_moe', e.target.value)} />
            </Champ>
            {!verrouillee && (
              <Champ label={t('situations_travaux_certificate_date')} htmlFor={id('dcert')}>
                <input id={id('dcert')} type="date" className={inputClass + ' sm:max-w-[12rem]'} value={form.date_certificat} onChange={(e) => set('date_certificat', e.target.value)} />
              </Champ>
            )}
          </fieldset>

          {plateforme && verrouillee && marche && (
            <FactureEntrepriseLink plateforme={plateforme} situation={situation} marche={marche} clientSiret={clientSiret} onUpdated={onLinked} />
          )}
          {erreur && <p role="alert" className="text-sm text-red-600">{erreur}</p>}
        </div>

        <aside aria-label={t('situations_travaux_certificate_preview')} className="rounded-lg bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] p-4 text-sm self-start lg:sticky lg:top-0">
          <h3 className="text-[0.6875rem] font-bold uppercase text-[var(--tblr-muted)] mb-2">{t('situations_travaux_certificate_preview')}</h3>
          {alertes.length > 0 && (
            <ul className="mb-3 space-y-1">
              {alertes.map((a) => (
                <li key={a} className="flex gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                  <IconAlertTriangle size={14} className="shrink-0 mt-px" aria-hidden /> {a}
                </li>
              ))}
            </ul>
          )}
          <dl className="divide-y divide-[var(--tblr-border)]">
            <div className="pb-2">
              {ligne(t('situations_travaux_admitted_ht'), certificat.cumulAdmisHt)}
              {ligne(t('situations_travaux_previous_ht'), certificat.cumulPrecedentHt, { moins: true })}
              {ligne(t('situations_travaux_period_ht'), certificat.periodeHt, { fort: true })}
            </div>
            <div className="py-2">
              {certificat.revisionHt !== 0 && ligne(t('situations_travaux_revision'), certificat.revisionHt)}
              {ligne(t('situations_travaux_vat', { rate: certificat.tvaRate.toLocaleString('fr-FR') }), certificat.tva)}
              {ligne(t('situations_travaux_period_ttc'), certificat.periodeTtc, { fort: true })}
            </div>
            <div className="py-2">
              {ligne(t('situations_travaux_retention', { rate: certificat.retenuePct.toLocaleString('fr-FR') }), certificat.retenue, { moins: true })}
              {certificat.avanceRemboursement !== 0 && ligne(t('situations_travaux_advance_repayment'), certificat.avanceRemboursement, { moins: true })}
              {certificat.penalites !== 0 && ligne(t('situations_travaux_penalties'), certificat.penalites, { moins: true })}
            </div>
            <div className="pt-2">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="font-bold text-[var(--tblr-text)]">{t('situations_travaux_net_to_pay')}</dt>
                <dd className="text-lg font-bold tabular-nums text-[var(--tblr-text)]">{formatEuros(certificat.netAPayer)}</dd>
              </div>
              {certificat.avancementPct !== null && (
                <p className="text-xs text-[var(--tblr-muted)] mt-1">
                  {t('situations_travaux_progress', { pct: certificat.avancementPct.toLocaleString('fr-FR') })}
                </p>
              )}
            </div>
          </dl>
        </aside>
      </div>
    </DialogShell>
  );
}
