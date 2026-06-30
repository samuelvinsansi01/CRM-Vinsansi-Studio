import { CheckCircle2, Info, TriangleAlert, XCircle } from 'lucide-react';
import { createPortal } from 'react-dom';
import { IconButton } from '../action/IconButton';

export type ToastTone = 'success' | 'danger' | 'warning' | 'info';

export type ToastItem = {
  id: string;
  title: string;
  description?: string;
  tone?: ToastTone;
};

type ToastViewportProps = {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
};

const toastIcon = {
  success: CheckCircle2,
  danger: XCircle,
  warning: TriangleAlert,
  info: Info,
};

export function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  if (!toasts.length) return null;

  return createPortal(
    <div className="toast-viewport" aria-live="polite" aria-label="Notificações">
      {toasts.map((toast) => {
        const tone = toast.tone ?? 'info';
        const Icon = toastIcon[tone];

        return (
          <article className={`toast toast--${tone}`} key={toast.id}>
            <Icon size={18} strokeWidth={2} />
            <div className="toast__content">
              <strong>{toast.title}</strong>
              {toast.description ? <span>{toast.description}</span> : null}
            </div>
            <IconButton icon={XCircle} label="Fechar notificação" size="sm" onClick={() => onDismiss(toast.id)} />
          </article>
        );
      })}
    </div>,
    document.body,
  );
}
