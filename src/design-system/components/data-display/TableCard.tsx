import type { ReactNode } from 'react';
import { Panel } from './Panel';
import { Pagination } from '../navigation/Pagination';

type TableCardProps = {
  title: string;
  children: ReactNode;
  footerText?: string;
  footerLeft?: ReactNode;
  page?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
};

export function TableCard({ title, children, footerText, footerLeft, page, totalPages, onPageChange }: TableCardProps) {
  return (
    <Panel title={title} className="table-card">
      {children}
      <div className="table-card__footer">
        <div className="table-card__footer-left">
          {footerText ? <small>{footerText}</small> : null}
          {footerLeft}
        </div>
        <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
      </div>
    </Panel>
  );
}
