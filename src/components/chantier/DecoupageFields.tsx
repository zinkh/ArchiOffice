import { useState } from 'react';
import { IconPlus, IconTrash, IconX, IconDownload } from '@tabler/icons-react';
import type { Batiment, PhaseOperation } from '../../types/dpgf';
import {
  batimentsActifs, phasesActives, libelleRegistre, registreDepuisDocument, sanitizeDecoupage,
  SANS_AFFECTATION, type DecoupageChantier, type FiltreDecoupage,
} from '../../lib/chantierDecoupage';

const SELECT = 'px-2.5 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-[var(--tblr-primary)]';

interface SelectsProps {
  decoupage: DecoupageChantier;
  batimentId?: string | null;
  phaseId?: string | null;
  onChange: (patch: { batiment_id?: string | null; phase_id?: string | null }) => void;
  className?: string;
}

/** Bâtiment et phase d'un compte-rendu ou d'une observation ; rien tant que le chantier n'en compte qu'un. */
export function DecoupageSelects({ decoupage, batimentId, phaseId, onChange, className }: SelectsProps) {
  const batiments = batimentsActifs(decoupage);
  const phases = phasesActives(decoupage);
  if (batiments.length === 0 && phases.length === 0) return null;
  return (
    <div className={className ?? 'flex flex-wrap gap-2'}>
      {batiments.length > 0 && (
        <select aria-label="Bâtiment" className={SELECT} value={batimentId || ''} onChange={e => onChange({ batiment_id: e.target.value || null })}>
          <option value="">Tous les bâtiments</option>
          {batiments.map(b => <option key={b.id} value={b.id}>{libelleRegistre(b)}</option>)}
        </select>
      )}
      {phases.length > 0 && (
        <select aria-label="Phase" className={SELECT} value={phaseId || ''} onChange={e => onChange({ phase_id: e.target.value || null })}>
          <option value="">Toutes les phases</option>
          {phases.map(p => <option key={p.id} value={p.id}>{libelleRegistre(p)}</option>)}
        </select>
      )}
    </div>
  );
}

interface FilterProps {
  decoupage: DecoupageChantier;
  filtre: FiltreDecoupage;
  onChange: (f: FiltreDecoupage) => void;
}

/** Filtres de liste : un bâtiment, une phase, ou ce qui n'est pas encore affecté. */
export function DecoupageFilters({ decoupage, filtre, onChange }: FilterProps) {
  const batiments = batimentsActifs(decoupage);
  const phases = phasesActives(decoupage);
  if (batiments.length === 0 && phases.length === 0) return null;
  return (
    <>
      {batiments.length > 0 && (
        <select aria-label="Filtrer par bâtiment" className={SELECT} value={filtre.batimentId} onChange={e => onChange({ ...filtre, batimentId: e.target.value })}>
          <option value="">Tous les bâtiments</option>
          {batiments.map(b => <option key={b.id} value={b.id}>{libelleRegistre(b)}</option>)}
          <option value={SANS_AFFECTATION}>Sans bâtiment</option>
        </select>
      )}
      {phases.length > 0 && (
        <select aria-label="Filtrer par phase" className={SELECT} value={filtre.phaseId} onChange={e => onChange({ ...filtre, phaseId: e.target.value })}>
          <option value="">Toutes les phases</option>
          {phases.map(p => <option key={p.id} value={p.id}>{libelleRegistre(p)}</option>)}
          <option value={SANS_AFFECTATION}>Sans phase</option>
        </select>
      )}
    </>
  );
}

interface PanelProps {
  decoupage: DecoupageChantier;
  projectId: string;
  onSave: (d: DecoupageChantier) => void;
  onClose: () => void;
}

const nextOrdre = (items: { ordre: number }[]) => items.reduce((m, x) => Math.max(m, x.ordre), -1) + 1;
const CHAMP = 'px-2 py-1 text-sm border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 dark:text-white outline-none focus:ring-1 focus:ring-[var(--tblr-primary)]';

/** Registre des bâtiments et phases du chantier. Retirer un bâtiment ne supprime rien : ses comptes-rendus et observations repassent « sans bâtiment ». */
export function DecoupagePanelChantier({ decoupage, projectId, onSave, onClose }: PanelProps) {
  const [draft, setDraft] = useState<DecoupageChantier>({
    multiBatiments: true, multiPhases: true,
    batiments: decoupage.batiments ?? [], phases: decoupage.phases ?? [],
  });
  const [message, setMessage] = useState('');
  const batiments = draft.batiments ?? [];
  const phases = draft.phases ?? [];

  const patchItem = <T extends Batiment | PhaseOperation>(key: 'batiments' | 'phases', id: string, p: Partial<T>) =>
    setDraft(d => ({ ...d, [key]: (d[key] ?? []).map(x => (x.id === id ? { ...x, ...p } : x)) }));
  const removeItem = (key: 'batiments' | 'phases', id: string) =>
    setDraft(d => ({ ...d, [key]: (d[key] ?? []).filter(x => x.id !== id) }));
  const addItem = (key: 'batiments' | 'phases') =>
    setDraft(d => {
      const list = d[key] ?? [];
      const code = key === 'batiments' ? String.fromCharCode(65 + (list.length % 26)) : `PH${list.length + 1}`;
      return { ...d, [key]: [...list, { id: crypto.randomUUID(), code, libelle: '', ordre: nextOrdre(list) }] };
    });

  const reprendreDuDpgf = async () => {
    setMessage('');
    try {
      const res = await fetch(`/api/projects/${projectId}/dpgf`);
      if (res.status === 404) { setMessage('Cette opération n’a pas encore de CCTP / DPGF.'); return; }
      if (!res.ok) throw new Error();
      const repris = registreDepuisDocument(await res.json());
      if ((repris.batiments?.length ?? 0) + (repris.phases?.length ?? 0) === 0) {
        setMessage('Le CCTP/DPGF de cette opération ne définit ni bâtiment ni phase.');
        return;
      }
      setDraft(d => {
        // Fusion par identifiant : ce qui est déjà saisi ici est gardé.
        const fusion = <T extends { id: string }>(actuel: T[] | undefined, apport: T[] | undefined) => {
          const ids = new Set((actuel ?? []).map(x => x.id));
          return [...(actuel ?? []), ...(apport ?? []).filter(x => !ids.has(x.id))];
        };
        return { ...d, batiments: fusion(d.batiments, repris.batiments), phases: fusion(d.phases, repris.phases) };
      });
    } catch {
      setMessage('Lecture du CCTP/DPGF impossible (hors connexion ?).');
    }
  };

  const renderList = (key: 'batiments' | 'phases', items: (Batiment | PhaseOperation)[], titre: string, vide: string) => (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-bold dark:text-white">{titre}</h4>
        <button type="button" onClick={() => addItem(key)} className="flex items-center gap-1 text-xs font-bold text-[var(--tblr-primary)] hover:underline">
          <IconPlus size={14} /> Ajouter
        </button>
      </div>
      {items.length === 0 && <p className="text-xs italic text-zinc-500">{vide}</p>}
      <ul className="space-y-1.5">
        {items.map(item => (
          <li key={item.id} className="flex items-center gap-2">
            <input aria-label="Code" className={`${CHAMP} w-20`} value={item.code} maxLength={12}
              onChange={e => patchItem(key, item.id, { code: e.target.value })} />
            <input aria-label="Libellé" className={`${CHAMP} flex-1 min-w-0`} value={item.libelle} maxLength={80} placeholder="Libellé (facultatif)"
              onChange={e => patchItem(key, item.id, { libelle: e.target.value })} />
            <button type="button" aria-label={`Retirer ${libelleRegistre(item)}`} onClick={() => removeItem(key, item.id)} className="p-1 text-zinc-400 hover:text-red-600">
              <IconTrash size={16} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Bâtiments et phases du chantier"
        className="bg-white dark:bg-zinc-900 p-5 rounded-xl w-full max-w-lg max-h-[90dvh] overflow-y-auto space-y-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold dark:text-white">Bâtiments et phases</h3>
            <p className="text-xs text-zinc-500 mt-1">
              Chaque compte-rendu et chaque observation peut se rapporter à un bâtiment et à une phase. Sans choix, ils concernent toute l'opération.
            </p>
          </div>
          <button type="button" aria-label="Fermer" onClick={onClose} className="p-1 text-zinc-400 hover:text-zinc-700"><IconX size={18} /></button>
        </div>
        <button type="button" onClick={reprendreDuDpgf}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg dark:text-white">
          <IconDownload size={14} /> Reprendre ceux du CCTP / DPGF
        </button>
        {message && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">{message}</p>}
        {renderList('batiments', batiments, 'Bâtiments', 'Aucun bâtiment : le chantier est suivi d’un seul tenant.')}
        {renderList('phases', phases, 'Phases', 'Aucune phase : le chantier est suivi d’un seul tenant.')}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold dark:text-zinc-300">Annuler</button>
          <button type="button" onClick={() => onSave(sanitizeDecoupage(draft))} className="px-4 py-2 bg-[var(--tblr-primary)] hover:brightness-90 text-white rounded-lg text-sm font-bold">Enregistrer</button>
        </div>
      </div>
    </div>
  );
}
