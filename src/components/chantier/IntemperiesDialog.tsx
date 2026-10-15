import { useId, useState } from 'react';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import type { IntemperieLot, ProjectLot, SiteReportLotTracking } from '../../types';
import {
  INTEMPERIE_TYPES, ajouterIntemperie, groupesIntemperies, libelleIntemperie, retirerIntemperie,
} from '../../lib/siteReportLotSuivi';
import { Champ, DIALOG_FIELD, DialogShell, lireNombre, nouvelId } from './LotEventsDialog';

/**
 * Intempéries du compte-rendu. Un épisode touche en général plusieurs entreprises : on le saisit
 * une fois (type, jour, jours perdus) et on coche les entreprises concernées ; il est recopié dans
 * le suivi de chacune. Chaque ajout ou retrait est enregistré tout de suite.
 */
const nomLot = (lot: ProjectLot) => lot.contact_name?.split(' - ')[0] || lot.lot_title;

export function IntemperiesDialog({ lots, tracking, reportDate, onChange, onClose }: {
  lots: ProjectLot[];
  tracking: SiteReportLotTracking[];
  /** Date du compte-rendu : jour proposé pour une intempérie. */
  reportDate?: string;
  /** Transforme la liste du suivi des lots ; l'appelant l'applique d'un seul enregistrement. */
  onChange: (transform: (list: SiteReportLotTracking[]) => SiteReportLotTracking[]) => void;
  onClose: () => void;
}) {
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const [type, setType] = useState<IntemperieLot['type']>('pluie');
  const [date, setDate] = useState(reportDate || '');
  const [jours, setJours] = useState('1');
  // Toutes les entreprises sont concernées par défaut : l'architecte décoche celles qui ne le sont pas.
  const [concernes, setConcernes] = useState<Set<string>>(() => new Set(lots.map(l => l.id)));

  const joursNb = lireNombre(jours);
  const valide = joursNb != null && joursNb > 0 && concernes.size > 0;
  const groupes = groupesIntemperies(tracking);
  const lotParId = new Map(lots.map(l => [l.id, l]));
  const anciens = tracking.filter(t => (Number(t.intemperies_jours) || 0) > 0 && lotParId.has(t.lot_id));

  const basculer = (lotId: string, coche: boolean) =>
    setConcernes(prev => { const suivant = new Set(prev); if (coche) suivant.add(lotId); else suivant.delete(lotId); return suivant; });
  const toutesCochees = lots.length > 0 && concernes.size === lots.length;

  const ajouter = () => {
    if (!valide || joursNb == null) return;
    const lotIds = lots.filter(l => concernes.has(l.id)).map(l => l.id);
    onChange(list => ajouterIntemperie(list, lotIds, { type, jours: joursNb, ...(date ? { date } : {}) }, nouvelId));
    setJours('1');
  };

  return (
    <DialogShell titre="Intempéries" sousTitre="Épisodes constatés sur ce compte-rendu et entreprises concernées" onClose={onClose}>
      {(groupes.length > 0 || anciens.length > 0) && (
        <ul className="divide-y divide-[var(--tblr-border)] rounded-lg border border-[var(--tblr-border)]">
          {groupes.map(g => (
            <li key={g.key} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--tblr-text)]">
                  {libelleIntemperie(g.type)} · {g.jours} j{g.date ? ` · ${new Date(g.date).toLocaleDateString('fr-FR')}` : ''}
                </p>
                <p className="text-xs text-[var(--tblr-muted)] break-words">
                  {g.lotIds.length === lots.length && lots.length > 1
                    ? 'Toutes les entreprises'
                    : g.lotIds.map(lotId => { const l = lotParId.get(lotId); return l ? nomLot(l) : null; }).filter(Boolean).join(', ')}
                </p>
              </div>
              <button type="button" onClick={() => onChange(list => retirerIntemperie(list, g.key))}
                aria-label={`Retirer l'intempérie ${libelleIntemperie(g.type)}${g.date ? ` du ${new Date(g.date).toLocaleDateString('fr-FR')}` : ''}`}
                className="shrink-0 inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--tblr-muted)] hover:text-red-600">
                <IconTrash size={18} />
              </button>
            </li>
          ))}
          {anciens.map(t => (
            <li key={`ancien-${t.lot_id}`} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--tblr-text)]">Saisie antérieure · {t.intemperies_jours} j</p>
                <p className="text-xs text-[var(--tblr-muted)] break-words">{nomLot(lotParId.get(t.lot_id)!)}</p>
              </div>
              <button type="button"
                onClick={() => onChange(list => list.map(x => (x.lot_id === t.lot_id ? { ...x, intemperies_jours: undefined, intemperies: undefined } : x)))}
                aria-label={`Retirer la saisie antérieure d'intempéries, ${nomLot(lotParId.get(t.lot_id)!)}`}
                className="shrink-0 inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--tblr-muted)] hover:text-red-600">
                <IconTrash size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <fieldset className="space-y-3">
        <legend className="mb-1 text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">Ajouter une intempérie</legend>
        <Champ label="Type" htmlFor={id('type')}>
          <select id={id('type')} className={DIALOG_FIELD} value={type} onChange={e => setType(e.target.value as IntemperieLot['type'])}>
            {INTEMPERIE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Champ>
        <div className="grid grid-cols-2 gap-3">
          <Champ label="Jour" htmlFor={id('date')}>
            <input id={id('date')} className={DIALOG_FIELD} type="date" value={date} onChange={e => setDate(e.target.value)} />
          </Champ>
          <Champ label="Jours perdus" htmlFor={id('jours')}>
            <input id={id('jours')} className={DIALOG_FIELD} type="number" inputMode="decimal" min={0} step={0.5} value={jours} onChange={e => setJours(e.target.value)} />
          </Champ>
        </div>

        <div role="group" aria-labelledby={id('qui')} className="space-y-1">
          <div className="flex items-center justify-between gap-3">
            <span id={id('qui')} className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">Entreprises concernées</span>
            <button type="button" onClick={() => setConcernes(toutesCochees ? new Set() : new Set(lots.map(l => l.id)))}
              className="min-h-11 px-2 text-xs font-semibold text-[var(--tblr-primary)]">
              {toutesCochees ? 'Tout décocher' : 'Tout cocher'}
            </button>
          </div>
          <ul className="rounded-lg border border-[var(--tblr-border)] divide-y divide-[var(--tblr-border)]">
            {lots.map(lot => (
              <li key={lot.id}>
                <label className="flex min-h-11 items-center gap-3 px-3 py-2 text-sm text-[var(--tblr-text)]">
                  <input type="checkbox" className="size-5 shrink-0" checked={concernes.has(lot.id)} onChange={e => basculer(lot.id, e.target.checked)} />
                  <span className="min-w-0">
                    <span className="block font-semibold break-words">{nomLot(lot)}</span>
                    <span className="block text-xs text-[var(--tblr-muted)]">{lot.lot_number} · {lot.lot_title}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-[var(--tblr-muted)]">{concernes.size} entreprise{concernes.size > 1 ? 's' : ''} concernée{concernes.size > 1 ? 's' : ''}</p>
          <button type="button" onClick={ajouter} disabled={!valide}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-[var(--tblr-primary)] px-4 text-sm font-bold text-white transition hover:brightness-90 disabled:opacity-40">
            <IconPlus size={16} /> Ajouter
          </button>
        </div>
      </fieldset>
    </DialogShell>
  );
}
