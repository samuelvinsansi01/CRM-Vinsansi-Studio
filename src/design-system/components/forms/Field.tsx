import type { ChangeEvent, FormEvent, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Check, ChevronDown, Search } from 'lucide-react';

type BaseFieldProps = {
  label?: string;
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  iconRight?: LucideIcon;
  iconLeft?: LucideIcon;
  as?: 'input' | 'textarea';
  className?: string;
  density?: 'regular' | 'compact';
  onChange?: (value: string) => void;
};

type NativeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'children'>;
type NativeTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'defaultValue' | 'onChange' | 'children'>;

type FieldProps = BaseFieldProps & NativeInputProps & NativeTextareaProps;

export function Field({
  label,
  placeholder,
  value,
  defaultValue = '',
  iconLeft: IconLeft,
  iconRight: IconRight,
  as = 'input',
  className = '',
  density = 'regular',
  onChange,
  ...props
}: FieldProps) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const fieldValue = value ?? internalValue;

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const nextValue = event.target.value;

    if (value === undefined) {
      setInternalValue(nextValue);
    }

    onChange?.(nextValue);
  };

  const handleInput = (event: FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (props.type !== 'date') return;
    const nextValue = event.currentTarget.value;

    if (value === undefined) {
      setInternalValue(nextValue);
    }

    onChange?.(nextValue);
  };

  const content =
    as === 'textarea' ? (
      <textarea placeholder={placeholder} value={fieldValue} onChange={handleChange} onInput={handleInput} {...props} />
    ) : (
      <input placeholder={placeholder} value={fieldValue} onChange={handleChange} onInput={handleInput} {...props} />
    );

  return (
    <label className={`field ${density === 'compact' ? 'field--compact' : ''} ${as === 'textarea' ? 'field--textarea' : ''} ${className}`}>
      {label ? <span className="field__label">{label}</span> : null}
      <span className="field__control">
        {IconLeft ? <IconLeft size={16} strokeWidth={1.8} /> : null}
        {content}
        {IconRight ? <IconRight size={16} strokeWidth={1.8} /> : null}
      </span>
    </label>
  );
}

export function SearchInput({
  placeholder = 'Buscar',
  value,
  onChange,
}: {
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
}) {
  return <Field placeholder={placeholder} iconRight={Search} className="field--search" value={value} onChange={onChange} />;
}

type SelectOption = {
  label: string;
  value: string;
};

type SelectFieldProps = {
  children?: ReactNode;
  options?: Array<string | SelectOption>;
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  className?: string;
  density?: 'regular' | 'compact';
  searchable?: boolean;
  searchPlaceholder?: string;
};

export function SelectField({
  children,
  options,
  value,
  defaultValue,
  placeholder,
  onChange,
  className = '',
  density = 'regular',
  searchable = false,
  searchPlaceholder = 'Buscar...',
}: SelectFieldProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const normalizedOptions = useMemo<SelectOption[]>(() => {
    if (!options?.length) {
      const fallback = String(children ?? placeholder ?? 'Selecionar');
      return [{ label: fallback, value: fallback }];
    }

    return options.map((option) => (typeof option === 'string' ? { label: option, value: option } : option));
  }, [children, options, placeholder]);

  const filteredOptions = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase('pt-BR');
    if (!searchable || !query) return normalizedOptions;

    return normalizedOptions.filter((option) =>
      option.label.toLocaleLowerCase('pt-BR').includes(query),
    );
  }, [normalizedOptions, searchQuery, searchable]);

  const initialValue = defaultValue ?? value ?? normalizedOptions[0]?.value ?? '';
  const [internalValue, setInternalValue] = useState(initialValue);

  const selectedValue = value ?? internalValue;
  const selectedOptionLabel = normalizedOptions.find((option) => option.value === selectedValue)?.label;
  const selectedLabel = placeholder && (selectedValue === 'Todos' || selectedValue === '')
    ? placeholder
    : selectedOptionLabel ?? placeholder ?? children;

  useEffect(() => {
    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (!rootRef.current) return;

      if (!rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, []);

  const selectOption = (nextValue: string) => {
    if (value === undefined) {
      setInternalValue(nextValue);
    }

    onChange?.(nextValue);
    setSearchQuery('');
    setIsOpen(false);
  };

  return (
    <div className={`select-field-wrap ${density === 'compact' ? 'select-field-wrap--compact' : ''} ${className}`} ref={rootRef}>
      <button
        className={`select-field ${density === 'compact' ? 'select-field--compact' : ''} ${isOpen ? 'select-field--open' : ''}`}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => {
          setSearchQuery('');
          setIsOpen((current) => !current);
        }}
      >
        <span>{selectedLabel}</span>
        <ChevronDown size={16} strokeWidth={1.8} />
      </button>

      {isOpen ? (
        <div className="select-field__menu" role="listbox" onMouseDown={(event) => event.preventDefault()}>
          {searchable ? (
            <div className="select-field__search">
              <Search size={15} strokeWidth={1.8} />
              <input
                autoFocus
                type="search"
                value={searchQuery}
                placeholder={searchPlaceholder}
                onChange={(event) => setSearchQuery(event.target.value)}
                onMouseDown={(event) => event.stopPropagation()}
              />
            </div>
          ) : null}

          {filteredOptions.length ? filteredOptions.map((option) => (
            <button
              className="select-field__option"
              type="button"
              role="option"
              aria-selected={option.value === selectedValue}
              key={option.value}
              onClick={() => selectOption(option.value)}
            >
              <span>{option.label}</span>
              {option.value === selectedValue ? <Check size={14} strokeWidth={1.8} /> : null}
            </button>
          )) : (
            <div className="select-field__empty">Nenhum resultado encontrado.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
