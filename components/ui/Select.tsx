import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { I18nContext } from '../../contexts/I18nContext';
import { Icon } from './Icon';

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
  /** QNBS-v3: When true, renders a search input to filter options by label. */
  searchable?: boolean;
  searchPlaceholder?: string;
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

function matchesSearch(label: string, query: string): boolean {
  // QNBS-v3: Trim the query so leading/trailing whitespace doesn't produce a false "no results"
  // state — a whitespace-only query matches everything (no filter) rather than nothing.
  return label.toLowerCase().includes(query.trim().toLowerCase());
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
    searchable = false,
    searchPlaceholder,
  }: SelectProps) => {
    // QNBS-v3: Graceful fallback when rendered outside an I18nProvider (e.g. isolated unit tests).
    const i18n = useContext(I18nContext);
    const t = i18n?.t ?? ((key: string) => key);
    const { isOpen, setIsOpen, containerRef } = useSelectDropdown();
    const [searchQuery, setSearchQuery] = useState('');
    const searchInputRef = useRef<HTMLInputElement>(null);

    // QNBS-v3: Reset search whenever the dropdown closes so reopening shows the full list.
    useEffect(() => {
      if (!isOpen) setSearchQuery('');
    }, [isOpen]);

    // QNBS-v3: Focus the search input when the dropdown opens (only when searchable).
    useEffect(() => {
      if (isOpen && searchable) {
        searchInputRef.current?.focus();
      }
    }, [isOpen, searchable]);

    const filteredOptions = useMemo(() => {
      if (!searchable || !searchQuery.trim()) return options;
      return options?.filter((o) => matchesSearch(o.label, searchQuery));
    }, [options, searchable, searchQuery]);

    const filteredGroups = useMemo(() => {
      if (!searchable || !searchQuery.trim()) return groups;
      return groups
        ?.map((g) => ({
          ...g,
          options: g.options.filter((o) => matchesSearch(o.label, searchQuery)),
        }))
        .filter((g) => g.options.length > 0);
    }, [groups, searchable, searchQuery]);

    const selectedLabel =
      options?.find((o) => o.value === value)?.label ??
      groups?.flatMap((g) => g.options).find((o) => o.value === value)?.label;

    const handleSelect = useCallback(
      (opt: SelectOption) => {
        if (opt.disabled) return;
        onChange(opt.value);
        setIsOpen(false);
        setSearchQuery('');
      },
      [onChange, setIsOpen],
    );

    const hasResults = (filteredOptions?.length ?? 0) > 0 || (filteredGroups?.length ?? 0) > 0;

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
              <Icon
                name="check"
                size="sm"
                className="text-[var(--sc-accent)] flex-shrink-0"
                aria-hidden
              />
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
          <Icon
            name="chevron-down"
            size="sm"
            className={`text-[var(--sc-text-muted)] transition-transform duration-sc-fast flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </button>

        {isOpen && (
          <div
            role="listbox"
            aria-label={ariaLabel}
            className="absolute top-full left-0 mt-2 w-full max-h-64 overflow-y-auto rounded-sc-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] shadow-[var(--sc-shadow-xl)] z-[var(--sc-z-sticky)]"
          >
            {searchable && (
              <div className="px-3 pt-3 pb-1">
                <input
                  ref={searchInputRef}
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={searchPlaceholder ?? t('common.search')}
                  aria-label={t('common.search')}
                  className="w-full px-3 py-1.5 text-sm rounded-md border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-overlay)] text-[var(--sc-text-primary)] placeholder:text-[var(--sc-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            )}
            <ul className="py-1">
              {!hasResults && searchable && (
                <li className="px-4 py-2 text-sm text-[var(--sc-text-muted)]">
                  {t('common.noResults')}
                </li>
              )}
              {filteredOptions?.map(renderOption)}
              {filteredGroups?.map((group) => (
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
