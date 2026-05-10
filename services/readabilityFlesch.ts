/**
 * Lesbarkeits-Annäherung (Flesch Reading Ease, EN) — rein lokal, keine Netzwerk-Calls.
 * QNBS-v3: Dashboard-Insights für Schreibfluss ohne Cloud-Analyse.
 */

const VOWEL_RUN = /[aeiouyAEIOUY]+/g;

export function estimateSyllables(word: string): number {
  const w = word.replace(/[^a-zA-Z']/g, '');
  if (!w) return 0;
  const matches = w.match(VOWEL_RUN);
  let n = matches?.length ?? 1;
  if (/e$/i.test(w) && n > 1) n--;
  return Math.max(1, n);
}

export interface ReadabilitySnapshot {
  /** Flesch Reading Ease (ca. 0–100, höher = leichter). */
  score: number | null;
  words: number;
  sentences: number;
}

/** Harte Obergrenze — verhindert `split`/Syllable-Scan über Millionen Zeichen. */
const HARD_MAX_INPUT = 80_000;

/**
 * Englisch-lastige Heuristik; kurze Texte liefern `null`, um keine falsch-präzisen Zahlen vorzugaukeln.
 */
export function computeReadabilitySnapshot(text: string): ReadabilitySnapshot {
  const bounded = text.length > HARD_MAX_INPUT ? text.slice(0, HARD_MAX_INPUT) : text;
  const cleaned = bounded.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return { score: null, words: 0, sentences: 0 };
  }

  const words = cleaned.split(/\s+/).filter(Boolean);
  const sentenceEnds = cleaned.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const sentences = Math.max(1, sentenceEnds.length);
  const syllables = words.reduce((acc, w) => acc + estimateSyllables(w), 0);

  if (words.length < 40) {
    return { score: null, words: words.length, sentences };
  }

  const score = 206.835 - 1.015 * (words.length / sentences) - 84.6 * (syllables / words.length);
  const clamped = Math.round(Math.min(100, Math.max(0, score)) * 10) / 10;
  return { score: clamped, words: words.length, sentences };
}
