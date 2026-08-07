type SegmentedControlProps = {
  items: string[];
  active?: string;
  compact?: boolean;
  onChange?: (item: string) => void;
};

export function SegmentedControl({ items, active = items[0], compact = false, onChange }: SegmentedControlProps) {
  return (
    <div className={`segmented ${compact ? 'segmented--compact' : ''}`}>
      {items.map((item) => (
        <button
          className={`segmented__item ${item === active ? 'segmented__item--active' : ''}`}
          type="button"
          key={item}
          onClick={() => onChange?.(item)}
        >
          {item}
        </button>
      ))}
    </div>
  );
}
