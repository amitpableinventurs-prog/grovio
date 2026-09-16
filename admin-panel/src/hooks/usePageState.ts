import { useState } from 'react';

export function usePageState(initialPageSize = 10) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  function onChange(newPage: number, newPageSize: number) {
    setPage(newPage);
    setPageSize(newPageSize);
  }

  return { page, pageSize, setPage, setPageSize, onChange };
}
