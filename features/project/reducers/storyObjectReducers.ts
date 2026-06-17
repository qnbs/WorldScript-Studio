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
    action: PayloadAction<{ id: string; changes: Partial<StoryObject> }>,
  ) => {
    const obj = (state.data.storyObjects ?? []).find((o) => o.id === action.payload.id);
    // QNBS-v3: never let an update rewrite the entity id — objectGroups[*].objectIds key on it and
    // deleteStoryObject's cascade matches by id, so an id change would orphan group cross-refs.
    if (obj) {
      const originalId = obj.id;
      Object.assign(obj, action.payload.changes);
      obj.id = originalId;
    }
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
    action: PayloadAction<{ id: string; changes: Partial<ObjectGroup> }>,
  ) => {
    const g = (state.data.objectGroups ?? []).find((g) => g.id === action.payload.id);
    // QNBS-v3: keep id immutable — storyObjects[*].groupIds reference it; a change would desync membership.
    if (g) {
      const originalId = g.id;
      Object.assign(g, action.payload.changes);
      g.id = originalId;
    }
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
    if (obj && !obj.groupIds.includes(groupId)) obj.groupIds.push(groupId);
    if (grp && !grp.objectIds.includes(objectId)) grp.objectIds.push(objectId);
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
