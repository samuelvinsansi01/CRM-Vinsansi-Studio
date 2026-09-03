import type { CSSProperties, ChangeEvent, FormEvent, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  renderNoResults?: (query: string, selectValue: (value: string) => void) => ReactNode;
  disabled?: boolean;
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
  renderNoResults,
  disabled = false,
}: SelectFieldProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});

  const normalizedOptions = useMemo<SelectOption[]>(() => {
    if (!options?.length) {
      const fallback = String(children ?? placeholder ?? 'Selecionar');
      return [{ label: fallback, value: fallback }];
    }

    return options.map((option) => (typeof option === 'string' ? { label: option, value: option } : option));
  }, [children, options, placeholder]);

  const normalizeSearchValue = (text: string) =>
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR')
      .replace(/\s*[-/]\s*/g, ',')
      .replace(/\s*,\s*/g, ',')
      .replace(/\s+/g, ' ')
      .trim();

  const filteredOptions = useMemo(() => {
    const query = normalizeSearchValue(searchQuery);
    if (!searchable || !query) return normalizedOptions;

    return normalizedOptions.filter((option) =>
      normalizeSearchValue(option.label).includes(query),
    );
  }, [normalizedOptions, searchQuery, searchable]);

  const initialValue = defaultValue ?? value ?? normalizedOptions[0]?.value ?? '';
  const [internalValue, setInternalValue] = useState(initialValue);

  const selectedValue = value ?? internalValue;
  const selectedOptionLabel = normalizedOptions.find((option) => option.value === selectedValue)?.label;
  const selectedLabel = placeholder && (selectedValue === 'Todos' || selectedValue === '')
    ? placeholder
    : selectedOptionLabel ?? placeholder ?? children;

  const updateMenuPosition = useCallback(() => {
    if (!rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const viewportGap = 12;
    const estimatedMenuHeight = searchable ? 320 : Math.min(320, Math.max(96, normalizedOptions.length * 40 + 8));
    const spaceBelow = window.innerHeight - rect.bottom - viewportGap;
    const shouldFlip = spaceBelow < Math.min(220, estimatedMenuHeight) && rect.top > spaceBelow;
    setMenuStyle({
      position: 'fixed',
      // Menus são portais no <body>. O overlay dos drawers usa uma faixa de z-index
      // muito alta; portanto o menu precisa ficar acima dela para continuar clicável
      // dentro de drawers/modais.
      zIndex: 2147483200,
      right: Math.max(viewportGap, window.innerWidth - rect.right),
      minWidth: Math.max(rect.width, 220),
      ...(shouldFlip
        ? { bottom: Math.max(viewportGap, window.innerHeight - rect.top + 4), top: 'auto' }
        : { top: Math.max(viewportGap, rect.bottom + 4), bottom: 'auto' }),
    });
  }, [normalizedOptions.length, searchable]);

  useEffect(() => {
    if (!isOpen) return;
    updateMenuPosition();
    const reposition = () => updateMenuPosition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [isOpen, updateMenuPosition]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node;
      if (!rootRef.current) return;

      if (!rootRef.current.contains(target) && !menuRef.current?.contains(target)) {
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
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => {
          if (disabled) return;
          setSearchQuery('');
          setIsOpen((current) => !current);
        }}
      >
        <span title={String(selectedLabel ?? '')}>{selectedLabel}</span>
        <ChevronDown size={16} strokeWidth={1.8} />
      </button>

      {isOpen && typeof document !== 'undefined' ? createPortal(
        <div ref={menuRef} className="select-field__menu select-field__menu--portal" role="listbox" style={menuStyle} onMouseDown={(event: import('react').MouseEvent<HTMLDivElement>) => event.preventDefault()}>
          {searchable ? (
            <div className="select-field__search">
              <Search size={15} strokeWidth={1.8} />
              <input
                autoFocus
                type="search"
                value={searchQuery}
                placeholder={searchPlaceholder}
                onChange={(event: import('react').ChangeEvent<HTMLInputElement>) => setSearchQuery(event.target.value)}
                onMouseDown={(event: import('react').MouseEvent<HTMLInputElement>) => event.stopPropagation()}
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
              <span title={option.label}>{option.label}</span>
              {option.value === selectedValue ? <Check size={14} strokeWidth={1.8} /> : null}
            </button>
          )) : (
            renderNoResults ? renderNoResults(searchQuery, selectOption) : (
              <div className="select-field__empty">Nenhum resultado encontrado.</div>
            )
          )}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

export function MultiSelectField({
  options,
  values,
  onChange,
  placeholder = 'Todos',
  searchable = true,
  searchPlaceholder = 'Buscar...',
  selectedNoun = 'itens',
  className = '',
}: {
  options: SelectOption[];
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  selectedNoun?: string;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const selectedSet = useMemo(() => new Set(values), [values]);

  const normalizeSearchValue = (text: string) => text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

  const filteredOptions = useMemo(() => {
    const query = normalizeSearchValue(searchQuery);
    if (!searchable || !query) return options;
    return options.filter((option) => normalizeSearchValue(option.label).includes(query));
  }, [options, searchQuery, searchable]);

  const selectedLabel = useMemo(() => {
    if (!values.length) return placeholder;
    const labels = values.map((value) => options.find((option) => option.value === value)?.label).filter(Boolean) as string[];
    if (labels.length <= 2) return labels.join(', ') || placeholder;
    return `${values.length} ${selectedNoun} selecionados`;
  }, [options, placeholder, selectedNoun, values]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setIsOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, []);

  const toggleValue = (nextValue: string) => {
    const next = new Set(values);
    if (next.has(nextValue)) next.delete(nextValue);
    else next.add(nextValue);
    onChange(Array.from(next));
  };

  return (
    <div className={`select-field-wrap multi-select-field ${className}`} ref={rootRef}>
      <button
        className={`select-field ${isOpen ? 'select-field--open' : ''}`}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => { setSearchQuery(''); setIsOpen((current) => !current); }}
      >
        <span title={selectedLabel}>{selectedLabel}</span>
        <ChevronDown size={16} strokeWidth={1.8} />
      </button>
      {isOpen ? (
        <div className="select-field__menu multi-select-field__menu" role="listbox" aria-multiselectable="true" onMouseDown={(event: import('react').MouseEvent<HTMLDivElement>) => event.preventDefault()}>
          {searchable ? (
            <div className="select-field__search">
              <Search size={15} strokeWidth={1.8} />
              <input
                autoFocus
                type="search"
                value={searchQuery}
                placeholder={searchPlaceholder}
                onChange={(event: import('react').ChangeEvent<HTMLInputElement>) => setSearchQuery(event.target.value)}
                onMouseDown={(event: import('react').MouseEvent<HTMLInputElement>) => event.stopPropagation()}
              />
            </div>
          ) : null}
          <button
            className="select-field__option"
            type="button"
            role="option"
            aria-selected={!values.length}
            onClick={() => onChange([])}
          >
            <span>{placeholder}</span>
            {!values.length ? <Check size={14} strokeWidth={1.8} /> : null}
          </button>
          {filteredOptions.length ? filteredOptions.map((option) => (
            <button
              className="select-field__option"
              type="button"
              role="option"
              aria-selected={selectedSet.has(option.value)}
              key={option.value}
              onClick={() => toggleValue(option.value)}
            >
              <span title={option.label}>{option.label}</span>
              {selectedSet.has(option.value) ? <Check size={14} strokeWidth={1.8} /> : null}
            </button>
          )) : <div className="select-field__empty">Nenhum resultado encontrado.</div>}
          {values.length ? <div className="multi-select-field__footer">{values.length} {selectedNoun} selecionado(s)</div> : null}
        </div>
      ) : null}
    </div>
  );
}
