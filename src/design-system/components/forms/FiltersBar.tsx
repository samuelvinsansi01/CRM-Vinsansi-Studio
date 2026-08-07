import type { ReactNode } from 'react';

type FiltersBarProps = {
  left?: ReactNode;
  children: ReactNode;
};

export function FiltersBar({ left, children }: FiltersBarProps) {
  return (
    <div className={`filters-row ${left ? 'filters-row--split' : ''}`}>
      {left ? <div className="filters-row__left">{left}</div> : null}
      <div className="filters-row__controls">{children}</div>
    </div>
  );
}
