import { useCallback, useEffect, useRef, useState } from 'react';
import { appStoreRef } from '../app/storeRef';
import { statusActions } from '../features/status/statusSlice';
import { logger } from '../services/logger';
import {
  ensureWebSpeechConsent,
  isWebSpeechBlocked,
  onWebSpeechBlocked,
  WEB_SPEECH_LOCAL_ONLY_MESSAGE,
} from '../services/voice/webSpeechConsent';
import type { ISpeechRecognition } from '../types';

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
  /** Bumped by every start request and every stop; a start resumes after the consent dialog only while it is the latest. */
  const startRequestRef = useRef(0);

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
              const result = event.results[i];
              if (result?.isFinal && result[0]?.transcript) {
                finalTranscript += result[0].transcript;
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
                  'Microphone access denied. Please grant permission in browser settings.',
                );
                break;
              case 'no-speech':
                setMicError('No speech signal detected. Please try again.');
                break;
              case 'audio-capture':
                setMicError('No microphone found. Please connect a microphone.');
                break;
              case 'network':
                setMicError('Network error during speech recognition.');
                break;
              case 'language-not-supported':
                if (recognitionRef.current && recognitionRef.current.lang !== 'en-US') {
                  recognitionRef.current.lang = 'en-US';
                  setMicError(null);
                } else {
                  setMicError('Language not supported by the browser.');
                }
                break;
              default:
                setMicError(`Speech recognition error: ${event.error}`);
            }
          };
        }
      }
    }

    return () => {
      clearMicTimeout();
      recognitionRef.current?.stop();
      // A start still waiting for consent belongs to this instance; clearing it keeps that start from capturing later.
      recognitionRef.current = null;
    };
  }, [clearMicTimeout]);

  const startListening = useCallback(async () => {
    const recognition = recognitionRef.current;
    if (!recognition || isListeningRef.current) return;
    // QNBS-v3 (#1261): a local-only AI mode blocks Web Speech outright, whatever consent is stored; tell the user why.
    if (isWebSpeechBlocked()) {
      setMicError(WEB_SPEECH_LOCAL_ONLY_MESSAGE);
      // The editor microphones do not render micError; the toast tells the user why nothing starts.
      appStoreRef.current?.dispatch(
        statusActions.addNotification({ type: 'info', title: WEB_SPEECH_LOCAL_ONLY_MESSAGE }),
      );
      return;
    }
    const request = ++startRequestRef.current;
    // QNBS-v3 (#1261): Web Speech sends the audio to the browser vendor; no start without the stored consent.
    if (!(await ensureWebSpeechConsent())) return;
    // The control may have unmounted, remounted with a new instance, or been stopped while the consent dialog was open.
    const current = recognitionRef.current === recognition && startRequestRef.current === request;
    if (current && !isListeningRef.current) {
      setTranscript('');
      setMicError(null);
      try {
        recognition.start();
        setIsListening(true);

        timeoutRef.current = setTimeout(() => {
          if (isListeningRef.current) {
            recognitionRef.current?.stop();
            setIsListening(false);
            setMicError('No speech signal detected. Please speak clearly into the microphone.');
          }
        }, MIC_TIMEOUT_MS);
      } catch (e) {
        logger.error('Failed to start recognition', e);
        setMicError('Speech recognition could not be started.');
      }
    }
  }, []);

  const stopListening = useCallback(() => {
    clearMicTimeout();
    startRequestRef.current += 1; // a start still waiting for the consent dialog never begins capture
    if (recognitionRef.current && isListeningRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  }, [clearMicTimeout]);

  // QNBS-v3 (#1261): a switch to a local-only AI mode ends a running Web Speech recognition at once.
  useEffect(() => onWebSpeechBlocked(stopListening), [stopListening]);

  const toggleListening = useCallback(() => {
    if (isListeningRef.current) {
      stopListening();
    } else {
      void startListening();
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
