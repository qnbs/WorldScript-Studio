/**
 * Token-basierter Diff für eine Zeile (Wörter + Whitespace) — ohne externes Paket.
 * QNBS-v3: VC-Vergleich mit Wort-Hervorhebung bei geänderten Zeilen.
 */

export type TokenDiffOp =
  | { type: 'equal'; token: string }
  | { type: 'delete'; token: string }
  | { type: 'insert'; token: string };

/** Klein halten für schwache CPUs — bei Überschreitung Zeilen-Gesamtdiff statt LCS. */
const MAX_DP_CELLS = 80_000;

/** Sehr lange Zeilen: kein Wort-LCS (speicher-/CPU-intensiv). */
export const MAX_CHARS_WORD_DIFF_LINE = 1200;

/** Zerlegt eine Zeile in Whitespace- und Nicht-Whitespace-Tokens. */
export function tokenizeWordsAndSpaces(line: string): string[] {
  if (!line) return [];
  return line.match(/\s+|\S+/g) ?? [line];
}

function buildLcsTable(a: string[], b: string[]): number[][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const ai = a[i - 1];
      const bj = b[j - 1];
      const prev = dp[i - 1]?.[j - 1] ?? 0;
      const up = dp[i - 1]?.[j] ?? 0;
      const left = dp[i]?.[j - 1] ?? 0;
      const row = dp[i];
      if (!row) continue;
      row[j] = ai === bj ? prev + 1 : Math.max(up, left);
    }
  }
  return dp;
}

/** Myers-artiger Backtrack über LCS-Tabelle → gleich / löschen / einfügen. */
export function diffTokensToOps(a: string[], b: string[]): TokenDiffOp[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n * m > MAX_DP_CELLS) {
    if (n === 0) return b.map((token) => ({ type: 'insert' as const, token }));
    if (m === 0) return a.map((token) => ({ type: 'delete' as const, token }));
    return [
      { type: 'delete', token: a.join('') },
      { type: 'insert', token: b.join('') },
    ];
  }

  const dp = buildLcsTable(a, b);
  const opsRev: TokenDiffOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const aPrev = i > 0 ? a[i - 1] : undefined;
    const bPrev = j > 0 ? b[j - 1] : undefined;
    const leftScore = dp[i]?.[j - 1] ?? 0;
    const upScore = dp[i - 1]?.[j] ?? 0;
    if (i > 0 && j > 0 && aPrev === bPrev && aPrev !== undefined) {
      opsRev.push({ type: 'equal', token: aPrev });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || leftScore >= upScore) && bPrev !== undefined) {
      opsRev.push({ type: 'insert', token: bPrev });
      j--;
    } else if (i > 0 && aPrev !== undefined) {
      opsRev.push({ type: 'delete', token: aPrev });
      i--;
    }
  }
  opsRev.reverse();
  return opsRev;
}
