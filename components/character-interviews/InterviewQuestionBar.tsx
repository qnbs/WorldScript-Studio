import { useState } from 'react';
import { useCharacterInterviewsViewContext } from '../../contexts/CharacterInterviewsViewContext';
import { useTranslation } from '../../hooks/useTranslation';
import { getQuestionsForArchetype } from '../../services/characterInterviewTemplates';

// QNBS-v3: All dark: prefixes replaced with --sc-* tokens — appearance presets now work correctly.
export function InterviewQuestionBar() {
  const { t } = useTranslation();
  const { selectedInterview, isStreaming, sendQuestion } = useCharacterInterviewsViewContext();
  const [customQuestion, setCustomQuestion] = useState('');

  if (!selectedInterview) return null;

  const suggestions = getQuestionsForArchetype(selectedInterview.archetype);
  // QNBS-v3: only show questions not yet asked to reduce repetition
  const alreadyAsked = new Set(
    selectedInterview.messages.filter((m) => m.role === 'user').map((m) => m.content),
  );
  const remaining = suggestions.filter((q) => !alreadyAsked.has(q.question));

  const handleSend = () => {
    const q = customQuestion.trim();
    if (!q || isStreaming) return;
    sendQuestion(q);
    setCustomQuestion('');
  };

  return (
    <div className="border-t border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)]">
      {remaining.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-4 py-2">
          <span className="shrink-0 text-xs text-[var(--sc-text-muted)] self-center">
            {t('characterInterviews.suggestedQuestions')}:
          </span>
          {remaining.slice(0, 4).map((q) => (
            <button
              key={q.id}
              type="button"
              onClick={() => {
                if (!isStreaming) sendQuestion(q.question);
              }}
              disabled={isStreaming}
              className="shrink-0 rounded-full border border-[var(--sc-border-strong)] px-3 py-1 text-xs text-[var(--sc-accent)] transition-colors hover:bg-[var(--sc-accent)]/10 disabled:opacity-50"
            >
              {q.question}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 px-4 pb-4 pt-2">
        <input
          type="text"
          value={customQuestion}
          onChange={(e) => setCustomQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSend();
          }}
          placeholder={t('characterInterviews.questionPlaceholder')}
          disabled={isStreaming}
          aria-label={t('characterInterviews.customQuestion')}
          className="flex-1 rounded-sc-md border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] px-3 py-2 text-sm text-[var(--sc-text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] disabled:opacity-50 placeholder:text-[var(--sc-text-muted)]"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={isStreaming || !customQuestion.trim()}
          className="rounded-sc-md bg-[var(--sc-accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--sc-accent-hover)] disabled:opacity-50"
        >
          {t('characterInterviews.sendQuestion')}
        </button>
      </div>
    </div>
  );
}
