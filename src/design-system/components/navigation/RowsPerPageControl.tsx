import { ChevronDown } from 'lucide-react';
import { SelectField } from '../forms/Field';

export function RowsPerPageControl({
  value = 20,
  onChange,
}: {
  value?: number;
  onChange?: (value: number) => void;
}) {
  return (
    <div className="rows-per-page" aria-label="Linhas por pagina">
      <SelectField
        value={String(value)}
        options={['10', '20', '50', '100']}
        onChange={(nextValue) => onChange?.(Number(nextValue))}
      />
      <ChevronDown className="rows-per-page__fallback-icon" size={16} strokeWidth={1.8} />
    </div>
  );
}
