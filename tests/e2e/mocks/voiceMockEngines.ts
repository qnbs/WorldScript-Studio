/**
 * voiceMockEngines — Playwright installers for the voice E2E test seam (`window.__voiceTestHarness`).
 * QNBS-v3: P1-2 — Lets the deterministic Whisper STT suite exercise the real orchestration
 *          (intent parsing, command dispatch, download modal) without downloading 42 MB or running
 *          real Whisper inference. Each installer uses `addInitScript` so the harness exists before
 *          app JS runs (createSttEngine reads it during VoiceCommandService.initialize).
 */

import type { Page } from '@playwright/test';

export interface VoiceMockSttOptions {
  /** Transcripts emitted on successive `startListening()` calls (last is reused when exhausted). */
  transcripts: string[];
  /** ms before the mock STT delivers each transcript (default 30). */
  emitDelayMs?: number;
}

/**
 * Inject a deterministic mock STT engine. Uses id 'webSpeech' so VoiceCommandService takes the
 * direct STT path (not the VAD coordinator) — robust in headless CI with no audio dependency.
 */
export async function installVoiceSttMock(page: Page, opts: VoiceMockSttOptions): Promise<void> {
  await page.addInitScript((arg: VoiceMockSttOptions) => {
    const w = window as unknown as { __voiceTestHarness?: Record<string, unknown> };
    w.__voiceTestHarness = w.__voiceTestHarness ?? {};
    const transcripts = arg.transcripts ?? [];
    let idx = 0;
    // QNBS-v3: CodeAnt — honor the STT contract: a pending emission MUST be cancellable by
    //          stop()/dispose() so a transcript can't fire (and dispatch a command) after listening
    //          has stopped. Each start() re-arms; stop()/dispose() clear the pending timer.
    let pending: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const clearPending = (): void => {
      stopped = true;
      if (pending !== null) {
        clearTimeout(pending);
        pending = null;
      }
    };
    w.__voiceTestHarness['stt'] = {
      id: 'webSpeech',
      name: 'Mock STT (E2E)',
      isLocal: true,
      supportsStreaming: false,
      isAvailable: () => Promise.resolve(true),
      initialize: () => Promise.resolve(),
      start: (
        onResult: (r: { transcript: string; isFinal: boolean; confidence: number }) => void,
      ) => {
        stopped = false;
        const transcript = transcripts[idx] ?? transcripts[transcripts.length - 1] ?? '';
        idx += 1;
        pending = setTimeout(() => {
          pending = null;
          if (!stopped) onResult({ transcript, isFinal: true, confidence: 0.95 });
        }, arg.emitDelayMs ?? 30);
        return Promise.resolve();
      },
      stop: () => {
        clearPending();
        return Promise.resolve();
      },
      dispose: () => {
        clearPending();
        return Promise.resolve();
      },
    };
  }, opts);
}

export interface VoiceMockDownloadOptions {
  mode: 'success' | 'error';
  steps?: number;
  stepDelayMs?: number;
  errorMessage?: string;
}

/** Inject a simulated model-download hook (drives VoiceCommandService.downloadVoiceModels). */
export async function installVoiceDownloadMock(
  page: Page,
  opts: VoiceMockDownloadOptions,
): Promise<void> {
  await page.addInitScript((arg: VoiceMockDownloadOptions) => {
    const w = window as unknown as { __voiceTestHarness?: Record<string, unknown> };
    w.__voiceTestHarness = w.__voiceTestHarness ?? {};
    w.__voiceTestHarness['download'] = arg;
  }, opts);
}

/** Flip the simulated-download mode at runtime (e.g. 'error' → 'success' before a retry click). */
export async function setVoiceDownloadMode(page: Page, mode: 'success' | 'error'): Promise<void> {
  await page.evaluate((m: 'success' | 'error') => {
    const w = window as unknown as { __voiceTestHarness?: { download?: { mode: string } } };
    if (w.__voiceTestHarness?.download) w.__voiceTestHarness.download.mode = m;
  }, mode);
}
