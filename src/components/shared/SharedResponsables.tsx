// Choix du lot et de l'entreprise en charge d'une réserve, pour un confrère qui a le droit d'écriture. Les choix viennent
// du serveur (lots de l'affaire, entreprises de ses lots et de ses marchés : des noms, jamais une fiche contact) ; le serveur
// revalide chaque valeur, l'écran ne propose que ce qu'il connaît. Choisir un lot ajoute l'entreprise de sa fiche, comme le cabinet.
import { useTranslation } from 'react-i18next';
import { IconX } from '@tabler/icons-react';
import type { SharedContact } from './SharedContactCard';

export interface ResponsableOptions {
  lots: Array<{ title: string; number: string | null }>;
  entreprises: string[];
  lotEntreprise: Record<string, string>;
  /** Fiche réduite par nom d'entreprise, avec le détail de l'atelier seulement. */
  fiches?: Record<string, SharedContact>;
}
export interface Responsables { lots: string[]; entreprises: string[] }

const norm = (s: string) => s.trim().toLowerCase();

function ChipPicker({ label, values, choices, disabled, onChange }: {
  label: string; values: string[]; choices: Array<{ value: string; label: string }>; disabled: boolean; onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  const remaining = choices.filter(c => !values.some(v => norm(v) === norm(c.value)));
  return (
    <div className="space-y-1">
      <span className="text-[0.6875rem] font-semibold" style={{ color: 'var(--tblr-muted)' }}>{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {values.map(v => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full border border-[var(--tblr-border)] px-2 py-0.5 text-xs text-[var(--tblr-text)]">
            {v}
            {!disabled && (
              <button type="button" aria-label={`${t('shared_responsable_remove')} ${v}`} onClick={() => onChange(values.filter(x => x !== v))}
                className="rounded-full p-0.5 text-[var(--tblr-muted)] hover:text-[var(--tblr-text)]"><IconX size={12} aria-hidden /></button>
            )}
          </span>
        ))}
        {values.length === 0 && disabled && <span className="text-xs text-[var(--tblr-muted)]">{t('shared_responsable_none')}</span>}
        {!disabled && remaining.length > 0 && (
          <select value="" aria-label={label} onChange={e => { if (e.target.value) onChange([...values, e.target.value]); }}
            className="px-2 py-1 text-xs border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-800">
            <option value="">{t('shared_responsable_add')}</option>
            {remaining.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

export default function SharedResponsables({ value, options, disabled, onChange }: {
  value: Responsables; options: ResponsableOptions | null; disabled: boolean; onChange: (next: Responsables) => void;
}) {
  const { t } = useTranslation();
  const lotChoices = (options?.lots ?? []).map(l => ({ value: l.title, label: l.number ? `${l.number} · ${l.title}` : l.title }));
  const entrepriseChoices = (options?.entreprises ?? []).map(nom => ({ value: nom, label: nom }));
  const pickLots = (lots: string[]) => {
    // Un lot ajouté apporte l'entreprise de sa fiche, si elle n'est pas déjà en charge.
    const added = lots.filter(l => !value.lots.includes(l));
    const extra = added.map(l => options?.lotEntreprise?.[l]).filter((nom): nom is string => !!nom && !value.entreprises.some(e => norm(e) === norm(nom)));
    onChange({ lots, entreprises: [...value.entreprises, ...new Set(extra)] });
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ChipPicker label={t('shared_responsable_lots')} values={value.lots} choices={lotChoices} disabled={disabled} onChange={pickLots} />
      <ChipPicker label={t('shared_responsable_entreprises')} values={value.entreprises} choices={entrepriseChoices} disabled={disabled}
        onChange={entreprises => onChange({ lots: value.lots, entreprises })} />
    </div>
  );
}
