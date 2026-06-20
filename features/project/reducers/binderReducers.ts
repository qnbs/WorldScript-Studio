import type { PayloadAction } from '@reduxjs/toolkit';
import type { BinderNode, CompileProfile, ProjectAiPreset } from '../../../types';
import type { ProjectSliceState } from '../projectState';

// QNBS-v3: Binder/research nodes, compile profile, and per-project AI preset reducer cases.
export const binderReducers = {
  // QNBS-v3: Binder / research nodes offline-first in the project — extends the classic author pipeline without cloud.
  setBinderNodes: (state: ProjectSliceState, action: PayloadAction<BinderNode[]>) => {
    state.data.binderNodes = action.payload;
  },
  addBinderNode: (state: ProjectSliceState, action: PayloadAction<BinderNode>) => {
    if (!state.data.binderNodes) state.data.binderNodes = [];
    state.data.binderNodes.push(action.payload);
  },
  updateBinderNode: (
    state: ProjectSliceState,
    // QNBS-v3: id excluded from changes — child nodes keep parentId pointers and the delete/update
    // lookups match by id, so a renamed id would orphan whole subtrees.
    action: PayloadAction<{ id: string; changes: Partial<Omit<BinderNode, 'id'>> }>,
  ) => {
    const nodes = state.data.binderNodes;
    if (!nodes) return;
    const idx = nodes.findIndex((n) => n.id === action.payload.id);
    if (idx === -1) return;
    const node = nodes[idx];
    if (node) Object.assign(node, action.payload.changes);
  },
  deleteBinderNode: (state: ProjectSliceState, action: PayloadAction<string>) => {
    const rootId = action.payload;
    const nodes = state.data.binderNodes;
    if (!nodes?.length) return;
    const toRemove = new Set<string>();
    const collect = (pid: string) => {
      // QNBS-v3: visited guard — a cyclic binder (corrupted/imported parentId loop) would otherwise
      // recurse forever; the Set already dedupes removal, this also breaks the recursion.
      if (toRemove.has(pid)) return;
      toRemove.add(pid);
      for (const n of nodes) {
        if (n.parentId === pid) collect(n.id);
      }
    };
    collect(rootId);
    state.data.binderNodes = nodes.filter((n) => !toRemove.has(n.id));
  },
  updateCompileProfile: (
    state: ProjectSliceState,
    action: PayloadAction<Partial<CompileProfile>>,
  ) => {
    state.data.compileProfile = { ...state.data.compileProfile, ...action.payload };
  },
  // QNBS-v3: Per-project AI preset — patch individual fields to avoid full-object overwrites.
  setProjectAiPreset: (state: ProjectSliceState, action: PayloadAction<ProjectAiPreset>) => {
    state.data.aiPreset = action.payload;
  },
  patchProjectAiPreset: (
    state: ProjectSliceState,
    action: PayloadAction<Partial<ProjectAiPreset>>,
  ) => {
    state.data.aiPreset = { enabled: false, ...state.data.aiPreset, ...action.payload };
  },
  clearProjectAiPreset: (state: ProjectSliceState) => {
    delete state.data.aiPreset;
  },
};
