/**
 * ProForge — apply accepted review edits back into manuscript text.
 * QNBS-v3: Closes the core gap where "accept" recorded a status but never changed the
 * manuscript. Offset-safe (back-to-front), with a text-match fallback for stale offsets,
 * so an AI that returned slightly-off ranges still anchors correctly or is skipped — never
 * corrupts the section. Applied edits are natively undoable (project slice is redux-undo wrapped).
 */

import type { ReviewItem } from '../../features/proForge/types';
import { createLogger } from '../logger';

const log = createLogger('applyReviewEdits');

export interface SectionContentUpdate {
  id: string;
  content: string;
}

export interface ApplyEditsResult {
  /** New content for the section after all applicable edits. */
  content: string;
  /** Number of edits successfully applied. */
  applied: number;
  /** Number of edits that could not be anchored (stale/overlapping) and were skipped. */
  skipped: number;
  /** Number of edits rejected for security/integrity reasons (e.g. control characters). */
  invalid?: number;
}

interface PlannedEdit {
  start: number;
  end: number;
  proposed: string;
}

/** Maximum length of a single proposed edit to prevent memory DoS from AI output. */
const MAX_PROPOSED_LENGTH = 1_048_576; // 1 MiB

// QNBS-v3: C0 control characters that are dangerous in manuscript content or may be used for
// injection. We allow HT (\u0009), LF (\u000A), and CR (\u000D) because they are legitimate
// whitespace. Implemented as a loop to avoid literal control characters in source regexps
// (Biome's noControlCharactersInRegex rule) and to avoid adding a suppression.
function containsDisallowedControlChar(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (
      code <= 0x08 ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f) ||
      code === 0x7f
    ) {
      return true;
    }
  }
  return false;
}

// QNBS-v3: Lone surrogates are not valid Unicode scalar values and can break serialization,
// indexing, and downstream exports (PDF/EPUB). JavaScript strings can contain them, so we
// reject lone surrogates while allowing valid surrogate pairs (e.g. emoji).
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function isValidRange(range: { start: number; end: number }, len: number): boolean {
  return (
    Number.isFinite(range.start) &&
    Number.isFinite(range.end) &&
    range.start >= 0 &&
    range.end >= range.start &&
    range.end <= len
  );
}

/**
 * Find the start offset of the occurrence of `needle` in `content` that is closest to `preferNear`
 * (the stale original range start, when known) and does not overlap an already-planned edit.
 * Returns -1 if no free occurrence exists. Keeps duplicate-phrase application deterministic.
 */
function nearestFreeOccurrence(
  content: string,
  needle: string,
  preferNear: number | undefined,
  planned: PlannedEdit[],
): number {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  let idx = content.indexOf(needle);
  while (idx !== -1) {
    const end = idx + needle.length;
    const overlaps = planned.some((p) => idx < p.end && end > p.start);
    if (!overlaps) {
      // No range hint → first free occurrence; otherwise the one nearest the original position.
      const distance = preferNear === undefined ? idx : Math.abs(idx - preferNear);
      if (distance < bestDistance) {
        best = idx;
        bestDistance = distance;
      }
    }
    idx = content.indexOf(needle, idx + 1);
  }
  return best;
}

/** Validation result for proposed replacement text. */
export type ProposedTextValidationResult =
  | { ok: true; text: string }
  | { ok: false; reason: string };

/**
 * Validate proposed text for safe manuscript insertion.
 * QNBS-v3: Security hardening — reject control characters and malformed Unicode at the string
 * level. JavaScript strings are already valid UTF-16, but they may contain lone surrogates and
 * dangerous C0 control characters. A TextEncoder/TextDecoder round-trip is pointless for normal
 * JS strings (it always succeeds), so we enforce explicit character-level constraints instead.
 */
export function validateProposedText(text: string): ProposedTextValidationResult {
  if (typeof text !== 'string') {
    return { ok: false, reason: 'Proposed text must be a string' };
  }
  if (text.length > MAX_PROPOSED_LENGTH) {
    return {
      ok: false,
      reason: `Proposed text exceeds maximum length of ${MAX_PROPOSED_LENGTH} characters`,
    };
  }
  if (text.includes('\0')) {
    return { ok: false, reason: 'Proposed text contains null bytes' };
  }
  if (containsDisallowedControlChar(text)) {
    return { ok: false, reason: 'Proposed text contains disallowed control characters' };
  }
  if (LONE_SURROGATE_RE.test(text)) {
    return { ok: false, reason: 'Proposed text contains invalid Unicode (lone surrogates)' };
  }
  return { ok: true, text };
}

/**
 * Apply the accepted `ReviewItem`s that target a single section's content.
 * Only items carrying a `proposed` replacement are considered text edits; advisory items
 * (no `proposed`) are ignored and not counted as skipped.
 */
export function applyReviewEditsToSection(content: string, items: ReviewItem[]): ApplyEditsResult {
  let skipped = 0;
  let invalid = 0;
  const planned: PlannedEdit[] = [];

  for (const item of items) {
    // Advisory-only item (pacing note, quality score, plot-hole hint) — nothing to apply.
    if (item.proposed === undefined) continue;

    // QNBS-v3: Validate proposed text before insertion to prevent injection attacks.
    // Invalid proposals are skipped individually so one bad suggestion cannot abort a whole batch.
    const validation = validateProposedText(item.proposed);
    if (!validation.ok) {
      log.warn('Skipping invalid proposed edit', {
        sectionId: item.sectionId,
        itemId: item.id,
        reason: validation.reason,
      });
      invalid++;
      skipped++;
      continue;
    }
    const proposed = validation.text;

    // Strategy 1: trust offsets only if they still resolve to the expected original text
    // (or no original was provided to verify against). Empty original ('') is a valid anchor
    // when paired with an explicit range, enabling whole-section replacement on blank sections.
    if (item.range && isValidRange(item.range, content.length)) {
      const slice = content.slice(item.range.start, item.range.end);
      if (item.original === undefined || slice === item.original) {
        planned.push({ start: item.range.start, end: item.range.end, proposed });
        continue;
      }
    }

    // Strategy 2: offsets missing or stale — locate the original text directly. To stay
    // deterministic when the same phrase appears multiple times, pick the occurrence nearest the
    // (stale) original range and skip occurrences already claimed by another planned edit.
    // An empty original string is intentionally excluded here because it would match everywhere.
    if (item.original && item.original.length > 0) {
      const target = nearestFreeOccurrence(content, item.original, item.range?.start, planned);
      if (target !== -1) {
        planned.push({ start: target, end: target + item.original.length, proposed });
        continue;
      }
    }

    // Could not anchor the edit — skip rather than guess.
    skipped++;
  }

  // Apply back-to-front so earlier edits never invalidate the offsets of later (already-applied) ones.
  planned.sort((a, b) => b.start - a.start);
  let next = content;
  let lowerBound = content.length + 1; // start of the most recently applied (right-most) edit
  let applied = 0;
  for (const edit of planned) {
    // Drop edits that overlap one already applied to its right.
    if (edit.end > lowerBound) {
      skipped++;
      continue;
    }
    next = next.slice(0, edit.start) + edit.proposed + next.slice(edit.end);
    lowerBound = edit.start;
    applied++;
  }

  return { content: next, applied, skipped, invalid };
}

/**
 * Plan content updates for a whole manuscript from a flat list of accepted review items.
 * Returns only the sections whose content actually changed, plus aggregate counts.
 */
export function planAcceptedManuscriptEdits(
  manuscript: ReadonlyArray<{ id: string; content?: string }>,
  acceptedItems: ReadonlyArray<ReviewItem>,
): { updates: SectionContentUpdate[]; applied: number; skipped: number; invalid: number } {
  const bySection = new Map<string, ReviewItem[]>();
  for (const item of acceptedItems) {
    if (!item.sectionId || item.proposed === undefined) continue;
    const list = bySection.get(item.sectionId);
    if (list) list.push(item);
    else bySection.set(item.sectionId, [item]);
  }

  const updates: SectionContentUpdate[] = [];
  let applied = 0;
  let skipped = 0;
  let invalid = 0;

  for (const [sectionId, items] of bySection) {
    const section = manuscript.find((s) => s.id === sectionId);
    if (!section) {
      // Section was deleted between analysis and acceptance.
      skipped += items.length;
      continue;
    }
    const result = applyReviewEditsToSection(section.content ?? '', items);
    applied += result.applied;
    skipped += result.skipped;
    invalid += result.invalid ?? 0;
    if (result.content !== (section.content ?? '')) {
      updates.push({ id: sectionId, content: result.content });
    }
  }

  return { updates, applied, skipped, invalid };
}
