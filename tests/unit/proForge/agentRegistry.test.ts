/**
 * Tests for services/proForge/pipelineAgents/agentRegistry.ts — the single stage→agent resolver
 * shared by the orchestrator and the Core Capability Layer.
 * QNBS-v3: verifies the executable-stage list and that loadAgent lazily resolves each stage's agent
 * class (and throws for control-only / unknown stages).
 */

import { describe, expect, it } from 'vitest';

import type { PipelineStage } from '../../../features/proForge/types';
import {
  EXECUTABLE_STAGES,
  loadAgent,
} from '../../../services/proForge/pipelineAgents/agentRegistry';

describe('EXECUTABLE_STAGES', () => {
  it('lists the 8 pipeline stages in order, excluding control states', () => {
    expect(EXECUTABLE_STAGES).toEqual([
      'intake',
      'structural',
      'lineProse',
      'copyEdit',
      'proof',
      'production',
      'publishing',
      'analytics',
    ]);
  });

  it('does not include the idle/archived control states', () => {
    expect(EXECUTABLE_STAGES).not.toContain('idle' as PipelineStage);
    expect(EXECUTABLE_STAGES).not.toContain('archived' as PipelineStage);
  });
});

describe('loadAgent', () => {
  it.each(EXECUTABLE_STAGES)('resolves a constructable agent class for "%s"', async (stage) => {
    const Agent = await loadAgent(stage);
    expect(typeof Agent).toBe('function');
    // Each stage agent extends BaseAgent → its constructor has a non-zero name.
    expect(Agent.name.length).toBeGreaterThan(0);
  });

  it('maps intake → DiagnosticAgent and analytics → AnalyticsAgent', async () => {
    expect((await loadAgent('intake')).name).toBe('DiagnosticAgent');
    expect((await loadAgent('analytics')).name).toBe('AnalyticsAgent');
  });

  it('throws for a control-only stage (idle)', async () => {
    await expect(loadAgent('idle' as PipelineStage)).rejects.toThrow(/No agent registered/);
  });

  it('throws for an unknown stage', async () => {
    await expect(loadAgent('bogus' as PipelineStage)).rejects.toThrow(/No agent registered/);
  });
});
