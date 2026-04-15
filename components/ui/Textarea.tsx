import React, { useEffect, useRef } from 'react';
import { useAppSelector } from '../../app/hooks';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { useTranslation } from '../../hooks/useTranslation';

export const Textarea = React.memo(
  React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
    ({ className, style, ...props }, ref) => {
      const settings = useAppSelector((state) => state.settings);
      const innerRef = useRef<HTMLTextAreaElement>(null);
      const inputRef = (ref as React.RefObject<HTMLTextAreaElement>) || innerRef;
      const { isListening, transcript, toggleListening, setTranscript } = useSpeechRecognition();
      const { t } = useTranslation();

      const fontMap = {
        serif: 'Merriweather, serif',
        'sans-serif': 'Inter, sans-serif',
        monospace: 'JetBrains Mono, monospace',
        custom: 'JetBrains Mono, monospace',
      };

      const editorStyles: React.CSSProperties = {
        fontFamily: fontMap[settings.editorFont],
        fontSize: `${settings.fontSize}px`,
        lineHeight: settings.lineSpacing,
      };

      useEffect(() => {
        if (transcript && inputRef.current) {
          const input = inputRef.current;
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            'value'
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
            className={`
                flex min-h-[120px] w-full rounded-xl
                border border-[var(--border-primary)] 
                bg-white/5 backdrop-blur-md
                px-4 py-3 pb-12 text-sm 
                text-[var(--foreground-primary)] placeholder:text-[var(--foreground-muted)] 
                shadow-sm transition-all duration-200
                focus:outline-none focus:border-[var(--border-interactive)] focus:ring-4 focus:ring-[var(--ring-focus)] focus:bg-[var(--background-secondary)]/50
                hover:border-[var(--border-highlight)] hover:bg-white/10
                disabled:opacity-50 disabled:cursor-not-allowed
                scrollbar-thin scrollbar-thumb-rounded-md
                ${className}
            `}
            ref={inputRef}
            style={{ ...editorStyles, ...style }}
            {...props}
          />
          <button
            type="button"
            onClick={toggleListening}
            className={`absolute right-3 bottom-3 p-2 rounded-full transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[var(--ring-focus)] z-10 ${
              isListening
                ? 'text-red-500 bg-red-500/10 animate-pulse shadow-[0_0_0_4px_rgba(239,68,68,0.3)] scale-110'
                : 'text-[var(--foreground-muted)] bg-[var(--background-secondary)]/80 hover:text-[var(--foreground-primary)] hover:bg-white/10 shadow-sm border border-[var(--border-primary)]'
            }`}
            title={t('common.dictation.title')}
            aria-label={isListening ? t('common.dictation.stop') : t('common.dictation.start')}
          >
            {isListening ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-5 h-5"
              >
                <path d="M8.25 4.5a3.75 3.75 0 117.5 0v8.25a3.75 3.75 0 11-7.5 0V4.5z" />
                <path d="M6 10.5a.75.75 0 01.75.75v1.5a5.25 5.25 0 1010.5 0v-1.5a.75.75 0 011.5 0v1.5a6.751 6.751 0 01-6 6.709v2.291h3a.75.75 0 010 1.5h-7.5a.75.75 0 010-1.5h3v-2.291a6.751 6.751 0 01-6-6.709v-1.5A.75.75 0 016 10.5z" />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-5 h-5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"
                />
              </svg>
            )}
          </button>
        </div>
      );
    }
  )
);
Textarea.displayName = 'Textarea';
