import { useState } from 'react';
import { useCharacterInterviewsViewContext } from '../../contexts/CharacterInterviewsViewContext';
import { useTranslation } from '../../hooks/useTranslation';
import { getQuestionsForArchetype } from '../../services/characterInterviewTemplates';

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
    <div className="border-t border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      {remaining.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-4 py-2">
          <span className="shrink-0 text-xs text-gray-400 self-center">
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
              className="shrink-0 rounded-full border border-blue-300 px-3 py-1 text-xs text-blue-600 transition-colors hover:bg-blue-50 disabled:opacity-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/20"
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
          className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={isStreaming || !customQuestion.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {t('characterInterviews.sendQuestion')}
        </button>
      </div>
    </div>
  );
}
