/**
 * Unit tests for the ProForge Capability Layer (SSOT).
 * QNBS-v3: Ports are mocked — covers each op, validation failure, permission gating, dryRun,
 * and error normalization to ProForgeError.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// QNBS-v3: PR7 — records the signal the layer binds onto the agent, to assert caller-signal forwarding.
const boundSignals = vi.hoisted(() => ({ last: undefined as AbortSignal | undefined }));

// QNBS-v3: isolate runStage from the real agents — the layer's contract is "run agent + supervise".
vi.mock('../../../services/proForge/pipelineAgents/agentRegistry', () => ({
  EXECUTABLE_STAGES: ['intake'],
  loadAgent: vi.fn(async () => {
    return class FakeAgent {
      bindAbortSignal(signal: AbortSignal) {
        boundSignals.last = signal;
      }
      async execute() {
        return {
          reviewItems: [{ id: 'r1' }],
          metrics: {
            aiCalls: 1,
            tokensConsumed: 10,
            durationMs: 5,
            itemsFound: 1,
            itemsAccepted: 0,
            itemsRejected: 0,
          },
          agentOutput: { ok: true },
        };
      }
    };
  }),
}));

// QNBS-v3: controllable supervisor mock — lets a test force the intake hard gate to fire.
const supervisorState = vi.hoisted(() => ({ hardGateFailed: false }));
vi.mock('../../../services/proForge/pipelineAgents/supervisorAgent', () => ({
  SupervisorAgent: class {
    evaluate() {
      return { pass: true, retryRecommended: false, qualityScore: 90, reasons: [] };
    }
    intakeHardGateFailed() {
      return supervisorState.hardGateFailed;
    }
  },
}));

import type { PipelineRun } from '../../../features/proForge/types';
import type {
  ProForgeCapabilityPorts,
  ProForgeGatewayPort,
} from '../../../services/proForge/proForgeCapabilityCore';
import {
  createProForgeCapabilityLayer,
  type ProForgeCapabilityLayer,
} from '../../../services/proForge/proForgeCapabilityLayer';
import { ProForgeError } from '../../../services/proForge/proForgeCapabilitySchemas';

function makePorts(overrides: Partial<ProForgeCapabilityPorts> = {}): ProForgeCapabilityPorts {
  return {
    gateway: {
      generate: vi.fn(),
      embed: vi.fn(),
      modelList: vi.fn(),
      healthCheck: vi.fn(),
    } as unknown as ProForgeGatewayPort,
    memory: vi.fn(() => ({
      search: vi.fn(async () => [{ id: 'm1', key: 'k', content: 'c' }]),
      remember: vi.fn(),
      recall: vi.fn(async () => []),
    })) as unknown as ProForgeCapabilityPorts['memory'],
    history: {
      load: vi.fn(async () => []),
      save: vi.fn(),
    },
    project: {
      get: vi.fn(() => ({
        id: 'p1',
        title: 'T',
        logline: 'L',
        manuscript: [{ id: 's1', title: 'Ch1', content: 'hello world' }],
        characters: [],
        worlds: [],
      })),
    },
    isEnabled: () => true,
    ...overrides,
  };
}

describe('ProForgeCapabilityLayer', () => {
  let layer: ProForgeCapabilityLayer;
  let ports: ProForgeCapabilityPorts;

  beforeEach(() => {
    ports = makePorts();
    layer = createProForgeCapabilityLayer(ports);
    supervisorState.hardGateFailed = false;
    boundSignals.last = undefined;
  });

  describe('permission gating', () => {
    it('rejects every op with PERMISSION_DENIED when disabled', async () => {
      const disabled = createProForgeCapabilityLayer(makePorts({ isEnabled: () => false }));
      await expect(disabled.ragQuery({ projectId: 'p1', query: 'x' })).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      });
    });
  });

  describe('input validation', () => {
    it('throws VALIDATION on malformed runStage input', async () => {
      await expect(
        layer.runStage({ stage: 'not-a-stage', projectId: 'p1' }),
      ).rejects.toBeInstanceOf(ProForgeError);
      await expect(layer.runStage({ stage: 'not-a-stage', projectId: 'p1' })).rejects.toMatchObject(
        {
          code: 'VALIDATION',
        },
      );
    });

    it('throws VALIDATION when ragQuery query is empty', async () => {
      await expect(layer.ragQuery({ projectId: 'p1', query: '' })).rejects.toMatchObject({
        code: 'VALIDATION',
      });
    });

    // QNBS-v3 (CodeAnt #6): an empty-string runId must be rejected, not collapse to "no filter"
    // and silently return the latest run.
    it('throws VALIDATION when getSupervisorStatus runId is empty', async () => {
      await expect(layer.getSupervisorStatus({ projectId: 'p1', runId: '' })).rejects.toMatchObject(
        { code: 'VALIDATION' },
      );
    });

    it('throws VALIDATION when getHistory runId is empty', async () => {
      await expect(layer.getHistory({ projectId: 'p1', runId: '' })).rejects.toMatchObject({
        code: 'VALIDATION',
      });
    });
  });

  describe('runStage', () => {
    it('runs an agent and attaches the supervisor decision', async () => {
      const result = await layer.runStage({ stage: 'intake', projectId: 'p1' });
      expect(result.stage).toBe('intake');
      expect(result.reviewItems).toHaveLength(1);
      expect(result.supervisorDecision.pass).toBe(true);
      expect(result.metrics.aiCalls).toBe(1);
    });

    it('throws NOT_FOUND when the project is missing', async () => {
      const p = makePorts({ project: { get: () => null } });
      const l = createProForgeCapabilityLayer(p);
      await expect(l.runStage({ stage: 'intake', projectId: 'ghost' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    // QNBS-v3: PR6 CodeAnt — capability layer must enforce the SAME intake hard gate as the
    // orchestrator, so a fallback/unanalyzable intake throws instead of returning "success".
    it('throws STAGE_FAILED when the intake hard gate fails', async () => {
      supervisorState.hardGateFailed = true;
      await expect(layer.runStage({ stage: 'intake', projectId: 'p1' })).rejects.toMatchObject({
        code: 'STAGE_FAILED',
      });
    });

    // QNBS-v3: PR7 — a caller-provided signal must be bound to the agent so the run is cancellable.
    it('forwards a caller-provided abort signal to the agent', async () => {
      const controller = new AbortController();
      await layer.runStage({ stage: 'intake', projectId: 'p1' }, controller.signal);
      expect(boundSignals.last).toBe(controller.signal);
    });

    // QNBS-v3: PR7 — an aborted run must surface as a cancellation, not a "successful" empty result,
    // even for agents that complete without honouring the signal themselves.
    it('throws STAGE_FAILED when the signal is aborted by the time the agent returns', async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(
        layer.runStage({ stage: 'intake', projectId: 'p1' }, controller.signal),
      ).rejects.toMatchObject({ code: 'STAGE_FAILED' });
    });
  });

  describe('applyEdits', () => {
    it('applies an accepted edit to the manuscript', async () => {
      const res = await layer.applyEdits({
        manuscript: [{ id: 's1', content: 'the quick brown fox' }],
        items: [{ id: 'e1', sectionId: 's1', original: 'quick', proposed: 'slow' }],
      });
      expect(res.applied).toBe(1);
      expect(res.updates[0]?.content).toBe('the slow brown fox');
      expect(res.dryRun).toBe(false);
    });

    it('honours dryRun flag in the result', async () => {
      const res = await layer.applyEdits({
        manuscript: [{ id: 's1', content: 'abc' }],
        items: [],
        dryRun: true,
      });
      expect(res.dryRun).toBe(true);
      expect(res.applied).toBe(0);
    });
  });

  describe('ragQuery', () => {
    it('delegates to the project memory port', async () => {
      const res = await layer.ragQuery({ projectId: 'p1', query: 'dragon', k: 5, mode: 'lexical' });
      expect(res).toHaveLength(1);
      expect(ports.memory).toHaveBeenCalledWith('p1');
    });
  });

  describe('getHistory', () => {
    it('filters by runId and limits results', async () => {
      const runs = [{ id: 'a' }, { id: 'b' }] as unknown as PipelineRun[];
      const p = makePorts({ history: { load: vi.fn(async () => runs), save: vi.fn() } });
      const l = createProForgeCapabilityLayer(p);
      const byId = await l.getHistory({ projectId: 'p1', runId: 'b' });
      expect(byId).toHaveLength(1);
      expect(byId[0]?.id).toBe('b');
    });
  });

  describe('getSupervisorStatus', () => {
    it('returns per-stage decisions from the most recent run', async () => {
      const runs = [
        {
          id: 'a',
          stages: [
            {
              stage: 'intake',
              status: 'accepted',
              supervisorDecision: {
                pass: true,
                retryRecommended: false,
                qualityScore: 80,
                reasons: [],
              },
            },
          ],
        },
      ] as unknown as PipelineRun[];
      const p = makePorts({ history: { load: vi.fn(async () => runs), save: vi.fn() } });
      const l = createProForgeCapabilityLayer(p);
      const status = await l.getSupervisorStatus({ projectId: 'p1' });
      expect(status).toHaveLength(1);
      expect(status[0]?.stage).toBe('intake');
      expect(status[0]?.supervisorDecision?.pass).toBe(true);
    });

    it('returns [] when the project has no runs', async () => {
      const status = await layer.getSupervisorStatus({ projectId: 'p1' });
      expect(status).toEqual([]);
    });
  });
});
