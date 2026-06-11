import type { FC, FormEvent, KeyboardEvent } from 'react';
import { useEffect, useState } from 'react';
import { useTransientUiStore } from '../../app/transientUiStore';

interface CopilotComposerProps {
  placeholder: string;
  sendLabel: string;
  isStreaming: boolean;
  onSend: (text: string) => void;
}

/** Single-line-growing composer. Enter sends; Shift+Enter inserts a newline. */
export const CopilotComposer: FC<CopilotComposerProps> = ({
  placeholder,
  sendLabel,
  isStreaming,
  onSend,
}) => {
  const [value, setValue] = useState('');
  const draftMessage = useTransientUiStore((s) => s.copilotDraftMessage);
  const setCopilotDraftMessage = useTransientUiStore((s) => s.setCopilotDraftMessage);

  // QNBS-v3: Phase 3 — ProForge "Ask Copilot" chip sets a draft; consume once then clear.
  useEffect(() => {
    if (draftMessage) {
      setValue(draftMessage);
      setCopilotDraftMessage(null);
    }
  }, [draftMessage, setCopilotDraftMessage]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
    setValue('');
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-2 border-t border-[var(--sc-border-subtle)] p-3"
    >
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        rows={1}
        className="flex-1 resize-none rounded-sc-lg bg-[var(--sc-surface-raised)] text-[var(--sc-text-primary)] text-sm px-3 py-2 max-h-28 overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)]"
      />
      <button
        type="submit"
        disabled={isStreaming || !value.trim()}
        aria-label={sendLabel}
        className="shrink-0 rounded-sc-lg bg-[var(--sc-accent)] text-white p-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)]"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="w-icon-sc-sm h-icon-sc-sm"
          aria-hidden="true"
        >
          <path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" />
        </svg>
      </button>
    </form>
  );
};
