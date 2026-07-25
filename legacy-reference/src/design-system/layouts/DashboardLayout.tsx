import type { ReactNode } from 'react';
import { Header } from './Header';
import type { PageId } from '../../pages/pageRegistry';

type DashboardLayoutProps = {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  children: ReactNode;
};

export function DashboardLayout({ activePage, onNavigate, children }: DashboardLayoutProps) {
  return (
    <div className="app-viewport">
      <div className="app-shell">
        <Header activePage={activePage} onNavigate={onNavigate} />
        <main className="app-main">{children}</main>
        <footer className="app-footer">Feito com <span aria-hidden="true">❤</span> por Vinsansi Studio</footer>
      </div>
    </div>
  );
}
