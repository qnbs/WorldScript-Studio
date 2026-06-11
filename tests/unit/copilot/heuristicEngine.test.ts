/**
 * heuristicEngine tests — verifies each built-in rule with passing and failing project fixtures.
 * QNBS-v3: Pure unit tests; no AI calls, no network, no React.
 */

import type { EntityState } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';
import type { ProjectData } from '../../../features/project/projectState';
import type { CopilotContext } from '../../../services/copilot/copilotContextService';
import { _clearRegistry, runAllRules } from '../../../services/copilot/heuristicEngine';
import type { Character, World } from '../../../types';

// ---------------------------------------------------------------------------
// Minimal project fixture helpers
// ---------------------------------------------------------------------------

function makeChars(
  entries: Array<{ id: string; name: string; arc?: string; motivation?: string }>,
): EntityState<Character, string> {
  const entities: Record<string, Character> = {};
  for (const c of entries) {
    entities[c.id] = {
      id: c.id,
      name: c.name,
      backstory: '',
      motivation: c.motivation ?? '',
      appearance: '',
      personalityTraits: '',
      flaws: '',
      notes: '',
      characterArc: c.arc ?? '',
      relationships: '',
    };
  }
  return { ids: entries.map((c) => c.id), entities };
}

function makeWorlds(
  entries: Array<{
    id: string;
    name: string;
    description?: string;
    geography?: string;
    culture?: string;
  }>,
): EntityState<World, string> {
  const entities: Record<string, World> = {};
  for (const w of entries) {
    entities[w.id] = {
      id: w.id,
      name: w.name,
      description: w.description ?? '',
      geography: w.geography ?? '',
      magicSystem: '',
      culture: w.culture ?? '',
      notes: '',
      timeline: [],
      locations: [],
    };
  }
  return { ids: entries.map((w) => w.id), entities };
}

function makeProject(overrides: Partial<ProjectData> = {}): ProjectData {
  return {
    title: 'Test Novel',
    logline: '',
    outline: [],
    manuscript: [],
    characters: makeChars([]),
    worlds: makeWorlds([]),
    ...overrides,
  };
}

const ctx: CopilotContext = {
  view: 'manuscript',
  viewLabel: 'Manuscript',
  projectTitle: 'Test Novel',
  wordCount: 0,
  language: 'en',
  chapterCount: 0,
  characterCount: 0,
  worldEntryCount: 0,
  outlineCompleteness: 0,
  selectedText: '',
  openInsightCount: 0,
};

// ---------------------------------------------------------------------------
// Re-register built-in rules after each _clearRegistry call.
// Rules are auto-registered at module import time; clearing and re-importing
// is complex — instead we skip clearing and trust rule deduplication.
// ---------------------------------------------------------------------------

describe('heuristicEngine.runAllRules', () => {
  // Note: we don't call _clearRegistry() here so the built-in rules stay registered.

  it('returns empty array for an empty project', () => {
    const project = makeProject();
    const findings = runAllRules(project, ctx);
    expect(findings).toEqual([]);
  });

  describe('TensionDropRule', () => {
    it('fires when tension drops ≥2 points without recovery', () => {
      const manuscript = [
        { id: 's1', title: 'Ch1', content: 'text', status: 'final' as const },
        { id: 's2', title: 'Ch2', content: 'text', status: 'final' as const },
        { id: 's3', title: 'Ch3', content: 'text', status: 'draft' as const }, // drops 9→2
        { id: 's4', title: 'Ch4', content: 'text', status: 'draft' as const }, // no recovery
      ];
      const project = makeProject({ manuscript });
      const findings = runAllRules(project, ctx);
      expect(findings.some((f) => f.ruleId === 'tension-drop')).toBe(true);
    });

    it('does not fire for fewer than 4 chapters', () => {
      const manuscript = [
        { id: 's1', title: 'Ch1', content: 'text', status: 'final' as const },
        { id: 's2', title: 'Ch2', content: 'text', status: 'draft' as const },
      ];
      const findings = runAllRules(makeProject({ manuscript }), ctx);
      expect(findings.some((f) => f.ruleId === 'tension-drop')).toBe(false);
    });
  });

  describe('UnderdevelopedCharacterRule', () => {
    it('fires for a character with no arc/motivation appearing 3+ times', () => {
      const content = 'Alice walked. Alice smiled. Alice sat down.';
      const manuscript = [{ id: 's1', title: 'Ch1', content }];
      const project = makeProject({
        manuscript,
        characters: makeChars([{ id: 'c1', name: 'Alice' }]),
      });
      const findings = runAllRules(project, ctx);
      expect(findings.some((f) => f.ruleId === 'underdeveloped-character')).toBe(true);
    });

    it('does not fire when character has arc and motivation', () => {
      const content = 'Alice walked. Alice smiled.';
      const manuscript = [{ id: 's1', title: 'Ch1', content }];
      const project = makeProject({
        manuscript,
        characters: makeChars([
          {
            id: 'c1',
            name: 'Alice',
            arc: 'Redemption arc from failure',
            motivation: 'Seeks justice for family',
          },
        ]),
      });
      const findings = runAllRules(project, ctx);
      expect(findings.some((f) => f.ruleId === 'underdeveloped-character')).toBe(false);
    });
  });

  describe('OpenLoopRule', () => {
    it('fires when >60% of ≥6 chapters are Act II', () => {
      const manuscript = Array.from({ length: 8 }, (_, i) => ({
        id: `s${i}`,
        title: `Ch${i}`,
        content: 'text',
        act: (i < 6 ? 2 : 1) as 1 | 2 | 3,
      }));
      const findings = runAllRules(makeProject({ manuscript }), ctx);
      expect(findings.some((f) => f.ruleId === 'open-loop')).toBe(true);
    });

    it('does not fire with fewer than 6 chapters', () => {
      const manuscript = Array.from({ length: 4 }, (_, i) => ({
        id: `s${i}`,
        title: `Ch${i}`,
        content: 'text',
        act: 2 as const,
      }));
      const findings = runAllRules(makeProject({ manuscript }), ctx);
      expect(findings.some((f) => f.ruleId === 'open-loop')).toBe(false);
    });
  });

  describe('SlowPacingRule', () => {
    it('fires for 3+ consecutive very-short chapters', () => {
      const longContent = 'word '.repeat(200);
      const shortContent = 'short';
      const manuscript = [
        { id: 's1', title: 'Ch1', content: longContent },
        { id: 's2', title: 'Ch2', content: longContent },
        { id: 's3', title: 'Ch3', content: shortContent },
        { id: 's4', title: 'Ch4', content: shortContent },
        { id: 's5', title: 'Ch5', content: shortContent },
      ];
      const findings = runAllRules(makeProject({ manuscript }), ctx);
      expect(findings.some((f) => f.ruleId === 'slow-pacing')).toBe(true);
    });

    it('does not fire when pacing is consistent', () => {
      const content = 'word '.repeat(100);
      const manuscript = Array.from({ length: 5 }, (_, i) => ({
        id: `s${i}`,
        title: `Ch${i}`,
        content,
      }));
      const findings = runAllRules(makeProject({ manuscript }), ctx);
      expect(findings.some((f) => f.ruleId === 'slow-pacing')).toBe(false);
    });
  });

  describe('OverlengthSceneRule', () => {
    it('fires when one chapter is 4x the mean', () => {
      // QNBS-v3: Need ≥4 short chapters so the mean stays low enough for veryLong to be ≥4×
      // 4 × 50 + 3000 = 3200; mean = 640; 3000 ≥ 640×4 = 2560 ✓
      const short = 'word '.repeat(50);
      const veryLong = 'word '.repeat(3000);
      const manuscript = [
        { id: 's1', title: 'Ch1', content: short },
        { id: 's2', title: 'Ch2', content: short },
        { id: 's3', title: 'Ch3', content: short },
        { id: 's4', title: 'Ch4', content: short },
        { id: 's5', title: 'Ch5', content: veryLong },
      ];
      const findings = runAllRules(makeProject({ manuscript }), ctx);
      expect(findings.some((f) => f.ruleId === 'overlength-scene')).toBe(true);
    });
  });

  describe('MissingWorldContextRule', () => {
    it('fires when world entry is mentioned in manuscript but profile is empty', () => {
      const manuscript = [
        { id: 's1', title: 'Ch1', content: 'They travelled to Arendelle across the mountains.' },
      ];
      const project = makeProject({
        manuscript,
        worlds: makeWorlds([{ id: 'w1', name: 'Arendelle' }]),
      });
      const findings = runAllRules(project, ctx);
      expect(findings.some((f) => f.ruleId === 'missing-world-context')).toBe(true);
    });

    it('does not fire when world entry is sufficiently completed', () => {
      const manuscript = [
        { id: 's1', title: 'Ch1', content: 'They travelled to Arendelle across the mountains.' },
      ];
      const project = makeProject({
        manuscript,
        worlds: makeWorlds([
          {
            id: 'w1',
            name: 'Arendelle',
            description: 'A frozen Nordic kingdom with a magical curse.',
            geography: 'Mountains, fjords, and ice.',
            culture: 'Norse-inspired, monarchy-ruled.',
          },
        ]),
      });
      const findings = runAllRules(project, ctx);
      expect(findings.some((f) => f.ruleId === 'missing-world-context')).toBe(false);
    });
  });

  describe('severity sorting', () => {
    it('returns findings sorted error > warning > info', () => {
      const findings = runAllRules(
        makeProject({
          manuscript: Array.from({ length: 12 }, (_, i) => ({
            id: `s${i}`,
            title: `Ch${i}`,
            content: 'word '.repeat(300),
            status: (i % 3 === 0 ? 'final' : 'draft') as 'final' | 'draft',
            act: (i < 8 ? 2 : 1) as 1 | 2 | 3,
          })),
          characters: makeChars([{ id: 'c1', name: 'Bob' }]),
        }),
        ctx,
        20,
      );
      const severities = findings.map((f) => f.severity);
      const ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 };
      for (let i = 0; i < severities.length - 1; i++) {
        const a = ORDER[severities[i] ?? 'info'] ?? 2;
        const b = ORDER[severities[i + 1] ?? 'info'] ?? 2;
        expect(a).toBeLessThanOrEqual(b);
      }
    });
  });

  describe('_clearRegistry', () => {
    it('is a function that can be called without throwing', () => {
      expect(() => _clearRegistry()).not.toThrow();
      // Re-import to restore built-in rules (they register at module import time).
    });
  });
});
