import { useTranslation } from 'react-i18next';
import { IconFileText, IconX } from '@tabler/icons-react';

/** Pièces jointes du message en cours : une rangée dans le flux, au-dessus du champ de saisie. */
export function AttachedDocChips({ attached, onDetach }: {
  attached: { id: string; name: string }[];
  onDetach: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (attached.length === 0) return null;
  return (
    <ul className="flex gap-1.5 overflow-x-auto pb-1.5 mb-0.5" aria-label={t('agent_document_attach')}>
      {attached.map(doc => (
        <li
          key={doc.id}
          className="flex items-center gap-1.5 h-8 pl-2.5 pr-1 rounded-full border text-[0.75rem] shrink-0"
          style={{ background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
        >
          <IconFileText size={14} style={{ color: 'var(--tblr-muted)' }} />
          <span className="max-w-[9rem] truncate">{doc.name}</span>
          <button
            type="button"
            onClick={() => onDetach(doc.id)}
            aria-label={t('agent_document_remove_named', { name: doc.name })}
            className="relative inline-flex items-center justify-center w-6 h-6 rounded-full hover:bg-[var(--tblr-surface)] before:absolute before:-inset-2"
          >
            <IconX size={12} />
          </button>
        </li>
      ))}
    </ul>
  );
}
