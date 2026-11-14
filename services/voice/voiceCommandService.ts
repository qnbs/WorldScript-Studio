/**
 * Voice Command Service — central orchestrator for Voice Full Support.
 * QNBS-v3: Replaces MVP placeholder with production-grade multi-engine architecture.
 */

import type { AppDispatch, RootState } from '../../app/store';
import { settingsActions } from '../../features/settings/settingsSlice';
import {
  appendVoiceTranscript,
  reportVoiceIssue,
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
import { sttEngineUnderEco } from './engineChoice';
import { FeedbackService } from './feedbackService';
import { HybridIntentEngine } from './intentEngine';
import { ConsentRequiredError, createSttEngine } from './sttEngine';
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
import { RecoverableSttError } from './voiceTypes';
import { createWakeWordEngine } from './wakeWordEngine';
import {
  ensureWebSpeechConsent,
  isWebSpeechBlocked,
  onWebSpeechBlocked,
  WEB_SPEECH_LOCAL_ONLY_MESSAGE,
} from './webSpeechConsent';

export type GetStateFn = () => RootState;

type BuiltEngines = [SttEngine | null, TtsEngine | null, VadEngine | null, WakeWordEngine | null];
/** Applies one store write of an engine setup, or drops it once a dispose voided that setup (#1265). */
type SetupWrite = (write: () => void) => void;

/** Config keys that decide which engines exist; changing one rebuilds the engines on the next start. */
const ENGINE_CONFIG_KEYS = [
  'preferredSttEngine',
  'preferredTtsEngine',
  'enableVoiceWasm',
  // QNBS-v3 (#1261): turning cloud fallback off must replace a Web Speech engine chosen under it.
  'allowCloudFallback',
] as const;

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
  /** Set when the engine choice changes; the next start applies it before it uses any engine. */
  private engineChoiceChanged = false;
  private engineSetup: Promise<boolean> | null = null;
  // QNBS-v3: C-P1 — single-flight guard against re-entrant startListening (rapid PTT / wake-word).
  private isStarting = false;
  private listeningTimer: ReturnType<typeof setTimeout> | null = null;
  // QNBS-v3 (#556): dictation and command listening share one STT engine; only one of them may run it at a time.
  private isDictating = false;
  /** Bumped by every dictation stop: a dictation start that is still preparing then never starts the engine. */
  private dictationClaim = 0;
  private dictationStop: Promise<void> | null = null;
  /** The command-listening stop in progress; a second stop awaits it instead of tearing down again. */
  private commandStop: Promise<void> | null = null;
  /** Settles when a command-listening start finishes, so a dictation start can take over only afterwards. */
  private listeningStart: Promise<void> | null = null;
  /** Bumped by every command-listening stop: a start still building engines or waiting for consent then never starts the engine. */
  private listeningClaim = 0;
  /** Why the last engine setup built no STT engine, so every start reports it instead of a generic message (#1261). */
  private sttUnavailable: string | null = null;
  /** Bumped by dispose(): an engine setup still running then releases what it built instead of publishing it. */
  private lifecycle = 0;
  /** Unsubscribes from local-only switches; held from the first engine setup until dispose(). */
  private webSpeechWatch: (() => void) | null = null;
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

  /** Ends a running or starting session on an engine that is not declared local; a local engine keeps running. */
  private endWebSpeechSession(): void {
    const engine = this.sttEngine;
    if (!engine || engine.isLocal === true) return;
    // A running session (listening or dictation), or a start still in its setup or consent dialog.
    const running = this.isDictating || this.listeningTimer !== null;
    if (running || this.isStarting) void this.stopListening();
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

  /**
   * The one engine-setup operation every start goes through: applies a changed engine choice, then initializes.
   * QNBS-v3 (#1261): concurrent starts share it, so engines are never built twice or released while another start builds them.
   */
  private ensureEngines(): Promise<boolean> {
    // Taken before the engine-choice change, so a dispose during that change also voids the engines built after it.
    const lifecycle = this.lifecycle;
    if (!this.engineSetup) {
      const setup: Promise<boolean> = this.applyEngineChoice()
        .then(() => this.initialize(lifecycle))
        .finally(() => {
          // QNBS-v3 (#1265): dispose() drops a pending setup, so a stale one must not clear the setup that replaced it.
          if (this.engineSetup === setup) this.engineSetup = null;
        });
      this.engineSetup = setup;
    }
    return this.engineSetup;
  }

  async initialize(lifecycle = this.lifecycle): Promise<boolean> {
    // QNBS-v3 (#1265): a setup a dispose voided is never ready, builds nothing and leaves the engine-choice flag alone.
    if (lifecycle !== this.lifecycle) return false;
    if (this.isInitialized) return true;
    // A change from here on (even while the engines below are being built) is applied by the next start.
    this.engineChoiceChanged = false;

    try {
      await this.intentEngine.initialize();
      const write = this.writesFor(lifecycle);

      // Request microphone permission early
      const permission = await this.requestMicrophonePermission();
      if (permission !== 'granted') {
        logger.warn('Microphone permission not granted');
        write(() => this.d(setMicrophonePermission(permission)));
        return false;
      }
      write(() => this.d(setMicrophonePermission('granted')));

      // Initialize engines in parallel
      const engines: BuiltEngines = await Promise.all([
        this.initStt(write),
        this.initTts(write),
        this.initVad(write),
        this.initWakeWord(write),
      ]);
      if (!(await this.adoptEngines(lifecycle, engines))) return false;
      logger.info('Voice Command Service initialized successfully');
      return true;
    } catch (err) {
      logger.error('Voice initialization failed:', err);
      // QNBS-v3 (#1265): a setup a dispose voided must not report against the session that replaced it.
      if (lifecycle === this.lifecycle)
        this.d(setVoiceError(err instanceof Error ? err.message : 'Voice initialization failed'));
      return false;
    }
  }

  /** Publishes freshly built engines; after a dispose that came in while they were built, releases them instead. */
  private async adoptEngines(lifecycle: number, engines: BuiltEngines): Promise<boolean> {
    // QNBS-v3 (#1261): the disposed service owns none of these, so publishing them would leak them and revive the service.
    if (lifecycle !== this.lifecycle) {
      // A voided setup's cleanup failure belongs to no session, so it is only logged (#1265).
      await this.disposeAll(engines, 'Releasing engines from a voided setup failed');
      return false;
    }
    [this.sttEngine, this.ttsEngine, this.vadEngine, this.wakeWordEngine] = engines;
    // QNBS-v3 (#1265): set with the engines, before any await, so a dispose right after adoption is never undone.
    this.isInitialized = true;
    // QNBS-v3 (#1261): sessions exist only from here on; a local-only switch ends a running Web Speech session, dispose() unsubscribes.
    this.webSpeechWatch ??= onWebSpeechBlocked(() => this.endWebSpeechSession());
    if (engines[1]) this.feedbackService.setTtsEngine(engines[1]);
    return true;
  }

  /** The store writes of one setup: a voided setup must not overwrite the status of the session that replaced it (#1265). */
  private writesFor(lifecycle: number): SetupWrite {
    return (write) => {
      if (lifecycle === this.lifecycle) write();
    };
  }

  private async initStt(write: SetupWrite): Promise<SttEngine | null> {
    try {
      write(() => this.d(setSttStatus('loading')));
      // QNBS-v3: B5 — eco-mode overrides STT to lightweight WebSpeech to save power
      const eco = ecoModeService.isEcoMode();
      const engine = await createSttEngine({
        preferredEngine: sttEngineUnderEco(this.config.preferredSttEngine, eco),
        // QNBS-v3 (#1261): Eco Mode never turns the local-model opt-in on; it only lowers an auto choice to Web Speech.
        enableVoiceWasm: this.config.enableVoiceWasm,
        allowCloudFallback: this.config.allowCloudFallback,
      });
      write(() => {
        this.d(setActiveSttEngine(engine.id));
        this.d(setSttStatus('ready'));
        this.sttUnavailable = null;
      });
      return engine;
    } catch (err) {
      logger.warn('STT initialization failed:', err);
      write(() => {
        this.d(setSttStatus('error'));
        // e.g. LOCAL_STT_UNAVAILABLE_MESSAGE: a local-only choice with Whisper off says why, and how to recover.
        this.sttUnavailable = err instanceof Error ? err.message : null;
      });
      return null;
    }
  }

  private async initTts(write: SetupWrite): Promise<TtsEngine | null> {
    try {
      write(() => this.d(setTtsStatus('loading')));
      // QNBS-v3: B5 — eco-mode overrides TTS to WebSpeech to avoid heavy Kokoro/Piper models
      const eco = ecoModeService.isEcoMode();
      const engine = await createTtsEngine({
        preferredEngine: eco ? 'webSpeech' : this.config.preferredTtsEngine,
        enableVoiceWasm: this.config.enableVoiceWasm,
      });
      write(() => {
        this.d(setActiveTtsEngine(engine.id));
        this.d(setTtsStatus('ready'));
      });
      return engine;
    } catch (err) {
      logger.warn('TTS initialization failed:', err);
      write(() => this.d(setTtsStatus('error')));
      return null;
    }
  }

  private async initVad(write: SetupWrite): Promise<VadEngine | null> {
    try {
      write(() => this.d(setVadStatus('loading')));
      const engine = await createVadEngine(this.config.enableVoiceWasm);
      write(() => this.d(setVadStatus('ready')));
      return engine;
    } catch (err) {
      logger.warn('VAD initialization failed:', err);
      write(() => this.d(setVadStatus('error')));
      return null;
    }
  }

  private async initWakeWord(write: SetupWrite): Promise<WakeWordEngine | null> {
    try {
      write(() => this.d(setWakeWordStatus('loading')));
      const engine = await createWakeWordEngine(this.config.wakeWordPhrase);
      write(() => this.d(setWakeWordStatus('ready')));
      return engine;
    } catch (err) {
      logger.warn('Wake-word initialization failed:', err);
      write(() => this.d(setWakeWordStatus('error')));
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
    // QNBS-v3 (#1261): taken before any await, so a stop or release during the engine setup or the consent dialog ends this start.
    const claim = this.listeningClaim;
    let settleStart!: () => void;
    this.listeningStart = new Promise<void>((resolve) => {
      settleStart = resolve;
    });
    try {
      const stt = await this.prepareListening(claim);
      if (!stt || claim !== this.listeningClaim) return; // stopped or released while it was preparing

      this.d(setVoiceMode('listening'));
      this.d(setVoiceError(null));
      this.d(setVoiceTranscript(''));

      this.emit({ type: 'listening-started', timestamp: Date.now() });

      let capture: { stop(): Promise<void> } = stt;
      // QNBS-v3: Route through VoiceActivityCoordinator when Whisper WASM is active —
      // feeds PCM frames to the VAD and triggers STT on detected speech boundaries.
      if (this.config.enableVoiceWasm && stt.id === 'whisper' && this.vadEngine) {
        // QNBS-v3: C-P1 — the single-flight guard above already guarantees no active coordinator,
        //          so no pre-dispose is needed here (it would be unreachable dead code).
        this.coordinator = new VoiceActivityCoordinator(this.vadEngine, stt);
        capture = this.coordinator;
        await this.coordinator.start(
          (result) => this.handleSttResult(result),
          (error) => this.handleSttError(error),
        );
      } else {
        await stt.start(
          (result) => this.handleSttResult(result),
          (error) => this.handleSttError(error),
        );
      }

      // A stop while the engine started may have run before it was running: end it here, and leave no timer behind.
      if (claim !== this.listeningClaim) {
        await capture.stop();
        return;
      }
      // Auto-stop after timeout
      this.listeningTimer = setTimeout(() => {
        void this.stopCommandListening();
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
      this.listeningStart = null;
      settleStart();
    }
  }

  async startDictation(): Promise<void> {
    // QNBS-v3 (#1265): a stop issued while this start waits for the previous drain is newer and wins.
    const claimBeforeDrain = this.dictationClaim;
    await this.dictationStop;
    // QNBS-v3 (#556): claimed before any await, so a second start cannot pass this check while the first prepares.
    if (this.isDictating || this.dictationClaim !== claimBeforeDrain) return;
    this.isDictating = true;
    const claim = ++this.dictationClaim;
    try {
      // Command listening ends first, so the engine setup never replaces engines a running session uses.
      await this.endListeningBeforeDictation();
      const engine = await this.dictationEngine(claim);
      if (!engine || claim !== this.dictationClaim) return; // stopped while preparing
      // QNBS-v3 (#556): each dictation starts from an empty transcript, so a restart never re-inserts the last session.
      this.d(setVoiceTranscript(''));
      this.d(setDictationActive(true));
      this.d(setVoiceError(null));
      this.emit({ type: 'dictation-started', timestamp: Date.now() });
      await this.startDictationEngine(engine, claim);
    } catch (err) {
      if (claim === this.dictationClaim) this.isDictating = false;
      throw err;
    }
  }

  private async dictationEngine(claim: number): Promise<SttEngine | null> {
    // QNBS-v3 (#1261): the shared engine setup applies a changed engine choice before dictation uses an engine.
    const ready = await this.ensureEngines();
    if (claim !== this.dictationClaim) return null; // stopped or released during the setup: never ask for consent
    if (!ready) throw new Error('Voice service could not be initialized');
    return this.admitStt(() => claim === this.dictationClaim);
  }

  /** The engine a listening start may use, or null when a stop or release came in while it was preparing. */
  private async prepareListening(claim: number): Promise<SttEngine | null> {
    // A running dictation ends before the engine setup may replace the engines it uses.
    await this.endDictationBeforeListening();
    // QNBS-v3 (#1265): a direct-STT teardown may still be draining; a start in that window would open a session no stop ends.
    await this.commandStop;
    const ready = await this.ensureEngines();
    if (claim !== this.listeningClaim) return null; // stopped or released during the setup: never ask for consent
    if (!ready) throw new Error('Voice service could not be initialized');
    const stt = await this.admitStt(() => claim === this.listeningClaim);
    return claim === this.listeningClaim ? stt : null;
  }

  /**
   * The engine a start may use. An engine not declared local sends the audio off-device, so it starts only with the
   * stored consent, read right before the start; the consent dialog asks when none is stored. A stop or release while
   * the dialog is open bumps the caller's claim, so that start then ends without the engine.
   */
  private async admitStt(isCurrent: () => boolean): Promise<SttEngine | null> {
    const engine = this.sttEngine;
    if (!engine)
      return this.refuseStart(new Error(this.sttUnavailable ?? 'No STT engine available'));
    // QNBS-v3 (#1261): fail closed, only an engine that declares itself local starts without the stored Web Speech consent.
    if (engine.isLocal !== true && !(await ensureWebSpeechConsent()))
      // QNBS-v3 (#1265): a start the user already stopped while the dialog was open ends quietly instead of failing.
      return isCurrent() ? this.refuseStart(this.webSpeechRefusal()) : null;
    return engine;
  }

  /** Why Web Speech may not start: a local-only AI mode outranks any stored consent; otherwise consent is missing. */
  private webSpeechRefusal(): Error {
    return isWebSpeechBlocked()
      ? new Error(WEB_SPEECH_LOCAL_ONLY_MESSAGE)
      : new ConsentRequiredError();
  }

  /** Reports why a start cannot use an engine (listening and dictation alike), then fails that start. */
  private refuseStart(reason: Error): never {
    this.d(setVoiceError(reason.message));
    throw reason;
  }

  /** Dictation takes the engine over from command listening; otherwise speech would keep going to commands. */
  private async endListeningBeforeDictation(): Promise<void> {
    await this.listeningStart;
    if (this.coordinator || this.listeningTimer) await this.stopCommandListening();
    // A direct-STT teardown may still be draining; dictation must not open a session during it (#1265).
    await this.commandStop;
  }

  /** Listening takes the engine over from a running dictation instead of sharing its session. */
  private async endDictationBeforeListening(): Promise<void> {
    if (this.isDictating || this.dictationStop) await this.stopDictation();
  }

  private async startDictationEngine(engine: SttEngine, claim: number): Promise<void> {
    try {
      await engine.start(
        (result) => this.handleDictationResult(result),
        (error) => this.handleSttError(error),
      );
    } catch (err) {
      // QNBS-v3 (#556, #1265): a failed start must not leave dictation shown as active, but only while it still owns the session.
      if (claim === this.dictationClaim) {
        this.isDictating = false;
        this.d(setDictationActive(false));
        this.d(setVoiceError(err instanceof Error ? err.message : 'Dictation could not start'));
      }
      throw err;
    }
  }

  async stopListening(): Promise<void> {
    // QNBS-v3 (#556): the Voice Control microphone button also stops dictation through here; route it so the dictation guard clears.
    if (this.isDictating) {
      // A listening start that is still waiting for this dictation to end is cancelled by the same stop (#1261).
      this.listeningClaim += 1;
      return this.stopDictation();
    }
    await this.stopCommandListening();
  }

  /** Ends command listening and cancels a start that is still preparing. */
  private stopCommandListening(): Promise<void> {
    this.listeningClaim += 1;
    return this.endCommandListening();
  }

  /**
   * Ends a running command-listening session; unlike a stop it leaves a start that is still preparing alone.
   * QNBS-v3 (#1265): concurrent calls (a timeout and a dictation hand-off) share one teardown.
   */
  private endCommandListening(): Promise<void> {
    this.commandStop ??= this.teardownCommandListening().finally(() => {
      this.commandStop = null;
    });
    return this.commandStop;
  }

  private async teardownCommandListening(): Promise<void> {
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

  stopDictation(): Promise<void> {
    this.dictationClaim += 1;
    // QNBS-v3 (#556): a second stop shares the first one's drain instead of finishing before its last window arrives.
    this.dictationStop ??= this.drainDictation().finally(() => {
      this.dictationStop = null;
    });
    return this.dictationStop;
  }

  private async drainDictation(): Promise<void> {
    try {
      // QNBS-v3 (#556): stop the engine first; its last window is transcribed while dictation is still active, so the editor gets it.
      if (this.isDictating && this.sttEngine) await this.sttEngine.stop();
    } finally {
      this.isDictating = false;
      this.d(setDictationActive(false));
      this.emit({ type: 'dictation-stopped', timestamp: Date.now() });
    }
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
    // QNBS-v3 (#1265): capture goes on after a window problem, so the session must stay shown as active.
    if (error instanceof RecoverableSttError) {
      logger.warn('STT window problem:', error.message);
      this.d(reportVoiceIssue(error.message));
      return;
    }
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
    const engineChanged = ENGINE_CONFIG_KEYS.some(
      (key) => key in config && config[key] !== this.config[key],
    );
    this.config = { ...this.config, ...config };
    this.feedbackService.setFeedbackLevel(this.config.feedbackLevel);
    this.feedbackService.setMuted(this.config.ttsMuted);
    // QNBS-v3 (#1261): never torn down from here (a start may be using the engines); the next start applies the change itself.
    if (engineChanged) this.engineChoiceChanged = true;
  }

  /** Applies a changed engine choice inside a start, before it uses any engine: ends sessions, drops the old engines. */
  private async applyEngineChoice(): Promise<void> {
    if (!this.engineChoiceChanged || !this.isInitialized) return;
    const engines = [this.sttEngine, this.ttsEngine, this.vadEngine, this.wakeWordEngine];
    this.isInitialized = false;
    try {
      // Ends command listening and waits for a draining dictation; never stops the start that is calling this.
      await this.endCommandListening();
      await this.dictationStop;
    } catch (error) {
      logger.warn('Ending the voice session before an engine change failed', error);
    }
    // QNBS-v3 (#1265): released even when ending the session failed; the replacements built next would orphan them.
    await this.releaseEngines(engines);
  }

  /** Cancels speech and disposes every given engine; one failure neither stops the others nor the caller. */
  private async releaseEngines(
    engines: readonly ({ dispose(): Promise<void> } | null)[],
  ): Promise<void> {
    try {
      this.cancelSpeech();
    } catch (error) {
      logger.warn('Cancelling speech before an engine change failed', error);
    }
    await this.disposeAll(engines, 'Releasing the previous voice engines failed');
  }

  /** Disposes every given engine; one failure neither stops the others nor the caller, it is logged. */
  private async disposeAll(
    engines: readonly ({ dispose(): Promise<void> } | null)[],
    failure: string,
  ): Promise<void> {
    const released = await Promise.allSettled(engines.map((engine) => engine?.dispose()));
    for (const result of released) {
      if (result.status === 'rejected') logger.warn(failure, result.reason);
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  async dispose(): Promise<void> {
    this.lifecycle += 1;
    // A start after this builds fresh engines instead of joining a setup this dispose voided (#1265).
    this.engineSetup = null;
    // QNBS-v3 (#1265): set before the first await, so a start during this dispose builds fresh engines, never these.
    this.isInitialized = false;
    const coordinator = this.coordinator;
    const engines: BuiltEngines = [
      this.sttEngine,
      this.ttsEngine,
      this.vadEngine,
      this.wakeWordEngine,
    ];
    this.webSpeechWatch?.();
    this.webSpeechWatch = null;
    const stopping = this.stopListening();
    // QNBS-v3 (#1265): cleared before the first await, so a dictation started during this dispose keeps its own state.
    this.isDictating = false;
    this.cancelSpeech();
    await stopping;
    await this.releaseDisposed(coordinator, engines);
    this.eventListeners = [];
  }

  /** Releases what a dispose took over; engines a start built meanwhile belong to that start and stay. */
  private async releaseDisposed(
    coordinator: VoiceActivityCoordinator | null,
    engines: BuiltEngines,
  ): Promise<void> {
    // QNBS-v3: coordinator.dispose() handles its own engine teardown when active
    if (coordinator && this.coordinator === coordinator) {
      await coordinator.dispose();
      this.coordinator = null;
      return;
    }
    await Promise.all(engines.map((engine) => engine?.dispose()));
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
   * QNBS-v3: P1-2 — Download the WASM voice model (Whisper STT; Kokoro TTS rejects with its unavailability reason).
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

    // QNBS-v3 (#556): never fetch a TTS model Kokoro cannot load; the old id 'onnxruntime-community/kokoro' returns HTTP 401.
    if (modelType === 'tts') {
      const { KOKORO_UNAVAILABLE_REASON } = await import('./kokoroTtsEngine');
      this.d(
        settingsActions.setVoiceSettings({ voiceWasmDownloadError: KOKORO_UNAVAILABLE_REASON }),
      );
      throw new Error(KOKORO_UNAVAILABLE_REASON);
    }

    const modelId = 'Xenova/whisper-tiny.en';

    // QNBS-v3: Trigger model download via transformers pipeline warm-up.
    // This forces the model to be fetched and cached in browser storage.
    try {
      const { pipeline, env } = await import('../../packages/ai-core/src/vendor-transformers');
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
      // QNBS-v3 (#333/CodeAnt+Qodo): clear stale byte counts from a previous download attempt —
      // setVoiceSettings merges partial state, so a prior attempt's bytes would otherwise linger
      // until the first byte-bearing progress tick of THIS attempt arrives.
      this.d(
        settingsActions.setVoiceSettings({
          wasmModelDownloadProgress: 0.1,
          wasmModelDownloadLoadedBytes: undefined,
          wasmModelDownloadTotalBytes: undefined,
        }),
      );

      // Create pipeline to trigger model download
      const task = 'automatic-speech-recognition';
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
          // QNBS-v3 (#333 item 1): transformers.js's own `progress` field is 0-100 (percent), NOT a
          // 0-1 fraction — verified against its readResponse() source (`progress = loaded/total*100`).
          // The prior `p.progress ?? ...` fallback used it as-is, so `Math.min(0.95, pct)` clamped to
          // 0.95 almost immediately (any progress > 0.95%, i.e. after the very first chunk), making
          // the bar look stuck/frozen for the entire download. Prefer the real loaded/total ratio —
          // it's also what the new byte-level UI needs — and only fall back to progress/100.
          const hasBytes =
            typeof p.loaded === 'number' && typeof p.total === 'number' && p.total > 0;
          const pct = hasBytes
            ? (p.loaded as number) / (p.total as number)
            : typeof p.progress === 'number'
              ? p.progress / 100
              : 0;
          this.d(
            settingsActions.setVoiceSettings({
              wasmModelDownloadProgress: Math.min(0.95, pct),
              ...(hasBytes
                ? {
                    wasmModelDownloadLoadedBytes: p.loaded,
                    wasmModelDownloadTotalBytes: p.total,
                  }
                : {}),
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

      // Mark complete — clear byte counts too (no longer meaningful once the download is done).
      this.d(
        settingsActions.setVoiceSettings({
          wasmModelDownloadProgress: 1.0,
          wasmModelsReady: true,
          wasmModelDownloadLoadedBytes: undefined,
          wasmModelDownloadTotalBytes: undefined,
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
          wasmModelDownloadLoadedBytes: undefined,
          wasmModelDownloadTotalBytes: undefined,
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
