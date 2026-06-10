import type { FC } from 'react';
import { useEffect, useRef } from 'react';
import type { CopilotMessage } from '../../features/copilot/copilotSlice';
import { Spinner } from '../ui/Spinner';

interface CopilotMessageListProps {
  messages: CopilotMessage[];
  emptyTitle: string;
  emptyBody: string;
  youLabel: string;
  assistantLabel: string;
}

/** Scrollable conversation transcript. Auto-scrolls to the newest message. */
export const CopilotMessageList: FC<CopilotMessageListProps> = ({
  messages,
  emptyTitle,
  emptyBody,
  youLabel,
  assistantLabel,
}) => {
  const endRef = useRef<HTMLDivElement | null>(null);

  // QNBS-v3: keep the latest message in view as content streams in. Reference messages.length so
  // the dependency is genuinely used (re-scroll on every new/updated message).
  useEffect(() => {
    if (messages.length >= 0) {
      endRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-2">
        <p className="text-base font-semibold text-[var(--sc-text-primary)]">{emptyTitle}</p>
        <p className="text-sm text-[var(--sc-text-muted)]">{emptyBody}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" aria-live="polite">
      {messages.map((msg) => {
        const isUser = msg.role === 'user';
        return (
          <div key={msg.id} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
            <span className="text-xs font-medium text-[var(--sc-text-muted)] mb-1">
              {isUser ? youLabel : assistantLabel}
            </span>
            <div
              className={`max-w-[85%] rounded-sc-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                isUser
                  ? 'bg-[var(--sc-accent)] text-white'
                  : 'bg-[var(--sc-surface-raised)] text-[var(--sc-text-primary)]'
              }`}
            >
              {msg.content || (msg.pending ? <Spinner className="w-4 h-4" label="" /> : '')}
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
};
