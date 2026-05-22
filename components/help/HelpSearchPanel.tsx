import type { FC } from 'react';
import type { FlatHelpArticle } from '../../services/help/helpSearch';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Input } from '../ui/Input';

export interface HelpSearchPanelProps {
  query: string;
  onQueryChange: (q: string) => void;
  results: FlatHelpArticle[];
  translate: (key: string, replacements?: Record<string, string>) => string;
  onSelect: (article: FlatHelpArticle) => void;
  onClear: () => void;
}

export const HelpSearchPanel: FC<HelpSearchPanelProps> = ({
  query,
  onQueryChange: _onQueryChange,
  results,
  translate,
  onSelect,
  onClear,
}) => {
  if (!query.trim()) return null;

  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-[var(--sc-text-primary)]">
          {translate('help.searchResultsTitle')}
        </h2>
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          {translate('common.cancel')}
        </Button>
      </CardHeader>
      <CardContent>
        {results.length === 0 ? (
          <p className="text-sm text-[var(--sc-text-muted)]">
            {translate('help.noResults', { query })}
          </p>
        ) : (
          <ul className="space-y-2">
            {results.map((hit) => (
              <li key={`${hit.categoryId}-${hit.titleKey}`}>
                <button
                  type="button"
                  className="w-full text-left p-3 rounded-md hover:bg-[var(--sc-surface-overlay)] transition-colors"
                  onClick={() => onSelect(hit)}
                >
                  <span className="block text-xs text-[var(--sc-text-muted)] uppercase tracking-wide">
                    {translate(hit.categoryTitleKey)}
                  </span>
                  <span className="block text-base font-medium text-[var(--sc-text-primary)]">
                    {translate(hit.titleKey)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};

export const HelpSearchInput: FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}> = ({ value, onChange, placeholder }) => (
  <div className="mb-6 max-w-xl">
    <Input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      autoComplete="off"
    />
  </div>
);
