/**
 * Locale-aware readability estimation — rein lokal, keine Netzwerk-Calls.
 * QNBS-v3: Flesch-Varianten je Sprache — EN/Flesch, DE/Amstad, FR/Kandel-Moles,
 *          ES/Fernández Huerta, IT/Gulpease — statt einer englischzentrierten Heuristik.
 */

// ── Language-specific vowel patterns ─────────────────────────────────────────

const VOWELS_BY_LOCALE: Record<string, RegExp> = {
  en: /[aeiouyAEIOUY]+/g,
  de: /[aeiouäöüAEIOUÄÖÜ]+/g,
  fr: /[aeiouyàâéèêëîïôùûüÀÂÉÈÊËÎÏÔÙÛÜ]+/g,
  es: /[aeiouáéíóúüAEIOUÁÉÍÓÚÜ]+/g,
  it: /[aeiouàèéìíîòóùúAEIOUÀÈÉÌÍÎÒÓÙÚ]+/g,
};

function getSyllablePattern(locale: string): RegExp {
  return VOWELS_BY_LOCALE[locale] ?? VOWELS_BY_LOCALE['en'] ?? /[aeiouyAEIOUY]+/g;
}

export function estimateSyllables(word: string, locale = 'en'): number {
  // Strip non-alpha chars (dashes ok for compound words)
  const w = word.replace(/[^a-zA-ZÀ-ÿ'-]/g, '');
  if (!w) return 0;
  const pattern = getSyllablePattern(locale);
  const matches = w.match(pattern);
  let n = matches?.length ?? 1;
  // Silent-e rule only applies to English
  if (locale === 'en' && /e$/i.test(w) && n > 1) n--;
  return Math.max(1, n);
}

// ── Language-specific readability formula ─────────────────────────────────────

/** Returns a readability score in the Flesch 0–100 range. */
function applyFormula(
  locale: string,
  asl: number, // Average Sentence Length (words/sentence)
  asw: number, // Average Syllables per Word
  wordCount: number,
  sentenceCount: number,
  letterCount: number,
): number {
  switch (locale) {
    // German: Amstad (1978) adaptation of Flesch for German
    case 'de':
      return 180 - asl - 58.5 * asw;

    // French: Kandel & Moles (1958)
    case 'fr':
      return 209 - 1.015 * asl - 68.85 * asw;

    // Spanish: Fernández Huerta (1959)
    case 'es':
      return 206.84 - 60 * asw - 1.02 * asl;

    // Italian: Gulpease index (letters-based, not syllable-based, rescaled to 0–100)
    case 'it':
      // Gulpease: 89 + (300 × sentences − 10 × letters) / words
      return 89 + (300 * sentenceCount - 10 * letterCount) / wordCount;

    // English (default): Flesch Reading Ease
    default:
      return 206.835 - 1.015 * asl - 84.6 * asw;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface ReadabilitySnapshot {
  /** Flesch-style score (0–100, higher = easier to read). */
  score: number | null;
  words: number;
  sentences: number;
  /** Which locale-specific heuristic was used. */
  locale: string;
}

/** Hard upper bound — prevent split/syllable scan over millions of chars. */
const HARD_MAX_INPUT = 80_000;

/**
 * Computes a locale-aware readability score.
 * Minimum 40 words required; returns null for short texts to avoid false precision.
 */
export function computeReadabilitySnapshot(text: string, locale = 'en'): ReadabilitySnapshot {
  const bounded = text.length > HARD_MAX_INPUT ? text.slice(0, HARD_MAX_INPUT) : text;
  const cleaned = bounded.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return { score: null, words: 0, sentences: 0, locale };
  }

  const words = cleaned.split(/\s+/).filter(Boolean);
  const sentenceEnds = cleaned.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const sentences = Math.max(1, sentenceEnds.length);
  const syllables = words.reduce((acc, w) => acc + estimateSyllables(w, locale), 0);
  const letterCount = cleaned.replace(/[^a-zA-ZÀ-ÿ]/g, '').length;

  if (words.length < 40) {
    return { score: null, words: words.length, sentences, locale };
  }

  const asl = words.length / sentences;
  const asw = syllables / words.length;
  const raw = applyFormula(locale, asl, asw, words.length, sentences, letterCount);
  const clamped = Math.round(Math.min(100, Math.max(0, raw)) * 10) / 10;
  return { score: clamped, words: words.length, sentences, locale };
}
