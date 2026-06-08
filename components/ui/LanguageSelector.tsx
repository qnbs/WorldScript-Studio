import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Language } from '../../contexts/I18nContext';
import { useTranslation } from '../../hooks/useTranslation';

// QNBS-v3: Language metadata with flag emoji and native names for premium UX
const LANGUAGE_METADATA: Record<
  Language,
  { label: string; nativeName: string; flag: string; isBeta?: boolean }
> = {
  en: { label: 'English', nativeName: 'English', flag: '🇺🇸' },
  de: { label: 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
  fr: { label: 'French', nativeName: 'Français', flag: '🇫🇷' },
  es: { label: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
  it: { label: 'Italian', nativeName: 'Italiano', flag: '🇮🇹' },
  ar: { label: 'Arabic', nativeName: 'العربية', flag: '🇸🇦', isBeta: true },
  he: { label: 'Hebrew', nativeName: 'עברית', flag: '🇮🇱', isBeta: true },
  ja: { label: 'Japanese', nativeName: '日本語', flag: '🇯🇵', isBeta: true },
  zh: { label: 'Chinese', nativeName: '简体中文', flag: '🇨🇳', isBeta: true },
  pt: { label: 'Portuguese', nativeName: 'Português', flag: '🇵🇹', isBeta: true },
  el: { label: 'Greek', nativeName: 'Ελληνικά', flag: '🇬🇷', isBeta: true },
};

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

    // QNBS-v3: Position dropdown as fixed when opened to escape stacking context
    useEffect(() => {
      if (!isOpen || !containerRef.current || !dropdownRef.current) return;

      const updatePosition = () => {
        const containerRect = containerRef.current?.getBoundingClientRect();
        if (!containerRect) return;

        const dropdown = dropdownRef.current;
        if (!dropdown) return;

        // Position as fixed to escape any stacking context
        dropdown.style.position = 'fixed';
        dropdown.style.top = `${containerRect.bottom + window.scrollY}px`;
        dropdown.style.left = `${containerRect.left + window.scrollX}px`;
        dropdown.style.width = `${containerRect.width}px`;
        dropdown.style.marginTop = '0';
        dropdown.style.marginLeft = '0';
      };

      updatePosition();
      window.addEventListener('scroll', updatePosition);
      window.addEventListener('resize', updatePosition);

      return () => {
        window.removeEventListener('scroll', updatePosition);
        window.removeEventListener('resize', updatePosition);
      };
    }, [isOpen]);

    // QNBS-v3: Filter languages by search query (search in native name, label, and code)
    const filteredLanguages = useMemo(() => {
      const query = searchQuery.toLowerCase().trim();
      if (!query) return Object.keys(LANGUAGE_METADATA) as Language[];
      return (Object.keys(LANGUAGE_METADATA) as Language[]).filter((code) => {
        const meta = LANGUAGE_METADATA[code];
        return (
          meta.label.toLowerCase().includes(query) ||
          meta.nativeName.toLowerCase().includes(query) ||
          code.toLowerCase().includes(query)
        );
      });
    }, [searchQuery]);

    const currentMeta = LANGUAGE_METADATA[value];

    const handleSelect = useCallback(
      (lang: Language) => {
        onChange(lang);
        setIsOpen(false);
        setSearchQuery('');
      },
      [onChange],
    );

    // QNBS-v3: Compact variant for header (button with current language indicator)
    if (variant === 'compact') {
      return (
        <div className={`relative z-50 isolate ${className}`} ref={containerRef}>
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-label={t('portal.language.groupLabel')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-sc-md bg-[var(--glass-bg)] hover:bg-[var(--glass-bg-hover)] border border-[var(--sc-border-subtle)] text-[var(--sc-text-primary)] transition-all duration-sc-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
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
            <svg
              xmlns="http://www.w3.org/2020/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className={`w-3 h-3 text-[var(--sc-text-muted)] transition-transform duration-sc-fast ${isOpen ? 'rotate-180' : ''}`}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {isOpen && (
            <div
              role="listbox"
              aria-label={t('portal.language.groupLabel')}
              className="absolute top-full right-0 mt-2 w-64 max-h-80 overflow-y-auto rounded-sc-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] shadow-[var(--sc-shadow-xl)] z-[100]"
            >
              {showSearch && (
                <div className="p-2 border-b border-[var(--sc-border-subtle)]">
                  <input
                    ref={inputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t('portal.language.searchPlaceholder')}
                    className="w-full px-2.5 py-1.5 text-sm rounded-sc-md bg-[var(--glass-bg)] border border-[var(--sc-border-subtle)] text-[var(--sc-text-primary)] placeholder:text-[var(--sc-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
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
                        className={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
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
                            {meta.label}
                          </div>
                        </div>
                        {meta.isBeta && (
                          <span className="text-[0.6em] opacity-70 px-1" aria-hidden="true">
                            β
                          </span>
                        )}
                        {isActive && (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={2}
                            stroke="currentColor"
                            className="w-4 h-4 text-[var(--sc-accent)]"
                            aria-hidden="true"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      );
    }

    // Full variant for settings page
    return (
      <div className={`relative z-50 isolate ${className}`} ref={containerRef}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label={t('portal.language.groupLabel')}
          className="flex items-center justify-between w-full px-4 py-2.5 text-sm rounded-sc-lg bg-[var(--glass-bg)] hover:bg-[var(--glass-bg-hover)] border border-[var(--sc-border-subtle)] text-[var(--sc-text-primary)] transition-all duration-sc-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
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
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className={`w-4 h-4 text-[var(--sc-text-muted)] transition-transform duration-sc-fast ${isOpen ? 'rotate-180' : ''}`}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isOpen && (
          <div
            ref={dropdownRef}
            role="listbox"
            aria-label={t('portal.language.groupLabel')}
            className="max-h-80 overflow-y-auto rounded-sc-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] shadow-[var(--sc-shadow-xl)] z-[10000] isolate"
          >
            {showSearch && (
              <div className="p-2 border-b border-[var(--sc-border-subtle)]">
                <input
                  ref={inputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('portal.language.searchPlaceholder')}
                  className="w-full px-3 py-2 text-sm rounded-sc-md bg-[var(--glass-bg)] border border-[var(--sc-border-subtle)] text-[var(--sc-text-primary)] placeholder:text-[var(--sc-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
                />
              </div>
            )}
            <ul className="py-1 max-h-64 overflow-y-auto">
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
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
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
                          {meta.label}
                        </div>
                      </div>
                      {meta.isBeta && (
                        <span className="text-[0.6em] opacity-70 px-1" aria-hidden="true">
                          β
                        </span>
                      )}
                      {isActive && (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                          stroke="currentColor"
                          className="w-4 h-4 text-[var(--sc-accent)]"
                          aria-hidden="true"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    );
  },
);
LanguageSelector.displayName = 'LanguageSelector';
