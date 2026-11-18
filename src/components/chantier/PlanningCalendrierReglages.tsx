import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconPencil, IconTrash } from '@tabler/icons-react';
import { CALENDRIER_PLANNING, MAX_PERIODES_CALENDRIER, estDateIso, type AffichagePlanning, type CalendrierPlanning, type PeriodeCalendrierPlanning } from '../../lib/planningChantier';

interface Props {
  calendrier?: CalendrierPlanning;
  affichage: AffichagePlanning;
  disabled: boolean;
  onChange: (calendrier: CalendrierPlanning) => void;
  onAffichage: (patch: Partial<AffichagePlanning>) => void;
}
const vide = (): PeriodeCalendrierPlanning => ({ id: '', libelle: '', debut: '', fin: '', type: 'conge' });
const champ = 'rounded border border-[var(--tblr-border)] bg-[var(--tblr-surface)] px-2 py-2 text-sm min-h-11 w-full';

export function PlanningCalendrierReglages({ calendrier = CALENDRIER_PLANNING, affichage, disabled, onChange, onAffichage }: Props) {
  const { t } = useTranslation();
  const [brouillon, setBrouillon] = useState(vide);
  const [touche, setTouche] = useState(false);
  const set = (patch: Partial<PeriodeCalendrierPlanning>) => setBrouillon(p => ({ ...p, ...patch }));
  const valide = !!brouillon.libelle.trim() && estDateIso(brouillon.debut) && estDateIso(brouillon.fin) && brouillon.fin >= brouillon.debut;
  const limite = calendrier.periodes.length >= MAX_PERIODES_CALENDRIER && !brouillon.id;
  const sauver = () => {
    setTouche(true);
    if (!valide || limite) return;
    const nouvelle = { ...brouillon, libelle: brouillon.libelle.trim(), id: brouillon.id || crypto.randomUUID() };
    onChange({ ...calendrier, periodes: brouillon.id ? calendrier.periodes.map(p => p.id === brouillon.id ? nouvelle : p) : [...calendrier.periodes, nouvelle] });
    setBrouillon(vide()); setTouche(false);
  };
  return <fieldset className="mt-4 space-y-3 border-t border-[var(--tblr-border)] pt-3 text-sm" disabled={disabled}>
    <legend className="font-semibold px-1">{t('planning_calendar_title')}</legend>
    <p className="text-xs text-[var(--tblr-muted)]">{t('planning_calendar_scope')}</p>
    <div className="flex flex-wrap gap-4 items-center">
      <label>{t('planning_calendar_region')}
        <select className={champ} value={calendrier.joursFeries} onChange={e => onChange({ ...calendrier, joursFeries: e.target.value as CalendrierPlanning['joursFeries'] })}>
          <option value="france">{t('planning_calendar_france')}</option><option value="alsace_moselle">{t('planning_calendar_alsace')}</option><option value="aucun">{t('planning_calendar_none')}</option>
        </select>
      </label>
      <label className="flex gap-2 items-center min-h-11"><input type="checkbox" checked={affichage.joursFeries} onChange={e => onAffichage({ joursFeries: e.target.checked })} />{t('planning_calendar_show_holidays')}</label>
      <label className="flex gap-2 items-center min-h-11"><input type="checkbox" checked={affichage.conges} onChange={e => onAffichage({ conges: e.target.checked })} />{t('planning_calendar_show_leave')}</label>
    </div>
    {calendrier.joursFeries === 'alsace_moselle' && <p className="text-xs text-[var(--tblr-muted)]">{t('planning_calendar_alsace_help')}</p>}
    {calendrier.periodes.length > 0 && <ul className="space-y-1">
      {calendrier.periodes.map(p => <li key={p.id} className="flex flex-wrap gap-2 items-center justify-between border-b border-[var(--tblr-border)] pb-1">
        <span>{p.libelle} · {t(`planning_calendar_type_${p.type}`)} · {p.debut} – {p.fin}</span>
        <span className="inline-flex gap-1">
          <button type="button" className="btn btn-ghost min-h-11" aria-label={t('planning_calendar_edit', { name: p.libelle })} onClick={() => { setBrouillon(p); setTouche(false); }}><IconPencil size={16} aria-hidden="true" /></button>
          <button type="button" className="btn btn-ghost min-h-11" aria-label={t('planning_calendar_delete', { name: p.libelle })} onClick={() => { onChange({ ...calendrier, periodes: calendrier.periodes.filter(x => x.id !== p.id) }); if (brouillon.id === p.id) setBrouillon(vide()); }}><IconTrash size={16} aria-hidden="true" /></button>
        </span>
      </li>)}
    </ul>}
    <fieldset className="space-y-2">
      <legend className="text-xs font-semibold">{t(brouillon.id ? 'planning_calendar_edit_period' : 'planning_calendar_add_period')}</legend>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        <label>{t('planning_calendar_period_name')}<input className={champ} maxLength={100} value={brouillon.libelle} onChange={e => set({ libelle: e.target.value })} /></label>
        <label>{t('planning_calendar_period_type')}<select className={champ} value={brouillon.type} onChange={e => set({ type: e.target.value as PeriodeCalendrierPlanning['type'] })}><option value="conge">{t('planning_calendar_type_conge')}</option><option value="ferie">{t('planning_calendar_type_ferie')}</option></select></label>
        <label>{t('planning_calendar_period_start')}<input type="date" className={champ} value={brouillon.debut} onChange={e => set({ debut: e.target.value })} /></label>
        <label>{t('planning_calendar_period_end')}<input type="date" className={champ} value={brouillon.fin} min={brouillon.debut || undefined} onChange={e => set({ fin: e.target.value })} /></label>
      </div>
      <div className="flex flex-wrap gap-2"><button type="button" className="btn btn-secondary" onClick={sauver} disabled={limite}>{t(brouillon.id ? 'planning_calendar_save_period' : 'planning_calendar_add_period')}</button>
        {brouillon.id && <button type="button" className="btn btn-ghost" onClick={() => { setBrouillon(vide()); setTouche(false); }}>{t('planning_calendar_cancel_edit')}</button>}
      </div>
      {touche && !valide && <p role="alert" className="text-xs text-[var(--tblr-danger)]">{t('planning_calendar_invalid_period')}</p>}
      {limite && <p className="text-xs">{t('planning_calendar_limit', { count: MAX_PERIODES_CALENDRIER })}</p>}
    </fieldset>
  </fieldset>;
}
