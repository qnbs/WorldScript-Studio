import { describe, expect, it, vi } from 'vitest';
import { FeedbackService } from '../../../services/voice/feedbackService';
import type { TtsEngine, TtsUtterance } from '../../../services/voice/voiceTypes';

const mockTtsEngine: TtsEngine = {
  id: 'webSpeech',
  name: 'Mock TTS',
  isLocal: true,
  isAvailable: () => Promise.resolve(true),
  initialize: () => Promise.resolve(),
  speak: (_utterance: TtsUtterance) => Promise.resolve(),
  cancel: () => {},
  pause: () => {},
  resume: () => {},
  dispose: () => Promise.resolve(),
};

describe('FeedbackService', () => {
  it('emits visual events without TTS when muted', async () => {
    const svc = new FeedbackService(mockTtsEngine);
    svc.setMuted(true);

    const listener = vi.fn();
    svc.addEventListener(listener);

    await svc.feedback({ message: 'Test', level: 'standard' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0].type).toBe('feedback-spoken');
  });

  it('queues feedback and speaks via TTS', async () => {
    const speakSpy = vi.spyOn(mockTtsEngine, 'speak').mockResolvedValue(undefined);
    const svc = new FeedbackService(mockTtsEngine);

    await svc.feedback({ message: 'Hello', level: 'standard' });

    expect(speakSpy).toHaveBeenCalledWith(expect.objectContaining({ text: 'Hello' }));
  });

  it('filters by feedback level', async () => {
    const speakSpy = vi.spyOn(mockTtsEngine, 'speak').mockResolvedValue(undefined);
    const svc = new FeedbackService(mockTtsEngine);
    svc.setFeedbackLevel('minimal');

    await svc.feedback({ message: 'Info', level: 'verbose' });
    expect(speakSpy).not.toHaveBeenCalled();

    await svc.feedback({ message: 'Error', level: 'minimal' });
    expect(speakSpy).toHaveBeenCalledTimes(1);
  });

  it('cancels queued feedback', () => {
    const cancelSpy = vi.spyOn(mockTtsEngine, 'cancel');
    const svc = new FeedbackService(mockTtsEngine);
    svc.cancel();
    expect(cancelSpy).toHaveBeenCalled();
  });
});
