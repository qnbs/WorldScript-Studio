/**
 * Wake-Word Engine implementations.
 * QNBS-v3: Energy-threshold + phrase matching fallback; Sherpa-ONNX in future phase.
 */

import { logger } from '../logger';
import type { AudioChunk, WakeWordEngine } from './voiceTypes';

// ── Energy Threshold + Phrase Fallback ───────────────────────────────────────

export class EnergyThresholdWakeWordEngine implements WakeWordEngine {
  readonly name = 'Energy Threshold Wake-Word';

  private phrase = 'hey worldscript';
  private recentTranscripts: string[] = [];
  private maxRecent = 5;

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  async initialize(): Promise<void> {
    this.recentTranscripts = [];
  }

  setPhrase(phrase: string): void {
    this.phrase = phrase.toLowerCase().trim();
  }

  async processChunk(_chunk: AudioChunk): Promise<boolean> {
    // QNBS-v3: This fallback engine does not process raw audio.
    // It relies on the STT engine to provide transcripts and checks them.
    // In Phase 2, Sherpa-ONNX will process raw audio directly.
    return false;
  }

  /** Check a transcript for wake-word presence (called by orchestrator) */
  checkTranscript(transcript: string): boolean {
    const cleaned = transcript.toLowerCase().trim();
    this.recentTranscripts.push(cleaned);
    if (this.recentTranscripts.length > this.maxRecent) {
      this.recentTranscripts.shift();
    }

    const normalizedPhrase = this.phrase.toLowerCase().trim();
    // Allow fuzzy matching: phrase must be contained
    return cleaned.includes(normalizedPhrase);
  }

  async dispose(): Promise<void> {
    this.recentTranscripts = [];
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

export async function createWakeWordEngine(phrase?: string): Promise<WakeWordEngine> {
  const engine = new EnergyThresholdWakeWordEngine();
  if (phrase) {
    engine.setPhrase(phrase);
  }
  if (await engine.isAvailable()) {
    logger.info(`Wake-word engine selected: ${engine.name}`);
    return engine;
  }
  throw new Error('No wake-word engine available');
}
