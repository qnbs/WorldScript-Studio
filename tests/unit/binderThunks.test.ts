import { describe, expect, it } from 'vitest';
import { collectSubtreeIds } from '../../features/project/thunks/binderThunks';
import type { BinderNode } from '../../types';

// QNBS-v3: the production delete path (removeBinderSubtreeWithAssetsThunk) walks the subtree via
// collectSubtreeIds BEFORE deleteBinderNode's reducer guard runs. A cyclic/corrupted parentId chain
// must terminate here too, otherwise the asset-cleanup loop recurses forever and hangs the thunk.

const node = (id: string, parentId: string | null): BinderNode => ({
  id,
  parentId,
  type: 'folder',
  title: id,
  sortIndex: 0,
});

describe('collectSubtreeIds', () => {
  it('collects a node and its full subtree', () => {
    const nodes = [node('root', null), node('a', 'root'), node('b', 'a'), node('other', null)];
    expect(collectSubtreeIds(nodes, 'root').sort()).toEqual(['a', 'b', 'root']);
  });

  it('terminates on a cyclic parentId chain (a -> b -> a) without infinite recursion', () => {
    const nodes = [node('a', 'b'), node('b', 'a')];
    const ids = collectSubtreeIds(nodes, 'a');
    // Visited guard dedupes and breaks the loop — each id appears exactly once.
    expect(ids.sort()).toEqual(['a', 'b']);
  });

  it('handles a self-referential parentId without hanging', () => {
    const nodes = [node('x', 'x')];
    expect(collectSubtreeIds(nodes, 'x')).toEqual(['x']);
  });
});
