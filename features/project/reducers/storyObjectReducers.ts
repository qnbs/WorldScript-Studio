import type { PayloadAction } from '@reduxjs/toolkit';
import type { ObjectGroup, StoryObject } from '../../../types';
import type { ProjectSliceState } from '../projectState';

// QNBS-v3: Story Objects/Groups inventory reducer cases — cascade integrity preserved on delete.
export const storyObjectReducers = {
  addStoryObject: (state: ProjectSliceState, action: PayloadAction<StoryObject>) => {
    if (!state.data.storyObjects) state.data.storyObjects = [];
    state.data.storyObjects.push(action.payload);
  },
  updateStoryObject: (
    state: ProjectSliceState,
    // QNBS-v3: id AND groupIds excluded — id is referenced by objectGroups[*].objectIds and the
    // delete cascade; groupIds membership is reciprocal with objectGroups and must only change via
    // assign/removeObjectToGroup, else the two sides desync.
    action: PayloadAction<{ id: string; changes: Partial<Omit<StoryObject, 'id' | 'groupIds'>> }>,
  ) => {
    const obj = (state.data.storyObjects ?? []).find((o) => o.id === action.payload.id);
    if (obj) Object.assign(obj, action.payload.changes);
  },
  deleteStoryObject: (state: ProjectSliceState, action: PayloadAction<string>) => {
    const id = action.payload;
    state.data.storyObjects = (state.data.storyObjects ?? []).filter((o) => o.id !== id);
    // QNBS-v3: cascade remove from all groups so referential integrity is preserved.
    for (const g of state.data.objectGroups ?? []) {
      g.objectIds = g.objectIds.filter((oid) => oid !== id);
    }
  },
  addObjectGroup: (state: ProjectSliceState, action: PayloadAction<ObjectGroup>) => {
    if (!state.data.objectGroups) state.data.objectGroups = [];
    state.data.objectGroups.push(action.payload);
  },
  updateObjectGroup: (
    state: ProjectSliceState,
    // QNBS-v3: id AND objectIds excluded — id is referenced by storyObjects[*].groupIds, and
    // objectIds membership is reciprocal and must only change via assign/removeObjectToGroup.
    action: PayloadAction<{ id: string; changes: Partial<Omit<ObjectGroup, 'id' | 'objectIds'>> }>,
  ) => {
    const g = (state.data.objectGroups ?? []).find((g) => g.id === action.payload.id);
    if (g) Object.assign(g, action.payload.changes);
  },
  deleteObjectGroup: (state: ProjectSliceState, action: PayloadAction<string>) => {
    const id = action.payload;
    state.data.objectGroups = (state.data.objectGroups ?? []).filter((g) => g.id !== id);
    // QNBS-v3: cascade clear groupId from affected objects.
    for (const o of state.data.storyObjects ?? []) {
      o.groupIds = o.groupIds.filter((gid) => gid !== id);
    }
  },
  assignObjectToGroup: (
    state: ProjectSliceState,
    action: PayloadAction<{ objectId: string; groupId: string }>,
  ) => {
    const { objectId, groupId } = action.payload;
    const obj = (state.data.storyObjects ?? []).find((o) => o.id === objectId);
    const grp = (state.data.objectGroups ?? []).find((g) => g.id === groupId);
    // QNBS-v3: only wire the relation when BOTH ends exist — a stale/missing id would otherwise
    // write a one-sided reference and permanently desync groupIds vs objectIds.
    if (!obj || !grp) return;
    if (!obj.groupIds.includes(groupId)) obj.groupIds.push(groupId);
    if (!grp.objectIds.includes(objectId)) grp.objectIds.push(objectId);
  },
  removeObjectFromGroup: (
    state: ProjectSliceState,
    action: PayloadAction<{ objectId: string; groupId: string }>,
  ) => {
    const { objectId, groupId } = action.payload;
    const obj = (state.data.storyObjects ?? []).find((o) => o.id === objectId);
    const grp = (state.data.objectGroups ?? []).find((g) => g.id === groupId);
    if (obj) obj.groupIds = obj.groupIds.filter((gid) => gid !== groupId);
    if (grp) grp.objectIds = grp.objectIds.filter((oid) => oid !== objectId);
  },
};
