// tests/bench/fixtures/largeManuscript.ts
//
// QNBS-v3: A0.1 perf-harness fixture. Deterministic, reproducible large-manuscript builder so the
// benchmark numbers are comparable run-to-run (no Math.random, no Date.now). This is the baseline
// the Local-First (Y.Doc-as-SoT) migration is judged against — a fixture that drifts would make the
// before/after deltas meaningless.

import { charactersAdapter, worldsAdapter } from '../../../features/project/adapters';
import type { ProjectData } from '../../../features/project/projectState';
import type { Character, StorySection, World } from '../../../types';

/** Tiny deterministic LCG (Numerical Recipes constants) — reproducible "prose" without RNG flake. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

// A fixed lexicon keeps word/char counts stable across runs while producing realistic token spread.
const LEXICON =
  'the quiet harbor swallowed every lantern as Mara counted the tide against a hull of black oak and salt while the captain whispered a name no chart remembered and the wind carried it inland past the broken lighthouse toward the city that had forgotten how to sleep'.split(
    ' ',
  );

/** Build one paragraph of `wordsPerParagraph` words from the lexicon, capitalised + full-stopped. */
function buildParagraph(rng: () => number, wordsPerParagraph: number): string {
  const words: string[] = [];
  for (let i = 0; i < wordsPerParagraph; i++) {
    const w = LEXICON[Math.floor(rng() * LEXICON.length)] ?? 'the';
    words.push(i === 0 ? `${w.charAt(0).toUpperCase()}${w.slice(1)}` : w);
  }
  return `${words.join(' ')}.`;
}

/** Build the prose body for one section, ~`wordsPerSection` words across ~120-word paragraphs. */
function buildSectionContent(rng: () => number, wordsPerSection: number): string {
  const wordsPerParagraph = 120;
  const paragraphs: string[] = [];
  // QNBS-v3 (CodeAnt): emit EXACTLY wordsPerSection words (full paragraphs + a final partial one),
  // instead of rounding to whole 120-word paragraphs — otherwise the corpus drifts from the request
  // and invalidates size-based benchmark comparisons.
  let remaining = wordsPerSection;
  while (remaining > 0) {
    const n = Math.min(wordsPerParagraph, remaining);
    paragraphs.push(buildParagraph(rng, n));
    remaining -= n;
  }
  return paragraphs.join('\n\n');
}

export interface LargeManuscriptOptions {
  /** Number of manuscript sections (scenes/chapters). Default 60. */
  sectionCount?: number;
  /** Target words per section. Default 2000 → 60 × 2000 ≈ 120k words. */
  wordsPerSection?: number;
  /** Number of characters in the Codex EntityState. Default 24. */
  characterCount?: number;
  /** Number of worlds in the Codex EntityState. Default 8. */
  worldCount?: number;
  /** RNG seed — change only if you intend a different (but still deterministic) corpus. Default 42. */
  seed?: number;
}

function buildCharacter(i: number, rng: () => number): Character {
  return {
    id: `char-${i}`,
    name: `Character ${i}`,
    backstory: buildParagraph(rng, 60),
    motivation: buildParagraph(rng, 20),
    appearance: buildParagraph(rng, 25),
    personalityTraits: buildParagraph(rng, 15),
    flaws: buildParagraph(rng, 12),
    notes: buildParagraph(rng, 30),
    characterArc: buildParagraph(rng, 40),
    relationships: buildParagraph(rng, 18),
  };
}

function buildWorld(i: number, rng: () => number): World {
  return {
    id: `world-${i}`,
    name: `World ${i}`,
    description: buildParagraph(rng, 50),
    geography: buildParagraph(rng, 40),
    magicSystem: buildParagraph(rng, 35),
    culture: buildParagraph(rng, 45),
    notes: buildParagraph(rng, 25),
    timeline: [],
    locations: [],
  };
}

/**
 * Build a deterministic large ProjectData fixture. Shape matches the live `project` slice (EntityState
 * characters/worlds, StorySection[] manuscript), so it can be fed straight through `projectReducer` and
 * the redux-undo wrapper exactly as the app does.
 */
export function buildLargeManuscript(options: LargeManuscriptOptions = {}): ProjectData {
  const {
    sectionCount = 60,
    wordsPerSection = 2000,
    characterCount = 24,
    worldCount = 8,
    seed = 42,
  } = options;

  const rng = makeRng(seed);

  const manuscript: StorySection[] = [];
  for (let i = 0; i < sectionCount; i++) {
    const content = buildSectionContent(rng, wordsPerSection);
    manuscript.push({
      id: `sec-${i}`,
      title: `Chapter ${i + 1}`,
      content,
      // act spread (1/2/3) so swimlane / analytics paths see realistic distribution
      act: ((i % 3) + 1) as 1 | 2 | 3,
      status: 'first-draft',
      wordCount: countWords(content),
    });
  }

  const characters = charactersAdapter.addMany(
    charactersAdapter.getInitialState(),
    Array.from({ length: characterCount }, (_, i) => buildCharacter(i, rng)),
  );
  const worlds = worldsAdapter.addMany(
    worldsAdapter.getInitialState(),
    Array.from({ length: worldCount }, (_, i) => buildWorld(i, rng)),
  );

  // QNBS-v3 (CodeAnt): derive the goal from the ACTUAL generated manuscript (sum of section word
  // counts), so goal metadata can never disagree with the real corpus size.
  const generatedWordCount = manuscript.reduce((sum, s) => sum + (s.wordCount ?? 0), 0);

  return {
    id: 'bench-large-manuscript',
    title: 'The Forgetting Tide',
    logline: 'A salvager who maps drowned cities must remember the one name the sea erased.',
    author: 'Bench Author',
    characters,
    worlds,
    outline: [],
    manuscript,
    projectGoals: { totalWordCount: generatedWordCount, targetDate: null },
    writingHistory: [],
    binderNodes: [],
  };
}

/** Canonical word count used across the harness (whitespace-split, empties dropped). */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  return trimmed.split(/\s+/).length;
}

/** Total manuscript word count — the figure the fixture is sized against. */
export function totalWordCount(project: ProjectData): number {
  let total = 0;
  for (const section of project.manuscript) {
    total += countWords(section.content);
  }
  return total;
}
