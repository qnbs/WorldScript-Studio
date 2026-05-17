import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { electSingleHeavyInferenceTab } from '../../packages/ai-core/src/tabLeaderElection';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAddEventListener = vi.fn();
const mockRemoveEventListener = vi.fn();
const mockPostMessage = vi.fn();
const mockClose = vi.fn();

class MockBroadcastChannel {
  addEventListener = mockAddEventListener;
  removeEventListener = mockRemoveEventListener;
  postMessage = mockPostMessage;
  close = mockClose;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('electSingleHeavyInferenceTab', () => {
  it('returns true when window is undefined (SSR)', async () => {
    vi.stubGlobal('window', undefined);
    const result = await electSingleHeavyInferenceTab();
    expect(result).toBe(true);
  });

  it('returns true when BroadcastChannel is undefined', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const result = await electSingleHeavyInferenceTab();
    expect(result).toBe(true);
  });

  it('broadcasts a ping message on startup', async () => {
    const electionPromise = electSingleHeavyInferenceTab(50);
    vi.advanceTimersByTime(50);
    await electionPromise;
    expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ping' }));
  });

  it('closes the channel after the timeout', async () => {
    const electionPromise = electSingleHeavyInferenceTab(100);
    vi.advanceTimersByTime(100);
    await electionPromise;
    expect(mockClose).toHaveBeenCalled();
  });

  it('removes event listener after timeout', async () => {
    const electionPromise = electSingleHeavyInferenceTab(80);
    vi.advanceTimersByTime(80);
    await electionPromise;
    expect(mockRemoveEventListener).toHaveBeenCalled();
  });

  it('resolves to a boolean', async () => {
    const electionPromise = electSingleHeavyInferenceTab(60);
    vi.advanceTimersByTime(60);
    const result = await electionPromise;
    expect(typeof result).toBe('boolean');
  });
});
