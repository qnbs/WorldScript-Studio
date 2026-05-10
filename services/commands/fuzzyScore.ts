/** Normalisiert für Palette-Suche (ASCII-freundlich). */
export function normalizeSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** Subsequence match + kleiner Bonus für Wortanfänge. Score 0 = kein Treffer. */
export function scoreAgainstQuery(queryNorm: string, ...haystacks: string[]): number {
  if (!queryNorm) return 1;
  let best = 0;
  for (const raw of haystacks) {
    const h = normalizeSearch(raw);
    if (!h) continue;
    const sc = subsequenceScore(queryNorm, h);
    if (sc > best) best = sc;
  }
  return best;
}

function subsequenceScore(q: string, h: string): number {
  let qi = 0;
  let consecutive = 0;
  let maxConsecutive = 0;
  let wordBonus = 0;

  for (let hi = 0; hi < h.length && qi < q.length; hi++) {
    const qc = q[qi];
    const hc = h[hi];
    if (qc === undefined) break;
    if (qc === hc) {
      const prev = hi > 0 ? h[hi - 1] : ' ';
      if (prev === ' ' || prev === '-' || prev === '/') wordBonus += 3;
      qi++;
      consecutive++;
      maxConsecutive = Math.max(maxConsecutive, consecutive);
    } else {
      consecutive = 0;
    }
  }

  if (qi < q.length) return 0;

  const coverage = q.length / Math.max(h.length, 1);
  return 50 + maxConsecutive * 4 + wordBonus + coverage * 20;
}

export type HighlightSegment = { text: string; match: boolean };

/** Hebt maximal eine zusammenhängende Subsequence im Text hervor (UI-Hilfe). */
export function highlightSubsequence(queryNorm: string, displayText: string): HighlightSegment[] {
  if (!queryNorm) return [{ text: displayText, match: false }];
  const lower = displayText.toLowerCase();
  let qi = 0;
  const parts: HighlightSegment[] = [];
  let buf = '';
  let inMatch = false;

  for (let i = 0; i < displayText.length; i++) {
    const ch = displayText[i];
    const lc = lower[i];
    const qch = queryNorm[qi];
    const matches = qi < queryNorm.length && lc === qch;
    const nextInMatch = matches;

    if (nextInMatch !== inMatch && buf) {
      parts.push({ text: buf, match: inMatch });
      buf = '';
      inMatch = nextInMatch;
    } else if (buf === '' && i === 0) {
      inMatch = nextInMatch;
    }

    buf += ch;
    if (matches) qi++;
  }

  if (buf) parts.push({ text: buf, match: inMatch });

  return parts.length ? parts : [{ text: displayText, match: false }];
}
