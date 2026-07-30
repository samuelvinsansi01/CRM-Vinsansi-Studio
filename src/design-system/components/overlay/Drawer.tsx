import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { IconButton } from '../action/IconButton';

export type DrawerProps = {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'default' | 'wide';
  onClose: () => void;
};

export function Drawer({ open, title, description, children, footer, size = 'default', onClose }: DrawerProps) {
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.body.classList.add('overlay-open');

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.classList.remove('overlay-open');
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="drawer-layer" role="presentation">
      <button className="drawer-backdrop" type="button" aria-label="Fechar drawer" onClick={onClose} />
      <aside className={`drawer-panel drawer-panel--${size}`} role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header className="drawer-header">
          <div>
            <h2 id="drawer-title">{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <IconButton icon={X} label="Fechar" onClick={onClose} />
        </header>
        <div className="drawer-body">{children}</div>
        {footer ? <footer className="drawer-footer">{footer}</footer> : null}
      </aside>
    </div>,
    document.body,
  );
}
