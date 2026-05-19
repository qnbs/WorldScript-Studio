import { describe, expect, it } from 'vitest';
import sceneCommentsReducer, {
  type SceneCommentsState,
  sceneCommentsActions,
  selectAllComments,
  selectCommentsBySection,
  selectUnresolvedCount,
  selectUnresolvedCountBySection,
} from '../../features/sceneComments/sceneCommentsSlice';
import type { CommentReply, SceneComment } from '../../types';

function makeComment(overrides: Partial<SceneComment> = {}): SceneComment {
  return {
    id: 'c1',
    sectionId: 'sec1',
    createdAt: 1000,
    authorName: 'Alice',
    authorColor: '#f00',
    body: 'Hello',
    resolved: false,
    replies: [],
    ...overrides,
  };
}

function makeState(comments: SceneComment[] = []): SceneCommentsState {
  const state = sceneCommentsReducer(undefined, { type: '@@INIT' });
  return comments.reduce((s, c) => {
    return sceneCommentsReducer(s, sceneCommentsActions.addComment(c));
  }, state);
}

describe('sceneCommentsSlice', () => {
  it('starts empty', () => {
    const state = sceneCommentsReducer(undefined, { type: '@@INIT' });
    expect(selectAllComments({ sceneComments: state })).toHaveLength(0);
  });

  it('addComment adds a comment', () => {
    const state = makeState([makeComment()]);
    expect(selectAllComments({ sceneComments: state })).toHaveLength(1);
  });

  it('resolveComment marks as resolved', () => {
    const state = makeState([makeComment({ id: 'c1' })]);
    const next = sceneCommentsReducer(state, sceneCommentsActions.resolveComment('c1'));
    const comment = selectAllComments({ sceneComments: next })[0];
    expect(comment?.resolved).toBe(true);
  });

  it('unresolveComment reopens a resolved comment', () => {
    const state = makeState([makeComment({ id: 'c1', resolved: true })]);
    const next = sceneCommentsReducer(state, sceneCommentsActions.unresolveComment('c1'));
    const comment = selectAllComments({ sceneComments: next })[0];
    expect(comment?.resolved).toBe(false);
  });

  it('addReply appends reply to comment', () => {
    const state = makeState([makeComment({ id: 'c1' })]);
    const reply: CommentReply = {
      id: 'r1',
      createdAt: 2000,
      authorName: 'Bob',
      authorColor: '#00f',
      body: 'Reply',
    };
    const next = sceneCommentsReducer(
      state,
      sceneCommentsActions.addReply({ commentId: 'c1', reply }),
    );
    const comment = selectAllComments({ sceneComments: next })[0];
    expect(comment?.replies).toHaveLength(1);
    expect(comment?.replies[0]?.body).toBe('Reply');
  });

  it('addReply does nothing for missing comment', () => {
    const state = makeState([makeComment({ id: 'c1' })]);
    const reply: CommentReply = {
      id: 'r1',
      createdAt: 2000,
      authorName: 'Bob',
      authorColor: '#00f',
      body: 'Noop',
    };
    const next = sceneCommentsReducer(
      state,
      sceneCommentsActions.addReply({ commentId: 'missing', reply }),
    );
    expect(selectAllComments({ sceneComments: next })).toHaveLength(1);
  });

  it('deleteComment removes a comment', () => {
    const state = makeState([makeComment({ id: 'c1' })]);
    const next = sceneCommentsReducer(state, sceneCommentsActions.deleteComment('c1'));
    expect(selectAllComments({ sceneComments: next })).toHaveLength(0);
  });

  it('deleteCommentsForSection removes only that section', () => {
    const state = makeState([
      makeComment({ id: 'c1', sectionId: 'sec1' }),
      makeComment({ id: 'c2', sectionId: 'sec2' }),
    ]);
    const next = sceneCommentsReducer(state, sceneCommentsActions.deleteCommentsForSection('sec1'));
    const remaining = selectAllComments({ sceneComments: next });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe('c2');
  });

  it('selectCommentsBySection returns only that section', () => {
    const state = makeState([
      makeComment({ id: 'c1', sectionId: 'sec1' }),
      makeComment({ id: 'c2', sectionId: 'sec2' }),
    ]);
    const result = selectCommentsBySection('sec1')({ sceneComments: state });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('c1');
  });

  it('selectUnresolvedCount counts only unresolved', () => {
    const state = makeState([
      makeComment({ id: 'c1', resolved: false }),
      makeComment({ id: 'c2', resolved: true }),
      makeComment({ id: 'c3', resolved: false }),
    ]);
    expect(selectUnresolvedCount({ sceneComments: state })).toBe(2);
  });

  it('selectUnresolvedCountBySection counts by section', () => {
    const state = makeState([
      makeComment({ id: 'c1', sectionId: 'sec1', resolved: false }),
      makeComment({ id: 'c2', sectionId: 'sec1', resolved: true }),
      makeComment({ id: 'c3', sectionId: 'sec2', resolved: false }),
    ]);
    expect(selectUnresolvedCountBySection('sec1')({ sceneComments: state })).toBe(1);
  });

  it('selectUnresolvedCountBySection returns 0 for empty section', () => {
    const state = makeState([makeComment({ id: 'c1', sectionId: 'sec1' })]);
    expect(selectUnresolvedCountBySection('sec999')({ sceneComments: state })).toBe(0);
  });

  it('ignores addReply for unknown comment without crashing', () => {
    const state = makeState([]);
    const reply: CommentReply = {
      id: 'r1',
      createdAt: 1,
      authorName: 'X',
      authorColor: '#000',
      body: 'y',
    };
    expect(() =>
      sceneCommentsReducer(state, sceneCommentsActions.addReply({ commentId: 'nope', reply })),
    ).not.toThrow();
  });
});
