import React, { useEffect, useState } from 'react';

/** Numéro de lot modifiable en place (« 00 », « 01A »...) ; enregistré à la sortie du champ. */
export function LotNumberInput({ value, onCommit }: { value: string; onCommit: (numero: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = async () => {
    const numero = draft.trim();
    if (numero === value) { setDraft(value); return; }
    if (!(await onCommit(numero))) setDraft(value);
  };
  return <input aria-label="Numéro du lot" maxLength={12} className="w-full bg-transparent border-b border-transparent focus:border-blue-500 outline-none"
    value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => void commit()}
    onKeyDown={e => {
      if (e.key === 'Enter') e.currentTarget.blur();
      if (e.key === 'Escape') { setDraft(value); e.preventDefault(); }
    }} />;
}
