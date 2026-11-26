// Petits éléments d'interface partagés par les écrans de négociation (module ACT).
import React, { useState } from 'react';
import { cn } from '../../lib/utils';
import { STATUT_LIBELLES, type StatutNegociation } from '../../lib/actNegociation';
import type { ModeRemise, RemiseCommerciale } from '../../lib/remiseCommerciale';

export const CARTE_STYLE: React.CSSProperties = {
  background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)',
};

export const CHAMP = 'px-2 py-1.5 text-sm border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500';
export const BOUTON = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-zinc-800 text-[var(--tblr-text)] hover:bg-zinc-200 dark:hover:bg-zinc-700 transition disabled:opacity-40';
export const BOUTON_PLEIN = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-40';
export const ENTETE_TH = 'px-3 py-2 text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]';

export const eur = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);

interface NumInputProps {
  value: number | undefined | null;
  onChange: (v: number | undefined) => void;
  label: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

/** Champ de montant : vide = « pas de valeur » (jamais zéro, qui est un prix). */
export function NumInput({ value, onChange, label, placeholder, className, disabled }: NumInputProps) {
  return (
    <input
      type="number" step="0.01" aria-label={label} disabled={disabled}
      className={cn(CHAMP, 'w-full text-right', className)}
      value={value ?? ''} placeholder={placeholder ?? '—'}
      onChange={e => {
        const v = e.target.value;
        const n = v === '' ? undefined : parseFloat(v);
        onChange(n == null || Number.isNaN(n) ? undefined : n);
      }}
    />
  );
}

interface RemiseInputProps {
  remise: RemiseCommerciale | undefined;
  /** `undefined` : champ vidé, pas de remise saisie. Une valeur 0 est transmise telle quelle (elle retire une remise héritée). */
  onChange: (remise: RemiseCommerciale | undefined) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
}

/** Remise commerciale : une valeur et son unité, « % » du prix ou « € » HT. */
export function RemiseInput({ remise, onChange, label, placeholder, disabled }: RemiseInputProps) {
  // Sans remise saisie, l'unité choisie est mémorisée ici pour que la valeur tapée ensuite la reprenne.
  const [modeChoisi, setModeChoisi] = useState<ModeRemise>('pourcentage');
  const mode = remise?.mode ?? modeChoisi;
  return (
    <span className="inline-flex items-center gap-1">
      <NumInput
        label={label} disabled={disabled} className="w-24" placeholder={placeholder ?? 'aucune'}
        value={remise?.valeur}
        onChange={v => onChange(v == null ? undefined : { mode, valeur: Math.max(0, v) })}
      />
      <select
        aria-label={`Unité de la remise, ${label}`} disabled={disabled} value={mode}
        onChange={e => {
          const m = e.target.value as ModeRemise;
          setModeChoisi(m);
          if (remise) onChange({ mode: m, valeur: remise.valeur });
        }}
        className={cn(CHAMP, 'w-14 px-1')}
      >
        <option value="pourcentage">%</option>
        <option value="montant">€</option>
      </select>
    </span>
  );
}

const STATUT_STYLE: Record<StatutNegociation, string> = {
  ecartee: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  retenue: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  a_verifier: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  a_negocier: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  en_negociation: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  offre_finale: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
};

export function StatutPastille({ statut }: { statut: StatutNegociation }) {
  return (
    <span className={cn('inline-block px-2 py-0.5 rounded-full text-[0.6875rem] font-bold whitespace-nowrap', STATUT_STYLE[statut])}>
      {STATUT_LIBELLES[statut]}
    </span>
  );
}

/** Écart coloré : en dessous de la référence (bon pour le maître d'ouvrage) en vert, au-dessus en rouge. */
export function Ecart({ valeur, pct }: { valeur: number | null; pct?: number | null }) {
  if (valeur == null) return <span className="text-[var(--tblr-muted)]">—</span>;
  const couleur = valeur > 0 ? 'text-red-600 dark:text-red-400' : valeur < 0 ? 'text-green-700 dark:text-green-400' : 'text-[var(--tblr-muted)]';
  return (
    <span className={cn('whitespace-nowrap', couleur)}>
      {eur(valeur)}
      {pct != null && <span className="block text-[0.6875rem] opacity-80">{(valeur > 0 ? '+' : '') + (pct * 100).toFixed(1).replace('.', ',')} %</span>}
    </span>
  );
}
