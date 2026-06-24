// QNBS-v3: PR-C1 — on-demand "Check this scene" LanguageTool panel. Self-hosted grammar/spell check
// over the active section; offset-safe apply, ignore, and add-to-dictionary. Hidden entirely when the
// active locale has no LanguageTool coverage (see useLanguageToolCheck).
import type { FC } from 'react';
import React from 'react';
import { useWriterViewContext } from '../../contexts/WriterViewContext';
import { useLanguageToolCheck } from '../../hooks/useLanguageToolCheck';
import { useTranslation } from '../../hooks/useTranslation';
import type { LanguageToolMatch } from '../../services/languageToolService';
import { Button } from '../ui/Button';

const GrammarMatchItem: FC<{
  match: LanguageToolMatch;
  onApply: (replacement: string) => void;
  onIgnore: () => void;
  onAddToDictionary: () => void;
}> = ({ match, onApply, onIgnore, onAddToDictionary }) => {
  const { t } = useTranslation();
  return (
    <li className="rounded-sc-md border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] p-2 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-[var(--sc-text-muted)]">
          {match.categoryName || match.category}
        </span>
        <code className="text-[11px] text-[var(--sc-danger-fg)] bg-[var(--sc-danger-bg)] px-1 rounded truncate max-w-[50%]">
          {match.matchedText}
        </code>
      </div>
      <p className="text-xs text-[var(--sc-text-secondary)]">{match.message}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {match.replacements.length > 0 ? (
          match.replacements.map((replacement) => (
            <button
              key={replacement}
              type="button"
              onClick={() => onApply(replacement)}
              className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--sc-accent)]/15 text-[var(--sc-text-primary)] border border-[var(--sc-border-subtle)] hover:bg-[var(--sc-accent)]/25 focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
            >
              {replacement}
            </button>
          ))
        ) : (
          <span className="text-[11px] text-[var(--sc-text-muted)] italic">
            {t('writer.grammar.noSuggestions')}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={onIgnore}
          className="text-[11px] text-[var(--sc-text-muted)] hover:text-[var(--sc-text-secondary)] focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] rounded"
        >
          {t('writer.grammar.ignore')}
        </button>
        {match.isSpelling && (
          <button
            type="button"
            onClick={onAddToDictionary}
            className="text-[11px] text-[var(--sc-text-muted)] hover:text-[var(--sc-text-secondary)] focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] rounded"
          >
            {t('writer.grammar.addToDictionary')}
          </button>
        )}
      </div>
    </li>
  );
};

const GrammarCheckPanel: FC = React.memo(() => {
  const { t } = useTranslation();
  const { selectedSectionId } = useWriterViewContext();
  const {
    available,
    unsupportedLocale,
    status,
    matches,
    check,
    applySuggestion,
    ignore,
    addToDictionary,
  } = useLanguageToolCheck();

  // Locale has no LanguageTool support → feature is simply absent (honest, no error).
  if (unsupportedLocale) {
    return (
      <p className="text-xs text-[var(--sc-text-muted)] px-1 py-2">
        {t('writer.grammar.unsupported')}
      </p>
    );
  }

  const onCheck = () => {
    if (selectedSectionId) void check(selectedSectionId);
  };

  return (
    <section aria-label={t('writer.grammar.title')} className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--sc-text-primary)]">
          {t('writer.grammar.title')}
        </h3>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={onCheck}
          disabled={!available || !selectedSectionId || status === 'checking'}
        >
          {status === 'checking' ? t('writer.grammar.checking') : t('writer.grammar.checkButton')}
        </Button>
      </div>

      {!available && (
        <p className="text-xs text-[var(--sc-warning-fg)]">{t('writer.grammar.disabled')}</p>
      )}
      {!selectedSectionId && available && (
        <p className="text-xs text-[var(--sc-text-muted)]">{t('writer.grammar.selectScene')}</p>
      )}
      {status === 'offline' && (
        <p className="text-xs text-[var(--sc-danger-fg)]">{t('writer.grammar.offline')}</p>
      )}
      {status === 'error' && (
        <p className="text-xs text-[var(--sc-danger-fg)]">{t('writer.grammar.error')}</p>
      )}
      {status === 'ok' && matches.length === 0 && (
        <p className="text-xs text-[var(--sc-success-fg)]">{t('writer.grammar.noIssues')}</p>
      )}

      {matches.length > 0 && (
        <>
          <p className="text-xs text-[var(--sc-text-muted)]">
            {t('writer.grammar.issuesFound', { count: matches.length })}
          </p>
          <ul className="space-y-2" aria-label={t('writer.grammar.title')}>
            {matches.map((match) => (
              <GrammarMatchItem
                key={`${match.offset}-${match.length}-${match.ruleId}`}
                match={match}
                onApply={(replacement) =>
                  selectedSectionId && applySuggestion(selectedSectionId, match, replacement)
                }
                onIgnore={() => ignore(match)}
                onAddToDictionary={() => addToDictionary(match.matchedText)}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
});
GrammarCheckPanel.displayName = 'GrammarCheckPanel';

export { GrammarCheckPanel };
