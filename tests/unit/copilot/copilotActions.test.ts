import { describe, expect, it, vi } from 'vitest';
import {
  detectCopilotIntent,
  runCopilotDiagnostic,
} from '../../../services/copilot/copilotActions';
import type { ProForgeCapabilityLayer } from '../../../services/proForge/proForgeCapabilityLayer';

describe('detectCopilotIntent', () => {
  it('detects diagnostic intent', () => {
    expect(detectCopilotIntent('run a quick diagnostic on my manuscript')).toBe('diagnostic');
    expect(detectCopilotIntent('what is my quality score?')).toBe('diagnostic');
    expect(detectCopilotIntent('analyze my story')).toBe('diagnostic');
  });

  it('detects explain-view intent', () => {
    expect(detectCopilotIntent('what can I do here?')).toBe('explainView');
  });

  it('returns null for general chat', () => {
    expect(detectCopilotIntent('write me a sentence about a dragon')).toBeNull();
  });
});

describe('runCopilotDiagnostic', () => {
  function mockCapability(runStage: ProForgeCapabilityLayer['runStage']): ProForgeCapabilityLayer {
    return { runStage } as unknown as ProForgeCapabilityLayer;
  }

  const zeroMetrics = {
    aiCalls: 1,
    tokensConsumed: 1,
    durationMs: 1,
    itemsFound: 0,
    itemsAccepted: 0,
    itemsRejected: 0,
  };

  it('extracts score + summary from a successful intake run', async () => {
    const cap = mockCapability(
      vi.fn(async () => ({
        stage: 'intake' as const,
        reviewItems: [],
        metrics: zeroMetrics,
        agentOutput: {
          qualityScore: { overall: 72 },
          summary: 'Solid draft.',
          isFallback: false,
        },
        supervisorDecision: { pass: true, retryRecommended: false, qualityScore: 72, reasons: [] },
      })),
    );
    const res = await runCopilotDiagnostic(cap, 'p1');
    expect(res).toEqual({ score: 72, summary: 'Solid draft.' });
  });

  it('returns null on a fallback report', async () => {
    const cap = mockCapability(
      vi.fn(async () => ({
        stage: 'intake' as const,
        reviewItems: [],
        metrics: zeroMetrics,
        agentOutput: { isFallback: true, qualityScore: { overall: 0 }, summary: '' },
        supervisorDecision: { pass: false, retryRecommended: true, qualityScore: 0, reasons: [] },
      })),
    );
    expect(await runCopilotDiagnostic(cap, 'p1')).toBeNull();
  });

  it('returns null when runStage throws', async () => {
    const cap = mockCapability(
      vi.fn(async () => {
        throw new Error('no ai');
      }),
    );
    expect(await runCopilotDiagnostic(cap, 'p1')).toBeNull();
  });
});
