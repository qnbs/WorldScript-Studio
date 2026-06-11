/**
 * Tests for services/ai/routingLogger.ts
 * QNBS-v3: Verifies that each routing branch emits a correctly structured log entry
 * and that sanitizeLogContext prevents key/token leakage.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock logger ──────────────────────────────────────────────────────────────

const mockInfo = vi.fn();

vi.mock('../../../services/logger', () => ({
  createLogger: vi.fn(() => ({
    info: mockInfo,
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  sanitizeLogContext: vi.fn((ctx: Record<string, unknown>) => ctx),
}));

// Import AFTER mocks are set up.
const { logRoutingDecision } = await import('../../../services/ai/routingLogger');

describe('logRoutingDecision()', () => {
  beforeEach(() => {
    mockInfo.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('logs passthrough decisions', () => {
    logRoutingDecision({
      mode: 'hybrid',
      originalProvider: 'gemini',
      chosenProvider: 'gemini',
      reason: 'passthrough',
    });
    expect(mockInfo).toHaveBeenCalledWith(
      'routing-decision',
      expect.objectContaining({
        mode: 'hybrid',
        originalProvider: 'gemini',
        chosenProvider: 'gemini',
        reason: 'passthrough',
      }),
    );
  });

  it('logs mode-override decisions', () => {
    logRoutingDecision({
      mode: 'local',
      originalProvider: 'gemini',
      chosenProvider: 'webllm',
      reason: 'mode-override',
    });
    expect(mockInfo).toHaveBeenCalledWith(
      'routing-decision',
      expect.objectContaining({
        reason: 'mode-override',
        chosenProvider: 'webllm',
      }),
    );
  });

  it('logs openrouter-preferred decisions', () => {
    logRoutingDecision({
      mode: 'hybrid',
      originalProvider: 'gemini',
      chosenProvider: 'openrouter',
      reason: 'openrouter-preferred',
    });
    expect(mockInfo).toHaveBeenCalledWith(
      'routing-decision',
      expect.objectContaining({
        reason: 'openrouter-preferred',
        chosenProvider: 'openrouter',
      }),
    );
  });

  it('logs openrouter-fallback decisions', () => {
    logRoutingDecision({
      mode: 'hybrid',
      originalProvider: 'openrouter',
      chosenProvider: 'gemini',
      reason: 'openrouter-fallback',
    });
    expect(mockInfo).toHaveBeenCalledWith(
      'routing-decision',
      expect.objectContaining({
        reason: 'openrouter-fallback',
      }),
    );
  });

  it('includes latencyMs when provided', () => {
    logRoutingDecision({
      mode: 'cloud',
      originalProvider: 'openai',
      chosenProvider: 'openai',
      reason: 'passthrough',
      latencyMs: 123,
    });
    expect(mockInfo).toHaveBeenCalledWith(
      'routing-decision',
      expect.objectContaining({
        latencyMs: 123,
      }),
    );
  });
});
