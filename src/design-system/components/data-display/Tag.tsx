import type { ReactNode } from 'react';

type TagProps = {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'primary';
};

export function Tag({ children, tone = 'neutral' }: TagProps) {
  return <span className={`tag tag--${tone}`}>{children}</span>;
}
