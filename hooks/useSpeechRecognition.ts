import { useState, useEffect, useCallback, useRef } from 'react';
import type { ISpeechRecognition } from '../types';
import { logger } from '../services/logger';

const LANG_PREFERENCES = ['de-DE', 'de-AT', 'en-US', 'en-GB'];
const MIC_TIMEOUT_MS = 8000; // 8 Sekunden ohne Ergebnis → Timeout

const stripControlChars = (value: string): string => {
  let result = '';
  for (const char of String(value)) {
    const code = char.charCodeAt(0);
    result += code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f) ? ' ' : char;
  }
  return result;
};

const sanitizeSpeechTranscript = (text: string): string =>
  stripControlChars(text).replace(/\s+/g, ' ').trim().slice(0, 1024);

export const useSpeechRecognition = () => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [micError, setMicError] = useState<string | null>(null);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isListeningRef = useRef(false);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  const clearMicTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognitionRef.current = new SpeechRecognition();
        if (recognitionRef.current) {
          recognitionRef.current.continuous = true;
          recognitionRef.current.interimResults = true;

          const browserLang = navigator.language || 'de-DE';
          const preferred =
            LANG_PREFERENCES.find((l) => l.startsWith(browserLang.slice(0, 2))) || 'de-DE';
          recognitionRef.current.lang = preferred;

          recognitionRef.current.onresult = (event) => {
            clearMicTimeout();
            setMicError(null);
            let finalTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
              }
            }
            const sanitizedTranscript = sanitizeSpeechTranscript(finalTranscript);
            if (sanitizedTranscript) {
              setTranscript(sanitizedTranscript);
            }
          };

          recognitionRef.current.onend = () => {
            clearMicTimeout();
            if (isListeningRef.current) {
              setIsListening(false);
            }
          };

          recognitionRef.current.onerror = (event) => {
            clearMicTimeout();
            logger.error('Speech recognition error', event.error);
            setIsListening(false);

            switch (event.error) {
              case 'not-allowed':
              case 'permission-denied':
                setMicError(
                  'Mikrofon-Zugriff verweigert. Bitte Berechtigung in den Browser-Einstellungen erteilen.'
                );
                break;
              case 'no-speech':
                setMicError('Kein Sprachsignal erkannt. Bitte erneut versuchen.');
                break;
              case 'audio-capture':
                setMicError('Kein Mikrofon gefunden. Bitte Mikrofon anschließen.');
                break;
              case 'network':
                setMicError('Netzwerkfehler bei der Spracherkennung.');
                break;
              case 'language-not-supported':
                if (recognitionRef.current && recognitionRef.current.lang !== 'en-US') {
                  recognitionRef.current.lang = 'en-US';
                  setMicError(null);
                } else {
                  setMicError('Sprache wird vom Browser nicht unterstützt.');
                }
                break;
              default:
                setMicError(`Spracherkennungsfehler: ${event.error}`);
            }
          };
        }
      }
    }

    return () => {
      clearMicTimeout();
      recognitionRef.current?.stop();
    };
  }, [clearMicTimeout]);

  const startListening = useCallback(() => {
    if (recognitionRef.current && !isListeningRef.current) {
      setTranscript('');
      setMicError(null);
      try {
        recognitionRef.current.start();
        setIsListening(true);

        timeoutRef.current = setTimeout(() => {
          if (isListeningRef.current) {
            recognitionRef.current?.stop();
            setIsListening(false);
            setMicError('Kein Sprachsignal erkannt. Bitte sprechen Sie deutlich ins Mikrofon.');
          }
        }, MIC_TIMEOUT_MS);
      } catch (e) {
        logger.error('Failed to start recognition', e);
        setMicError('Spracherkennung konnte nicht gestartet werden.');
      }
    }
  }, []);

  const stopListening = useCallback(() => {
    clearMicTimeout();
    if (recognitionRef.current && isListeningRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  }, [clearMicTimeout]);

  const toggleListening = useCallback(() => {
    if (isListeningRef.current) {
      stopListening();
    } else {
      startListening();
    }
  }, [startListening, stopListening]);

  return {
    isListening,
    transcript,
    micError,
    startListening,
    stopListening,
    toggleListening,
    setTranscript,
  };
};
