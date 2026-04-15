import { useState, useEffect, useCallback, useRef } from 'react';
import type { ISpeechRecognition } from '../types';

// Präferierte Sprachen in Fallback-Reihenfolge
const LANG_PREFERENCES = ['de-DE', 'de-AT', 'en-US', 'en-GB'];
const MIC_TIMEOUT_MS = 8000; // 8 Sekunden ohne Ergebnis → Timeout

export const useSpeechRecognition = () => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [micError, setMicError] = useState<string | null>(null);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isListeningRef = useRef(false);

  // isListening-Ref synchron halten (für Callbacks ohne Stale-Closure)
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

          // Sprache: Browser-Sprache bevorzugt, dann Fallback-Kette
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
            if (finalTranscript) {
              setTranscript(finalTranscript);
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
            console.error('Speech recognition error', event.error);
            setIsListening(false);

            // Benutzerfreundliche Fehlermeldungen
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
                // Fallback auf en-US
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
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [clearMicTimeout]);

  const startListening = useCallback(() => {
    if (recognitionRef.current && !isListeningRef.current) {
      setTranscript('');
      setMicError(null);
      try {
        recognitionRef.current.start();
        setIsListening(true);

        // Mikrofon-Timeout: Wenn nach X Sekunden kein Ergebnis → automatisch stoppen
        timeoutRef.current = setTimeout(() => {
          if (isListeningRef.current) {
            recognitionRef.current?.stop();
            setIsListening(false);
            setMicError('Kein Sprachsignal erkannt. Bitte sprechen Sie deutlich ins Mikrofon.');
          }
        }, MIC_TIMEOUT_MS);
      } catch (e) {
        console.error('Failed to start recognition', e);
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
