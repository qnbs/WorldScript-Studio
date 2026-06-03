import type { FC } from 'react';
import { ROSTER_SORT_OPTIONS, type RosterSort } from '../../services/rosterMetrics';
import { Select } from '../ui/Select';

// QNBS-v3: Shared roster toolbar (Characters / World) — at-a-glance stat chips + live search +
// sort. Purely controlled; the consuming view owns the ephemeral search/sort state.
type TranslateFn = (key: string, replacements?: Record<string, string>) => string;

export interface RosterStat {
  label: string;
  value: string | number;
}

interface RosterToolbarProps {
  t: TranslateFn;
  stats: RosterStat[];
  searchQuery: string;
  onSearchChange: (value: string) => void;
  sort: RosterSort;
  onSortChange: (value: RosterSort) => void;
  /** Result count shown next to the search field (e.g. filtered vs total). */
  resultCount: number;
  totalCount: number;
  searchPlaceholder: string;
  searchAriaLabel: string;
  sortAriaLabel: string;
}

export const RosterToolbar: FC<RosterToolbarProps> = ({
  t,
  stats,
  searchQuery,
  onSearchChange,
  sort,
  onSortChange,
  resultCount,
  totalCount,
  searchPlaceholder,
  searchAriaLabel,
  sortAriaLabel,
}) => (
  <div className="mb-6 flex flex-col gap-3 rounded-sc-xl border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)]/40 p-3 backdrop-blur-sm lg:flex-row lg:items-center lg:justify-between">
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-1">
      {stats.map((s) => (
        <li key={s.label} className="flex items-baseline gap-1.5">
          <span className="text-lg font-black tabular-nums text-[var(--sc-text-primary)]">
            {s.value}
          </span>
          <span className="text-xs font-medium text-[var(--sc-text-muted)]">{s.label}</span>
        </li>
      ))}
    </ul>

    <div className="flex items-center gap-2">
      <div className="relative">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.6}
          stroke="currentColor"
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--sc-text-muted)]"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
          />
        </svg>
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchAriaLabel}
          className="h-11 w-40 rounded-sc-lg border border-[var(--sc-border-subtle)] bg-[var(--glass-bg)] py-2 pl-8 pr-3 text-sm text-[var(--sc-text-primary)] shadow-sm backdrop-blur-md transition-all duration-sc-fast placeholder:text-[var(--sc-text-muted)] hover:border-[var(--sc-border-strong)] focus-visible:border-[var(--border-interactive)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] sm:w-52"
        />
      </div>
      <div className="w-40 shrink-0">
        <Select
          value={sort}
          onChange={(e) => onSortChange(e.target.value as RosterSort)}
          aria-label={sortAriaLabel}
        >
          {ROSTER_SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </option>
          ))}
        </Select>
      </div>
    </div>

    {searchQuery.trim() ? (
      <p className="px-1 text-xs text-[var(--sc-text-muted)] lg:order-last lg:w-full lg:text-right">
        {t('roster.resultCount', { count: String(resultCount), total: String(totalCount) })}
      </p>
    ) : null}
  </div>
);
