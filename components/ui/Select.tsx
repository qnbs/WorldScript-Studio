import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectOptionGroup {
  label: string;
  options: SelectOption[];
}

interface SelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options?: SelectOption[];
  groups?: SelectOptionGroup[];
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}

function useSelectDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  return { isOpen, setIsOpen, containerRef };
}

export const Select = React.memo(
  ({
    id,
    value,
    onChange,
    options,
    groups,
    placeholder,
    ariaLabel,
    disabled,
    className = '',
  }: SelectProps) => {
    const { isOpen, setIsOpen, containerRef } = useSelectDropdown();
    const selectedLabel =
      options?.find((o) => o.value === value)?.label ??
      groups?.flatMap((g) => g.options).find((o) => o.value === value)?.label;

    const handleSelect = useCallback(
      (opt: SelectOption) => {
        if (opt.disabled) return;
        onChange(opt.value);
        setIsOpen(false);
      },
      [onChange, setIsOpen],
    );

    const renderOption = (opt: SelectOption) => {
      const isActive = opt.value === value;
      return (
        <li key={opt.value}>
          <button
            type="button"
            onClick={() => handleSelect(opt)}
            role="option"
            aria-selected={isActive}
            disabled={opt.disabled}
            className={`w-full flex items-center justify-between px-4 py-2 text-left text-sm transition-colors ${
              isActive
                ? 'bg-[var(--sc-accent-subtle)] text-[var(--sc-text-primary)]'
                : opt.disabled
                  ? 'text-[var(--sc-text-muted)] cursor-not-allowed opacity-50'
                  : 'text-[var(--sc-text-secondary)] hover:bg-[var(--sc-surface-raised)]'
            } focus-visible:outline-none focus-visible:bg-[var(--sc-surface-raised)]`}
          >
            <span>{opt.label}</span>
            {isActive && (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="w-4 h-4 text-[var(--sc-accent)] flex-shrink-0"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
        </li>
      );
    };

    return (
      <div className={`relative ${className}`} ref={containerRef}>
        <button
          id={id}
          type="button"
          disabled={disabled}
          onClick={() => setIsOpen(!isOpen)}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label={ariaLabel}
          className="flex items-center justify-between w-full px-4 py-2.5 text-sm rounded-sc-lg bg-[var(--glass-bg)] hover:bg-[var(--glass-bg-hover)] border border-[var(--sc-border-subtle)] text-[var(--sc-text-primary)] transition-all duration-sc-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <span className={selectedLabel ? '' : 'text-[var(--sc-text-muted)]'}>
            {selectedLabel ?? placeholder ?? ''}
          </span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className={`w-4 h-4 text-[var(--sc-text-muted)] transition-transform duration-sc-fast flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isOpen && (
          <div
            role="listbox"
            aria-label={ariaLabel}
            className="absolute top-full left-0 mt-2 w-full max-h-64 overflow-y-auto rounded-sc-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] shadow-[var(--sc-shadow-xl)] z-[var(--sc-z-docked)]"
          >
            <ul className="py-1">
              {options?.map(renderOption)}
              {groups?.map((group) => (
                <React.Fragment key={group.label}>
                  <li className="px-4 py-1.5 text-xs font-semibold text-[var(--sc-text-muted)] uppercase tracking-wide">
                    {group.label}
                  </li>
                  {group.options.map(renderOption)}
                </React.Fragment>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  },
);
Select.displayName = 'Select';
