import type { LucideIcon } from 'lucide-react';

type MetricTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

type MetricCardProps = {
  icon?: LucideIcon;
  value: string;
  label: string;
  tone?: MetricTone;
  active?: boolean;
  onClick?: () => void;
};

export function MetricCard({ icon: Icon, value, label, tone = 'neutral', active = false, onClick }: MetricCardProps) {
  const className = `metric-card metric-card--${tone} ${active ? 'metric-card--active' : ''} ${onClick ? 'metric-card--interactive' : ''}`;
  const content = (
    <>
      {Icon ? (
        <span className="metric-card__icon">
          <Icon size={20} strokeWidth={1.8} />
        </span>
      ) : null}
      <span className="metric-card__text">
        <strong>{value}</strong>
        <small>{label}</small>
      </span>
    </>
  );

  if (onClick) {
    return <button type="button" className={className} onClick={onClick}>{content}</button>;
  }
  return <article className={className}>{content}</article>;
}
