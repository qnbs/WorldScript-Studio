import React, { useEffect, useRef } from 'react';
import { useAppSelector } from '../../app/hooks';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { useTranslation } from '../../hooks/useTranslation';
import { resolveEditorFontFamily } from '../../services/editorTypography';
import { Icon } from './Icon';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /**
   * 'overlay': a real, focusable, input-only textarea meant to sit invisibly over a separate,
   * visible text-mirror layer (e.g. ContextPanel.tsx, ManuscriptEditor.tsx) — renders with no
   * glass background/blur/shadow/hover background/reserved bottom padding, and skips the
   * dictation mic button (its reserved padding would otherwise collide with the mirror text).
   * QNBS-v3 (#341): the unconditional `backdrop-blur-md` on the 'default' variant was sitting
   * directly over such mirror layers, making the visible text underneath unreadable.
   */
  variant?: 'default' | 'overlay';
}

const DEFAULT_CLASSES = `
    flex min-h-[120px] w-full rounded-sc-lg
    border border-[var(--sc-border-subtle)]
    bg-[var(--glass-bg)] backdrop-blur-md
    px-4 py-3 pb-12 text-sm
    text-[var(--sc-text-primary)] placeholder:text-[var(--sc-text-muted)]
    shadow-sm transition-all duration-sc-fast
    focus-visible:outline-none focus-visible:border-[var(--border-interactive)] focus-visible:ring-4 focus-visible:ring-[var(--sc-ring-focus)] focus-visible:bg-[var(--sc-surface-raised)]/50
    hover:border-[var(--sc-border-strong)] hover:bg-[var(--glass-bg-hover)]
    disabled:opacity-50 disabled:cursor-not-allowed
    scrollbar-thin scrollbar-thumb-rounded-md
`;

// QNBS-v3 (#341): no glass/blur/shadow/hover-bg/reserved padding — the caller's own className
// fully controls appearance (typically text-transparent, sitting over a visible mirror layer).
// Keeps border/rounded/focus-visible ring so keyboard focus stays visible per WCAG.
const OVERLAY_CLASSES = `
    flex min-h-[120px] w-full rounded-sc-lg
    border border-[var(--sc-border-subtle)]
    text-sm placeholder:text-[var(--sc-text-muted)]
    transition-all duration-sc-fast
    focus-visible:outline-none focus-visible:border-[var(--border-interactive)] focus-visible:ring-4 focus-visible:ring-[var(--sc-ring-focus)]
    disabled:opacity-50 disabled:cursor-not-allowed
    scrollbar-thin scrollbar-thumb-rounded-md
`;

export const Textarea = React.memo(
  React.forwardRef<HTMLTextAreaElement, TextareaProps>(
    ({ className, style, variant = 'default', ...props }, ref) => {
      const settings = useAppSelector((state) => state.settings);
      const innerRef = useRef<HTMLTextAreaElement>(null);
      const inputRef = (ref as React.RefObject<HTMLTextAreaElement>) || innerRef;
      const { isListening, transcript, toggleListening, setTranscript } = useSpeechRecognition();
      const { t } = useTranslation();

      const editorStyles: React.CSSProperties = {
        fontFamily: resolveEditorFontFamily(settings.editorFont),
        fontSize: `${settings.fontSize}px`,
        lineHeight: settings.lineSpacing,
      };

      useEffect(() => {
        if (transcript && inputRef.current) {
          const input = inputRef.current;
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            'value',
          )?.set;

          if (nativeInputValueSetter) {
            const currentValue = input.value;
            const separator = currentValue.length > 0 && !currentValue.endsWith('\n') ? ' ' : '';
            const newValue = currentValue ? `${currentValue}${separator}${transcript}` : transcript;
            nativeInputValueSetter.call(input, newValue);
            const event = new Event('input', { bubbles: true });
            input.dispatchEvent(event);
          }
          setTranscript('');
        }
      }, [transcript, setTranscript, inputRef]);

      return (
        <div className="relative w-full h-full group">
          <textarea
            className={`${variant === 'overlay' ? OVERLAY_CLASSES : DEFAULT_CLASSES} ${className}`}
            ref={inputRef}
            style={{ ...editorStyles, ...style }}
            {...props}
          />
          {variant === 'default' && (
            <button
              type="button"
              onClick={toggleListening}
              className={`absolute right-3 bottom-3 p-2 rounded-full transition-all duration-sc-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--sc-ring-focus)] z-10 ${
                isListening
                  ? 'text-[var(--sc-danger-fg)] bg-[var(--sc-danger-bg)] animate-pulse shadow-[0_0_0_4px_var(--sc-danger-fg)] scale-110'
                  : 'text-[var(--sc-text-muted)] bg-[var(--sc-surface-raised)]/80 hover:text-[var(--sc-text-primary)] hover:bg-[var(--glass-bg-hover)] shadow-sm border border-[var(--sc-border-subtle)]'
              }`}
              title={t('common.dictation.title')}
              aria-label={isListening ? t('common.dictation.stop') : t('common.dictation.start')}
            >
              {isListening ? (
                <Icon name="microphone-solid" size="md" aria-hidden />
              ) : (
                <Icon name="microphone" size="md" aria-hidden />
              )}
            </button>
          )}
        </div>
      );
    },
  ),
);
Textarea.displayName = 'Textarea';
