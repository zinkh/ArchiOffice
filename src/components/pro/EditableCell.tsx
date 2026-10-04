import React, { useState } from 'react';

export interface EditingCell {
  rowKey: string;
  field: string;
  value: string;
}

// Déclarés au niveau module : redéfinis à l'intérieur de DPGFWorkspace, ces
// composants changeaient d'identité à chaque rendu du parent, ce que React
// traite comme un composant entièrement différent — il démontait puis
// remontait l'input à chaque frappe, réinitialisant son état local `v` à la
// valeur d'origine. D'où le texte qui s'effaçait sauf à taper plus vite que
// le cycle de rendu, et l'édition qui ne se commitait jamais vraiment.
export const CellInput = ({
  value, onCommit, onCancel, className = '', label,
}: { value: string; onCommit: (v: string) => void; onCancel: () => void; className?: string; label?: string }) => {
  const [v, setV] = useState(value);
  return (
    <input
      autoFocus
      aria-label={label}
      value={v}
      onChange={e => setV(e.target.value)}
      onFocus={e => e.target.select()}
      onBlur={() => onCommit(v)}
      onKeyDown={e => {
        // Les raccourcis du tableau (Tab, Suppr, Alt+flèches) ne doivent pas
        // agir sur la ligne pendant la saisie.
        e.stopPropagation();
        if (e.key === 'Enter') { onCommit(v); e.currentTarget.blur(); }
        if (e.key === 'Escape') { onCancel(); }
      }}
      className={`w-full px-1 py-0 rounded outline-none text-sm font-mono border border-[var(--tblr-primary)] bg-[var(--tblr-surface)] text-[var(--tblr-text)] ${className}`}
    />
  );
};

export const EditableCell = ({
  rKey, field, value, editingCell, onStartEdit, onCommit, onCancel, numeric = false, className = '', editOnClick = false, label, showZero = false,
}: {
  rKey: string; field: string; value: string | number; editingCell: EditingCell | null;
  onStartEdit: (rKey: string, field: string, value: string | number) => void;
  onCommit: (v: string) => void; onCancel: () => void; numeric?: boolean; className?: string;
  /** Sur téléphone, un appui suffit : le double appui y zoome ou n'arrive jamais. */
  editOnClick?: boolean;
  /** Nom du champ, annoncé pendant la saisie. */
  label?: string;
  /** Affiche « 0,00 » plutôt qu'une case vide (quantité attendue d'un bâtiment coché). */
  showZero?: boolean;
}) => {
  const isEditing = editingCell?.rowKey === rKey && editingCell?.field === field;
  const display = numeric && typeof value === 'number' && (value > 0 || (showZero && value === 0))
    ? new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
    : String(value || '');

  if (isEditing) {
    return <CellInput value={editingCell.value} onCommit={onCommit} onCancel={onCancel} className={className} label={label} />;
  }
  return (
    <div
      onDoubleClick={() => onStartEdit(rKey, field, value)}
      onClick={editOnClick ? e => { e.stopPropagation(); onStartEdit(rKey, field, value); } : undefined}
      className={`px-1 py-0.5 cursor-text rounded min-h-[22px] hover:bg-[var(--tblr-surface-2)] ${numeric ? 'text-right font-mono tabular-nums' : ''} ${className}`}
      title={editOnClick ? undefined : 'Double-clic pour éditer'}
    >
      {display}
    </div>
  );
};
