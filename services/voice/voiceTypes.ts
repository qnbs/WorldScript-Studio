/**
 * Core type definitions for the Voice Full Support subsystem.
 * QNBS-v3: All engines are abstracted behind interfaces for graceful degradation.
 */

import type { VoiceFeedbackLevel, VoiceSttEngine, VoiceTtsEngine } from '../../types';

// ── Audio ────────────────────────────────────────────────────────────────────

export interface AudioChunk {
  /** Mono PCM16 data at 16kHz */
  buffer: Int16Array;
  /** Duration in milliseconds */
  durationMs: number;
  /** Whether VAD detected speech in this chunk */
  hasSpeech: boolean;
  /** Timestamp when chunk was captured */
  capturedAt: number;
}

export interface AudioStreamConfig {
  sampleRate: number;
  channelCount: number;
  bufferSize: number;
}

export const DEFAULT_AUDIO_CONFIG: AudioStreamConfig = {
  sampleRate: 16000,
  channelCount: 1,
  bufferSize: 4096,
};

// ── STT Engine ───────────────────────────────────────────────────────────────

export interface SttResult {
  transcript: string;
  isFinal: boolean;
  confidence: number;
  language?: string;
}

export interface SttEngine {
  readonly id: VoiceSttEngine;
  readonly name: string;
  readonly isLocal: boolean;
  readonly supportsStreaming: boolean;
  /** Check if engine can run in current environment */
  isAvailable(): Promise<boolean>;
  /** Initialize engine (download models, etc.) */
  initialize(): Promise<void>;
  /** Start listening; callbacks receive results */
  start(onResult: (result: SttResult) => void, onError: (error: Error) => void): Promise<void>;
  /** Stop listening */
  stop(): Promise<void>;
  /** Dispose engine resources */
  dispose(): Promise<void>;
}

// ── TTS Engine ───────────────────────────────────────────────────────────────

export interface TtsUtterance {
  text: string;
  rate?: number;
  volume?: number;
  pitch?: number;
  language?: string;
}

export interface TtsEngine {
  readonly id: VoiceTtsEngine;
  readonly name: string;
  readonly isLocal: boolean;
  isAvailable(): Promise<boolean>;
  initialize(): Promise<void>;
  speak(utterance: TtsUtterance): Promise<void>;
  cancel(): void;
  pause(): void;
  resume(): void;
  dispose(): Promise<void>;
}

// ── VAD Engine ───────────────────────────────────────────────────────────────

export interface VadSegment {
  startMs: number;
  endMs: number;
  isSpeech: boolean;
}

export interface VadEngine {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  initialize(): Promise<void>;
  /** QNBS-v3: async to support ONNX-based VAD (Silero). */
  processChunk(chunk: AudioChunk): Promise<VadSegment | null>;
  dispose(): Promise<void>;
}

// ── Wake-Word Engine ─────────────────────────────────────────────────────────

export interface WakeWordEngine {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  initialize(): Promise<void>;
  /** Process audio; returns true if wake word detected */
  processChunk(chunk: AudioChunk): Promise<boolean>;
  /** Set wake-word phrase (if supported) */
  setPhrase?(phrase: string): void;
  dispose(): Promise<void>;
}

// ── Intent Engine ────────────────────────────────────────────────────────────

export interface IntentSlot {
  name: string;
  value: string;
}

export interface ParsedIntent {
  /** Matched command id */
  commandId: string;
  /** Raw confidence score 0-1 */
  confidence: number;
  /** Extracted slot values */
  slots: IntentSlot[];
  /** Original transcript */
  transcript: string;
}

export interface IntentEngine {
  readonly name: string;
  initialize(): Promise<void>;
  /** Parse transcript into intent; returns null if no match */
  parse(transcript: string, context: IntentContext): ParsedIntent | null;
  /** Register or update available commands */
  registerCommands(commands: VoiceCommandDefinition[]): void;
}

export interface IntentContext {
  /** Current application view */
  currentView: string;
  /** Currently selected entity ids */
  selectedIds: string[];
  /** Current project character names for slot matching */
  characterNames: string[];
  /** Current project scene/section titles for slot matching */
  sectionTitles: string[];
  /** Current project world names for slot matching */
  worldNames: string[];
  /** Last executed command id */
  lastCommandId: string | null;
}

// ── Voice Command Definition ─────────────────────────────────────────────────

export interface VoiceCommandDefinition {
  id: string;
  /** Natural language templates for matching, e.g. "open {view}" */
  templates: string[];
  /** Additional keywords for fuzzy matching */
  keywords: string[];
  /** Whether this command supports dictation context */
  supportsDictation: boolean;
  /** Required view context; empty = any view */
  requiredViews: string[];
}

// ── Feedback ─────────────────────────────────────────────────────────────────

export interface FeedbackEvent {
  message: string;
  level: VoiceFeedbackLevel;
  /** If true, only shows visually (no TTS) */
  visualOnly?: boolean;
  /** Priority for screen readers */
  priority?: 'polite' | 'assertive';
}

// ── Voice Service Events ─────────────────────────────────────────────────────

export type VoiceEventType =
  | 'listening-started'
  | 'listening-stopped'
  | 'transcript-received'
  | 'intent-recognized'
  | 'command-executed'
  | 'command-failed'
  | 'feedback-spoken'
  | 'error'
  | 'dictation-started'
  | 'dictation-stopped';

export interface VoiceEvent {
  type: VoiceEventType;
  payload?: unknown;
  timestamp: number;
}

export type VoiceEventListener = (event: VoiceEvent) => void;
