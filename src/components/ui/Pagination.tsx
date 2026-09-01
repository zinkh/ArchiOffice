import React from 'react';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  className?: string;
  style?: React.CSSProperties;
}

/** Compact page-number list with ellipses, e.g. 1 … 4 5 [6] 7 8 … 12 */
function pageNumbers(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, total, current, current - 1, current + 1]);
  const sorted = [...pages].filter(p => p >= 1 && p <= total).sort((a, b) => a - b);
  const result: (number | '…')[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) result.push('…');
    result.push(p);
  });
  return result;
}

export function Pagination({ currentPage, totalPages, totalItems, pageSize, onPageChange, className = '', style }: PaginationProps) {
  if (totalItems === 0 || totalPages <= 1) return null;

  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${className}`} style={style}>
      <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}>
        {start}–{end} sur {totalItems}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          className="p-1.5 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-[var(--tblr-surface-2)]"
          style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
          aria-label="Page précédente"
        >
          <IconChevronLeft size={15} />
        </button>

        {pageNumbers(currentPage, totalPages).map((p, i) =>
          p === '…' ? (
            <span key={`ellipsis-${i}`} className="px-1.5 text-xs" style={{ color: 'var(--tblr-muted)' }}>…</span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange(p)}
              className="min-w-[28px] h-[28px] px-1 rounded-lg text-xs font-semibold transition-colors"
              style={p === currentPage
                ? { background: 'var(--tblr-primary)', color: '#fff' }
                : { color: 'var(--tblr-text)' }}
            >
              {p}
            </button>
          )
        )}

        <button
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="p-1.5 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-[var(--tblr-surface-2)]"
          style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
          aria-label="Page suivante"
        >
          <IconChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}
