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
    dispatch: vi.fn() as unknown as OrchestratorContext['dispatch'],
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
    } as unknown as ReturnType<OrchestratorContext['getState']>),
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

// Uniform 50 scores — a plausible-but-mediocre real analysis, NOT a fallback by itself.
const FALLBACK_QUALITY_SCORE = {
  overall: 50,
  prose: 50,
  structure: 50,
  consistency: 50,
  pacing: 50,
  dialogue: 50,
  marketability: 50,
};

// Zeroed scores accompany a genuine fallback report (isFallback: true).
const ZERO_QUALITY_SCORE = {
  overall: 0,
  prose: 0,
  structure: 0,
  consistency: 0,
  pacing: 0,
  dialogue: 0,
  marketability: 0,
};

// ---------------------------------------------------------------------------
// Tests: evaluate() dispatch
// ---------------------------------------------------------------------------

describe('SupervisorAgent', () => {
  let agent: SupervisorAgent;

  beforeEach(() => {
    agent = new SupervisorAgent(makeContext());
  });

  describe('evaluate() — default/terminal stages', () => {
    it('passes with score 100 for idle/archived stages (no specific logic)', () => {
      const idle = agent.evaluate('idle', { reviewItems: [], agentOutput: undefined });
      expect(idle.pass).toBe(true);
      expect(idle.qualityScore).toBe(100);
      expect(idle.reasons).toHaveLength(0);
      expect(agent.evaluate('archived', { reviewItems: [], agentOutput: undefined }).pass).toBe(
        true,
      );
    });
  });

  describe('evaluateLineProse', () => {
    it('passes with a measured score in the pass band when prose edits are present', () => {
      const result = agent.evaluate('lineProse', { reviewItems: [], agentOutput: { edits: [{}] } });
      expect(result.pass).toBe(true);
      expect(result.qualityScore).toBeGreaterThanOrEqual(60);
      expect(result.qualityScore).toBeLessThanOrEqual(95);
    });

    it('passes for a short manuscript even with zero edits', () => {
      const result = agent.evaluate('lineProse', { reviewItems: [], agentOutput: { edits: [] } });
      expect(result.pass).toBe(true);
    });

    it('fails for a long manuscript with zero prose edits and no review items', () => {
      const longAgent = new SupervisorAgent(makeContext('word '.repeat(1100)));
      const result = longAgent.evaluate('lineProse', {
        reviewItems: [],
        agentOutput: { edits: [] },
      });
      expect(result.pass).toBe(false);
      expect(result.retryRecommended).toBe(true);
    });
  });

  describe('evaluateCopyEdit', () => {
    it('passes when copy-edit findings exist', () => {
      const result = agent.evaluate('copyEdit', {
        reviewItems: [],
        agentOutput: { grammarEdits: [{}], styleEdits: [], repetitionHits: [], formatIssues: [] },
      });
      expect(result.pass).toBe(true);
    });

    it('fails for a long manuscript with zero findings', () => {
      const longAgent = new SupervisorAgent(makeContext('word '.repeat(1600)));
      const result = longAgent.evaluate('copyEdit', {
        reviewItems: [],
        agentOutput: { grammarEdits: [], styleEdits: [], repetitionHits: [], formatIssues: [] },
      });
      expect(result.pass).toBe(false);
      expect(result.retryRecommended).toBe(true);
    });
  });

  describe('evaluateProduction', () => {
    it('passes with score 95 when at least one artifact exists', () => {
      const result = agent.evaluate('production', {
        reviewItems: [],
        agentOutput: { artifacts: [{}] },
      });
      expect(result.pass).toBe(true);
      expect(result.qualityScore).toBe(95);
    });

    it('fails when no artifacts were produced', () => {
      const result = agent.evaluate('production', {
        reviewItems: [],
        agentOutput: { artifacts: [] },
      });
      expect(result.pass).toBe(false);
      expect(result.reasons.some((r) => r.includes('artifact'))).toBe(true);
    });
  });

  describe('evaluatePublishing', () => {
    it('passes when title + back-cover blurb are present', () => {
      const result = agent.evaluate('publishing', {
        reviewItems: [],
        agentOutput: { metadata: { title: 'My Book' }, blurbs: { backCover: 'A gripping tale.' } },
      });
      expect(result.pass).toBe(true);
    });

    it('fails when title/blurb are missing', () => {
      const result = agent.evaluate('publishing', {
        reviewItems: [],
        agentOutput: { metadata: { title: '' }, blurbs: { backCover: '' } },
      });
      expect(result.pass).toBe(false);
      expect(result.reasons.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('evaluateAnalytics', () => {
    it('passes with score 100 when metrics exist', () => {
      const result = agent.evaluate('analytics', { reviewItems: [], agentOutput: { metrics: {} } });
      expect(result.pass).toBe(true);
      expect(result.qualityScore).toBe(100);
    });

    it('never blocks the pipeline even without metrics', () => {
      const result = agent.evaluate('analytics', { reviewItems: [], agentOutput: undefined });
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

    it('fails and recommends retry when the report is marked isFallback', () => {
      // QNBS-v3: Real fallback reports carry isFallback:true with zeroed scores
      // (see DiagnosticAgent.createFallbackReport). Detection keys off the flag, not score===50.
      const result = agent.evaluate('intake', {
        reviewItems: [],
        agentOutput: {
          isFallback: true,
          qualityScore: ZERO_QUALITY_SCORE,
          consistencyIssues: [],
          structuralGaps: [],
        },
      });
      expect(result.pass).toBe(false);
      expect(result.retryRecommended).toBe(true);
      expect(result.qualityScore).toBe(0);
      expect(result.reasons.some((r) => r.includes('fallback'))).toBe(true);
    });

    it('does NOT treat uniform 50 scores as fallback without the isFallback flag', () => {
      const result = agent.evaluate('intake', {
        reviewItems: [],
        agentOutput: {
          qualityScore: FALLBACK_QUALITY_SCORE,
          consistencyIssues: [{ id: 'ci-1' }],
          structuralGaps: [],
        },
      });
      // No isFallback flag → treated as a (low but real) analysis, passes the gate.
      expect(result.pass).toBe(true);
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
  // Tests: intakeHardGateFailed — centralized gate shared by orchestrator + capability layer
  // ---------------------------------------------------------------------------

  describe('intakeHardGateFailed', () => {
    it('fails a fallback intake (pass:false + score below the floor)', () => {
      const decision = agent.evaluate('intake', {
        reviewItems: [],
        agentOutput: {
          isFallback: true,
          qualityScore: ZERO_QUALITY_SCORE,
          consistencyIssues: [],
          structuralGaps: [],
        },
      });
      expect(agent.intakeHardGateFailed(decision)).toBe(true);
    });

    it('does NOT fail a legitimately weak-but-analyzed manuscript (pass:true, low score)', () => {
      // QNBS-v3: gating on score alone would mislabel a real low-quality analysis as a provider
      // failure; the gate must require the supervisor to have actually flagged it (pass:false).
      const lowButReal = agent.intakeHardGateFailed({
        pass: true,
        retryRecommended: false,
        qualityScore: 5,
        reasons: [],
      });
      expect(lowButReal).toBe(false);
    });

    it('does NOT fail a passing high-score intake', () => {
      const decision = agent.evaluate('intake', {
        reviewItems: [],
        agentOutput: {
          qualityScore: REAL_QUALITY_SCORE,
          consistencyIssues: [{ id: 'ci-1' }],
          structuralGaps: [],
        },
      });
      expect(agent.intakeHardGateFailed(decision)).toBe(false);
    });

    it('respects a custom intakeHardGate threshold', () => {
      // With the gate floored at 0, even a fallback (score 0) does not trip it.
      const lenient = new SupervisorAgent(makeContext(), { intakeHardGate: 0 });
      const decision = lenient.evaluate('intake', {
        reviewItems: [],
        agentOutput: {
          isFallback: true,
          qualityScore: ZERO_QUALITY_SCORE,
          consistencyIssues: [],
          structuralGaps: [],
        },
      });
      expect(lenient.intakeHardGateFailed(decision)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Tests: structural stage
  // ---------------------------------------------------------------------------

  describe('evaluateStructural', () => {
    it('passes with a measured score in the pass band when edits are present', () => {
      const result = agent.evaluate('structural', {
        reviewItems: [],
        agentOutput: { edits: [{ id: 'e1' }] },
      });
      expect(result.pass).toBe(true);
      expect(result.qualityScore).toBeGreaterThanOrEqual(60);
      expect(result.qualityScore).toBeLessThanOrEqual(95);
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
      expect(result.qualityScore).toBeLessThan(60);
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

    it('does NOT double-count edits + their derived reviewItems (canonical max, not sum)', () => {
      // QNBS-v3: PR6 CodeAnt — reviewItems are derived 1:1 from edits, so the score with BOTH
      // present must equal the score from the single canonical source, never the inflated sum.
      const reviewItems = Array.from({ length: 3 }, (_, i) => ({
        id: `ri-${i}`,
        stage: 'structural' as const,
        type: 'structuralEdit' as const,
        severity: 'info' as const,
        description: 'derived from edit',
        status: 'pending' as const,
        confidence: 0.8,
        createdAt: new Date(0).toISOString(),
      }));
      const edits = [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }];

      const both = agent.evaluate('structural', { reviewItems, agentOutput: { edits } });
      const editsOnly = agent.evaluate('structural', { reviewItems: [], agentOutput: { edits } });
      // max(3,3) === 3 → identical score; the old `edits + reviewItems` sum (6) would inflate it.
      expect(both.qualityScore).toBe(editsOnly.qualityScore);
    });
  });

  // ---------------------------------------------------------------------------
  // Tests: proof stage
  // ---------------------------------------------------------------------------

  describe('evaluateProof', () => {
    it('passes with a measured score in the pass band when grammar issues exist', () => {
      const result = agent.evaluate('proof', {
        reviewItems: [],
        agentOutput: {
          overallPass: true,
          grammar: { issues: [{ id: 'g1', description: 'Missing comma' }] },
        },
      });
      expect(result.pass).toBe(true);
      expect(result.qualityScore).toBeGreaterThanOrEqual(70);
      expect(result.qualityScore).toBeLessThanOrEqual(95);
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
      expect(result.qualityScore).toBeLessThan(70);
      expect(result.reasons.some((r) => r.includes('grammar/style/technical/legal'))).toBe(true);
    });

    it('does NOT flag a long manuscript when proof found non-grammar (style/legal) issues', () => {
      // QNBS-v3: PR6 CodeAnt — proof signal must count style/technical/legal findings, not only
      // grammar; a clean-grammar report with real style/legal findings is NOT a fallback.
      const longContent = 'word '.repeat(510).trim();
      const longAgent = new SupervisorAgent(makeContext(longContent));
      const result = longAgent.evaluate('proof', {
        reviewItems: [],
        agentOutput: {
          overallPass: true,
          grammar: { issues: [] },
          style: { issues: [{ id: 's1' }, { id: 's2' }] },
          legal: { warnings: [{ id: 'l1' }] },
        },
      });
      expect(result.pass).toBe(true);
    });

    it('passes for short manuscript with overallPass and zero grammar issues (under 500 words)', () => {
      // Default context has "Short text." — well under 500 words
      const result = agent.evaluate('proof', {
        reviewItems: [],
        agentOutput: { overallPass: true, grammar: { issues: [] } },
      });
      expect(result.pass).toBe(true);
    });

    it('passes with a measured score when agentOutput is undefined (no sentinel)', () => {
      const result = agent.evaluate('proof', {
        reviewItems: [],
        agentOutput: undefined,
      });
      expect(result.pass).toBe(true);
      expect(result.qualityScore).toBeGreaterThanOrEqual(70);
      expect(result.qualityScore).toBeLessThanOrEqual(95);
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
        } as unknown as ReturnType<OrchestratorContext['getState']>),
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
        } as unknown as ReturnType<OrchestratorContext['getState']>),
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

  // ---------------------------------------------------------------------------
  // Tests: PR6 — measured scoring + configurable thresholds
  // ---------------------------------------------------------------------------

  describe('measured scoring', () => {
    it('scores higher with more findings (not a flat constant)', () => {
      const longAgent = new SupervisorAgent(makeContext('word '.repeat(2000)));
      const few = longAgent.evaluate('structural', {
        reviewItems: [],
        agentOutput: { edits: [{ id: 'a' }] },
      });
      const many = longAgent.evaluate('structural', {
        reviewItems: [],
        agentOutput: { edits: Array.from({ length: 12 }, (_, i) => ({ id: `e${i}` })) },
      });
      expect(many.qualityScore).toBeGreaterThan(few.qualityScore);
    });
  });

  describe('configurable thresholds', () => {
    it('a lower largeManuscriptWords threshold flags a smaller manuscript as suspicious', () => {
      // ~600 words: passes under the default 1000 threshold...
      const ctx = makeContext('word '.repeat(600));
      const dflt = new SupervisorAgent(ctx).evaluate('structural', {
        reviewItems: [],
        agentOutput: { edits: [] },
      });
      expect(dflt.pass).toBe(true);
      // ...but fails when the threshold is lowered to 300.
      const strict = new SupervisorAgent(ctx, { largeManuscriptWords: 300 }).evaluate(
        'structural',
        {
          reviewItems: [],
          agentOutput: { edits: [] },
        },
      );
      expect(strict.pass).toBe(false);
      expect(strict.retryRecommended).toBe(true);
    });
  });
});
