import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { IconPlus } from '@tabler/icons-react';
import { ModalShell } from '../ui/ModalShell';
import { cn } from '../../lib/utils';
import { TCE_FULL_LABEL, TCE_LABEL } from '../../lib/observationLots';
import { ROW_FIELD } from './fields';

export interface IntervenantOption {
  /** Texte enregistré dans le champ « Société ». */
  value: string;
  label: string;
  /** « Lot 02 Plâtrerie », « Bureau de contrôle »... : le rôle de l'intervenant sur le chantier. */
  detail?: string;
}

const TCE_OPTION: IntervenantOption = { value: TCE_LABEL, label: `${TCE_LABEL} · ${TCE_FULL_LABEL}`, detail: 'Toutes les entreprises' };
const MAX_VISIBLE = 30;
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Choix de la société d'une rubrique : liste déroulante des intervenants du chantier, filtrée au fil
 * de la saisie, avec TCE (tout corps d'état) en tête et une ligne pour créer un intervenant qui n'en
 * fait pas encore partie. Le texte tapé n'est enregistré que s'il correspond à une proposition : une
 * valeur libre déjà enregistrée reste affichée, mais on ne peut plus en inventer une par une faute de frappe.
 */
export function IntervenantCombobox({ value, options, onCommit, onCreate, label, placeholder = 'Société', className }: {
  value: string;
  options: readonly IntervenantOption[];
  onCommit: (value: string) => void;
  /** Demande de création d'un intervenant (le texte tapé amorce son nom). */
  onCreate: (query: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  useEffect(() => { if (!open) setDraft(value); }, [value, open]);

  const all = useMemo(() => [TCE_OPTION, ...options], [options]);
  const shown = useMemo(() => {
    const q = norm(draft === value ? '' : draft);
    const matching = q ? all.filter(o => norm(`${o.label} ${o.detail ?? ''}`).includes(q)) : all;
    return matching.slice(0, MAX_VISIBLE);
  }, [all, draft, value]);
  // Dernière ligne : la création. Toujours là, pour qu'un intervenant absent se crée sans quitter la rubrique.
  const createIndex = shown.length;

  const choose = (index: number) => {
    if (index === createIndex) {
      const query = draft === value ? '' : draft.trim();
      setOpen(false);
      onCreate(query);
      return;
    }
    const option = shown[index];
    if (!option) return;
    setOpen(false);
    setDraft(option.value);
    if (option.value !== value) onCommit(option.value);
  };

  const close = () => {
    setOpen(false);
    // Un texte qui est exactement une proposition vaut choix ; sinon on rend la valeur enregistrée.
    const exact = all.find(o => norm(o.value) === norm(draft) || norm(o.label) === norm(draft));
    if (exact && exact.value !== value) { setDraft(exact.value); onCommit(exact.value); }
    else setDraft(value);
  };

  return (
    <div className={cn('relative', className)}>
      <input
        ref={inputRef}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder={placeholder}
        className={cn(ROW_FIELD, 'w-full md:text-xs pointer-coarse:min-h-11 md:pointer-coarse:min-h-0', value.trim().toUpperCase() === TCE_LABEL && 'font-bold')}
        value={draft}
        onFocus={e => { setOpen(true); setActive(0); e.currentTarget.select(); }}
        onChange={e => { setDraft(e.target.value); setOpen(true); setActive(0); }}
        onBlur={close}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(i => Math.min(i + 1, createIndex)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter' && open) { e.preventDefault(); choose(active); }
          else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setDraft(value); setOpen(false); }
        }}
      />
      {open && (
        // onMouseDown + preventDefault : le champ garde le focus, donc la sortie de champ ne referme pas la liste avant le clic.
        <ul
          id={listId}
          role="listbox"
          aria-label={`Propositions : ${label}`}
          onMouseDown={e => e.preventDefault()}
          className="absolute left-0 top-full z-30 mt-1 max-h-64 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-[var(--tblr-border)] py-1 shadow-lg"
          style={{ background: 'var(--tblr-surface)' }}
        >
          {shown.map((o, i) => (
            <li
              key={`${o.value}-${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(i)}
              className={cn('cursor-pointer px-3 py-2 text-sm pointer-coarse:min-h-11', i === active && 'bg-[var(--tblr-surface-2)]', o === TCE_OPTION && 'font-bold')}
            >
              <span className="block truncate">{o.label}</span>
              {o.detail && <span className="block truncate text-xs font-normal text-[var(--tblr-muted)]">{o.detail}</span>}
            </li>
          ))}
          {shown.length === 0 && <li role="presentation" className="px-3 py-2 text-xs text-[var(--tblr-muted)]">Aucun intervenant ne correspond.</li>}
          <li
            id={`${listId}-${createIndex}`}
            role="option"
            aria-selected={active === createIndex}
            onMouseEnter={() => setActive(createIndex)}
            onClick={() => choose(createIndex)}
            className={cn('flex cursor-pointer items-center gap-2 border-t border-[var(--tblr-border)] px-3 py-2 text-sm font-semibold text-[var(--tblr-primary)] pointer-coarse:min-h-11', active === createIndex && 'bg-[var(--tblr-surface-2)]')}
          >
            <IconPlus size={14} aria-hidden="true" />
            <span className="truncate">{draft !== value && draft.trim() ? `Créer l'intervenant « ${draft.trim()} »` : 'Créer un nouvel intervenant'}</span>
          </li>
        </ul>
      )}
    </div>
  );
}

export interface NewIntervenantInput { name: string; role: string }

/** Création d'un intervenant qui ne fait pas encore partie du chantier : nom et rôle, la fiche contact est créée ou retrouvée. */
export function NewIntervenantDialog({ open, initialName, knownNames, onSubmit, onClose }: {
  open: boolean;
  initialName: string;
  /** Noms des fiches contact du cabinet : proposés à la saisie pour ne pas créer de doublon. */
  knownNames: readonly string[];
  /** Crée ou rattache l'intervenant ; rejette avec un message lisible en cas d'échec. */
  onSubmit: (input: NewIntervenantInput) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [role, setRole] = useState('Entreprise');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  useEffect(() => { if (open) { setName(initialName); setRole('Entreprise'); setError(null); setBusy(false); } }, [open, initialName]);

  const submit = async () => {
    if (!name.trim() || !role.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ name: name.trim(), role: role.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "L'intervenant n'a pas pu être créé.");
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <ModalShell
          key="new-intervenant"
          size="md"
          busy={busy}
          title="Nouvel intervenant du chantier"
          subtitle="Il rejoint les intervenants de l'opération. Une fiche contact du cabinet du même nom est reprise, sinon elle est créée."
          onClose={onClose}
          footer={(
            <>
              <button type="button" onClick={onClose} disabled={busy} className="btn btn-ghost">Annuler</button>
              <button type="button" onClick={() => { void submit(); }} disabled={busy || !name.trim() || !role.trim()} className="btn btn-primary">
                {busy ? 'Création…' : 'Créer et choisir'}
              </button>
            </>
          )}
        >
          <form className="p-4 space-y-3 text-sm" onSubmit={e => { e.preventDefault(); void submit(); }}>
            {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">{error}</div>}
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase text-[var(--tblr-muted)]">Société ou nom</span>
              <input autoFocus list={listId} value={name} onChange={e => setName(e.target.value)} maxLength={200}
                className="w-full rounded-lg border border-[var(--tblr-border)] bg-transparent px-3 py-2" />
              <datalist id={listId}>{knownNames.slice(0, 200).map(n => <option key={n} value={n} />)}</datalist>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase text-[var(--tblr-muted)]">Rôle sur le chantier</span>
              <input value={role} onChange={e => setRole(e.target.value)} maxLength={100}
                className="w-full rounded-lg border border-[var(--tblr-border)] bg-transparent px-3 py-2" />
            </label>
          </form>
        </ModalShell>
      )}
    </AnimatePresence>
  );
}
