/**
 * Tests for SupervisorAgent — heuristic quality gate between ProForge pipeline stages.
 * QNBS-v3: No AI calls; pure logic over StageResult shapes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PipelineConfig } from '../../../../features/proForge/types';
import { SupervisorAgent } from '../../../../services/proForge/pipelineAgents/supervisorAgent';
import type { OrchestratorContext } from '../../../../services/proForge/proForgeOrchestrator';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: PipelineConfig = {
  genrePreset: 'general-fiction',
  selectedStages: ['intake', 'structural', 'proof'],
  aiProvider: 'gemini',
  ragMode: 'hybrid',
  maxTokens: 4000,
  creativity: 'Balanced',
  useDuckDb: false,
  autoAcceptThreshold: 0,
  language: 'en',
};

function makeSection(content: string) {
  return { id: 's1', title: 'Chapter 1', content, status: 'draft' as const, act: 1 };
}

function makeContext(manuscriptContent = 'Short text.'): OrchestratorContext {
  return {
    projectId: 'proj-test',
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    dispatch: vi.fn() as any,
    getState: vi.fn().mockReturnValue({
      project: {
        present: {
          data: {
            title: 'Test Novel',
            logline: 'A hero journey',
            manuscript: [makeSection(manuscriptContent)],
            characters: { ids: [], entities: {} },
            worlds: { ids: [], entities: {} },
            outline: [{ title: 'Act 1', description: 'Setup' }],
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: partial test state
    } as any),
    manuscript: [],
    characters: [],
    worlds: [],
    config: DEFAULT_CONFIG,
  };
}

const REAL_QUALITY_SCORE = {
  overall: 72,
  prose: 70,
  structure: 75,
  consistency: 68,
  pacing: 73,
  dialogue: 71,
  marketability: 77,
};

// Fallback sentinel: all 3 checked dimensions are exactly 50.
const FALLBACK_QUALITY_SCORE = {
  overall: 50,
  prose: 50,
  structure: 50,
  consistency: 50,
  pacing: 50,
  dialogue: 50,
  marketability: 50,
};

// ---------------------------------------------------------------------------
// Tests: evaluate() dispatch
// ---------------------------------------------------------------------------

describe('SupervisorAgent', () => {
  let agent: SupervisorAgent;

  beforeEach(() => {
    agent = new SupervisorAgent(makeContext());
  });

  describe('evaluate() — unknown/default stages', () => {
    it('passes with score 100 for stages without specific logic', () => {
      const result = agent.evaluate('lineProse', { reviewItems: [], agentOutput: undefined });
      expect(result.pass).toBe(true);
      expect(result.qualityScore).toBe(100);
      expect(result.reasons).toHaveLength(0);
    });

    it('passes for copyEdit stage', () => {
      const result = agent.evaluate('copyEdit', { reviewItems: [], agentOutput: undefined });
      expect(result.pass).toBe(true);
    });

    it('passes for publishing stage', () => {
      const result = agent.evaluate('publishing', { reviewItems: [], agentOutput: undefined });
      expect(result.pass).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Tests: intake stage
  // ---------------------------------------------------------------------------

  describe('evaluateIntake', () => {
    it('passes when report has real quality scores and issues', () => {
      const result = agent.evaluate('intake', {
        reviewItems: [],
        agentOutput: {
          qualityScore: REAL_QUALITY_SCORE,
          consistencyIssues: [{ id: 'ci-1' }],
          structuralGaps: [],
        },
      });
      expect(result.pass).toBe(true);
      expect(result.retryRecommended).toBe(false);
      expect(result.qualityScore).toBe(72);
    });

    it('fails and recommends retry when all 3 sentinel dimensions are 50', () => {
      const result = agent.evaluate('intake', {
        reviewItems: [],
        agentOutput: {
          qualityScore: FALLBACK_QUALITY_SCORE,
          consistencyIssues: [],
          structuralGaps: [],
        },
      });
      expect(result.pass).toBe(false);
      expect(result.retryRecommended).toBe(true);
      expect(result.qualityScore).toBe(0);
      expect(result.reasons.some((r) => r.includes('fallback'))).toBe(true);
    });

    it('does NOT treat partial 50-scores as fallback (only all-3-at-50 triggers)', () => {
      const result = agent.evaluate('intake', {
        reviewItems: [],
        agentOutput: {
          qualityScore: { ...REAL_QUALITY_SCORE, overall: 50 }, // only overall=50, prose≠50
          consistencyIssues: [{ id: 'ci-1' }],
          structuralGaps: [],
        },
      });
      // overall=50 but prose=70 → not a fallback sentinel
      expect(result.pass).toBe(true);
    });

    it('adds "no issues found" reason when no issues and not fallback', () => {
      const result = agent.evaluate('intake', {
        reviewItems: [],
        agentOutput: {
          qualityScore: REAL_QUALITY_SCORE,
          consistencyIssues: [],
          structuralGaps: [],
        },
      });
      // "no issues" warning is added but does NOT prevent pass
      expect(result.pass).toBe(true);
      expect(result.reasons.some((r) => r.includes('No issues found'))).toBe(true);
    });

    it('uses 50 as default qualityScore when agentOutput is undefined', () => {
      const result = agent.evaluate('intake', {
        reviewItems: [],
        agentOutput: undefined,
      });
      expect(result.qualityScore).toBe(50);
      // isFallback is false because qualityScore is undefined → pass
      expect(result.pass).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Tests: structural stage
  // ---------------------------------------------------------------------------

  describe('evaluateStructural', () => {
    it('passes with score 80 when edits are present', () => {
      const result = agent.evaluate('structural', {
        reviewItems: [],
        agentOutput: { edits: [{ id: 'e1' }] },
      });
      expect(result.pass).toBe(true);
      expect(result.qualityScore).toBe(80);
    });

    it('passes when no edits but reviewItems are present', () => {
      const result = agent.evaluate('structural', {
        reviewItems: [
          {
            id: 'ri-1',
            stage: 'structural' as const,
            type: 'structuralEdit',
            severity: 'info',
            description: 'Review this',
            status: 'pending',
            confidence: 0.8,
            createdAt: new Date().toISOString(),
          },
        ],
        agentOutput: { edits: [] },
      });
      expect(result.pass).toBe(true);
    });

    it('fails with retry for long manuscript with zero edits and no reviewItems', () => {
      // 1001+ words — build a long manuscript section
      const longContent = 'word '.repeat(1010).trim();
      const longAgent = new SupervisorAgent(makeContext(longContent));
      const result = longAgent.evaluate('structural', {
        reviewItems: [],
        agentOutput: { edits: [] },
      });
      expect(result.pass).toBe(false);
      expect(result.retryRecommended).toBe(true);
      expect(result.qualityScore).toBe(40);
      expect(result.reasons.some((r) => r.includes('structural edits'))).toBe(true);
    });

    it('passes for short manuscript with zero edits (under 1000 words)', () => {
      // Default context has "Short text." — well under 1000 words
      const result = agent.evaluate('structural', {
        reviewItems: [],
        agentOutput: { edits: [] },
      });
      expect(result.pass).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Tests: proof stage
  // ---------------------------------------------------------------------------

  describe('evaluateProof', () => {
    it('passes with score 90 when grammar issues exist', () => {
      const result = agent.evaluate('proof', {
        reviewItems: [],
        agentOutput: {
          overallPass: true,
          grammar: { issues: [{ id: 'g1', description: 'Missing comma' }] },
        },
      });
      expect(result.pass).toBe(true);
      expect(result.qualityScore).toBe(90);
    });

    it('passes when overallPass is false (not the suspicious pattern)', () => {
      const result = agent.evaluate('proof', {
        reviewItems: [],
        agentOutput: { overallPass: false, grammar: { issues: [] } },
      });
      expect(result.pass).toBe(true);
    });

    it('fails for substantial manuscript that passed proof with zero grammar issues', () => {
      // 501+ words — suspicious all-pass sentinel
      const longContent = 'word '.repeat(510).trim();
      const longAgent = new SupervisorAgent(makeContext(longContent));
      const result = longAgent.evaluate('proof', {
        reviewItems: [],
        agentOutput: { overallPass: true, grammar: { issues: [] } },
      });
      expect(result.pass).toBe(false);
      expect(result.retryRecommended).toBe(true);
      expect(result.qualityScore).toBe(40);
      expect(result.reasons.some((r) => r.includes('zero grammar issues'))).toBe(true);
    });

    it('passes for short manuscript with overallPass and zero grammar issues (under 500 words)', () => {
      // Default context has "Short text." — well under 500 words
      const result = agent.evaluate('proof', {
        reviewItems: [],
        agentOutput: { overallPass: true, grammar: { issues: [] } },
      });
      expect(result.pass).toBe(true);
    });

    it('passes when agentOutput is undefined (no sentinel)', () => {
      const result = agent.evaluate('proof', {
        reviewItems: [],
        agentOutput: undefined,
      });
      expect(result.pass).toBe(true);
      expect(result.qualityScore).toBe(90);
    });
  });

  // ---------------------------------------------------------------------------
  // Tests: word count estimation
  // ---------------------------------------------------------------------------

  describe('word count estimation', () => {
    it('counts words across multiple sections', () => {
      const multiCtx: OrchestratorContext = {
        ...makeContext(),
        getState: vi.fn().mockReturnValue({
          project: {
            present: {
              data: {
                title: 'Test',
                logline: '',
                manuscript: [makeSection('one two three'), makeSection('four five six seven')],
                characters: { ids: [], entities: {} },
                worlds: { ids: [], entities: {} },
                outline: [],
              },
            },
          },
          // biome-ignore lint/suspicious/noExplicitAny: test mock
        } as any),
      };
      const multiAgent = new SupervisorAgent(multiCtx);
      // 7 words total (under 1000) → structural passes
      const result = multiAgent.evaluate('structural', {
        reviewItems: [],
        agentOutput: { edits: [] },
      });
      expect(result.pass).toBe(true);
    });

    it('returns 0 when project data is absent', () => {
      const noProjectCtx: OrchestratorContext = {
        ...makeContext(),
        getState: vi.fn().mockReturnValue({
          project: { present: null },
          // biome-ignore lint/suspicious/noExplicitAny: test mock
        } as any),
      };
      const nullAgent = new SupervisorAgent(noProjectCtx);
      // Should not throw; word count = 0 → proof passes (under 500)
      const result = nullAgent.evaluate('proof', {
        reviewItems: [],
        agentOutput: { overallPass: true, grammar: { issues: [] } },
      });
      expect(result.pass).toBe(true);
    });
  });
});
