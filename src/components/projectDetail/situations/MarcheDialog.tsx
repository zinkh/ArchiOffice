import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectLot } from '../../../types';
import type { MarcheTravaux } from '../../../lib/certificatPaiement';
import { num } from '../../../lib/certificatPaiement';
import { DialogShell, Champ, inputClass, boutonPrincipal, boutonSecondaire } from './DialogShell';

export interface MarcheForm {
  entreprise_nom: string;
  entreprise_siret: string;
  lot_numero: string;
  lot_titre: string;
  montant_ht: string;
  tva_rate: string;
  avance_montant_ttc: string;
  retenue_garantie_pct: string;
  retenue_garantie_bancaire: boolean;
  revision_active: boolean;
}

const vide: MarcheForm = {
  entreprise_nom: '', entreprise_siret: '', lot_numero: '', lot_titre: '', montant_ht: '',
  tva_rate: '20', avance_montant_ttc: '', retenue_garantie_pct: '5',
  retenue_garantie_bancaire: false, revision_active: false,
};

export const montantLot = (lot: ProjectLot): number =>
  (lot.base_amount || 0) + (lot.options_amount || 0) + (lot.amendments_amount || 0);

/** Corps envoyé à l'API, montants en nombres. */
export function marcheDepuisLot(lot: ProjectLot): Record<string, unknown> {
  return {
    entreprise_nom: lot.contact_name || '',
    lot_numero: lot.lot_number || '',
    lot_titre: lot.lot_title || '',
    montant_ht: montantLot(lot),
    tva_rate: 20,
    retenue_garantie_pct: 5,
  };
}

function formDepuisMarche(m: MarcheTravaux): MarcheForm {
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  return {
    entreprise_nom: m.entreprise_nom ?? '',
    entreprise_siret: s(m.entreprise_siret),
    lot_numero: s(m.lot_numero),
    lot_titre: s(m.lot_titre),
    montant_ht: s(m.montant_ht),
    tva_rate: s(m.tva_rate ?? 20),
    avance_montant_ttc: num(m.avance_montant_ttc) ? s(m.avance_montant_ttc) : '',
    retenue_garantie_pct: s(m.retenue_garantie_pct ?? 5),
    retenue_garantie_bancaire: !!m.retenue_garantie_bancaire,
    revision_active: !!m.revision_active,
  };
}

export function MarcheDialog({
  open, marche, lots, onClose, onSave,
}: {
  open: boolean;
  /** Absent : création. */
  marche: MarcheTravaux | null;
  lots: ProjectLot[];
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const [form, setForm] = useState<MarcheForm>(vide);
  const [saving, setSaving] = useState(false);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm(marche ? formDepuisMarche(marche) : vide);
    setErreur('');
  }, [open, marche]);

  const set = <K extends keyof MarcheForm>(k: K, v: MarcheForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const reprendreLot = (lotId: string) => {
    const lot = lots.find((l) => l.id === lotId);
    if (!lot) return;
    setForm((f) => ({
      ...f,
      lot_numero: lot.lot_number || '',
      lot_titre: lot.lot_title || '',
      entreprise_nom: lot.contact_name || f.entreprise_nom,
      montant_ht: montantLot(lot) ? String(montantLot(lot)) : f.montant_ht,
    }));
  };

  const siretValide = !form.entreprise_siret || /^\d{14}$/.test(form.entreprise_siret.replace(/\s/g, ''));

  const enregistrer = async () => {
    if (!form.entreprise_nom.trim()) { setErreur(t('situations_travaux_marche_error_company')); return; }
    if (!siretValide) { setErreur(t('situations_travaux_marche_error_siret')); return; }
    setSaving(true);
    setErreur('');
    try {
      await onSave({
        entreprise_nom: form.entreprise_nom.trim(),
        entreprise_siret: form.entreprise_siret.replace(/\s/g, '') || null,
        lot_numero: form.lot_numero.trim(),
        lot_titre: form.lot_titre.trim(),
        montant_ht: num(form.montant_ht),
        tva_rate: form.tva_rate === '' ? 20 : num(form.tva_rate),
        avance_montant_ttc: num(form.avance_montant_ttc),
        retenue_garantie_pct: form.retenue_garantie_pct === '' ? 5 : num(form.retenue_garantie_pct),
        retenue_garantie_bancaire: form.retenue_garantie_bancaire,
        revision_active: form.revision_active,
      });
    } catch (e: any) {
      setErreur(e?.message || t('situations_travaux_save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const id = (k: string) => `${uid}-${k}`;

  return (
    <DialogShell
      open={open}
      busy={saving}
      onClose={onClose}
      title={marche ? t('situations_travaux_marche_edit') : t('situations_travaux_marche_new')}
      subtitle={t('situations_travaux_marche_hint')}
      footer={(
        <>
          <button type="button" className={boutonSecondaire} onClick={onClose} disabled={saving}>{t('projectdetail_dialog_cancel')}</button>
          <button type="button" className={boutonPrincipal} onClick={enregistrer} disabled={saving}>
            {saving ? t('situations_travaux_saving') : t('situations_travaux_save')}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        {!marche && lots.length > 0 && (
          <Champ label={t('situations_travaux_marche_from_lot')} htmlFor={id('lot')}>
            <select id={id('lot')} className={inputClass} defaultValue="" onChange={(e) => reprendreLot(e.target.value)}>
              <option value="">{t('situations_travaux_marche_from_lot_none')}</option>
              {lots.map((l) => (
                <option key={l.id} value={l.id}>
                  {[l.lot_number, l.lot_title, l.contact_name].filter(Boolean).join(' · ')}
                </option>
              ))}
            </select>
          </Champ>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-[6rem_1fr] gap-3">
          <Champ label={t('situations_travaux_lot_number')} htmlFor={id('num')}>
            <input id={id('num')} className={inputClass} value={form.lot_numero} onChange={(e) => set('lot_numero', e.target.value)} />
          </Champ>
          <Champ label={t('situations_travaux_lot_title')} htmlFor={id('titre')}>
            <input id={id('titre')} className={inputClass} value={form.lot_titre} onChange={(e) => set('lot_titre', e.target.value)} />
          </Champ>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Champ label={t('situations_travaux_company')} htmlFor={id('ent')}>
            <input id={id('ent')} className={inputClass} value={form.entreprise_nom} onChange={(e) => set('entreprise_nom', e.target.value)} required />
          </Champ>
          <Champ label={t('situations_travaux_siret')} htmlFor={id('siret')} hint={t('situations_travaux_siret_hint')}>
            <input
              id={id('siret')} inputMode="numeric" className={inputClass + ' font-mono'}
              aria-invalid={!siretValide}
              value={form.entreprise_siret} onChange={(e) => set('entreprise_siret', e.target.value)}
            />
          </Champ>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Champ label={t('situations_travaux_marche_amount')} htmlFor={id('ht')} className="col-span-2">
            <input id={id('ht')} type="number" step="any" min={0} inputMode="decimal" className={inputClass + ' tabular-nums'} value={form.montant_ht} onChange={(e) => set('montant_ht', e.target.value)} />
          </Champ>
          <Champ label={t('situations_travaux_vat_rate')} htmlFor={id('tva')}>
            <input id={id('tva')} type="number" step="any" min={0} inputMode="decimal" className={inputClass + ' tabular-nums'} value={form.tva_rate} onChange={(e) => set('tva_rate', e.target.value)} />
          </Champ>
          <Champ label={t('situations_travaux_retention_pct')} htmlFor={id('rg')}>
            <input
              id={id('rg')} type="number" step="any" min={0} max={5} inputMode="decimal"
              className={inputClass + ' tabular-nums'} disabled={form.retenue_garantie_bancaire}
              value={form.retenue_garantie_pct} onChange={(e) => set('retenue_garantie_pct', e.target.value)}
            />
          </Champ>
        </div>
        <Champ label={t('situations_travaux_advance_paid')} htmlFor={id('av')} hint={t('situations_travaux_advance_paid_hint')}>
          <input id={id('av')} type="number" step="any" min={0} inputMode="decimal" className={inputClass + ' tabular-nums sm:max-w-[14rem]'} value={form.avance_montant_ttc} onChange={(e) => set('avance_montant_ttc', e.target.value)} />
        </Champ>
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm text-[var(--tblr-text)]">
            <input type="checkbox" className="mt-0.5" checked={form.retenue_garantie_bancaire} onChange={(e) => set('retenue_garantie_bancaire', e.target.checked)} />
            <span>{t('situations_travaux_bank_guarantee')}</span>
          </label>
          <label className="flex items-start gap-2 text-sm text-[var(--tblr-text)]">
            <input type="checkbox" className="mt-0.5" checked={form.revision_active} onChange={(e) => set('revision_active', e.target.checked)} />
            <span>{t('situations_travaux_revisable')}</span>
          </label>
        </div>
        {erreur && <p role="alert" className="text-sm text-[var(--tblr-danger)]">{erreur}</p>}
      </div>
    </DialogShell>
  );
}
