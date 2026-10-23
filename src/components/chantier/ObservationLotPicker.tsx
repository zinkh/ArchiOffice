import { useMemo, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { IconBuilding, IconChevronDown } from '@tabler/icons-react';
import { ModalShell } from '../ui/ModalShell';
import { cn } from '../../lib/utils';
import type { Observation, ProjectLot } from '../../types';
import {
  observationScopeLabel, observationSelectedLotIds, selectionToFields, TCE_FULL_LABEL, TCE_LABEL,
  type LotSelectionFields,
} from '../../lib/observationLots';
import { TOUCH_TARGET } from './fields';

export type LotChoice = LotSelectionFields & {
  /** Entreprise désignée : celle du lot quand il n'y en a qu'un, effacée pour plusieurs lots ou TCE (les lots portent alors les entreprises). */
  contact_id: string | null;
};

type PickerLot = Pick<ProjectLot, 'id' | 'lot_number' | 'lot_title'> & { contact_name?: string | null; contact_id?: string | null };

const entreprise = (l: PickerLot) => (l.contact_name || '').split(' - ')[0].trim();
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Attribution d'une observation à un lot, à plusieurs lots ou à tous (TCE). Un seul geste pour
 * corriger l'entreprise d'une observation saisie dans le mauvais lot : le bouton montre l'attribution
 * actuelle, la fenêtre permet de la changer sans recopier l'observation.
 */
export function ObservationLotPicker({ obs, lots, onApply, className }: {
  obs: Observation;
  lots: readonly PickerLot[];
  onApply: (choice: LotChoice) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [tce, setTce] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  const openPicker = () => {
    setTce(!!obs.tce);
    setSelected(new Set(observationSelectedLotIds(obs)));
    setQuery('');
    setOpen(true);
  };

  const visible = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return lots;
    return lots.filter(l => norm(`${l.lot_number} ${l.lot_title} ${entreprise(l)}`).includes(q));
  }, [lots, query]);

  const toggle = (id: string) => {
    setTce(false);
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const apply = () => {
    const fields = selectionToFields([...selected], lots, tce);
    const only = !fields.tce && fields.lot_ids.length === 0 ? lots.find(l => l.id === fields.lot_id) : undefined;
    onApply({ ...fields, contact_id: only?.contact_id ?? null });
    setOpen(false);
  };

  const scope = observationScopeLabel(obs, lots);
  const current = obs.tce ? TCE_FULL_LABEL : observationSelectedLotIds(obs).map(id => lots.find(l => l.id === id)).filter((l): l is PickerLot => !!l).map(entreprise).filter(Boolean).join(', ');

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        aria-haspopup="dialog"
        aria-label={`Lot et entreprise : ${scope}${current ? `, ${current}` : ''}. Modifier l'attribution`}
        title="Changer le lot et l'entreprise, ou attribuer à plusieurs lots / tous (TCE)"
        className={cn(
          'inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--tblr-border)] px-2.5 py-1 text-xs hover:bg-[var(--tblr-surface)]',
          obs.tce && 'font-bold', TOUCH_TARGET, className,
        )}
      >
        <IconBuilding size={13} aria-hidden="true" className="shrink-0 text-[var(--tblr-muted)]" />
        <span className="truncate">{scope}{current && !obs.tce ? ` · ${current}` : ''}</span>
        <IconChevronDown size={12} aria-hidden="true" className="shrink-0 text-[var(--tblr-muted)]" />
      </button>
      <AnimatePresence>
        {open && (
          <ModalShell
            key="lot-picker"
            size="md"
            title="Lot et entreprise de l'observation"
            subtitle="Cochez un lot pour corriger l'entreprise, plusieurs lots, ou TCE pour tous."
            onClose={() => setOpen(false)}
            footer={(
              <>
                <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost">Annuler</button>
                <button type="button" onClick={apply} className="btn btn-primary">Appliquer</button>
              </>
            )}
          >
            <div className="p-4 space-y-3 text-sm">
              <label className={cn('flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer', tce ? 'border-[var(--tblr-primary)]' : 'border-[var(--tblr-border)]')}>
                <input type="checkbox" className="mt-1 size-4" checked={tce} onChange={e => { setTce(e.target.checked); if (e.target.checked) setSelected(new Set()); }} />
                <span>
                  <span className="block font-bold">{TCE_LABEL} · {TCE_FULL_LABEL}</span>
                  <span className="block text-xs text-[var(--tblr-muted)]">L'observation concerne tous les lots : chaque entreprise la reçoit à la diffusion.</span>
                </span>
              </label>
              <input
                type="search"
                aria-label="Chercher un lot ou une entreprise"
                placeholder="Chercher un lot ou une entreprise…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="w-full rounded-lg border border-[var(--tblr-border)] bg-transparent px-3 py-2 text-sm"
              />
              <fieldset disabled={tce} className={cn('space-y-1', tce && 'opacity-50')}>
                <legend className="sr-only">Lots concernés</legend>
                {visible.length === 0 && <p className="py-3 text-center text-[var(--tblr-muted)]">Aucun lot ne correspond.</p>}
                {visible.map(l => (
                  <label key={l.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-[var(--tblr-surface-2)]">
                    <input type="checkbox" className="size-4" checked={selected.has(l.id)} onChange={() => toggle(l.id)} />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{l.lot_number} · {l.lot_title}</span>
                      <span className="block truncate text-xs text-[var(--tblr-muted)]">{entreprise(l) || 'Entreprise à désigner'}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              {!tce && selected.size === 0 && <p className="text-xs text-[var(--tblr-muted)]">Sans lot coché, l'observation n'est rattachée à aucun lot.</p>}
            </div>
          </ModalShell>
        )}
      </AnimatePresence>
    </>
  );
}
