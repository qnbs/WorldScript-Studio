/**
 * Voice Command Service — central orchestrator for Voice Full Support.
 * QNBS-v3: Replaces MVP placeholder with production-grade multi-engine architecture.
 */

import type { AppDispatch, RootState } from '../../app/store';
import { settingsActions } from '../../features/settings/settingsSlice';
import {
  appendVoiceTranscript,
  setActiveSttEngine,
  setActiveTtsEngine,
  setDictationActive,
  setLastConfidence,
  setMicrophonePermission,
  setSttStatus,
  setTtsStatus,
  setVadStatus,
  setVoiceError,
  setVoiceMode,
  setVoiceOnboardingComplete,
  setVoiceTranscript,
  setWakeWordStatus,
} from '../../features/voice/voiceSlice';
import type { VoiceFeedbackLevel } from '../../types';
// QNBS-v3: B5 — eco-mode forces lightweight WebSpeech backend when battery is low
import { ecoModeService } from '../ai/ecoModeService';
import { logger } from '../logger';
import { FeedbackService } from './feedbackService';
import { HybridIntentEngine } from './intentEngine';
import { createSttEngine } from './sttEngine';
import { createTtsEngine } from './ttsEngine';
import { createVadEngine } from './vadEngine';
import { VoiceActivityCoordinator } from './voiceActivityCoordinator';
import { getVoiceTestHarness, type VoiceTestDownloadHook } from './voiceTestSeam';
import type {
  SttEngine,
  SttResult,
  TtsEngine,
  VadEngine,
  VoiceEvent,
  VoiceEventListener,
  WakeWordEngine,
} from './voiceTypes';
import { createWakeWordEngine } from './wakeWordEngine';

export type GetStateFn = () => RootState;

export interface VoiceServiceConfig {
  preferredSttEngine: 'auto' | 'whisper' | 'webSpeech';
  preferredTtsEngine: 'auto' | 'kokoro' | 'piper' | 'webSpeech';
  feedbackLevel: VoiceFeedbackLevel;
  speechRate: number;
  speechVolume: number;
  allowCloudFallback: boolean;
  listeningTimeoutSeconds: number;
  wakeWordPhrase: string;
  ttsMuted: boolean;
  dictationAutoPunctuation: boolean;
  /** When true, prefers WasmSttEngine (Whisper) + SileroVadEngine over Web Speech API. */
  enableVoiceWasm: boolean;
}

export class VoiceCommandService {
  private sttEngine: SttEngine | null = null;
  private ttsEngine: TtsEngine | null = null;
  private vadEngine: VadEngine | null = null;
  private wakeWordEngine: WakeWordEngine | null = null;
  private feedbackService: FeedbackService;
  private intentEngine: HybridIntentEngine;

  private dispatch: AppDispatch | null = null;
  private getState: GetStateFn | null = null;
  private config: VoiceServiceConfig;

  private coordinator: VoiceActivityCoordinator | null = null;
  private isInitialized = false;
  // QNBS-v3: C-P1 — single-flight guard against re-entrant startListening (rapid PTT / wake-word).
  private isStarting = false;
  private listeningTimer: ReturnType<typeof setTimeout> | null = null;
  private eventListeners: VoiceEventListener[] = [];

  constructor(config: Partial<VoiceServiceConfig> = {}) {
    this.config = {
      preferredSttEngine: 'auto',
      preferredTtsEngine: 'auto',
      feedbackLevel: 'standard',
      speechRate: 1.0,
      speechVolume: 1.0,
      allowCloudFallback: false,
      listeningTimeoutSeconds: 8,
      wakeWordPhrase: 'Hey WorldScript',
      ttsMuted: false,
      dictationAutoPunctuation: true,
      enableVoiceWasm: false,
      ...config,
    };

    this.intentEngine = new HybridIntentEngine();
    this.feedbackService = new FeedbackService();
    this.feedbackService.setFeedbackLevel(this.config.feedbackLevel);
    this.feedbackService.setMuted(this.config.ttsMuted);
  }

  // ── Eventing ───────────────────────────────────────────────────────────────

  addEventListener(listener: VoiceEventListener): () => void {
    this.eventListeners.push(listener);
    return () => {
      this.eventListeners = this.eventListeners.filter((l) => l !== listener);
    };
  }

  private emit(event: VoiceEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        logger.warn('Voice event listener error:', err);
      }
    }
  }

  // ── Redux Bridge ───────────────────────────────────────────────────────────

  setDispatch(dispatch: AppDispatch, getState: GetStateFn): void {
    this.dispatch = dispatch;
    this.getState = getState;
  }

  private d(action: Parameters<AppDispatch>[0]): void {
    if (this.dispatch) {
      this.dispatch(action);
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async initialize(): Promise<boolean> {
    if (this.isInitialized) return true;

    try {
      await this.intentEngine.initialize();

      // Request microphone permission early
      const permission = await this.requestMicrophonePermission();
      if (permission !== 'granted') {
        logger.warn('Microphone permission not granted');
        this.d(setMicrophonePermission(permission));
        return false;
      }
      this.d(setMicrophonePermission('granted'));

      // Initialize engines in parallel
      const [stt, tts, vad, wake] = await Promise.all([
        this.initStt(),
        this.initTts(),
        this.initVad(),
        this.initWakeWord(),
      ]);

      this.sttEngine = stt;
      this.ttsEngine = tts;
      this.vadEngine = vad;
      this.wakeWordEngine = wake;

      if (tts) {
        this.feedbackService.setTtsEngine(tts);
      }

      this.isInitialized = true;
      logger.info('Voice Command Service initialized successfully');
      return true;
    } catch (err) {
      logger.error('Voice initialization failed:', err);
      this.d(setVoiceError(err instanceof Error ? err.message : 'Voice initialization failed'));
      return false;
    }
  }

  private async initStt(): Promise<SttEngine | null> {
    try {
      this.d(setSttStatus('loading'));
      // QNBS-v3: B5 — eco-mode overrides STT to lightweight WebSpeech to save power
      const eco = ecoModeService.isEcoMode();
      const engine = await createSttEngine({
        preferredEngine: eco ? 'webSpeech' : this.config.preferredSttEngine,
        enableVoiceWasm: this.config.enableVoiceWasm || eco,
      });
      this.d(setActiveSttEngine(engine.id));
      this.d(setSttStatus('ready'));
      return engine;
    } catch (err) {
      logger.warn('STT initialization failed:', err);
      this.d(setSttStatus('error'));
      return null;
    }
  }

  private async initTts(): Promise<TtsEngine | null> {
    try {
      this.d(setTtsStatus('loading'));
      // QNBS-v3: B5 — eco-mode overrides TTS to WebSpeech to avoid heavy Kokoro/Piper models
      const eco = ecoModeService.isEcoMode();
      const engine = await createTtsEngine({
        preferredEngine: eco ? 'webSpeech' : this.config.preferredTtsEngine,
        enableVoiceWasm: this.config.enableVoiceWasm,
      });
      this.d(setActiveTtsEngine(engine.id));
      this.d(setTtsStatus('ready'));
      return engine;
    } catch (err) {
      logger.warn('TTS initialization failed:', err);
      this.d(setTtsStatus('error'));
      return null;
    }
  }

  private async initVad(): Promise<VadEngine | null> {
    try {
      this.d(setVadStatus('loading'));
      const engine = await createVadEngine(this.config.enableVoiceWasm);
      this.d(setVadStatus('ready'));
      return engine;
    } catch (err) {
      logger.warn('VAD initialization failed:', err);
      this.d(setVadStatus('error'));
      return null;
    }
  }

  private async initWakeWord(): Promise<WakeWordEngine | null> {
    try {
      this.d(setWakeWordStatus('loading'));
      const engine = await createWakeWordEngine(this.config.wakeWordPhrase);
      this.d(setWakeWordStatus('ready'));
      return engine;
    } catch (err) {
      logger.warn('Wake-word initialization failed:', err);
      this.d(setWakeWordStatus('error'));
      return null;
    }
  }

  private async requestMicrophonePermission(): Promise<'granted' | 'denied' | 'prompt'> {
    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
        return 'denied';
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => {
        t.stop();
      });
      return 'granted';
    } catch {
      return 'denied';
    }
  }

  // ── Listening Control ──────────────────────────────────────────────────────

  async startListening(): Promise<void> {
    // QNBS-v3: C-P1 — single-flight guard. A re-entrant call (rapid push-to-talk presses, or a
    //          wake-word firing while a start is mid-flight) would race engine init and leak a mic
    //          stream / orphan a coordinator. Ignore while starting or already listening.
    if (this.isStarting || this.coordinator || this.listeningTimer) return;
    this.isStarting = true;
    try {
      if (!this.isInitialized) {
        const ok = await this.initialize();
        if (!ok) {
          throw new Error('Voice service could not be initialized');
        }
      }

      if (!this.sttEngine) {
        throw new Error('No STT engine available');
      }

      this.d(setVoiceMode('listening'));
      this.d(setVoiceError(null));
      this.d(setVoiceTranscript(''));

      this.emit({ type: 'listening-started', timestamp: Date.now() });

      // QNBS-v3: Route through VoiceActivityCoordinator when Whisper WASM is active —
      // feeds PCM frames to the VAD and triggers STT on detected speech boundaries.
      if (this.config.enableVoiceWasm && this.sttEngine.id === 'whisper' && this.vadEngine) {
        // QNBS-v3: C-P1 — the single-flight guard above already guarantees no active coordinator,
        //          so no pre-dispose is needed here (it would be unreachable dead code).
        this.coordinator = new VoiceActivityCoordinator(this.vadEngine, this.sttEngine);
        await this.coordinator.start(
          (result) => this.handleSttResult(result),
          (error) => this.handleSttError(error),
        );
      } else {
        await this.sttEngine.start(
          (result) => this.handleSttResult(result),
          (error) => this.handleSttError(error),
        );
      }

      // Auto-stop after timeout
      this.listeningTimer = setTimeout(() => {
        this.stopListening();
      }, this.config.listeningTimeoutSeconds * 1000);
    } catch (err) {
      // QNBS-v3: CodeAnt — roll back the 'listening' mode if startup fails after we set it, so the
      //          UI/Redux don't stay stuck in listening when capture never actually started.
      this.d(setVoiceMode('inactive'));
      this.d(setVoiceError(err instanceof Error ? err.message : 'Voice start failed'));
      if (this.listeningTimer) {
        clearTimeout(this.listeningTimer);
        this.listeningTimer = null;
      }
      if (this.coordinator) {
        try {
          await this.coordinator.dispose();
        } catch {
          /* best-effort teardown */
        }
        this.coordinator = null;
      }
      throw err;
    } finally {
      this.isStarting = false;
    }
  }

  async startDictation(): Promise<void> {
    if (!this.isInitialized) {
      const ok = await this.initialize();
      if (!ok) throw new Error('Voice service could not be initialized');
    }
    if (!this.sttEngine) throw new Error('No STT engine available');

    this.d(setDictationActive(true));
    this.d(setVoiceError(null));

    this.emit({ type: 'dictation-started', timestamp: Date.now() });

    await this.sttEngine.start(
      (result) => this.handleDictationResult(result),
      (error) => this.handleSttError(error),
    );
  }

  async stopListening(): Promise<void> {
    if (this.listeningTimer) {
      clearTimeout(this.listeningTimer);
      this.listeningTimer = null;
    }

    this.d(setVoiceMode('inactive'));
    this.d(setDictationActive(false));

    if (this.coordinator) {
      // QNBS-v3: Whisper/VAD coordinator owns its own teardown path
      await this.coordinator.stop();
      this.coordinator = null;
    } else if (this.sttEngine) {
      await this.sttEngine.stop();
    }

    this.emit({ type: 'listening-stopped', timestamp: Date.now() });
  }

  async stopDictation(): Promise<void> {
    this.d(setDictationActive(false));
    if (this.sttEngine) {
      await this.sttEngine.stop();
    }
    this.emit({ type: 'dictation-stopped', timestamp: Date.now() });
  }

  // ── Result Handlers ────────────────────────────────────────────────────────

  private handleSttResult(result: SttResult): void {
    this.d(setVoiceTranscript(result.transcript));
    this.d(setLastConfidence(result.confidence));

    this.emit({
      type: 'transcript-received',
      payload: result,
      timestamp: Date.now(),
    });

    if (result.isFinal) {
      void this.processTranscript(result.transcript);
    }
  }

  private handleDictationResult(result: SttResult): void {
    if (result.transcript.trim()) {
      this.d(appendVoiceTranscript(result.transcript));
    }
  }

  private handleSttError(error: Error): void {
    logger.error('STT error:', error);
    this.d(setVoiceError(error.message));
    this.emit({ type: 'error', payload: error.message, timestamp: Date.now() });
    void this.feedbackService.error('Speech recognition error. Please try again.');
  }

  // ── Intent Processing ──────────────────────────────────────────────────────

  private async processTranscript(transcript: string): Promise<void> {
    this.d(setVoiceMode('processing'));

    try {
      const state = this.getState?.();
      if (!state) return;

      const context = this.buildIntentContext(state);
      const intent = this.intentEngine.parse(transcript, context);

      if (!intent) {
        void this.feedbackService.error(`I didn't understand: "${transcript}"`);
        this.d(setVoiceMode('inactive'));
        return;
      }

      this.emit({
        type: 'intent-recognized',
        payload: intent,
        timestamp: Date.now(),
      });

      // Execute via CommandExecutorContext or direct dispatch
      await this.executeIntent(intent);
    } catch (err) {
      logger.error('Intent processing error:', err);
      this.d(setVoiceError(err instanceof Error ? err.message : 'Processing failed'));
      void this.feedbackService.error('Error processing command.');
    }
  }

  private buildIntentContext(state: RootState): Parameters<HybridIntentEngine['parse']>[1] {
    const project = state.project.present?.data;
    const characterNames = project
      ? Object.values(project.characters.entities ?? {})
          .filter(
            (c: unknown): c is { name: string } => !!c && typeof c === 'object' && 'name' in c,
          )
          .map((c) => c.name)
      : [];
    const sectionTitles = project?.manuscript?.map((s: { title: string }) => s.title) ?? [];
    const worldNames = project
      ? Object.values(project.worlds.entities ?? {})
          .filter(
            (w: unknown): w is { name: string } => !!w && typeof w === 'object' && 'name' in w,
          )
          .map((w) => w.name)
      : [];

    // QNBS-v3: currentView lives in app-level React state, not Redux.
    // We use a best-effort fallback; the intent engine still matches broad commands.
    const currentView = (document.body.dataset['view'] as string) ?? 'dashboard';

    return {
      currentView,
      selectedIds: [],
      characterNames,
      sectionTitles,
      worldNames,
      lastCommandId: null,
    };
  }

  private async executeIntent(intent: ReturnType<HybridIntentEngine['parse']>): Promise<void> {
    if (!intent) return;

    // QNBS-v3: Dispatch voice command execution via custom event so App.tsx can handle it
    // without coupling service to React context.
    const event = new CustomEvent('voice-command', {
      detail: { commandId: intent.commandId, slots: intent.slots, transcript: intent.transcript },
    });
    window.dispatchEvent(event);

    this.emit({
      type: 'command-executed',
      payload: intent,
      timestamp: Date.now(),
    });

    // Provide feedback
    const state = this.getState?.();
    const feedbackLevel = state?.settings.voice.feedbackLevel ?? 'standard';
    if (feedbackLevel !== 'minimal') {
      void this.feedbackService.confirm('Done');
    }

    this.d(setVoiceMode('inactive'));
  }

  // ── TTS Public API ─────────────────────────────────────────────────────────

  async speak(text: string): Promise<void> {
    if (!this.ttsEngine || this.config.ttsMuted) return;
    await this.ttsEngine.speak({
      text,
      rate: this.config.speechRate,
      volume: this.config.speechVolume,
    });
  }

  cancelSpeech(): void {
    this.ttsEngine?.cancel();
    this.feedbackService.cancel();
  }

  // ── Configuration ──────────────────────────────────────────────────────────

  updateConfig(config: Partial<VoiceServiceConfig>): void {
    this.config = { ...this.config, ...config };
    this.feedbackService.setFeedbackLevel(this.config.feedbackLevel);
    this.feedbackService.setMuted(this.config.ttsMuted);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  async dispose(): Promise<void> {
    await this.stopListening();
    this.cancelSpeech();

    // QNBS-v3: coordinator.dispose() handles its own engine teardown when active
    if (this.coordinator) {
      await this.coordinator.dispose();
      this.coordinator = null;
    } else {
      await Promise.all([
        this.sttEngine?.dispose(),
        this.ttsEngine?.dispose(),
        this.vadEngine?.dispose(),
        this.wakeWordEngine?.dispose(),
      ]);
    }

    this.isInitialized = false;
    this.eventListeners = [];
  }

  // ── Onboarding ─────────────────────────────────────────────────────────────

  completeOnboarding(): void {
    this.d(setVoiceOnboardingComplete(true));
  }

  resetOnboarding(): void {
    this.d(setVoiceOnboardingComplete(false));
  }

  // ── Voice WASM Model Download ───────────────────────────────────────────────

  /**
   * QNBS-v3: P1-2 — Download WASM voice models (Whisper STT + Kokoro TTS).
   * Called from VoiceModelDownloadModal when enableVoiceWasm is toggled.
   */
  // QNBS-v3: P1-2 / CodeAnt P2-3 — signal allows VoiceModelDownloadModal cancel to abort mid-download
  async downloadVoiceModels(modelType: 'stt' | 'tts', signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return;

    // QNBS-v3: P1-2 — E2E seam. Run a deterministic simulated download (no 42 MB fetch in CI).
    const downloadHook = getVoiceTestHarness()?.download;
    if (downloadHook) {
      await this.runSimulatedDownload(downloadHook, signal);
      return;
    }

    const modelId = modelType === 'stt' ? 'Xenova/whisper-tiny.en' : 'onnxruntime-community/kokoro';

    // QNBS-v3: Trigger model download via transformers pipeline warm-up.
    // This forces the model to be fetched and cached in browser storage.
    try {
      const { pipeline, env } = await import('@huggingface/transformers');
      // Disable WASM proxy for direct inline execution
      interface XenovaEnv {
        backends?: { onnx?: { wasm?: { proxy?: boolean } } };
      }
      const typedEnv = env as unknown as XenovaEnv;
      if (typedEnv.backends?.onnx?.wasm) {
        typedEnv.backends.onnx.wasm.proxy = false;
      }

      if (signal?.aborted) return;

      // Report initial progress
      this.d(
        settingsActions.setVoiceSettings({
          wasmModelDownloadProgress: 0.1,
        }),
      );

      // Create pipeline to trigger model download
      const task = modelType === 'stt' ? 'automatic-speech-recognition' : 'text-to-speech';
      const createPipeline = pipeline as (
        task: string,
        model: string,
        opts: unknown,
      ) => Promise<unknown>;

      // QNBS-v3: Progress callback — guard with aborted check to avoid stale state after cancel
      const pipe = await createPipeline(task, modelId, {
        dtype: 'q8',
        onProgress: (progress: unknown) => {
          if (signal?.aborted) return;
          const p = progress as { progress?: number; loaded?: number; total?: number };
          const pct = p.progress ?? (p.loaded && p.total ? p.loaded / p.total : 0);
          this.d(
            settingsActions.setVoiceSettings({
              wasmModelDownloadProgress: Math.min(0.95, pct),
            }),
          );
        },
      });

      if (signal?.aborted) {
        if (pipe && typeof (pipe as { dispose?: () => void }).dispose === 'function') {
          (pipe as { dispose: () => void }).dispose();
        }
        return;
      }

      // Mark complete
      this.d(
        settingsActions.setVoiceSettings({
          wasmModelDownloadProgress: 1.0,
          wasmModelsReady: true,
        }),
      );

      // Dispose pipeline - it will be recreated on actual use
      if (pipe && typeof (pipe as { dispose?: () => void }).dispose === 'function') {
        (pipe as { dispose: () => void }).dispose();
      }

      logger.info(`[VoiceCommandService] ${modelType.toUpperCase()} model downloaded successfully`);
    } catch (err) {
      if (signal?.aborted) return;
      logger.error(`[VoiceCommandService] Model download failed:`, err);
      this.d(
        settingsActions.setVoiceSettings({
          wasmModelDownloadProgress: 0,
          voiceWasmDownloadError: err instanceof Error ? err.message : String(err),
        }),
      );
      throw err;
    }
  }

  /**
   * QNBS-v3: P1-2 — Deterministic download simulation for E2E. Emits the same Redux progress
   * actions as the real path (so the modal UI is exercised identically), honors the abort signal
   * for cancel coverage, and throws on `mode: 'error'` for retry-path coverage.
   */
  private async runSimulatedDownload(
    hook: VoiceTestDownloadHook,
    signal?: AbortSignal,
  ): Promise<void> {
    const steps = Math.max(1, hook.steps ?? 5);
    const delay = hook.stepDelayMs ?? 50;
    // QNBS-v3: CodeAnt — on abort, reset progress to 0 so the modal's auto-start (which only fires
    //          when progress === 0) can re-run on reopen/retry after a cancel.
    const resetProgress = (): void => {
      this.d(settingsActions.setVoiceSettings({ wasmModelDownloadProgress: 0 }));
    };

    this.d(settingsActions.setVoiceSettings({ wasmModelDownloadProgress: 0.05 }));

    for (let i = 1; i <= steps; i++) {
      if (signal?.aborted) {
        resetProgress();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (signal?.aborted) {
        resetProgress();
        return;
      }
      this.d(
        settingsActions.setVoiceSettings({
          wasmModelDownloadProgress: Math.min(0.95, i / steps),
        }),
      );
    }

    if (signal?.aborted) {
      resetProgress();
      return;
    }

    if (hook.mode === 'error') {
      const message = hook.errorMessage ?? 'Simulated download failure';
      this.d(
        settingsActions.setVoiceSettings({
          wasmModelDownloadProgress: 0,
          voiceWasmDownloadError: message,
        }),
      );
      throw new Error(message);
    }

    this.d(
      settingsActions.setVoiceSettings({
        wasmModelDownloadProgress: 1.0,
        wasmModelsReady: true,
      }),
    );
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

let voiceServiceInstance: VoiceCommandService | null = null;

export function getVoiceService(config?: Partial<VoiceServiceConfig>): VoiceCommandService {
  if (!voiceServiceInstance) {
    voiceServiceInstance = new VoiceCommandService(config);
  } else if (config) {
    voiceServiceInstance.updateConfig(config);
  }
  return voiceServiceInstance;
}

/**
 * QNBS-v3: P1-2 — Convenience wrapper for VoiceModelDownloadModal.
 * Downloads WASM voice models via the singleton instance.
 * Accepts an optional AbortSignal so the modal cancel button can abort mid-download.
 */
export async function downloadVoiceModels(
  modelType: 'stt' | 'tts',
  signal?: AbortSignal,
): Promise<void> {
  const service = getVoiceService();
  await service.downloadVoiceModels(modelType, signal);
}

export function resetVoiceService(): void {
  void voiceServiceInstance?.dispose();
  voiceServiceInstance = null;
}
