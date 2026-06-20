import { describe, expect, it } from 'vitest';
import projectReducer, { projectActions } from '../../features/project/projectSlice';
import type { ObjectGroup, StoryObject } from '../../types';

// Minimal state shape accepted by the raw inner reducer
type TestState = Parameters<typeof projectReducer>[0];

const BASE: TestState = {
  data: {
    title: '',
    logline: '',
    characters: { ids: [], entities: {} },
    worlds: { ids: [], entities: {} },
    outline: [],
    manuscript: [],
  },
};

const obj = (overrides?: Partial<StoryObject>): StoryObject => ({
  id: 'obj-1',
  name: 'Magic Sword',
  description: 'A legendary blade',
  type: 'weapon',
  groupIds: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const grp = (overrides?: Partial<ObjectGroup>): ObjectGroup => ({
  id: 'grp-1',
  name: 'Weapons',
  color: '#ef4444',
  objectIds: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('projectSlice — storyObjects reducers', () => {
  it('addStoryObject lazily initialises the array and appends', () => {
    const next = projectReducer(BASE, projectActions.addStoryObject(obj()));
    expect(next.data.storyObjects).toHaveLength(1);
    expect(next.data.storyObjects![0]!.name).toBe('Magic Sword');
  });

  it('updateStoryObject mutates only the target object', () => {
    const state = {
      ...BASE,
      data: { ...BASE.data, storyObjects: [obj(), obj({ id: 'obj-2', name: 'Shield' })] },
    };
    const next = projectReducer(
      state,
      projectActions.updateStoryObject({ id: 'obj-1', changes: { name: 'Holy Sword' } }),
    );
    expect(next.data.storyObjects![0]!.name).toBe('Holy Sword');
    expect(next.data.storyObjects![1]!.name).toBe('Shield');
  });

  it('updateStoryObject ignores an id change to preserve group cross-refs', () => {
    const state = {
      ...BASE,
      data: {
        ...BASE.data,
        storyObjects: [obj({ groupIds: ['grp-1'] })],
        objectGroups: [grp({ objectIds: ['obj-1'] })],
      },
    };
    const next = projectReducer(
      state,
      projectActions.updateStoryObject({ id: 'obj-1', changes: { name: 'Renamed' } }),
    );
    expect(next.data.storyObjects![0]!.id).toBe('obj-1'); // id is immutable (excluded from changes type)
    expect(next.data.storyObjects![0]!.name).toBe('Renamed');
    // deletion cascade still resolves because the id never drifted from the group reference
    const after = projectReducer(next, projectActions.deleteStoryObject('obj-1'));
    expect(after.data.objectGroups![0]!.objectIds).toHaveLength(0);
  });

  it('deleteStoryObject removes the object and cascades groupIds in all groups', () => {
    const state = {
      ...BASE,
      data: {
        ...BASE.data,
        storyObjects: [obj({ groupIds: ['grp-1'] })],
        objectGroups: [grp({ objectIds: ['obj-1'] })],
      },
    };
    const next = projectReducer(state, projectActions.deleteStoryObject('obj-1'));
    expect(next.data.storyObjects).toHaveLength(0);
    expect(next.data.objectGroups![0]!.objectIds).toHaveLength(0);
  });

  it('deleteStoryObject is a no-op for unknown id', () => {
    const state = { ...BASE, data: { ...BASE.data, storyObjects: [obj()] } };
    const next = projectReducer(state, projectActions.deleteStoryObject('unknown'));
    expect(next.data.storyObjects).toHaveLength(1);
  });
});

describe('projectSlice — objectGroups reducers', () => {
  it('addObjectGroup lazily initialises and appends', () => {
    const next = projectReducer(BASE, projectActions.addObjectGroup(grp()));
    expect(next.data.objectGroups).toHaveLength(1);
    expect(next.data.objectGroups![0]!.name).toBe('Weapons');
  });

  it('updateObjectGroup updates only the target', () => {
    const state = {
      ...BASE,
      data: { ...BASE.data, objectGroups: [grp(), grp({ id: 'grp-2', name: 'Tools' })] },
    };
    const next = projectReducer(
      state,
      projectActions.updateObjectGroup({ id: 'grp-1', changes: { name: 'Blades' } }),
    );
    expect(next.data.objectGroups![0]!.name).toBe('Blades');
    expect(next.data.objectGroups![1]!.name).toBe('Tools');
  });

  it('updateObjectGroup ignores an id change to preserve membership refs', () => {
    const state = {
      ...BASE,
      data: { ...BASE.data, objectGroups: [grp()] },
    };
    const next = projectReducer(
      state,
      projectActions.updateObjectGroup({ id: 'grp-1', changes: { name: 'Blades' } }),
    );
    expect(next.data.objectGroups![0]!.id).toBe('grp-1'); // id immutable (excluded from changes type)
    expect(next.data.objectGroups![0]!.name).toBe('Blades');
  });

  it('deleteObjectGroup removes the group and clears groupIds on objects', () => {
    const state = {
      ...BASE,
      data: {
        ...BASE.data,
        storyObjects: [obj({ groupIds: ['grp-1'] })],
        objectGroups: [grp()],
      },
    };
    const next = projectReducer(state, projectActions.deleteObjectGroup('grp-1'));
    expect(next.data.objectGroups).toHaveLength(0);
    expect(next.data.storyObjects![0]!.groupIds).toHaveLength(0);
  });

  it('assignObjectToGroup adds cross-references on both sides', () => {
    const state = {
      ...BASE,
      data: { ...BASE.data, storyObjects: [obj()], objectGroups: [grp()] },
    };
    const next = projectReducer(
      state,
      projectActions.assignObjectToGroup({ objectId: 'obj-1', groupId: 'grp-1' }),
    );
    expect(next.data.storyObjects![0]!.groupIds).toContain('grp-1');
    expect(next.data.objectGroups![0]!.objectIds).toContain('obj-1');
  });

  it('assignObjectToGroup is idempotent — no duplicate entries', () => {
    const state = {
      ...BASE,
      data: {
        ...BASE.data,
        storyObjects: [obj({ groupIds: ['grp-1'] })],
        objectGroups: [grp({ objectIds: ['obj-1'] })],
      },
    };
    const next = projectReducer(
      state,
      projectActions.assignObjectToGroup({ objectId: 'obj-1', groupId: 'grp-1' }),
    );
    expect(next.data.storyObjects![0]!.groupIds).toHaveLength(1);
    expect(next.data.objectGroups![0]!.objectIds).toHaveLength(1);
  });

  it('removeObjectFromGroup clears cross-references on both sides', () => {
    const state = {
      ...BASE,
      data: {
        ...BASE.data,
        storyObjects: [obj({ groupIds: ['grp-1'] })],
        objectGroups: [grp({ objectIds: ['obj-1'] })],
      },
    };
    const next = projectReducer(
      state,
      projectActions.removeObjectFromGroup({ objectId: 'obj-1', groupId: 'grp-1' }),
    );
    expect(next.data.storyObjects![0]!.groupIds).toHaveLength(0);
    expect(next.data.objectGroups![0]!.objectIds).toHaveLength(0);
  });
});
