import type { FC, FormEvent, KeyboardEvent } from 'react';
import { useEffect, useState } from 'react';
import { useTransientUiStore } from '../../app/transientUiStore';
import { Icon } from '../ui/Icon';

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
        className="flex-1 resize-none rounded-sc-lg bg-[var(--sc-surface-raised)] text-[var(--sc-text-primary)] text-sm px-3 py-2 max-h-28 overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
      />
      <button
        type="submit"
        disabled={isStreaming || !value.trim()}
        aria-label={sendLabel}
        className="shrink-0 rounded-sc-lg bg-[var(--sc-accent)] text-[var(--sc-text-on-accent)] p-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
      >
        <Icon name="send" size="sm" aria-hidden />
      </button>
    </form>
  );
};
