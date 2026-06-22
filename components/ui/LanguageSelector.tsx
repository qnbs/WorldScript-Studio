import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Language } from '../../contexts/I18nContext';
import { useTranslation } from '../../hooks/useTranslation';
import { LOCALES } from '../../i18n/locales';
import { Icon } from './Icon';

// QNBS-v3: Language metadata derived from the SSOT registry (i18n/locales.ts) — no longer a parallel
// hand-maintained table. nativeName is the endonym (intentionally NOT localized so users always find
// their own language). The exonym label is resolved at render time via t('portal.language.names.<code>')
// to satisfy the no-hardcoded-user-facing-strings rule. flag is an emoji (non-translatable); isBeta is
// derived from the registry status. isBeta = the *beta* tier only, so the β badge distinguishes beta
// from near-production (ja/zh/pt/el show no β; the finer tier lives in the README + status dashboard).
const LANGUAGE_METADATA: Record<Language, { nativeName: string; flag: string; isBeta?: boolean }> =
  Object.fromEntries(
    LOCALES.map((l) => [
      l.code,
      {
        nativeName: l.nativeName,
        flag: l.flag,
        ...(l.status === 'beta' ? { isBeta: true } : {}),
      },
    ]),
  ) as Record<Language, { nativeName: string; flag: string; isBeta?: boolean }>;

interface LanguageSelectorProps {
  value: Language;
  onChange: (language: Language) => void;
  /** Show as compact button (for header) or full dropdown (for settings) */
  variant?: 'compact' | 'full';
  /** Show search input inside dropdown (default true) */
  showSearch?: boolean;
  /** Optional className for styling */
  className?: string;
}

export const LanguageSelector = React.memo(
  ({
    value,
    onChange,
    variant = 'full',
    showSearch = true,
    className = '',
  }: LanguageSelectorProps) => {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // QNBS-v3: Close on outside click / escape
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent | TouchEvent) => {
        const target = event.target as Node;
        const isInsideContainer = containerRef.current?.contains(target);
        const isInsideDropdown = dropdownRef.current?.contains(target);
        if (!isInsideContainer && !isInsideDropdown) {
          setIsOpen(false);
          setSearchQuery('');
        }
      };

      const handleEscape = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          setIsOpen(false);
          setSearchQuery('');
        }
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

    // QNBS-v3: Focus input when opened
    useEffect(() => {
      if (isOpen && inputRef.current) {
        inputRef.current.focus();
      }
    }, [isOpen]);

    // QNBS-v3: Position dropdown via portal to document.body with absolute
    // positioning. This escapes any parent stacking context, overflow clipping,
    // backdrop-filter/transform containing blocks, and z-index traps that
    // break fixed positioning inside Card components.
    useLayoutEffect(() => {
      if (!isOpen || !containerRef.current || !dropdownRef.current) return;

      const dropdown = dropdownRef.current;

      const updatePosition = () => {
        const containerRect = containerRef.current?.getBoundingClientRect();
        if (!containerRect) return;

        // body-relative coordinates for absolute positioning under document.body
        const scrollX = window.scrollX ?? document.documentElement.scrollLeft ?? 0;
        const scrollY = window.scrollY ?? document.documentElement.scrollTop ?? 0;

        dropdown.style.position = 'absolute';
        dropdown.style.top = `${containerRect.bottom + scrollY + 8}px`; // 8px gap
        dropdown.style.marginTop = '0';
        dropdown.style.marginLeft = '0';

        if (variant === 'compact') {
          dropdown.style.left = `${containerRect.right + scrollX - 256}px`;
          dropdown.style.width = '256px';
        } else {
          dropdown.style.left = `${containerRect.left + scrollX}px`;
          dropdown.style.width = `${containerRect.width}px`;
        }
      };

      updatePosition();

      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);

      return () => {
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
      };
    }, [isOpen, variant]);

    // QNBS-v3: Filter languages by search query (search in localized exonym, native name, and code)
    const filteredLanguages = useMemo(() => {
      const query = searchQuery.toLowerCase().trim();
      if (!query) return Object.keys(LANGUAGE_METADATA) as Language[];
      return (Object.keys(LANGUAGE_METADATA) as Language[]).filter((code) => {
        const meta = LANGUAGE_METADATA[code];
        return (
          t(`portal.language.names.${code}`).toLowerCase().includes(query) ||
          meta.nativeName.toLowerCase().includes(query) ||
          code.toLowerCase().includes(query)
        );
      });
    }, [searchQuery, t]);

    const currentMeta = LANGUAGE_METADATA[value];

    const handleSelect = useCallback(
      (lang: Language) => {
        onChange(lang);
        setIsOpen(false);
        setSearchQuery('');
      },
      [onChange],
    );

    const isCompact = variant === 'compact';
    const itemPadding = isCompact ? 'px-3 py-2' : 'px-4 py-2.5';
    const inputPadding = isCompact ? 'px-2.5 py-1.5' : 'px-3 py-2';

    const dropdown = (
      <div
        ref={dropdownRef}
        role="listbox"
        aria-label={t('portal.language.groupLabel')}
        className="absolute max-h-80 overflow-y-auto rounded-sc-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] shadow-[var(--sc-shadow-xl)] z-[10000]"
      >
        {showSearch && (
          <div className="p-2 border-b border-[var(--sc-border-subtle)]">
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('portal.language.searchPlaceholder')}
              className={`w-full text-sm rounded-sc-md bg-[var(--glass-bg)] border border-[var(--sc-border-subtle)] text-[var(--sc-text-primary)] placeholder:text-[var(--sc-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] ${inputPadding}`}
            />
          </div>
        )}
        <ul className="py-1">
          {filteredLanguages.map((lang) => {
            const meta = LANGUAGE_METADATA[lang];
            const isActive = lang === value;
            return (
              <li key={lang}>
                <button
                  type="button"
                  onClick={() => handleSelect(lang)}
                  role="option"
                  aria-selected={isActive}
                  className={`w-full flex items-center gap-3 text-left text-sm transition-colors ${itemPadding} ${
                    isActive
                      ? 'bg-[var(--sc-accent-subtle)] text-[var(--sc-text-primary)]'
                      : 'text-[var(--sc-text-secondary)] hover:bg-[var(--sc-surface-raised)]'
                  } focus-visible:outline-none focus-visible:bg-[var(--sc-surface-raised)]`}
                >
                  <span className="text-base" aria-hidden="true">
                    {meta.flag}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{meta.nativeName}</div>
                    <div className="text-xs text-[var(--sc-text-muted)] truncate">
                      {t(`portal.language.names.${lang}`)}
                    </div>
                  </div>
                  {meta.isBeta && (
                    <span className="text-[0.6em] opacity-70 px-1" aria-hidden="true">
                      β
                    </span>
                  )}
                  {isActive && (
                    <Icon name="check" size="sm" className="text-[var(--sc-accent)]" aria-hidden />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );

    // QNBS-v3: Compact variant for header (button with current language indicator)
    if (isCompact) {
      return (
        <div className={`relative ${className}`} ref={containerRef}>
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-label={t('portal.language.groupLabel')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-sc-md bg-[var(--glass-bg)] hover:bg-[var(--glass-bg-hover)] border border-[var(--sc-border-subtle)] text-[var(--sc-text-primary)] transition-all duration-sc-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] cursor-pointer"
          >
            <span className="text-base" aria-hidden="true">
              {currentMeta.flag}
            </span>
            <span className="hidden sm:inline">{currentMeta.nativeName}</span>
            {currentMeta.isBeta && (
              <sup className="text-[0.6em] opacity-70" aria-hidden="true">
                β
              </sup>
            )}
            <Icon
              name="chevron-down"
              size="sm"
              className={`text-[var(--sc-text-muted)] transition-transform duration-sc-fast ${isOpen ? 'rotate-180' : ''}`}
              aria-hidden
            />
          </button>

          {isOpen && createPortal(dropdown, document.body)}
        </div>
      );
    }

    // Full variant for settings page
    return (
      <div className={`relative ${className}`} ref={containerRef}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label={t('portal.language.groupLabel')}
          className="flex items-center justify-between w-full px-4 py-2.5 text-sm rounded-sc-lg bg-[var(--glass-bg)] hover:bg-[var(--glass-bg-hover)] border border-[var(--sc-border-subtle)] text-[var(--sc-text-primary)] transition-all duration-sc-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <span className="text-base" aria-hidden="true">
              {currentMeta.flag}
            </span>
            <span className="font-medium">{currentMeta.nativeName}</span>
            {currentMeta.isBeta && (
              <span className="text-[0.6em] opacity-70 px-1" aria-hidden="true">
                β
              </span>
            )}
          </div>
          <Icon
            name="chevron-down"
            size="sm"
            className={`text-[var(--sc-text-muted)] transition-transform duration-sc-fast ${isOpen ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </button>

        {isOpen && createPortal(dropdown, document.body)}
      </div>
    );
  },
);
LanguageSelector.displayName = 'LanguageSelector';
