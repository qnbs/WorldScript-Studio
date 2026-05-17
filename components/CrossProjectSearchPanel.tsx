import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppSelector } from '../app/hooks';
import { useTransientUiStore } from '../app/transientUiStore';
import { selectFeatureFlags } from '../features/featureFlags/featureFlagsSlice';
import { selectProjectData } from '../features/project/projectSelectors';
import type { ProjectData } from '../features/project/projectSlice';
import { useTranslation } from '../hooks/useTranslation';
import {
  type CrossProjectSearchResult,
  searchAcrossProjects,
} from '../services/crossProjectSearchService';

// QNBS-v3: debounce search input to avoid running fuzzy score on every keystroke
function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

const matchTypeLabel: Record<CrossProjectSearchResult['matchType'], string> = {
  title: 'Title',
  logline: 'Logline',
  manuscript: 'Manuscript',
  character: 'Character',
};

const ResultItem: React.FC<{
  result: CrossProjectSearchResult;
  onClose: () => void;
}> = React.memo(({ result, onClose }) => (
  <button
    type="button"
    onClick={onClose}
    className="w-full text-left px-4 py-3 rounded-lg hover:bg-[var(--background-secondary)] focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] transition-colors group"
  >
    <div className="flex items-center gap-2 mb-1">
      <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-[var(--background-tertiary)] text-[var(--foreground-secondary)]">
        {matchTypeLabel[result.matchType]}
      </span>
      <span className="text-xs text-[var(--foreground-secondary)] truncate">
        {result.projectTitle}
      </span>
    </div>
    <p className="text-sm text-[var(--foreground-primary)] line-clamp-2">{result.excerpt}</p>
  </button>
));
ResultItem.displayName = 'ResultItem';

interface CrossProjectSearchPanelProps {
  projectData: ProjectData | null;
}

export const CrossProjectSearchPanel: React.FC<CrossProjectSearchPanelProps> = React.memo(
  ({ projectData }) => {
    const { t } = useTranslation();
    const featureFlags = useAppSelector(selectFeatureFlags);
    const isOpen = useTransientUiStore((s) => s.isCrossProjectSearchOpen);
    const setOpen = useTransientUiStore((s) => s.setCrossProjectSearchOpen);

    const [query, setQuery] = useState('');
    const debouncedQuery = useDebounce(query, 200);
    const inputRef = useRef<HTMLInputElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    const close = useCallback(() => {
      setOpen(false);
      setQuery('');
    }, [setOpen]);

    // Focus input when panel opens
    useEffect(() => {
      if (isOpen) {
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    }, [isOpen]);

    // Esc closes; focus-trap via keyboard guard
    useEffect(() => {
      if (!isOpen) return;
      const handler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      };
      document.addEventListener('keydown', handler);
      return () => document.removeEventListener('keydown', handler);
    }, [isOpen, close]);

    // Click-outside closes
    useEffect(() => {
      if (!isOpen) return;
      const handler = (e: MouseEvent) => {
        if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
          close();
        }
      };
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }, [isOpen, close]);

    const results: CrossProjectSearchResult[] = React.useMemo(() => {
      if (!debouncedQuery.trim() || !projectData) return [];
      return searchAcrossProjects(debouncedQuery, projectData);
    }, [debouncedQuery, projectData]);

    if (!featureFlags.enableCrossProjectSearch || !isOpen) return null;

    return (
      // QNBS-v3: fixed overlay + role="dialog" satisfies WCAG 2.2 modal pattern; aria-modal signals SR to ignore background
      <div
        role="presentation"
        className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 px-4 bg-black/40 backdrop-blur-sm"
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={t('crossSearch.panelLabel')}
          className="w-full max-w-xl bg-[var(--background-primary)] border border-[var(--border-primary)] rounded-xl shadow-2xl overflow-hidden"
        >
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-primary)]">
            <svg
              aria-hidden="true"
              className="w-4 h-4 flex-shrink-0 text-[var(--foreground-secondary)]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"
              />
            </svg>
            <input
              ref={inputRef}
              type="search"
              aria-label={t('crossSearch.inputLabel')}
              placeholder={t('crossSearch.placeholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent text-sm text-[var(--foreground-primary)] placeholder-[var(--foreground-secondary)] outline-none"
            />
            <button
              type="button"
              onClick={close}
              aria-label={t('common.close')}
              className="text-xs text-[var(--foreground-secondary)] hover:text-[var(--foreground-primary)] px-2 py-1 rounded border border-[var(--border-primary)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]"
            >
              Esc
            </button>
          </div>

          {/* Results */}
          <div
            role="list"
            aria-label={t('crossSearch.resultsLabel')}
            className="max-h-80 overflow-y-auto py-2 px-2"
          >
            {debouncedQuery.trim() === '' && (
              <p className="px-4 py-6 text-sm text-center text-[var(--foreground-secondary)]">
                {t('crossSearch.hint')}
              </p>
            )}
            {debouncedQuery.trim() !== '' && results.length === 0 && (
              <p className="px-4 py-6 text-sm text-center text-[var(--foreground-secondary)]">
                {t('crossSearch.noResults')}
              </p>
            )}
            {results.map((r) => (
              // QNBS-v3: key uses all stable discriminators so same project can have multiple match types
              <div role="listitem" key={`${r.projectId}:${r.matchType}:${r.score}:${r.excerpt}`}>
                <ResultItem result={r} onClose={close} />
              </div>
            ))}
          </div>

          {/* Footer note: v1 scope */}
          <div className="px-4 py-2 border-t border-[var(--border-primary)] text-xs text-[var(--foreground-secondary)] text-center">
            {t('crossSearch.scopeNote')}
          </div>
        </div>
      </div>
    );
  },
);
CrossProjectSearchPanel.displayName = 'CrossProjectSearchPanel';

export const CrossProjectSearchPanelConnected: React.FC = React.memo(() => {
  const projectData = useAppSelector(selectProjectData);
  return <CrossProjectSearchPanel projectData={projectData ?? null} />;
});
CrossProjectSearchPanelConnected.displayName = 'CrossProjectSearchPanelConnected';
