import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';

/**
 * Champ saisi localement et validé à la sortie du champ (ou Entrée). Chaque
 * frappe envoyée au serveur renvoyait le CR entier, dont la réponse (parfois
 * dans le désordre) écrasait la saisie en cours : le texte semblait se
 * réinitialiser. Le brouillon local n'est resynchronisé que hors saisie.
 */
export function DraftInput({ value, onCommit, className, ...rest }: {
  value: string;
  onCommit: (v: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur'>) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  const commit = () => {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  };
  return (
    <input
      {...rest}
      className={className}
      value={draft}
      onFocus={() => setEditing(true)}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

export const parseDays = (v: string): number | undefined => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/**
 * Zone de texte qui s'agrandit avec son contenu et n'enregistre qu'à la sortie
 * du champ : un texte long (décision, observation) reste lisible en entier sur
 * un téléphone, là où un champ d'une ligne en coupait la fin.
 */
export function CommitTextarea({ value, onCommit, className, ...rest }: {
  value: string;
  onCommit: (v: string) => void;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'defaultValue' | 'onChange' | 'onBlur' | 'rows'>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  useEffect(() => { fit(); }, [fit, value]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined' || !el.parentElement) return;
    const ro = new ResizeObserver(fit);
    ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, [fit]);
  return (
    <textarea
      {...rest}
      ref={ref}
      rows={1}
      defaultValue={value}
      onInput={fit}
      onBlur={e => { if (e.target.value !== value) onCommit(e.target.value); }}
      className={cn('resize-none overflow-hidden leading-snug outline-none', className)}
    />
  );
}

/**
 * Apparence d'un champ de ligne : encadré et lisible au doigt sur téléphone,
 * discret (sans cadre) à partir de 768 px où la ligne tient sur une rangée.
 */
export const ROW_FIELD =
  'rounded-md border border-[var(--tblr-border)] bg-[var(--tblr-surface)] px-2.5 py-2 text-sm text-[var(--tblr-text)] ' +
  'focus:border-[var(--tblr-primary)] md:border-transparent md:bg-transparent md:px-0 md:py-0';

/** Cible tactile de 44 px sous `pointer: coarse`, sans changer la ligne au bureau. */
export const TOUCH_TARGET = 'pointer-coarse:min-h-11 pointer-coarse:min-w-11';
