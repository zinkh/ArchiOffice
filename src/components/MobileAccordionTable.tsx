import { useState } from 'react';
import { IconPlus, IconMinus } from '@tabler/icons-react';

export interface AccordionColumn {
  label: string;
  render: (row: any) => React.ReactNode;
  primary?: boolean;
}

interface Props {
  columns: AccordionColumn[];
  data: any[];
  keyField: string;
  emptyText?: string;
  actions?: (row: any) => React.ReactNode;
}

export function MobileAccordionTable({ columns, data, keyField, emptyText = 'Aucune donnée', actions }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const primaryCol = columns.find(c => c.primary) ?? columns[0];
  const restCols = columns.filter(c => !c.primary);

  const toggle = (key: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  if (data.length === 0) {
    return (
      <div className="py-10 text-center text-sm" style={{ color: 'var(--tblr-muted)' }}>
        {emptyText}
      </div>
    );
  }

  return (
    <div>
      {data.map(row => {
        const key = String(row[keyField]);
        const isOpen = expanded.has(key);
        return (
          <div key={key} style={{ borderBottom: '1px solid var(--tblr-border)' }}>
            {/* Row header — always visible */}
            <button
              className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
              style={{ background: isOpen ? 'var(--tblr-surface-2)' : undefined }}
              onClick={() => toggle(key)}
            >
              <span
                className="w-5 h-5 rounded flex items-center justify-center shrink-0"
                style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}
              >
                {isOpen ? <IconMinus size={11} /> : <IconPlus size={11} />}
              </span>
              <span className="flex-1 min-w-0 text-sm font-medium" style={{ color: 'var(--tblr-text)' }}>
                {primaryCol.render(row)}
              </span>
              {actions && !isOpen && (
                <span onClick={e => e.stopPropagation()}>
                  {actions(row)}
                </span>
              )}
            </button>

            {/* Expanded detail */}
            {isOpen && (
              <div className="px-4 pb-3" style={{ background: 'var(--tblr-surface-2)' }}>
                {restCols.map((col, i) => (
                  <div
                    key={i}
                    className="flex items-start justify-between gap-4 py-2"
                    style={{ borderBottom: i < restCols.length - 1 ? '1px solid var(--tblr-border)' : undefined }}
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-wide shrink-0" style={{ color: 'var(--tblr-muted)' }}>
                      {col.label}
                    </span>
                    <span className="text-xs text-right" style={{ color: 'var(--tblr-text)' }}>
                      {col.render(row)}
                    </span>
                  </div>
                ))}
                {actions && (
                  <div className="flex justify-end gap-2 pt-3">
                    {actions(row)}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
