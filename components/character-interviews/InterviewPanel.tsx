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
        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-blue-600 text-white'
            : 'bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-white'
        }`}
      >
        <p
          className={`mb-1 text-xs font-medium ${isUser ? 'text-blue-200' : 'text-gray-500 dark:text-gray-400'}`}
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
      <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-gray-500 dark:text-gray-400">
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
            <div className="rounded-2xl bg-gray-100 px-4 py-3 dark:bg-gray-700">
              <p className="text-xs text-gray-500 dark:text-gray-400 animate-pulse">
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
            className="rounded-full bg-red-100 px-4 py-1 text-xs text-red-600 transition-colors hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
          >
            {t('characterInterviews.stopGeneration')}
          </button>
        </div>
      )}
      <InterviewQuestionBar />
    </div>
  );
}
