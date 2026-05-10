import { describe, expect, it } from 'vitest';
import { diffTokensToOps, tokenizeWordsAndSpaces } from '../../services/wordDiff';

describe('wordDiff', () => {
  it('tokenizes words and whitespace', () => {
    expect(tokenizeWordsAndSpaces('a  b')).toEqual(['a', '  ', 'b']);
  });

  it('diffTokensToOps marks insert/delete/equal', () => {
    const ops = diffTokensToOps(
      tokenizeWordsAndSpaces('the cat'),
      tokenizeWordsAndSpaces('the dog'),
    );
    expect(ops.some((o) => o.type === 'equal')).toBe(true);
    expect(ops.some((o) => o.type === 'delete')).toBe(true);
    expect(ops.some((o) => o.type === 'insert')).toBe(true);
  });
});
