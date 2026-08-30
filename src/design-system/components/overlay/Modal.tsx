import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { IconButton } from '../action/IconButton';

export type ModalProps = {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
};

export function Modal({ open, title, description, children, footer, onClose }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    document.body.classList.add('overlay-open');
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.classList.remove('overlay-open');
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="dialog-layer" role="presentation">
      <button className="dialog-backdrop" type="button" aria-label="Fechar modal" onClick={onClose} />
      <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header className="modal-header">
          <div>
            <h2 id="modal-title">{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <IconButton icon={X} label="Fechar" onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </section>
    </div>,
    document.body,
  );
}
