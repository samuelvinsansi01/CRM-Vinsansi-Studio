import type { ReactNode } from 'react';

type PanelProps = {
  title?: string;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
};

export function Panel({ title, children, className = '', actions }: PanelProps) {
  return (
    <section className={`panel ${className}`}>
      {title || actions ? (
        <header className="panel__header">
          {title ? <h2>{title}</h2> : <span />}
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}
