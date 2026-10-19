import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconDownload, IconEdit, IconPlus, IconSignature, IconTrash } from '@tabler/icons-react';
import { conditionsDe, consommation, type MarcheAccordCadreChamps, type StatutConsommation } from '../../../lib/accordCadre';
import { Champ, DialogShell, boutonPrincipal, boutonSecondaire, formatEuros, inputClass } from './DialogShell';

export type MarcheAC = MarcheAccordCadreChamps & { id: string; entreprise_nom: string; montant_ht?: number | string | null };

const dateFr = (d?: string | null) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR') : '');

const COULEUR: Record<StatutConsommation, string> = {
  sans_plafond: 'bg-[var(--tblr-text)]',
  normal: 'bg-[var(--tblr-text)]',
  proche: 'bg-[var(--tblr-warning)]',
  atteint: 'bg-[var(--tblr-danger)]',
  depasse: 'bg-[var(--tblr-danger)]',
};

/** Enregistrement de la signature d'un accord-cadre ou d'un marché subséquent (papier ou électronique). */
export function SignatureDialog({
  open, subtitle, onClose, onSave,
}: {
  open: boolean;
  subtitle: string;
  onClose: () => void;
  onSave: (body: { mode: 'papier' | 'electronique'; date: string }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [mode, setMode] = useState<'papier' | 'electronique'>('papier');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode('papier');
    setDate(new Date().toISOString().slice(0, 10));
    setErreur('');
    setEnCours(false);
  }, [open]);

  const enregistrer = async () => {
    setEnCours(true);
    setErreur('');
    try {
      await onSave({ mode, date });
    } catch (e: any) {
      setErreur(e?.message || t('situations_travaux_save_failed'));
      setEnCours(false);
    }
  };

  return (
    <DialogShell
      open={open}
      title={t('accord_cadre_sign_title')}
      subtitle={subtitle}
      onClose={onClose}
      busy={enCours}
      footer={(
        <>
          <button type="button" className={boutonSecondaire} onClick={onClose} disabled={enCours}>{t('accord_cadre_cancel')}</button>
          <button type="button" className={boutonPrincipal} onClick={enregistrer} disabled={enCours || !date}>{t('accord_cadre_sign_button')}</button>
        </>
      )}
    >
      <div className="space-y-4">
        <Champ label={t('accord_cadre_sign_mode')} htmlFor={`${id}-mode`}>
          <select id={`${id}-mode`} className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as 'papier' | 'electronique')}>
            <option value="papier">{t('accord_cadre_sign_paper')}</option>
            <option value="electronique">{t('accord_cadre_sign_electronic')}</option>
          </select>
        </Champ>
        <Champ label={t('accord_cadre_sign_date')} htmlFor={`${id}-date`}>
          <input id={`${id}-date`} type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Champ>
        {erreur && <p role="alert" className="text-sm text-[var(--tblr-danger)]">{erreur}</p>}
      </div>
    </DialogShell>
  );
}

/**
 * Bloc d'un accord-cadre dans l'onglet RDT : consommation du plafond, signature
 * et marchés subséquents. Chaque subséquent est aussi un marché ordinaire plus bas
 * dans l'onglet, avec ses situations de travaux.
 */
export function AccordCadrePanel({
  marche, subsequents, tete, subsequentsGroupe, titulaires, onEditConditions, onSign, onNewSubsequent, onEditSubsequent, onSignSubsequent, onDeleteSubsequent, onPdfSubsequent,
}: {
  marche: MarcheAC;
  subsequents: MarcheAC[];
  /** Accord-cadre de tête quand `marche` n'est qu'un titulaire de plus : il porte les conditions communes. */
  tete?: MarcheAC;
  /** Subséquents de tous les titulaires : le plafond est partagé. */
  subsequentsGroupe?: MarcheAC[];
  /** Les titulaires du groupe (au moins deux pour parler de plafond partagé). */
  titulaires?: MarcheAC[];
  onEditConditions: () => void;
  onSign: () => void;
  onNewSubsequent: () => void;
  onEditSubsequent: (s: MarcheAC) => void;
  onSignSubsequent: (s: MarcheAC) => void;
  onDeleteSubsequent: (s: MarcheAC) => void;
  onPdfSubsequent: (s: MarcheAC) => void;
}) {
  const { t } = useTranslation();
  const conditions = conditionsDe(tete ?? marche);
  const partage = (titulaires?.length ?? 0) > 1;
  const c = consommation(conditions, (subsequentsGroupe ?? subsequents).map((s) => ({ montant_ht: Number(s.montant_ht) || 0, statut: s.statut })));
  const signe = marche.statut_signature === 'signe';
  const pctAffiche = Math.min(100, c.pctMaxi ?? 0);

  return (
    <div className="border-t border-[var(--tblr-border)]">
      <div className="px-4 sm:px-5 py-4 space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[0.6875rem] font-bold uppercase px-2 py-0.5 rounded bg-[var(--tblr-surface-2)] text-[var(--tblr-text)]">{t('accord_cadre_badge')}</span>
          {marche.mode_execution && <span className="text-xs text-[var(--tblr-muted)]">{t(`accord_cadre_mode_${marche.mode_execution}`)}</span>}
          {conditions.dateFin && <span className="text-xs text-[var(--tblr-muted)]">{t('accord_cadre_ends_on', { date: dateFr(conditions.dateFin) })}</span>}
          {signe && marche.date_signature && <span className="text-xs text-[var(--tblr-muted)]">{t('accord_cadre_signed_on', { date: dateFr(marche.date_signature) })}</span>}
          <button type="button" className={boutonSecondaire + ' px-2 ml-auto'} onClick={onEditConditions} aria-label={t('accord_cadre_edit_conditions', { company: marche.entreprise_nom })}>
            <IconEdit size={14} />
          </button>
        </div>

        {partage && (
          <p className="text-xs text-[var(--tblr-muted)]">
            {t('accord_cadre_holders', { names: (titulaires ?? []).map((x) => x.entreprise_nom).join(', ') })}
          </p>
        )}
        <div className="max-w-xl space-y-1">
          <p className="text-sm text-[var(--tblr-text)]">
            {conditions.montantMaxiHT === null
              ? t('accord_cadre_consumed_no_max', { amount: formatEuros(c.cumulHT) })
              : t('accord_cadre_consumed', { amount: formatEuros(c.cumulHT), max: formatEuros(conditions.montantMaxiHT) })}
          </p>
          {conditions.montantMaxiHT !== null && (
            <div
              className="h-2 rounded-full bg-[var(--tblr-surface-2)] overflow-hidden"
              role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pctAffiche}
              aria-label={t('accord_cadre_progress_label', { company: marche.entreprise_nom })}
            >
              <div className={`h-full ${COULEUR[c.statut]}`} style={{ width: `${pctAffiche}%` }} />
            </div>
          )}
          <p className="text-xs text-[var(--tblr-muted)]">
            {[
              c.resteMaxiHT !== null ? t('accord_cadre_remaining', { amount: formatEuros(c.resteMaxiHT) }) : '',
              c.miniAtteint === null ? '' : c.miniAtteint ? t('accord_cadre_min_reached') : t('accord_cadre_min_remaining', { amount: formatEuros(c.resteAuMiniHT ?? 0) }),
            ].filter(Boolean).join(' · ')}
          </p>
          {(c.statut === 'proche' || c.statut === 'atteint' || c.statut === 'depasse') && (
            <p role="status" className={c.statut === 'proche' ? 'text-xs font-bold text-[var(--tblr-warning)]' : 'text-xs font-bold text-[var(--tblr-danger)]'}>
              {t(`accord_cadre_status_${c.statut}`)}
            </p>
          )}
        </div>

        {!signe && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-[var(--tblr-surface-2)] px-3 py-2">
            <p className="text-sm text-[var(--tblr-text)] flex-1 basis-60">{t('accord_cadre_sign_required')}</p>
            <button type="button" className={boutonSecondaire} onClick={onSign}><IconSignature size={14} /> {t('accord_cadre_sign_button')}</button>
          </div>
        )}
      </div>

      <div className="border-t border-[var(--tblr-border)]">
        <div className="px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-bold text-[var(--tblr-text)]">{t('accord_cadre_subs_title')}</h4>
          <button type="button" className={boutonPrincipal} onClick={onNewSubsequent} disabled={!signe}>
            <IconPlus size={14} /> {t('accord_cadre_sub_add')}
          </button>
        </div>

        {subsequents.length === 0 ? (
          <p className="px-5 pb-4 text-sm text-[var(--tblr-muted)]">{t('accord_cadre_subs_empty')}</p>
        ) : (
          <ul className="divide-y divide-[var(--tblr-border)] border-t border-[var(--tblr-border)]">
            {subsequents.map((s) => {
              const n = s.numero_subsequent ?? 0;
              const signeS = s.statut_signature === 'signe';
              return (
                <li key={s.id} className="px-4 sm:px-5 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1 basis-60">
                    <p className="text-sm font-bold text-[var(--tblr-text)]">
                      {t('accord_cadre_sub_short', { n })}
                      {s.objet ? <span className="font-normal text-[var(--tblr-muted)]"> · {s.objet}</span> : null}
                    </p>
                    <p className="text-xs text-[var(--tblr-muted)]">
                      {[s.date_notification ? t('accord_cadre_sub_col_date') + ' ' + dateFr(s.date_notification) : '', signeS ? t('accord_cadre_sub_signed') : t('accord_cadre_sub_unsigned')].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <p className="text-sm font-bold tabular-nums text-[var(--tblr-text)]">{formatEuros(Number(s.montant_ht) || 0)}</p>
                  <div className="flex items-center gap-1">
                    <a href={`#marche-${s.id}`} className={boutonSecondaire + ' text-xs'}>{t('accord_cadre_sub_situations')}</a>
                    <button type="button" className={boutonSecondaire + ' px-2 min-h-11 min-w-11'} onClick={() => onPdfSubsequent(s)} aria-label={t('accord_cadre_sub_pdf_named', { n })}><IconDownload size={14} /></button>
                    {!signeS && (
                      <>
                        <button type="button" className={boutonSecondaire + ' px-2 min-h-11 min-w-11'} onClick={() => onSignSubsequent(s)} aria-label={t('accord_cadre_sub_sign_named', { n })}><IconSignature size={14} /></button>
                        <button type="button" className={boutonSecondaire + ' px-2 min-h-11 min-w-11'} onClick={() => onEditSubsequent(s)} aria-label={t('accord_cadre_sub_edit_named', { n })}><IconEdit size={14} /></button>
                        <button type="button" className={boutonSecondaire + ' px-2 min-h-11 min-w-11'} onClick={() => onDeleteSubsequent(s)} aria-label={t('accord_cadre_sub_delete_named', { n })}><IconTrash size={14} /></button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
