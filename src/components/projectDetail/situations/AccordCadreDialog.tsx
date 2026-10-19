import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MarcheAccordCadreChamps, ModeExecution } from '../../../lib/accordCadre';
import { Champ, DialogShell, boutonPrincipal, boutonSecondaire, inputClass } from './DialogShell';

export interface ConditionsAccordCadreBody {
  mode_execution: ModeExecution;
  montant_mini_ht: number | null;
  montant_maxi_ht: number | null;
  date_fin_accord_cadre: string | null;
  /** Rejoindre l'accord-cadre de tête indiqué (autre titulaire, plafond partagé). */
  groupe_avec?: string;
}

const MODES: ModeExecution[] = ['marches_subsequents', 'bons_de_commande', 'mixte'];

/** `null` : pas de montant ; `NaN` : saisie illisible. */
function lireMontant(brut: string): number | null {
  const s = brut.trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : Number.NaN;
}

const texteMontant = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(Number(v)));

/**
 * Conditions d'un accord-cadre : mode d'exécution, montants mini et maxi, fin.
 * Sert à ériger un marché ordinaire en accord-cadre comme à ajuster un accord-cadre existant.
 */
export function AccordCadreDialog({
  open, marche, canRemove, tetes = [], onClose, onSave, onRemove,
}: {
  open: boolean;
  marche: (MarcheAccordCadreChamps & { entreprise_nom: string }) | null;
  /** Retirer l'accord-cadre n'est possible que sans marché subséquent. */
  canRemove: boolean;
  /** Accords-cadres de l'opération qu'un marché ordinaire peut rejoindre comme titulaire de plus. */
  tetes?: { id: string; label: string }[];
  onClose: () => void;
  onSave: (body: ConditionsAccordCadreBody) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [mode, setMode] = useState<ModeExecution>('marches_subsequents');
  const [mini, setMini] = useState('');
  const [maxi, setMaxi] = useState('');
  const [fin, setFin] = useState('');
  const [rejoint, setRejoint] = useState('');
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!open || !marche) return;
    setMode(marche.mode_execution ?? 'marches_subsequents');
    setMini(texteMontant(marche.montant_mini_ht));
    setMaxi(texteMontant(marche.montant_maxi_ht));
    setFin(marche.date_fin_accord_cadre ? String(marche.date_fin_accord_cadre).slice(0, 10) : '');
    setRejoint('');
    setErreur('');
    setEnCours(false);
  }, [open, marche]);

  if (!marche) return null;
  const existant = marche.type_marche === 'accord_cadre';
  // Titulaire rattaché à un autre accord-cadre : ses conditions sont celles de la tête.
  const membre = existant && !!marche.accord_cadre_groupe_id;

  const enregistrer = async () => {
    if (rejoint) {
      setEnCours(true);
      setErreur('');
      try {
        await onSave({ mode_execution: mode, montant_mini_ht: null, montant_maxi_ht: null, date_fin_accord_cadre: null, groupe_avec: rejoint });
      } catch (e: any) {
        setErreur(e?.message || t('situations_travaux_save_failed'));
        setEnCours(false);
      }
      return;
    }
    const lMini = lireMontant(mini);
    const lMaxi = lireMontant(maxi);
    if (Number.isNaN(lMini) || Number.isNaN(lMaxi)) { setErreur(t('accord_cadre_invalid_amount')); return; }
    setEnCours(true);
    setErreur('');
    try {
      await onSave({ mode_execution: mode, montant_mini_ht: lMini, montant_maxi_ht: lMaxi, date_fin_accord_cadre: fin || null });
    } catch (e: any) {
      setErreur(e?.message || t('situations_travaux_save_failed'));
      setEnCours(false);
    }
  };

  const retirer = async () => {
    setEnCours(true);
    setErreur('');
    try {
      await onRemove();
    } catch (e: any) {
      setErreur(e?.message || t('situations_travaux_save_failed'));
      setEnCours(false);
    }
  };

  return (
    <DialogShell
      open={open}
      title={t('accord_cadre_dlg_title')}
      subtitle={marche.entreprise_nom}
      onClose={onClose}
      busy={enCours}
      footer={(
        <>
          {existant && (
            <button type="button" className={boutonSecondaire + ' mr-auto'} onClick={retirer} disabled={enCours || !canRemove}>
              {t('accord_cadre_remove')}
            </button>
          )}
          <button type="button" className={boutonSecondaire} onClick={onClose} disabled={enCours}>{t('accord_cadre_cancel')}</button>
          {!membre && <button type="button" className={boutonPrincipal} onClick={enregistrer} disabled={enCours}>{t('accord_cadre_save')}</button>}
        </>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--tblr-muted)]">{t('accord_cadre_dlg_desc')}</p>
        {membre && <p className="text-sm text-[var(--tblr-text)]">{t('accord_cadre_member_note')}</p>}
        {!existant && tetes.length > 0 && (
          <Champ label={t('accord_cadre_join')} htmlFor={`${id}-join`} hint={t('accord_cadre_join_hint')}>
            <select id={`${id}-join`} className={inputClass} value={rejoint} onChange={(e) => setRejoint(e.target.value)}>
              <option value="">{t('accord_cadre_join_none')}</option>
              {tetes.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </Champ>
        )}
        {!rejoint && !membre && (
          <>
        <Champ label={t('accord_cadre_mode')} htmlFor={`${id}-mode`}>
          <select id={`${id}-mode`} className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as ModeExecution)}>
            {MODES.map((m) => <option key={m} value={m}>{t(`accord_cadre_mode_${m}`)}</option>)}
          </select>
        </Champ>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Champ label={t('accord_cadre_min')} htmlFor={`${id}-min`}>
            <input id={`${id}-min`} className={inputClass} inputMode="decimal" value={mini} onChange={(e) => setMini(e.target.value)} />
          </Champ>
          <Champ label={t('accord_cadre_max')} htmlFor={`${id}-max`}>
            <input id={`${id}-max`} className={inputClass} inputMode="decimal" value={maxi} onChange={(e) => setMaxi(e.target.value)} />
          </Champ>
        </div>
        <Champ label={t('accord_cadre_end')} htmlFor={`${id}-fin`} hint={t('accord_cadre_end_hint')}>
          <input id={`${id}-fin`} type="date" className={inputClass} value={fin} onChange={(e) => setFin(e.target.value)} />
        </Champ>
          </>
        )}
        {erreur && <p role="alert" className="text-sm text-[var(--tblr-danger)]">{erreur}</p>}
      </div>
    </DialogShell>
  );
}
