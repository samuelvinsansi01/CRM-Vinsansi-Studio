import { Globe2, Instagram, Link2, MessageCircle } from 'lucide-react';
import type { ReactNode } from 'react';

type DestinationBadgeProps = {
  value?: string | null;
};

const destinationIcon = {
  whatsapp: MessageCircle,
  instagram: Instagram,
  site: Globe2,
  aggregator: Link2,
};

function normalizeDestination(value?: string | null) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized.includes('instagram')) return { key: 'instagram', label: 'Instagram' };
  if (normalized.includes('site')) return { key: 'site', label: 'Com site' };
  if (normalized.includes('agreg')) return { key: 'aggregator', label: 'Agregadores' };
  return { key: 'whatsapp', label: 'WhatsApp' };
}

export function DestinationBadge({ value }: DestinationBadgeProps) {
  const destination = normalizeDestination(value);
  const Icon = destinationIcon[destination.key as keyof typeof destinationIcon];

  return (
    <span className={`destination-badge destination-badge--${destination.key}`} title={destination.label} aria-label={destination.label}>
      <Icon size={16} strokeWidth={1.9} />
      <span className="sr-only">{destination.label}</span>
    </span>
  );
}

export function destinationText(value?: string | null): ReactNode {
  return <DestinationBadge value={value} />;
}
