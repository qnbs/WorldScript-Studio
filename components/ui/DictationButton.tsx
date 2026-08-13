import type { FC, RefObject } from 'react';
import { useEffect } from 'react';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { useTranslation } from '../../hooks/useTranslation';
import { Icon } from './Icon';

interface DictationButtonProps {
  targetRef: RefObject<HTMLTextAreaElement | null>;
}

// QNBS-v3 (#341/#344): extracted from Textarea.tsx's default-variant mic button so overlay consumers (ContextPanel, ManuscriptEditor) can render it as a sibling instead of losing dictation entirely.
export const DictationButton: FC<DictationButtonProps> = ({ targetRef }) => {
  const { isListening, transcript, toggleListening, setTranscript } = useSpeechRecognition();
  const { t } = useTranslation();

  useEffect(() => {
    if (transcript && targetRef.current) {
      const input = targetRef.current;
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
  }, [transcript, setTranscript, targetRef]);

  return (
    <button
      type="button"
      onClick={toggleListening}
      className={`absolute right-3 bottom-3 p-2 rounded-full transition-all duration-sc-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--sc-ring-focus)] z-20 ${
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
  );
};
DictationButton.displayName = 'DictationButton';
