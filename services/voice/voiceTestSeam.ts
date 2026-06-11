/**
 * voiceTestSeam — E2E injection point for the voice pipeline.
 * QNBS-v3: P1-2 — Deterministic Whisper STT E2E needs the full orchestration (download modal,
 *          VAD→STT bridge, intent→command dispatch) WITHOUT downloading 42 MB or running real
 *          Whisper inference in headless CI. This seam lets Playwright inject mock engines and a
 *          simulated download via `window.__voiceTestHarness` (set by addInitScript). It is dead
 *          code in production: the global is never set at runtime, so `getVoiceTestHarness()`
 *          returns undefined and every real code path runs unchanged.
 */

import type { SttEngine, VadEngine } from './voiceTypes';

/** Drives the simulated model download in {@link VoiceCommandService.downloadVoiceModels}. */
export interface VoiceTestDownloadHook {
  /** 'success' marks the model ready; 'error' throws after emitting progress. */
  mode: 'success' | 'error';
  /** Number of progress ticks before completion (default 5). */
  steps?: number;
  /** Delay between ticks in ms — large enough that a cancel test can interrupt mid-download. */
  stepDelayMs?: number;
  /** Error message surfaced when mode === 'error'. */
  errorMessage?: string;
}

export interface VoiceTestHarness {
  /** Injected STT engine — returned verbatim by `createSttEngine`. */
  stt?: SttEngine;
  /** Injected VAD engine — returned verbatim by `createVadEngine`. */
  vad?: VadEngine;
  /** When present, `downloadVoiceModels` runs a deterministic simulated download. */
  download?: VoiceTestDownloadHook;
}

/**
 * Returns the active test harness, or undefined in production.
 * QNBS-v3: Reads a live window property each call so Playwright can mutate the hook (e.g. flip
 *          a download `mode` from 'error' to 'success' between a failure and a retry).
 */
export function getVoiceTestHarness(): VoiceTestHarness | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { __voiceTestHarness?: VoiceTestHarness }).__voiceTestHarness;
}
