import { useEffect, useState } from 'react';
import { logger } from '../services/logger';

// QNBS-v3: PR5 — a self-contained microphone level meter for voice feedback. While any consumer is
// `active`, ONE shared getUserMedia stream + AnalyserNode is opened and the smoothed 0–1 RMS level is
// broadcast to every consumer. Sharing (ref-counted) is essential: VoiceIndicator and
// VoiceControlPanel both meter and are mounted together, so a per-hook stream would open the mic
// twice. Taps the mic directly (works for any STT engine). Feature-detected — no-ops to 0 where Web
// Audio / getUserMedia are unavailable (incl. jsdom). Never records or logs audio.

interface WindowWithAudio extends Window {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as WindowWithAudio;
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

// ── Shared, ref-counted mic-meter source ─────────────────────────────────────
const subscribers = new Set<(level: number) => void>();
let refCount = 0;
let ctx: AudioContext | null = null;
let stream: MediaStream | null = null;
let rafId: number | null = null;
let currentLevel = 0;
// QNBS-v3 (CodeAnt): monotonic session token. Each start() and teardown() bumps it; a pending
// getUserMedia whose token is stale (superseded by a rapid deactivate→reactivate) releases its
// stream and bails, so overlapping startups can't leak a second pipeline.
let session = 0;

function broadcast(level: number): void {
  currentLevel = level;
  for (const cb of subscribers) cb(level);
}

function teardown(): void {
  session += 1;
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = null;
  if (stream) for (const track of stream.getTracks()) track.stop();
  stream = null;
  void ctx?.close();
  ctx = null;
  broadcast(0);
}

function start(): void {
  const AudioCtor = getAudioContextCtor();
  const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  if (!AudioCtor || !media?.getUserMedia) return;

  session += 1;
  const mySession = session;
  media
    .getUserMedia({ audio: true })
    .then((s) => {
      // Superseded by a newer start/teardown, or everyone left while acquiring — release the mic.
      if (mySession !== session || refCount === 0) {
        for (const track of s.getTracks()) track.stop();
        return;
      }
      try {
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
          const next = currentLevel + (Math.min(1, rms * 2.2) - currentLevel) * 0.4;
          broadcast(next);
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      } catch (err) {
        // QNBS-v3 (CodeAnt): if setup throws after the stream was acquired, release it + ctx here —
        // the outer catch only sees rejections, not synchronous setup failures.
        logger.warn('useMicLevel: audio graph setup failed', { err: String(err) });
        teardown();
      }
    })
    .catch((err) => {
      // Permission denied / no device — leave the meter at 0, don't surface an error to the user.
      logger.warn('useMicLevel: microphone unavailable for metering', { err: String(err) });
    });
}

/** Returns a smoothed 0–1 microphone level while `active`; 0 when inactive or unsupported. */
export function useMicLevel(active: boolean): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!active) return;
    const cb = (l: number) => setLevel(l);
    subscribers.add(cb);
    refCount += 1;
    if (refCount === 1) start();

    return () => {
      subscribers.delete(cb);
      refCount -= 1;
      if (refCount === 0) teardown();
      setLevel(0);
    };
  }, [active]);

  return active ? level : 0;
}
