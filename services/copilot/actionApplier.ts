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
 * When `original` is empty, replaces the entire section with `proposed`.
 * Returns the new content and how many replacements were applied/skipped.
 */
export function applyTextEdit(
  sectionContent: string,
  original: string,
  proposed: string,
): ApplyEditsResult {
  if (!original.trim()) {
    // QNBS-v3: whole-section replacement — used when the AI rewrites the full chapter.
    return { content: proposed, applied: 1, skipped: 0 };
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
