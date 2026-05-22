import { useEffect, useRef } from 'react';
import { useCharacterInterviewsViewContext } from '../../contexts/CharacterInterviewsViewContext';
import { useTranslation } from '../../hooks/useTranslation';
import { InterviewQuestionBar } from './InterviewQuestionBar';

function MessageBubble({
  role,
  content,
  characterName,
}: {
  role: 'user' | 'ai';
  content: string;
  characterName: string;
}) {
  const { t } = useTranslation();
  const isUser = role === 'user';
  const label = isUser ? t('characterInterviews.messageRoleUser') : characterName;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-sc-xl px-4 py-3 ${
          isUser
            ? 'bg-[var(--sc-accent)] text-white'
            : 'bg-[var(--sc-surface-overlay)] text-[var(--sc-text-primary)]'
        }`}
      >
        <p
          className={`mb-1 text-xs font-medium ${isUser ? 'text-white/70' : 'text-[var(--sc-text-muted)]'}`}
        >
          {label}
        </p>
        <p className="text-sm whitespace-pre-wrap">{content || '…'}</p>
      </div>
    </div>
  );
}

export function InterviewPanel() {
  const { t } = useTranslation();
  const { selectedInterview, selectedCharacter, isStreaming, stopStreaming, hasAiKey } =
    useCharacterInterviewsViewContext();

  const bottomRef = useRef<HTMLDivElement>(null);
  // QNBS-v3: track message count to trigger auto-scroll; ref is the only body dep but scroll must fire on new messages
  const msgCount = selectedInterview?.messages.length ?? 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — effect fires on msgCount change; bottomRef is stable
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgCount]);

  if (!selectedInterview) return null;

  if (!hasAiKey) {
    return (
      // QNBS-v3: dark: prefix removed — sc-token adapts to all appearance presets.
      <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-[var(--sc-text-muted)]">
        {t('characterInterviews.noAiKey')}
      </div>
    );
  }

  const characterName: string = selectedCharacter?.name ?? t('characterInterviews.messageRoleAi');

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto space-y-4 p-4">
        {selectedInterview.messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            role={msg.role}
            content={msg.content}
            characterName={characterName}
          />
        ))}
        {isStreaming && (
          <div className="flex justify-start">
            <div className="rounded-sc-xl bg-[var(--sc-surface-overlay)] px-4 py-3">
              <p className="text-xs text-[var(--sc-text-muted)] animate-pulse">
                {t('characterInterviews.thinking')}
              </p>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      {isStreaming && (
        <div className="flex justify-center py-2">
          <button
            type="button"
            onClick={stopStreaming}
            className="rounded-full bg-[var(--sc-danger-bg)] px-4 py-1 text-xs text-[var(--sc-danger-fg)] transition-colors hover:opacity-80"
          >
            {t('characterInterviews.stopGeneration')}
          </button>
        </div>
      )}
      <InterviewQuestionBar />
    </div>
  );
}
