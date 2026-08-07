import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Loader2 } from 'lucide-react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  iconLeft?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
  size?: ButtonSize;
  variant?: ButtonVariant;
  children: ReactNode;
};

export function Button({
  children,
  iconLeft: IconLeft,
  iconRight: IconRight,
  loading = false,
  disabled,
  size = 'md',
  variant = 'primary',
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      className={`button button--${variant} button--${size} ${loading ? 'button--loading' : ''} ${className}`}
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="button__spinner" size={16} strokeWidth={2} /> : null}
      {!loading && IconLeft ? <IconLeft size={16} strokeWidth={2} /> : null}
      <span>{children}</span>
      {!loading && IconRight ? <IconRight size={16} strokeWidth={2} /> : null}
    </button>
  );
}
