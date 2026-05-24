/**
 * Voice Feedback Service — intelligent, context-aware, non-intrusive.
 * QNBS-v3: Orchestrates TTS output based on user feedback level and app state.
 */

import type { VoiceFeedbackLevel } from '../../types';
import { logger } from '../logger';
import type {
  FeedbackEvent,
  TtsEngine,
  TtsUtterance,
  VoiceEvent,
  VoiceEventListener,
} from './voiceTypes';

export class FeedbackService {
  private ttsEngine: TtsEngine | null = null;
  private feedbackLevel: VoiceFeedbackLevel = 'standard';
  private ttsMuted = false;
  private listeners: VoiceEventListener[] = [];
  private feedbackQueue: FeedbackEvent[] = [];
  private isSpeaking = false;

  constructor(ttsEngine?: TtsEngine) {
    if (ttsEngine) {
      this.ttsEngine = ttsEngine;
    }
  }

  setTtsEngine(engine: TtsEngine): void {
    this.ttsEngine = engine;
  }

  setFeedbackLevel(level: VoiceFeedbackLevel): void {
    this.feedbackLevel = level;
  }

  setMuted(muted: boolean): void {
    this.ttsMuted = muted;
    if (muted) {
      this.ttsEngine?.cancel();
      this.isSpeaking = false;
      this.feedbackQueue = [];
    }
  }

  addEventListener(listener: VoiceEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emit(event: VoiceEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        logger.warn('Voice event listener error:', err);
      }
    }
  }

  /**
   * Provide feedback for an event.
   * Respects feedback level: minimal only speaks errors, standard speaks actions,
   * verbose speaks everything including confirmations.
   */
  async feedback(event: FeedbackEvent): Promise<void> {
    // Always emit event for UI listeners (visual feedback)
    this.emit({ type: 'feedback-spoken', payload: event, timestamp: Date.now() });

    if (this.ttsMuted || !this.ttsEngine) return;

    // Filter by level
    if (this.feedbackLevel === 'minimal' && event.level !== 'minimal') {
      return;
    }

    if (event.visualOnly) return;

    this.feedbackQueue.push(event);
    await this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.isSpeaking || this.feedbackQueue.length === 0) return;

    this.isSpeaking = true;
    const event = this.feedbackQueue.shift()!;

    try {
      const utterance: TtsUtterance = {
        text: event.message,
        rate: 1.0,
        volume: 0.8,
      };
      await this.ttsEngine!.speak(utterance);
    } catch (err) {
      logger.warn('TTS feedback failed:', err);
    } finally {
      this.isSpeaking = false;
      // Process next if any
      if (this.feedbackQueue.length > 0) {
        void this.processQueue();
      }
    }
  }

  /** Quick confirmation feedback */
  async confirm(action: string): Promise<void> {
    await this.feedback({ message: action, level: 'standard', priority: 'polite' });
  }

  /** Error feedback */
  async error(message: string): Promise<void> {
    await this.feedback({ message, level: 'minimal', priority: 'assertive' });
  }

  /** Help/verbose feedback */
  async info(message: string): Promise<void> {
    await this.feedback({ message, level: 'verbose', priority: 'polite' });
  }

  cancel(): void {
    this.ttsEngine?.cancel();
    this.isSpeaking = false;
    this.feedbackQueue = [];
  }
}
