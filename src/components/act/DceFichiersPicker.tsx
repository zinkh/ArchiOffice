import { IconX } from '@tabler/icons-react';
import type { DocumentDce } from '../../lib/dceIndices';

/**
 * Documents de l'affaire rattachés à une pièce du DCE : chacun porte son indice
 * (lu sur sa fiche), repris dans le tableau d'indices envoyé aux entreprises.
 */
export default function DceFichiersPicker({ documents, value, onChange, label }: {
  documents: DocumentDce[];
  value: string[];
  onChange: (next: string[]) => void;
  label: string;
}) {
  const parId = new Map(documents.map(d => [d.id, d]));
  const disponibles = documents.filter(d => !value.includes(d.id));
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {value.map(id => {
          const d = parId.get(id);
          return (
            <span key={id} className="inline-flex items-center gap-1 rounded-full border border-[var(--tblr-border)] bg-[var(--tblr-surface)] pl-2.5 pr-1 py-0.5 text-[0.6875rem] text-[var(--tblr-text)]">
              {d ? `${d.name}${d.indice ? ` · ind. ${d.indice}` : ''}` : 'Document supprimé'}
              <button type="button" aria-label={`Retirer ${d?.name ?? 'le document'}`} onClick={() => onChange(value.filter(v => v !== id))}
                className="p-0.5 rounded-full text-[var(--tblr-muted)] hover:text-red-500"><IconX size={11} /></button>
            </span>
          );
        })}
      </div>
      <select aria-label={label} value="" onChange={e => e.target.value && onChange([...value, e.target.value])}
        className="w-full px-2.5 py-1.5 text-xs border border-dashed border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500">
        <option value="">{disponibles.length ? 'Joindre un document de l\'affaire…' : 'Aucun autre document dans l\'affaire'}</option>
        {disponibles.map(d => <option key={d.id} value={d.id}>{d.name}{d.indice ? ` (ind. ${d.indice})` : ''}</option>)}
      </select>
    </div>
  );
}
