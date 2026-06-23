import { useEffect, useRef, useState } from 'react';
import { logger } from '../services/logger';

// QNBS-v3: PR5 — a self-contained microphone level meter for voice feedback. While `active`, it opens
// its own getUserMedia stream + AnalyserNode and reports a smoothed 0–1 RMS level via rAF. This works
// regardless of the STT engine (Web Speech, Whisper, …) because it taps the mic directly rather than
// relying on the VAD path, which only exists in the WASM/Whisper mode. Feature-detected: returns 0 and
// does nothing where Web Audio / getUserMedia are unavailable (incl. jsdom). Never records or logs audio.

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Returns a smoothed 0–1 microphone input level while `active`; 0 when inactive or unsupported. */
export function useMicLevel(active: boolean): number {
  const [level, setLevel] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    const AudioCtor = getAudioContextCtor();
    const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!AudioCtor || !media?.getUserMedia) return;

    let cancelled = false;
    let ctx: AudioContext | null = null;
    let stream: MediaStream | null = null;

    media
      .getUserMedia({ audio: true })
      .then((s) => {
        if (cancelled) {
          for (const track of s.getTracks()) track.stop();
          return;
        }
        stream = s;
        ctx = new AudioCtor();
        const source = ctx.createMediaStreamSource(s);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const data = new Uint8Array(analyser.fftSize);

        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (const v of data) {
            const centered = (v - 128) / 128;
            sum += centered * centered;
          }
          const rms = Math.sqrt(sum / data.length);
          // Smooth toward the new value and clamp; rms ~0.3 is already a loud signal, so scale up.
          setLevel((prev) => {
            const next = Math.min(1, rms * 2.2);
            return prev + (next - prev) * 0.4;
          });
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      })
      .catch((err) => {
        // Permission denied / no device — leave the meter at 0, don't surface an error to the user.
        logger.warn('useMicLevel: microphone unavailable for metering', { err: String(err) });
      });

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (stream) for (const track of stream.getTracks()) track.stop();
      void ctx?.close();
      setLevel(0);
    };
  }, [active]);

  return active ? level : 0;
}
