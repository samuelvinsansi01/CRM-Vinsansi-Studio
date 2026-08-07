import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { Button } from '../action/Button';
import { IconButton } from '../action/IconButton';

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  children,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
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
    <div className="dialog-layer" role="presentation">
      <button className="dialog-backdrop" type="button" aria-label="Fechar confirmação" onClick={onClose} />
      <section className="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <header className="dialog-header">
          <span className={`dialog-icon ${danger ? 'dialog-icon--danger' : ''}`}>
            <AlertTriangle size={18} strokeWidth={2} />
          </span>
          <IconButton icon={X} label="Fechar" onClick={onClose} />
        </header>
        <div className="dialog-body">
          <h2 id="confirm-title">{title}</h2>
          {description ? <p>{description}</p> : null}
          {children}
        </div>
        <footer className="dialog-footer">
          <Button variant="secondary" onClick={onClose}>{cancelLabel}</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
