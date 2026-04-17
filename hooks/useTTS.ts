import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '../services/logger';

export const useTTS = () => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const isSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    return () => {
      if (isSupported) window.speechSynthesis.cancel();
    };
  }, [isSupported]);

  // Workaround für Chrome: speechSynthesis stoppt nach ~15s ohne Interaktion
  useEffect(() => {
    if (!isSupported) return;
    const keepAlive = setInterval(() => {
      if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 10_000);
    return () => clearInterval(keepAlive);
  }, [isSupported]);

  const speak = useCallback(
    (text: string, lang = 'de-DE') => {
      if (!isSupported || !text.trim()) return;
      window.speechSynthesis.cancel();

      const utt = new SpeechSynthesisUtterance(text);
      utt.lang = lang;
      utt.rate = 0.95;
      utt.pitch = 1.0;

      utt.onstart = () => {
        setIsSpeaking(true);
        setIsPaused(false);
      };
      utt.onend = () => {
        setIsSpeaking(false);
        setIsPaused(false);
      };
      utt.onerror = (e) => {
        if (e.error !== 'interrupted') logger.warn('[TTS] error:', e.error);
        setIsSpeaking(false);
        setIsPaused(false);
      };
      utt.onpause = () => setIsPaused(true);
      utt.onresume = () => setIsPaused(false);

      utteranceRef.current = utt;
      window.speechSynthesis.speak(utt);
    },
    [isSupported],
  );

  const pause = useCallback(() => {
    if (isSupported && window.speechSynthesis.speaking) {
      window.speechSynthesis.pause();
      setIsPaused(true);
    }
  }, [isSupported]);

  const resume = useCallback(() => {
    if (isSupported && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      setIsPaused(false);
    }
  }, [isSupported]);

  const stop = useCallback(() => {
    if (isSupported) window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
  }, [isSupported]);

  return { speak, pause, resume, stop, isSpeaking, isPaused, isSupported };
};
