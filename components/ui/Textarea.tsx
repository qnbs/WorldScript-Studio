import React, { useRef } from 'react';
import { useAppSelector } from '../../app/hooks';
import { useTranslation } from '../../hooks/useTranslation';
import { resolveEditorFontFamily } from '../../services/editorTypography';
import { DictationButton } from './DictationButton';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /**
   * 'overlay': a real, focusable, input-only textarea meant to sit invisibly over a separate,
   * visible text-mirror layer (e.g. ContextPanel.tsx, ManuscriptEditor.tsx) — renders with no
   * glass background/blur/shadow/hover background/reserved bottom padding, and does not render
   * its own dictation mic button (the consumer renders a `DictationButton` sibling instead, since
   * the reserved padding for an internal one would collide with the mirror text).
   */
  // QNBS-v3 (#341): the unconditional `backdrop-blur-md` on the 'default' variant was sitting directly over such mirror layers, making the visible text underneath unreadable.
  variant?: 'default' | 'overlay';
}

const DEFAULT_CLASSES = `
    flex min-h-[120px] w-full rounded-sc-lg
    border border-[var(--sc-border-subtle)]
    bg-[var(--glass-bg)] backdrop-blur-md
    px-4 py-3 pb-12 text-sm
    text-[var(--sc-text-primary)] placeholder:text-[var(--sc-text-muted)]
    shadow-sm transition-all duration-sc-fast
    focus-visible:outline-none focus-visible:border-[var(--border-interactive)] focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] focus-visible:bg-[var(--sc-surface-raised)]/50
    hover:border-[var(--sc-border-strong)] hover:bg-[var(--glass-bg-hover)]
    disabled:opacity-50 disabled:cursor-not-allowed
    scrollbar-thin scrollbar-thumb-rounded-md
`;

// QNBS-v3 (#341): no glass/blur/shadow/hover-bg/reserved padding — the caller's own className fully controls appearance (typically text-transparent, sitting over a visible mirror layer).
const OVERLAY_CLASSES = `
    flex min-h-[120px] w-full rounded-sc-lg
    border border-[var(--sc-border-subtle)]
    text-sm placeholder:text-[var(--sc-text-muted)]
    transition-all duration-sc-fast
    focus-visible:outline-none focus-visible:border-[var(--border-interactive)] focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]
    disabled:opacity-50 disabled:cursor-not-allowed
    scrollbar-thin scrollbar-thumb-rounded-md
`;

export const Textarea = React.memo(
  React.forwardRef<HTMLTextAreaElement, TextareaProps>(
    ({ className, style, variant = 'default', ...props }, ref) => {
      const settings = useAppSelector((state) => state.settings);
      const innerRef = useRef<HTMLTextAreaElement>(null);
      const inputRef = (ref as React.RefObject<HTMLTextAreaElement>) || innerRef;
      const { dir } = useTranslation();

      const editorStyles: React.CSSProperties = {
        fontFamily: resolveEditorFontFamily(settings.editorFont, dir, settings.customFont?.name),
        fontSize: `${settings.fontSize}px`,
        lineHeight: settings.lineSpacing,
      };

      return (
        <div className="relative w-full h-full group">
          <textarea
            className={`${variant === 'overlay' ? OVERLAY_CLASSES : DEFAULT_CLASSES} ${className}`}
            ref={inputRef}
            dir={dir}
            style={{ ...editorStyles, ...style }}
            {...props}
          />
          {variant === 'default' && <DictationButton targetRef={inputRef} />}
        </div>
      );
    },
  ),
);
Textarea.displayName = 'Textarea';
