// QNBS-v3: Scene comments stored in Redux (not IDB) — small data, per-session collaborative editing.
//          EntityState for O(1) lookups; persisted to localStorage via custom middleware.
import {
  createEntityAdapter,
  createSelector,
  createSlice,
  type PayloadAction,
} from '@reduxjs/toolkit';
import type { CommentReply, SceneComment } from '../../types';

const commentsAdapter = createEntityAdapter<SceneComment>();

export interface SceneCommentsState {
  comments: ReturnType<typeof commentsAdapter.getInitialState>;
}

const STORAGE_KEY = 'worldscript-scene-comments';

const loadState = (): SceneCommentsState => {
  if (typeof window === 'undefined') {
    return { comments: commentsAdapter.getInitialState() };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { comments: commentsAdapter.getInitialState() };
    const parsed = JSON.parse(raw) as { comments: SceneComment[] };
    return { comments: commentsAdapter.setAll(commentsAdapter.getInitialState(), parsed.comments) };
  } catch {
    return { comments: commentsAdapter.getInitialState() };
  }
};

const sceneCommentsSlice = createSlice({
  name: 'sceneComments',
  initialState: loadState,
  reducers: {
    addComment(state, action: PayloadAction<SceneComment>) {
      commentsAdapter.addOne(state.comments, action.payload);
    },
    resolveComment(state, action: PayloadAction<string>) {
      commentsAdapter.updateOne(state.comments, {
        id: action.payload,
        changes: { resolved: true },
      });
    },
    unresolveComment(state, action: PayloadAction<string>) {
      commentsAdapter.updateOne(state.comments, {
        id: action.payload,
        changes: { resolved: false },
      });
    },
    addReply(state, action: PayloadAction<{ commentId: string; reply: CommentReply }>) {
      const comment = state.comments.entities[action.payload.commentId];
      if (!comment) return;
      commentsAdapter.updateOne(state.comments, {
        id: action.payload.commentId,
        changes: { replies: [...comment.replies, action.payload.reply] },
      });
    },
    deleteComment(state, action: PayloadAction<string>) {
      commentsAdapter.removeOne(state.comments, action.payload);
    },
    deleteCommentsForSection(state, action: PayloadAction<string>) {
      const toRemove = Object.values(state.comments.entities)
        .filter((c): c is SceneComment => !!c && c.sectionId === action.payload)
        .map((c) => c.id);
      commentsAdapter.removeMany(state.comments, toRemove);
    },
  },
});

export const sceneCommentsActions = sceneCommentsSlice.actions;

// ── Selectors ─────────────────────────────────────────────────────────────────

const commentsSelectors = commentsAdapter.getSelectors();

export const selectAllComments = (state: { sceneComments: SceneCommentsState }) =>
  commentsSelectors.selectAll(state.sceneComments.comments);

export const selectCommentsBySection = (sectionId: string) =>
  createSelector(selectAllComments, (all) => all.filter((c) => c.sectionId === sectionId));

export const selectUnresolvedCount = (state: { sceneComments: SceneCommentsState }) =>
  commentsSelectors.selectAll(state.sceneComments.comments).filter((c) => !c.resolved).length;

export const selectUnresolvedCountBySection = (sectionId: string) =>
  createSelector(
    selectAllComments,
    (all) => all.filter((c) => c.sectionId === sectionId && !c.resolved).length,
  );

// ── Persistence middleware ────────────────────────────────────────────────────
import type { Middleware } from '@reduxjs/toolkit';

export const sceneCommentsPersistenceMiddleware: Middleware<unknown, unknown> =
  (storeAPI) => (next) => (action) => {
    const result = next(action);
    const actionType = (action as { type?: string }).type;
    if (typeof actionType === 'string' && actionType.startsWith('sceneComments/')) {
      try {
        const state = storeAPI.getState() as { sceneComments: SceneCommentsState };
        const comments = commentsSelectors.selectAll(state.sceneComments.comments);
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ comments }));
      } catch {
        // localStorage may be unavailable
      }
    }
    return result;
  };

export default sceneCommentsSlice.reducer;
