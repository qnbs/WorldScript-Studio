import React, { useEffect, useRef } from 'react';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { useTranslation } from '../../hooks/useTranslation';
import { Icon } from './Icon';

const inputBaseClasses = `
  flex h-11 w-full appearance-none rounded-sc-lg
  border border-[var(--sc-border-subtle)]
  bg-[var(--glass-bg)] backdrop-blur-md
  px-4 py-2 text-sm
  text-[var(--sc-text-primary)] placeholder:text-[var(--sc-text-muted)]
  shadow-sm transition-all duration-sc-fast
  focus-visible:outline-none focus-visible:border-[var(--border-interactive)] focus-visible:ring-4 focus-visible:ring-[var(--sc-ring-focus)] focus-visible:bg-[var(--sc-surface-raised)]/50
  hover:border-[var(--sc-border-strong)] hover:bg-[var(--glass-bg-hover)]
  disabled:opacity-50 disabled:cursor-not-allowed
`;

/** QNBS-v3: InputBase — plain text input without any built-in dictation chrome.
 *  Use this inside composite forms where the dictation button is not desired. */
export const InputBase = React.memo(
  React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    ({ className, ...props }, ref) => (
      <input className={`${inputBaseClasses} ${className ?? ''}`} ref={ref} {...props} />
    ),
  ),
);
InputBase.displayName = 'InputBase';

/** QNBS-v3: DictationInput — InputBase plus a speech-to-text toggle button.
 *  This is the historical default `Input` export; new forms can opt into InputBase instead. */
export const DictationInput = React.memo(
  React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    ({ className, ...props }, ref) => {
      const innerRef = useRef<HTMLInputElement>(null);
      const inputRef = (ref as React.RefObject<HTMLInputElement>) || innerRef;

      const { isListening, transcript, toggleListening, setTranscript } = useSpeechRecognition();
      const { t } = useTranslation();

      useEffect(() => {
        if (transcript && inputRef.current) {
          const input = inputRef.current;
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value',
          )?.set;

          if (nativeInputValueSetter) {
            const currentValue = input.value;
            const newValue = currentValue ? `${currentValue} ${transcript}` : transcript;
            nativeInputValueSetter.call(input, newValue);
            const event = new Event('input', { bubbles: true });
            input.dispatchEvent(event);
          }
          setTranscript('');
        }
      }, [transcript, setTranscript, inputRef]);

      return (
        <div className="relative w-full group">
          <input
            className={`${inputBaseClasses} pr-10 ${className ?? ''}`}
            ref={inputRef}
            {...props}
          />
          <button
            type="button"
            onClick={toggleListening}
            className={`absolute end-3 top-1/2 -translate-y-1/2 p-1.5 rounded-sc-md transition-all duration-sc-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] z-10 ${
              isListening
                ? 'text-[var(--sc-danger-fg)] bg-[var(--sc-danger-bg)] animate-pulse ring-1 ring-[var(--sc-danger-fg)]/50'
                : 'text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] hover:bg-[var(--glass-bg-hover)]'
            }`}
            title={t('common.dictation.title')}
            aria-label={isListening ? t('common.dictation.stop') : t('common.dictation.start')}
          >
            {isListening ? (
              <Icon name="microphone-solid" size="sm" />
            ) : (
              <Icon name="microphone" size="sm" />
            )}
          </button>
        </div>
      );
    },
  ),
);
DictationInput.displayName = 'DictationInput';

/** QNBS-v3: Historical default export — includes the dictation button for backward compatibility. */
export const Input = DictationInput;
