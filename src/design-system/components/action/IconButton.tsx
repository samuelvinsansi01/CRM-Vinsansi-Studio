import type { ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  label: string;
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
  size?: 'sm' | 'md';
};

export function IconButton({
  icon: Icon,
  label,
  tone = 'neutral',
  size = 'md',
  className = '',
  ...props
}: IconButtonProps) {
  return (
    <button
      className={`icon-button icon-button--${tone} icon-button--${size} ${className}`}
      aria-label={label}
      title={label}
      type="button"
      {...props}
    >
      <Icon size={size === 'sm' ? 16 : 20} strokeWidth={1.8} />
    </button>
  );
}
