import { useEffect, useMemo, useState } from 'react';

export const DEFAULT_PAGE_SIZE = 25;

/**
 * Client-side pagination over an already-filtered/sorted array. Resets to
 * page 1 whenever the source array's length or identity changes (e.g. a
 * search/filter/sort change), so users never land on a page that no longer
 * has any rows.
 */
export function usePagination<T>(items: T[], pageSize: number = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(1);

  // Reset to page 1 when the result count changes (new search/filter), but
  // not on every render — `items` is typically a freshly filtered/sorted
  // array each render, so keying off its identity would reset the page
  // right back to 1 the moment the user navigates to page 2.
  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, totalPages);

  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, currentPage, pageSize]);

  return {
    pageItems,
    currentPage,
    totalPages,
    totalItems: items.length,
    pageSize,
    setPage,
  };
}
