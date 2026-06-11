/**
 * CopilotMessageList — scrollable conversation transcript with markdown rendering.
 * QNBS-v3: Assistant messages are rendered as sanitized HTML (DOMPurify + micro-markdown).
 * User messages remain plain text. An "Apply to chapter" button appears on the last
 * assistant message when it contains a fenced code block and a chapter is active.
 */

import DOMPurify from 'dompurify';
import { type FC, useEffect, useRef } from 'react';
import type { CopilotMessage } from '../../features/copilot/copilotSlice';
import { Spinner } from '../ui/Spinner';

// ---------------------------------------------------------------------------
// Micro markdown renderer (~60 lines, zero deps)
// Handles: headings, bold, italic, inline code, fenced code blocks, lists, paragraphs.
// ---------------------------------------------------------------------------

function renderMarkdown(raw: string): string {
  let html = raw;

  // Fenced code blocks — capture content inside for rendering, also needed for Apply detection
  html = html.replace(/```(?:[^\n]*)?\n([\s\S]*?)```/g, (_, code: string) => {
    const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<pre class="mt-1 mb-1 overflow-x-auto rounded bg-[var(--sc-surface-overlay)] p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap"><code>${escaped}</code></pre>`;
  });

  // Split into lines and process
  const lines = html.split('\n');
  const out: string[] = [];
  let inList = false;
  let listTag = 'ul';

  for (const raw_line of lines) {
    const line = raw_line;

    // Headings
    const h3 = line.match(/^### (.+)/);
    const h2 = line.match(/^## (.+)/);
    const h1 = line.match(/^# (.+)/);
    if (h1 ?? h2 ?? h3) {
      if (inList) {
        out.push(`</${listTag}>`);
        inList = false;
      }
      const content = h1?.[1] ?? h2?.[1] ?? h3?.[1] ?? '';
      out.push(`<p class="mt-1 font-semibold">${content}</p>`);
      continue;
    }

    // Unordered list
    const ul = line.match(/^[-*] (.+)/);
    if (ul) {
      if (!inList || listTag !== 'ul') {
        if (inList) out.push(`</${listTag}>`);
        out.push('<ul class="my-1 ms-3 list-disc space-y-0.5">');
        listTag = 'ul';
        inList = true;
      }
      out.push(`<li>${ul[1]}</li>`);
      continue;
    }

    // Ordered list
    const ol = line.match(/^\d+\. (.+)/);
    if (ol) {
      if (!inList || listTag !== 'ol') {
        if (inList) out.push(`</${listTag}>`);
        out.push('<ol class="my-1 ms-3 list-decimal space-y-0.5">');
        listTag = 'ol';
        inList = true;
      }
      out.push(`<li>${ol[1]}</li>`);
      continue;
    }

    if (inList) {
      out.push(`</${listTag}>`);
      inList = false;
    }

    if (!line.trim()) {
      out.push('<br>');
      continue;
    }

    // Inline code, bold, italic
    let processed = line
      .replace(
        /`([^`]+)`/g,
        '<code class="rounded bg-[var(--sc-surface-overlay)] px-1 font-mono text-xs">$1</code>',
      )
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Already-wrapped tags (pre blocks) pass through unchanged
    if (
      !processed.startsWith('<pre') &&
      !processed.startsWith('<ul') &&
      !processed.startsWith('<ol')
    ) {
      processed = `<p class="mb-0.5">${processed}</p>`;
    }
    out.push(processed);
  }

  if (inList) out.push(`</${listTag}>`);
  return out.join('');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface CopilotMessageListProps {
  messages: CopilotMessage[];
  emptyTitle: string;
  emptyBody: string;
  youLabel: string;
  assistantLabel: string;
  /** i18n key resolved to a string for the apply button label */
  applyLabel: string;
  /** Whether an active manuscript chapter is available */
  hasActiveSection: boolean;
  /** Called when the user clicks "Apply to chapter" on the last assistant message */
  onApply?: (codeBlock: string) => void;
  /** Current apply state — drives button feedback */
  applyStatus: 'idle' | 'applying' | 'success' | 'error';
  applyingLabel: string;
}

// QNBS-v3: useEffect+innerHTML avoids dangerouslySetInnerHTML (eliminates biome suppression debt);
// DOMPurify sanitisation identical — the rule only flags the JSX prop, not direct DOM writes.
const ALLOWED_MD_TAGS = ['p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'h3', 'span'];
const MarkdownContent: FC<{ content: string }> = ({ content }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = DOMPurify.sanitize(renderMarkdown(content), {
        ALLOWED_TAGS: ALLOWED_MD_TAGS,
        ALLOWED_ATTR: ['class'],
      });
    }
  }, [content]);
  return <div ref={ref} className="prose-copilot break-words" />;
};

function hasCodeBlock(text: string): boolean {
  return /```[\s\S]*?```/.test(text);
}

function extractCodeBlock(text: string): string | null {
  const m = text.match(/```(?:[^\n]*)?\n([\s\S]*?)```/);
  return m?.[1]?.trim() ?? null;
}

/** Scrollable conversation transcript. Auto-scrolls to the newest message. */
export const CopilotMessageList: FC<CopilotMessageListProps> = ({
  messages,
  emptyTitle,
  emptyBody,
  youLabel,
  assistantLabel,
  applyLabel,
  hasActiveSection,
  onApply,
  applyStatus,
  applyingLabel,
}) => {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (messages.length >= 0) {
      endRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-base font-semibold text-[var(--sc-text-primary)]">{emptyTitle}</p>
        <p className="text-sm text-[var(--sc-text-muted)]">{emptyBody}</p>
      </div>
    );
  }

  // Find the index of the last non-pending assistant message
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'assistant' && !m.pending) {
      lastAssistantIdx = i;
      break;
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" aria-live="polite">
      {messages.map((msg, idx) => {
        const isUser = msg.role === 'user';
        const isLastAssistant = idx === lastAssistantIdx;
        const showApply =
          isLastAssistant && hasActiveSection && hasCodeBlock(msg.content) && onApply;

        return (
          <div key={msg.id} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
            <span className="mb-1 text-xs font-medium text-[var(--sc-text-muted)]">
              {isUser ? youLabel : assistantLabel}
            </span>
            <div
              className={`max-w-[85%] rounded-sc-lg px-3 py-2 text-sm ${
                isUser
                  ? 'bg-[var(--sc-accent)] text-white'
                  : 'bg-[var(--sc-surface-raised)] text-[var(--sc-text-primary)]'
              }`}
            >
              {msg.pending && !msg.content ? (
                <Spinner className="h-4 w-4" label="" />
              ) : isUser ? (
                <span className="whitespace-pre-wrap break-words">{msg.content}</span>
              ) : (
                <MarkdownContent content={msg.content} />
              )}
            </div>
            {showApply && (
              <button
                type="button"
                disabled={applyStatus === 'applying'}
                onClick={() => {
                  const block = extractCodeBlock(msg.content);
                  if (block) onApply(block);
                }}
                className="mt-1 rounded-sc-md border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] px-2.5 py-1 text-xs text-[var(--sc-text-secondary)] hover:bg-[var(--sc-surface-raised)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)]"
              >
                {applyStatus === 'applying' ? applyingLabel : applyLabel}
              </button>
            )}
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
};
