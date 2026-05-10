/**
 * Begrenzte Textproben für Dashboard-Metriken — vermeidet Megabyte-Strings auf schwacher Hardware.
 * QNBS-v3: Lesbarkeit braucht keine vollständige Novelle im RAM.
 */

import type { StorySection } from '../types';

/** ~64k Zeichen reichen für Flesch-Stichprobe (>40 Wörter mit großem Puffer). */
export const READABILITY_SAMPLE_MAX_CHARS = 65_536;

export function sampleManuscriptPlainText(
  sections: StorySection[],
  maxChars = READABILITY_SAMPLE_MAX_CHARS,
): string {
  let acc = '';
  for (const s of sections) {
    const c = s.content ?? '';
    if (!c) continue;
    if (acc.length >= maxChars) break;
    const sep = acc.length > 0 ? '\n\n' : '';
    const room = maxChars - acc.length - sep.length;
    if (room <= 0) break;
    acc += sep + (c.length <= room ? c : c.slice(0, room));
  }
  return acc;
}
