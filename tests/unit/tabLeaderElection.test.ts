import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  electSingleHeavyInferenceTab,
  surrenderLeadership,
} from '../../packages/ai-core/src/tabLeaderElection';

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

const HEARTBEAT_KEY = 'worldscript-ai-leader-heartbeat';

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
  localStorage.clear();
});

afterEach(() => {
  // QNBS-v3: Always surrender to clear heartbeat timer between tests.
  surrenderLeadership();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
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

  it('returns false without broadcasting when another tab has a fresh heartbeat', async () => {
    // QNBS-v3: Fast-path: if a recent leader heartbeat exists, skip election entirely.
    const now = Date.now();
    localStorage.setItem(HEARTBEAT_KEY, JSON.stringify({ id: 'other-tab-abc', ts: now }));

    const result = await electSingleHeavyInferenceTab(1000);
    expect(result).toBe(false);
    // No BroadcastChannel traffic — the fast-path short-circuits before opening the channel.
    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it('proceeds with election when existing heartbeat is stale', async () => {
    // QNBS-v3: Stale = older than HEARTBEAT_STALE_MS (12 000 ms).
    const staleTs = Date.now() - 15_000;
    localStorage.setItem(HEARTBEAT_KEY, JSON.stringify({ id: 'old-tab', ts: staleTs }));

    const electionPromise = electSingleHeavyInferenceTab(50);
    vi.advanceTimersByTime(50);
    await electionPromise;

    expect(mockPostMessage).toHaveBeenCalled();
  });

  it('writes a heartbeat to localStorage after winning', async () => {
    const electionPromise = electSingleHeavyInferenceTab(50);
    vi.advanceTimersByTime(50);
    const isLeader = await electionPromise;

    expect(isLeader).toBe(true);
    const stored = localStorage.getItem(HEARTBEAT_KEY);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored as string) as { id: string; ts: number };
    expect(typeof parsed.id).toBe('string');
    expect(typeof parsed.ts).toBe('number');
  });
});

describe('surrenderLeadership', () => {
  it('is a no-op when no leadership was won', () => {
    // Should not throw even if called without a prior election win.
    expect(() => surrenderLeadership()).not.toThrow();
  });

  it('clears the heartbeat from localStorage after winning', async () => {
    const electionPromise = electSingleHeavyInferenceTab(50);
    vi.advanceTimersByTime(50);
    const isLeader = await electionPromise;
    expect(isLeader).toBe(true);

    expect(localStorage.getItem(HEARTBEAT_KEY)).not.toBeNull();

    surrenderLeadership();

    expect(localStorage.getItem(HEARTBEAT_KEY)).toBeNull();
  });

  it('does not remove heartbeat written by another leader', async () => {
    // Simulate another tab's heartbeat already in localStorage.
    localStorage.setItem(HEARTBEAT_KEY, JSON.stringify({ id: 'other-tab-xyz', ts: Date.now() }));

    // We never won leadership (fast-path returned false), so surrenderLeadership is a no-op.
    surrenderLeadership();

    // The other tab's heartbeat should be untouched.
    expect(localStorage.getItem(HEARTBEAT_KEY)).not.toBeNull();
  });
});
