/**
 * actionApplier — apply an AI-suggested text replacement to a manuscript section.
 * QNBS-v3: Thin wrapper around applyReviewEditsToSection; keeps the copilot decoupled
 * from ProForge's ReviewItem model while reusing the offset-safe edit logic.
 * The change dispatches into redux-undo so Ctrl+Z always reverses it.
 */

import type { ApplyEditsResult } from '../proForge/applyReviewEdits';
import { applyReviewEditsToSection } from '../proForge/applyReviewEdits';

export type { ApplyEditsResult };

/**
 * Apply a single text replacement to `sectionContent`.
 * When `original` is empty or whitespace-only, replaces the entire section with `proposed`.
 * Returns the new content and how many replacements were applied/skipped.
 * QNBS-v3: Proposed text is validated in applyReviewEditsToSection to prevent injection attacks.
 */
export function applyTextEdit(
  sectionContent: string,
  original: string,
  proposed: string,
): ApplyEditsResult {
  if (!original.trim()) {
    // QNBS-v3: whole-section replacement — used when the AI rewrites the full chapter or the
    // chapter is currently blank. We pass an explicit full-range plus the current content as
    // original (even if empty) so applyReviewEditsToSection can anchor the edit. Relying on
    // text-match with an empty original would always fail because empty string matches everywhere.
    return applyReviewEditsToSection(sectionContent, [
      {
        id: 'copilot-apply',
        stage: 'copyEdit',
        type: 'proseEdit',
        severity: 'info',
        description: 'Copilot suggested replacement',
        original: sectionContent,
        proposed,
        range: { start: 0, end: sectionContent.length },
        confidence: 1,
        status: 'accepted',
        createdAt: new Date().toISOString(),
      },
    ]);
  }

  // Delegate to ProForge's offset-safe, stale-match-aware applier.
  return applyReviewEditsToSection(sectionContent, [
    {
      id: 'copilot-apply',
      stage: 'copyEdit',
      type: 'proseEdit',
      severity: 'info',
      description: 'Copilot suggested replacement',
      original,
      proposed,
      confidence: 1,
      status: 'accepted',
      createdAt: new Date().toISOString(),
    },
  ]);
}

/**
 * Extract the first fenced code block (``` ... ```) from a markdown string.
 * Returns null if none is found.
 */
export function extractCodeBlock(text: string): string | null {
  const match = text.match(/```(?:[^\n]*)?\n([\s\S]*?)```/);
  return match?.[1]?.trim() ?? null;
}
