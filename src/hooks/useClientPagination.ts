import { useCallback, useEffect, useMemo, useState } from 'react';

export function useClientPagination<T>(items: T[], initialRowsPerPage = 20) {
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPageState] = useState(initialRowsPerPage);
  const totalPages = Math.max(1, Math.ceil(items.length / rowsPerPage));
  const currentPage = Math.min(page, totalPages);

  useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [currentPage, page]);

  const pageItems = useMemo(
    () => items.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage),
    [currentPage, items, rowsPerPage],
  );

  const setRowsPerPage = useCallback((value: number) => {
    setRowsPerPageState(value);
    setPage(1);
  }, []);

  const resetPage = useCallback(() => setPage(1), []);

  return {
    page: currentPage,
    setPage,
    rowsPerPage,
    setRowsPerPage,
    totalPages,
    pageItems,
    resetPage,
  };
}
