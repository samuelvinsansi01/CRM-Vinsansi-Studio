import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from '../action/IconButton';

type PaginationProps = {
  page?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
};

export function Pagination({ page = 1, totalPages = 1, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages =
    totalPages <= 7
      ? Array.from({ length: totalPages }, (_, index) => index + 1)
      : Array.from(new Set([1, page - 1, page, page + 1, totalPages].filter((item) => item >= 1 && item <= totalPages))).sort((a, b) => a - b);

  return (
    <nav className="pagination" aria-label="Paginação">
      <IconButton icon={ChevronLeft} label="Anterior" size="sm" disabled={page <= 1} onClick={() => onPageChange?.(Math.max(1, page - 1))} />
      {pages.map((item, index) => (
        <span className="pagination__slot" key={item}>
          {index > 0 && item - pages[index - 1] > 1 ? <span className="pagination__ellipsis">...</span> : null}
          <button
            className={`pagination__item ${item === page ? 'pagination__item--active' : ''}`}
            type="button"
            onClick={() => onPageChange?.(item)}
          >
            {item}
          </button>
        </span>
      ))}
      <IconButton icon={ChevronRight} label="Próximo" size="sm" disabled={page >= totalPages} onClick={() => onPageChange?.(Math.min(totalPages, page + 1))} />
    </nav>
  );
}
