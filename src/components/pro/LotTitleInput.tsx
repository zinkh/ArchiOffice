import React, { useEffect, useState } from 'react';

export function LotTitleInput({ value, onCommit }: { value: string; onCommit: (title: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const title = draft.trim();
    if (!title) { setDraft(value); return; }
    if (title !== value) onCommit(title);
  };
  return <input aria-label="Intitulé du lot" className="w-full bg-transparent border-b border-transparent focus:border-blue-500 outline-none"
    value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
    onKeyDown={e => {
      if (e.key === 'Enter') e.currentTarget.blur();
      if (e.key === 'Escape') { setDraft(value); e.preventDefault(); }
    }} />;
}
