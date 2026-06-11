/**
 * heuristicEngine — pluggable, language-neutral narrative analysis rule engine.
 * QNBS-v3: Every rule is pure TypeScript with zero AI dependency. User-facing text is
 * represented as i18n key references + params — never hard-coded strings. Rules can be
 * registered at runtime to support the plugin system.
 */

import type { ProjectData } from '../../features/project/projectState';
import type { View } from '../../types';
import { computeTensionCurve } from '../plotBoardService';
import type { CopilotContext } from './copilotContextService';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type HeuristicSeverity = 'info' | 'warning' | 'error';

export interface HeuristicFinding {
  /** Stable id — unique per finding instance (rule id + discriminator). */
  id: string;
  ruleId: string;
  severity: HeuristicSeverity;
  /** i18n key for the short card title. */
  titleKey: string;
  /** i18n key for the one-line description. */
  descriptionKey: string;
  /** Interpolation params passed to t(descriptionKey, params). */
  params: Record<string, string | number>;
  /** Which app view is most relevant to fix this. */
  targetView: View;
  /** True when the Copilot can suggest a concrete action. */
  actionable: boolean;
}

export interface HeuristicRule {
  id: string;
  severity: HeuristicSeverity;
  /** i18n key summarising what this rule checks (shown in HEURISTIC-RULES docs). */
  descriptionKey: string;
  detect(project: ProjectData, ctx: CopilotContext): HeuristicFinding[];
}

// ---------------------------------------------------------------------------
// Rule registry
// ---------------------------------------------------------------------------

const _registry: HeuristicRule[] = [];

export function registerRule(rule: HeuristicRule): void {
  if (!_registry.find((r) => r.id === rule.id)) {
    _registry.push(rule);
  }
}

/** @internal For test isolation. */
export function _clearRegistry(): void {
  _registry.length = 0;
}

// ---------------------------------------------------------------------------
// Helper utilities (pure, no imports needed)
// ---------------------------------------------------------------------------

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Compute a simple 0–1 completeness fraction for a Character. */
function characterCompleteness(c: {
  characterArc: string;
  motivation: string;
  backstory: string;
  personalityTraits: string;
}): number {
  const fields = [c.characterArc, c.motivation, c.backstory, c.personalityTraits];
  const filled = fields.filter((f) => f.trim().length > 10).length;
  return filled / fields.length;
}

/** Compute a simple 0–1 completeness fraction for a World entry. */
function worldCompleteness(w: { description: string; geography: string; culture: string }): number {
  const fields = [w.description, w.geography, w.culture];
  const filled = fields.filter((f) => f.trim().length > 10).length;
  return filled / fields.length;
}

/** Jaccard similarity between word-sets of two strings. */
function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(
    a
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
  const setB = new Set(
    b
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  return intersection / (setA.size + setB.size - intersection);
}

// ---------------------------------------------------------------------------
// Built-in Rule: TensionDropRule
// Detects sections where the heuristic tension score drops ≥20% vs the
// preceding section without recovering in the next section.
// ---------------------------------------------------------------------------

const TensionDropRule: HeuristicRule = {
  id: 'tension-drop',
  severity: 'warning',
  descriptionKey: 'copilot.rule.tensionDrop.desc',

  detect(project) {
    const sections = project.manuscript;
    if (sections.length < 4) return [];
    const overrides = project.plotTensionOverrides ?? {};
    const curve = computeTensionCurve(sections, overrides);

    const findings: HeuristicFinding[] = [];
    // Find the first window of 2+ consecutive drops ≥2 points (scale 0–10 → ≥20%)
    for (let i = 1; i < curve.length - 1; i++) {
      const prev = curve[i - 1];
      const curr = curve[i];
      const next = curve[i + 1];
      if (!prev || !curr || !next) continue;
      const drop = prev.score - curr.score;
      const recovers = next.score > curr.score;
      if (drop >= 2 && !recovers) {
        const from = prev.sectionTitle || `Ch.${i}`;
        const to = next.sectionTitle || `Ch.${i + 2}`;
        findings.push({
          id: `tension-drop-${i}`,
          ruleId: 'tension-drop',
          severity: 'warning',
          titleKey: 'copilot.insight.tensionDrop.title',
          descriptionKey: 'copilot.insight.tensionDrop.desc',
          params: { from, to },
          targetView: 'sceneboard',
          actionable: true,
        });
        // Only report first unrecovered drop window per run
        break;
      }
    }
    return findings;
  },
};

// ---------------------------------------------------------------------------
// Built-in Rule: UnderdevelopedCharacterRule
// Characters appearing in the manuscript but with empty arc + motivation.
// ---------------------------------------------------------------------------

const UnderdevelopedCharacterRule: HeuristicRule = {
  id: 'underdeveloped-character',
  severity: 'info',
  descriptionKey: 'copilot.rule.underdevelopedChar.desc',

  detect(project) {
    const charEntities = project.characters.entities;
    const chars = Object.values(charEntities).filter(Boolean);
    if (chars.length === 0) return [];

    const manuscriptText = project.manuscript
      .map((s) => s.content ?? '')
      .join(' ')
      .toLowerCase();

    const findings: HeuristicFinding[] = [];
    for (const c of chars) {
      if (!c) continue;
      // Count approximate appearances in manuscript
      const nameWords = c.name.toLowerCase().split(/\s+/).filter(Boolean);
      const primaryName = nameWords[0] ?? '';
      if (!primaryName || primaryName.length < 2) continue;
      const regex = new RegExp(`\\b${primaryName}\\b`, 'g');
      const appearances = (manuscriptText.match(regex) ?? []).length;
      if (appearances < 2) continue;

      const completeness = characterCompleteness(c);
      if (completeness < 0.25) {
        findings.push({
          id: `underdeveloped-character-${c.id}`,
          ruleId: 'underdeveloped-character',
          severity: 'info',
          titleKey: 'copilot.insight.underdevelopedChar.title',
          descriptionKey: 'copilot.insight.underdevelopedChar.desc',
          params: { name: c.name, count: appearances },
          targetView: 'characters',
          actionable: true,
        });
      }
    }
    // Report at most 2 to keep the panel concise
    return findings.slice(0, 2);
  },
};

// ---------------------------------------------------------------------------
// Built-in Rule: OpenLoopRule
// Act II proportion check: if >60% of sections are Act 2 with ≥6 sections total.
// ---------------------------------------------------------------------------

const OpenLoopRule: HeuristicRule = {
  id: 'open-loop',
  severity: 'info',
  descriptionKey: 'copilot.rule.openLoop.desc',

  detect(project) {
    const sections = project.manuscript;
    if (sections.length < 6) return [];
    const act2Count = sections.filter((s) => s.act === 2).length;
    const pct = Math.round((act2Count / sections.length) * 100);
    if (pct > 60) {
      return [
        {
          id: 'open-loop-act2',
          ruleId: 'open-loop',
          severity: 'info',
          titleKey: 'copilot.insight.openLoop.title',
          descriptionKey: 'copilot.insight.openLoop.desc',
          params: { pct },
          targetView: 'sceneboard',
          actionable: false,
        },
      ];
    }
    return [];
  },
};

// ---------------------------------------------------------------------------
// Built-in Rule: SlowPacingRule
// 3+ consecutive sections with word count <40% of the project mean.
// ---------------------------------------------------------------------------

const SlowPacingRule: HeuristicRule = {
  id: 'slow-pacing',
  severity: 'info',
  descriptionKey: 'copilot.rule.slowPacing.desc',

  detect(project) {
    const sections = project.manuscript;
    if (sections.length < 4) return [];
    const counts = sections.map((s) => wordCount(s.content ?? ''));
    const total = counts.reduce((a, b) => a + b, 0);
    const mean = total / counts.length;
    if (mean < 50) return []; // Too short to be meaningful

    const threshold = mean * 0.4;
    let streak = 0;
    let startIdx = 0;
    for (let i = 0; i < counts.length; i++) {
      const c = counts[i] ?? 0;
      if (c < threshold) {
        if (streak === 0) startIdx = i;
        streak++;
        if (streak >= 3) {
          return [
            {
              id: `slow-pacing-${startIdx}`,
              ruleId: 'slow-pacing',
              severity: 'info',
              titleKey: 'copilot.insight.slowPacing.title',
              descriptionKey: 'copilot.insight.slowPacing.desc',
              params: { count: streak },
              targetView: 'manuscript',
              actionable: false,
            },
          ];
        }
      } else {
        streak = 0;
      }
    }
    return [];
  },
};

// ---------------------------------------------------------------------------
// Built-in Rule: HighRepetitionRule
// Detects high Jaccard similarity (>0.45) between adjacent paragraphs in
// any chapter, suggesting repetitive phrasing or copy-paste issues.
// ---------------------------------------------------------------------------

const HighRepetitionRule: HeuristicRule = {
  id: 'high-repetition',
  severity: 'warning',
  descriptionKey: 'copilot.rule.highRepetition.desc',

  detect(project) {
    // Cap to first 10 sections for performance on low-end hardware
    const sections = project.manuscript.slice(0, 10);
    for (const section of sections) {
      const content = section.content ?? '';
      const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().split(/\s+/).length > 15);
      if (paragraphs.length < 3) continue;
      for (let i = 0; i < paragraphs.length - 2; i++) {
        const a = paragraphs[i] ?? '';
        const b = paragraphs[i + 1] ?? '';
        const c = paragraphs[i + 2] ?? '';
        if (jaccardSimilarity(a, b) > 0.45 && jaccardSimilarity(b, c) > 0.45) {
          return [
            {
              id: `high-repetition-${section.id}`,
              ruleId: 'high-repetition',
              severity: 'warning',
              titleKey: 'copilot.insight.highRepetition.title',
              descriptionKey: 'copilot.insight.highRepetition.desc',
              params: { chapter: section.title || 'Untitled chapter' },
              targetView: 'manuscript',
              actionable: true,
            },
          ];
        }
      }
    }
    return [];
  },
};

// ---------------------------------------------------------------------------
// Built-in Rule: PlotHoleRule (proxy)
// A character is linked in chapter A (via characterIds) but has zero content
// in earlier chapters — suggesting they appear before they're introduced.
// ---------------------------------------------------------------------------

const PlotHoleRule: HeuristicRule = {
  id: 'plot-hole',
  severity: 'warning',
  descriptionKey: 'copilot.rule.plotHole.desc',

  detect(project) {
    const sections = project.manuscript;
    if (sections.length < 3) return [];
    const charEntities = project.characters.entities;

    // Build: for each characterId, find the first section index that links them
    const firstLink = new Map<string, number>();
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      if (!s) continue;
      for (const cid of s.characterIds ?? []) {
        if (!firstLink.has(cid)) firstLink.set(cid, i);
      }
    }

    // Check: does any earlier chapter *content* mention the character by name
    // before their first linked appearance?
    const findings: HeuristicFinding[] = [];
    for (const [cid, introIdx] of firstLink) {
      if (introIdx === 0) continue; // introduced in first chapter — fine
      const char = charEntities[cid];
      if (!char) continue;
      const primaryName = char.name.split(/\s+/)[0]?.toLowerCase() ?? '';
      if (!primaryName || primaryName.length < 2) continue;
      const regex = new RegExp(`\\b${primaryName}\\b`);
      for (let j = 0; j < introIdx; j++) {
        const s = sections[j];
        if (!s) continue;
        if (regex.test(s.content?.toLowerCase() ?? '')) {
          findings.push({
            id: `plot-hole-${cid}`,
            ruleId: 'plot-hole',
            severity: 'warning',
            titleKey: 'copilot.insight.plotHole.title',
            descriptionKey: 'copilot.insight.plotHole.desc',
            params: {
              character: char.name,
              chapterA: s.title || `Ch.${j + 1}`,
              chapterB: sections[introIdx]?.title || `Ch.${introIdx + 1}`,
            },
            targetView: 'manuscript',
            actionable: false,
          });
          break;
        }
      }
    }
    return findings.slice(0, 2);
  },
};

// ---------------------------------------------------------------------------
// Built-in Rule: MissingWorldContextRule
// A world entry is referenced by name in the manuscript but its profile is
// less than 25% complete.
// ---------------------------------------------------------------------------

const MissingWorldContextRule: HeuristicRule = {
  id: 'missing-world-context',
  severity: 'info',
  descriptionKey: 'copilot.rule.missingWorld.desc',

  detect(project) {
    const worldEntities = project.worlds.entities;
    const worlds = Object.values(worldEntities).filter(Boolean);
    if (worlds.length === 0) return [];

    const manuscriptText = project.manuscript
      .map((s) => s.content ?? '')
      .join(' ')
      .toLowerCase();
    const findings: HeuristicFinding[] = [];

    for (const w of worlds) {
      if (!w) continue;
      const completeness = worldCompleteness(w);
      if (completeness >= 0.25) continue;
      // Only flag if name appears in the manuscript
      const nameLC = w.name.toLowerCase().split(/\s+/)[0] ?? '';
      if (nameLC.length < 3) continue;
      if (!manuscriptText.includes(nameLC)) continue;
      findings.push({
        id: `missing-world-${w.id}`,
        ruleId: 'missing-world-context',
        severity: 'info',
        titleKey: 'copilot.insight.missingWorld.title',
        descriptionKey: 'copilot.insight.missingWorld.desc',
        params: { entry: w.name, pct: Math.round(completeness * 100) },
        targetView: 'world',
        actionable: true,
      });
    }
    return findings.slice(0, 2);
  },
};

// ---------------------------------------------------------------------------
// Built-in Rule: OverlengthSceneRule
// A single chapter is ≥4× the project mean word count.
// ---------------------------------------------------------------------------

const OverlengthSceneRule: HeuristicRule = {
  id: 'overlength-scene',
  severity: 'info',
  descriptionKey: 'copilot.rule.overlengthScene.desc',

  detect(project) {
    const sections = project.manuscript;
    if (sections.length < 2) return [];
    const counts = sections.map((s) => wordCount(s.content ?? ''));
    const total = counts.reduce((a, b) => a + b, 0);
    const mean = total / counts.length;
    if (mean < 100) return [];

    const findings: HeuristicFinding[] = [];
    for (let i = 0; i < sections.length; i++) {
      const c = counts[i] ?? 0;
      if (c >= mean * 4) {
        const s = sections[i];
        if (!s) continue;
        findings.push({
          id: `overlength-scene-${s.id}`,
          ruleId: 'overlength-scene',
          severity: 'info',
          titleKey: 'copilot.insight.overlengthScene.title',
          descriptionKey: 'copilot.insight.overlengthScene.desc',
          params: { title: s.title || `Ch.${i + 1}`, times: Math.round(c / mean) },
          targetView: 'manuscript',
          actionable: false,
        });
      }
    }
    return findings.slice(0, 1);
  },
};

// ---------------------------------------------------------------------------
// Register all built-in rules
// ---------------------------------------------------------------------------

const BUILT_IN_RULES: HeuristicRule[] = [
  TensionDropRule,
  UnderdevelopedCharacterRule,
  OpenLoopRule,
  SlowPacingRule,
  HighRepetitionRule,
  PlotHoleRule,
  MissingWorldContextRule,
  OverlengthSceneRule,
];

BUILT_IN_RULES.forEach(registerRule);

// ---------------------------------------------------------------------------
// Engine entry point
// ---------------------------------------------------------------------------

/**
 * Run all registered rules and return findings sorted by severity (error > warning > info).
 * Caps total output to `limit` to prevent overwhelming the panel.
 */
export function runAllRules(
  project: ProjectData,
  ctx: CopilotContext,
  limit = 10,
): HeuristicFinding[] {
  const SEVERITY_ORDER: Record<HeuristicSeverity, number> = { error: 0, warning: 1, info: 2 };
  const findings: HeuristicFinding[] = [];

  for (const rule of _registry) {
    try {
      const results = rule.detect(project, ctx);
      findings.push(...results);
    } catch {
      // Individual rule failures must not crash the engine
    }
  }

  return findings
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 2) - (SEVERITY_ORDER[b.severity] ?? 2))
    .slice(0, limit);
}
