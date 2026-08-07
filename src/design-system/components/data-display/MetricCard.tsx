import type { LucideIcon } from 'lucide-react';

type MetricTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

type MetricCardProps = {
  icon?: LucideIcon;
  value: string;
  label: string;
  tone?: MetricTone;
  active?: boolean;
};

export function MetricCard({ icon: Icon, value, label, tone = 'neutral', active = false }: MetricCardProps) {
  return (
    <article className={`metric-card metric-card--${tone} ${active ? 'metric-card--active' : ''}`}>
      {Icon ? (
        <span className="metric-card__icon">
          <Icon size={20} strokeWidth={1.8} />
        </span>
      ) : null}
      <span className="metric-card__text">
        <strong>{value}</strong>
        <small>{label}</small>
      </span>
    </article>
  );
}
