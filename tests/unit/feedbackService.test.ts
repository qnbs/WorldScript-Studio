import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedbackService } from '../../services/voice/feedbackService';
import type { FeedbackEvent, TtsEngine, TtsUtterance, VoiceEvent } from '../../services/voice/voiceTypes';

function makeMockTts(): TtsEngine {
  return {
    id: 'mock-tts',
    name: 'Mock TTS',
    isLocal: true,
    speak: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn(),
  };
}

describe('FeedbackService', () => {
  let service: FeedbackService;
  let mockTts: TtsEngine;

  beforeEach(() => {
    mockTts = makeMockTts();
    service = new FeedbackService(mockTts);
  });

  // ── Basic setup ──────────────────────────────────────────────────────────

  it('constructs without engine', () => {
    const s = new FeedbackService();
    expect(s).toBeDefined();
  });

  it('sets TTS engine after construction', () => {
    const s = new FeedbackService();
    s.setTtsEngine(mockTts);
    // Should be able to speak after setting engine
    expect(() => s.confirm('test')).not.toThrow();
  });

  it('sets feedback level', () => {
    service.setFeedbackLevel('minimal');
    expect(() => service.confirm('test')).not.toThrow();
  });

  // ── Event listeners ──────────────────────────────────────────────────────

  it('adds and removes event listeners', () => {
    const listener = vi.fn();
    const unsubscribe = service.addEventListener(listener);
    service.confirm('action');
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    service.confirm('action2');
    // Listener should not be called again after unsubscribe
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('survives listener exceptions', async () => {
    const badListener = vi.fn().mockImplementation(() => {
      throw new Error('boom');
    });
    const goodListener = vi.fn();
    service.addEventListener(badListener);
    service.addEventListener(goodListener);
    await service.confirm('action');
    expect(goodListener).toHaveBeenCalled();
  });

  // ── Feedback levels ──────────────────────────────────────────────────────

  it('speaks standard feedback at standard level', async () => {
    service.setFeedbackLevel('standard');
    await service.feedback({ message: 'Hello', level: 'standard', priority: 'polite' });
    expect(mockTts.speak).toHaveBeenCalledOnce();
  });

  it('skips non-minimal feedback at minimal level', async () => {
    service.setFeedbackLevel('minimal');
    await service.feedback({ message: 'Hello', level: 'standard', priority: 'polite' });
    expect(mockTts.speak).not.toHaveBeenCalled();
  });

  it('speaks minimal feedback at minimal level', async () => {
    service.setFeedbackLevel('minimal');
    await service.feedback({ message: 'Error', level: 'minimal', priority: 'assertive' });
    expect(mockTts.speak).toHaveBeenCalledOnce();
  });

  it('speaks everything at verbose level', async () => {
    service.setFeedbackLevel('verbose');
    await service.feedback({ message: 'Info', level: 'verbose', priority: 'polite' });
    expect(mockTts.speak).toHaveBeenCalledOnce();
  });

  // ── Muting ───────────────────────────────────────────────────────────────

  it('skips TTS when muted', async () => {
    service.setMuted(true);
    await service.confirm('action');
    expect(mockTts.speak).not.toHaveBeenCalled();
  });

  it('cancels current speech when muted', () => {
    service.setMuted(true);
    expect(mockTts.cancel).toHaveBeenCalled();
  });

  it('resumes speaking after unmuting', async () => {
    service.setMuted(true);
    service.setMuted(false);
    await service.confirm('action');
    expect(mockTts.speak).toHaveBeenCalledOnce();
  });

  // ── Visual only ──────────────────────────────────────────────────────────

  it('skips TTS for visual-only events', async () => {
    await service.feedback({ message: 'Visual', level: 'standard', priority: 'polite', visualOnly: true });
    expect(mockTts.speak).not.toHaveBeenCalled();
  });

  it('still emits event for visual-only feedback', async () => {
    const listener = vi.fn();
    service.addEventListener(listener);
    await service.feedback({ message: 'Visual', level: 'standard', priority: 'polite', visualOnly: true });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'feedback-spoken' }),
    );
  });

  // ── Queue processing ─────────────────────────────────────────────────────

  it('processes feedback queue sequentially', async () => {
    await service.feedback({ message: 'First', level: 'standard', priority: 'polite' });
    await service.feedback({ message: 'Second', level: 'standard', priority: 'polite' });
    expect(mockTts.speak).toHaveBeenCalledTimes(2);
  });

  it('handles TTS speak failure gracefully', async () => {
    mockTts.speak = vi.fn().mockRejectedValue(new Error('TTS OOM'));
    await service.confirm('action');
    // Should not throw
    expect(mockTts.speak).toHaveBeenCalled();
  });

  // ── Convenience methods ──────────────────────────────────────────────────

  it('confirm sends standard level feedback', async () => {
    await service.confirm('Saved');
    expect(mockTts.speak).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Saved' }),
    );
  });

  it('error sends minimal level feedback', async () => {
    await service.error('Failed');
    expect(mockTts.speak).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Failed' }),
    );
  });

  it('info sends verbose level feedback', async () => {
    await service.info('Details');
    expect(mockTts.speak).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Details' }),
    );
  });

  // ── Cancel ───────────────────────────────────────────────────────────────

  it('cancels TTS and clears queue', () => {
    service.cancel();
    expect(mockTts.cancel).toHaveBeenCalled();
  });

  it('does not throw when canceling without engine', () => {
    const s = new FeedbackService();
    expect(() => s.cancel()).not.toThrow();
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  it('emits event even without TTS engine', async () => {
    const s = new FeedbackService();
    const listener = vi.fn();
    s.addEventListener(listener);
    await s.confirm('action');
    expect(listener).toHaveBeenCalled();
  });

  it('handles empty message', async () => {
    await service.feedback({ message: '', level: 'standard', priority: 'polite' });
    expect(mockTts.speak).toHaveBeenCalledWith(
      expect.objectContaining({ text: '' }),
    );
  });
});
