/**
 * Tests for hooks/useObjectsView.ts
 * QNBS-v3: Covers CRUD for objects/groups, search filtering, group assignment, form state.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();

vi.mock('uuid', () => ({ v4: () => 'new-uuid' }));

const OBJ_1 = {
  id: 'obj-1',
  name: 'Sword of Dawn',
  description: 'A magical sword',
  type: 'weapon' as const,
  significance: 'Very important',
  notes: '',
  groupIds: ['grp-1'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const OBJ_2 = {
  id: 'obj-2',
  name: 'Ancient Map',
  description: 'Points to treasure',
  type: 'document' as const,
  significance: 'Key item',
  notes: '',
  groupIds: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const GRP_1 = {
  id: 'grp-1',
  name: 'Weapons',
  description: '',
  color: '#ff0000',
  objectIds: ['obj-1'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

let mockObjects = [OBJ_1, OBJ_2];
let mockGroups = [GRP_1];

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({
      project: {
        present: {
          data: {
            storyObjects: mockObjects,
            objectGroups: mockGroups,
          },
        },
      },
    }),
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

vi.mock('../../../features/project/projectSelectors', () => ({
  selectStoryObjects: (s: {
    project: { present: { data: { storyObjects: typeof mockObjects } } };
  }) => s.project.present.data.storyObjects,
  selectObjectGroups: (s: {
    project: { present: { data: { objectGroups: typeof mockGroups } } };
  }) => s.project.present.data.objectGroups,
}));

vi.mock('../../../features/project/projectSlice', () => ({
  projectActions: {
    addStoryObject: vi.fn((o) => ({ type: 'project/addStoryObject', payload: o })),
    updateStoryObject: vi.fn((p) => ({ type: 'project/updateStoryObject', payload: p })),
    deleteStoryObject: vi.fn((id) => ({ type: 'project/deleteStoryObject', payload: id })),
    addObjectGroup: vi.fn((g) => ({ type: 'project/addObjectGroup', payload: g })),
    updateObjectGroup: vi.fn((p) => ({ type: 'project/updateObjectGroup', payload: p })),
    deleteObjectGroup: vi.fn((id) => ({ type: 'project/deleteObjectGroup', payload: id })),
    assignObjectToGroup: vi.fn((p) => ({ type: 'project/assignObjectToGroup', payload: p })),
    removeObjectFromGroup: vi.fn((p) => ({ type: 'project/removeObjectFromGroup', payload: p })),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { projectActions } from '../../../features/project/projectSlice';
import { useObjectsView } from '../../../hooks/useObjectsView';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useObjectsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockObjects = [{ ...OBJ_1 }, { ...OBJ_2 }];
    mockGroups = [{ ...GRP_1 }];
  });

  it('returns all objects and groups', () => {
    const { result } = renderHook(() => useObjectsView());
    expect(result.current.objects).toHaveLength(2);
    expect(result.current.groups).toHaveLength(1);
  });

  describe('filteredObjects', () => {
    it('returns all objects when searchQuery is empty', () => {
      const { result } = renderHook(() => useObjectsView());
      expect(result.current.filteredObjects).toHaveLength(2);
    });

    it('filters by name', () => {
      const { result } = renderHook(() => useObjectsView());
      act(() => result.current.setSearchQuery('sword'));
      expect(result.current.filteredObjects).toHaveLength(1);
      expect(result.current.filteredObjects[0].name).toBe('Sword of Dawn');
    });

    it('filters by description', () => {
      const { result } = renderHook(() => useObjectsView());
      act(() => result.current.setSearchQuery('treasure'));
      expect(result.current.filteredObjects).toHaveLength(1);
      expect(result.current.filteredObjects[0].id).toBe('obj-2');
    });

    it('filters by type', () => {
      const { result } = renderHook(() => useObjectsView());
      act(() => result.current.setSearchQuery('weapon'));
      expect(result.current.filteredObjects).toHaveLength(1);
    });

    it('filters by group', () => {
      const { result } = renderHook(() => useObjectsView());
      act(() => result.current.setSelectedGroupFilter('grp-1'));
      expect(result.current.filteredObjects).toHaveLength(1);
      expect(result.current.filteredObjects[0].id).toBe('obj-1');
    });

    it('filters for ungrouped objects', () => {
      const { result } = renderHook(() => useObjectsView());
      act(() => result.current.setSelectedGroupFilter('ungrouped'));
      expect(result.current.filteredObjects).toHaveLength(1);
      expect(result.current.filteredObjects[0].id).toBe('obj-2');
    });
  });

  describe('object form', () => {
    it('opens form for adding new object', () => {
      const { result } = renderHook(() => useObjectsView());
      act(() => result.current.handleAddObject());
      expect(result.current.isObjectFormOpen).toBe(true);
      expect(result.current.editingObject).toBeNull();
    });

    it('opens form for editing an object', () => {
      const { result } = renderHook(() => useObjectsView());
      act(() => result.current.handleEditObject(OBJ_1));
      expect(result.current.isObjectFormOpen).toBe(true);
      expect(result.current.editingObject?.id).toBe('obj-1');
    });

    it('dispatches addStoryObject when saving new object', () => {
      const { result } = renderHook(() => useObjectsView());
      act(() => result.current.handleAddObject());
      act(() => {
        result.current.handleSaveObject({
          name: 'New Item',
          description: 'desc',
          type: 'misc',
          significance: 'low',
          notes: '',
        });
      });
      expect(projectActions.addStoryObject).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Item', id: 'new-uuid' }),
      );
      expect(result.current.isObjectFormOpen).toBe(false);
    });

    it('dispatches updateStoryObject when saving existing object', () => {
      const { result } = renderHook(() => useObjectsView());
      act(() => result.current.handleEditObject(OBJ_1));
      act(() => {
        result.current.handleSaveObject({
          name: 'Updated Sword',
          description: 'upgraded',
          type: 'weapon',
          significance: 'critical',
          notes: '',
        });
      });
      expect(projectActions.updateStoryObject).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'obj-1' }),
      );
    });

    it('dispatches deleteStoryObject', () => {
      const { result } = renderHook(() => useObjectsView());
      act(() => result.current.handleDeleteObject('obj-1'));
      expect(projectActions.deleteStoryObject).toHaveBeenCalledWith('obj-1');
    });
  });

  describe('group form', () => {
    it('opens form for adding new group', () => {
      const { result } = renderHook(() => useObjectsView());
      act(() => result.current.handleAddGroup());
      expect(result.current.isGroupFormOpen).toBe(true);
      expect(result.current.editingGroup).toBeNull();
    });

    it('opens form for editing a group', () => {
      const { result } = renderHook(() => useObjectsView());
      act(() => result.current.handleEditGroup(GRP_1));
      expect(result.current.isGroupFormOpen).toBe(true);
      expect(result.current.editingGroup?.id).toBe('grp-1');
    });

    it('dispatches addObjectGroup when saving new group', () => {
      const { result } = renderHook(() => useObjectsView());
      act(() => result.current.handleAddGroup());
      act(() => {
        result.current.handleSaveGroup({ name: 'Armor', description: '', color: '#blue' });
      });
      expect(projectActions.addObjectGroup).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Armor' }),
      );
    });

    it('dispatches updateObjectGroup when saving existing group', () => {
      const { result } = renderHook(() => useObjectsView());
      act(() => result.current.handleEditGroup(GRP_1));
      act(() => {
        result.current.handleSaveGroup({
          name: 'Blades',
          description: 'sharp things',
          color: '#333',
        });
      });
      expect(projectActions.updateObjectGroup).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'grp-1' }),
      );
    });

    it('dispatches deleteObjectGroup and clears group filter', () => {
      const { result } = renderHook(() => useObjectsView());
      act(() => result.current.setSelectedGroupFilter('grp-1'));
      act(() => result.current.handleDeleteGroup('grp-1'));
      expect(projectActions.deleteObjectGroup).toHaveBeenCalledWith('grp-1');
      expect(result.current.selectedGroupFilter).toBeNull();
    });
  });

  describe('group assignment', () => {
    it('dispatches assignObjectToGroup', () => {
      const { result } = renderHook(() => useObjectsView());
      act(() => result.current.handleAssignToGroup('obj-2', 'grp-1'));
      expect(projectActions.assignObjectToGroup).toHaveBeenCalledWith({
        objectId: 'obj-2',
        groupId: 'grp-1',
      });
    });

    it('dispatches removeObjectFromGroup', () => {
      const { result } = renderHook(() => useObjectsView());
      act(() => result.current.handleRemoveFromGroup('obj-1', 'grp-1'));
      expect(projectActions.removeObjectFromGroup).toHaveBeenCalledWith({
        objectId: 'obj-1',
        groupId: 'grp-1',
      });
    });
  });

  describe('handleCancelForm', () => {
    it('closes all forms and clears editing state', () => {
      const { result } = renderHook(() => useObjectsView());
      act(() => result.current.handleEditObject(OBJ_1));
      act(() => result.current.handleCancelForm());
      expect(result.current.isObjectFormOpen).toBe(false);
      expect(result.current.editingObject).toBeNull();
    });
  });

  describe('tab and search state', () => {
    it('switches active tab', () => {
      const { result } = renderHook(() => useObjectsView());
      expect(result.current.activeTab).toBe('objects');
      act(() => result.current.setActiveTab('groups'));
      expect(result.current.activeTab).toBe('groups');
    });

    it('updates searchQuery', () => {
      const { result } = renderHook(() => useObjectsView());
      act(() => result.current.setSearchQuery('map'));
      expect(result.current.searchQuery).toBe('map');
    });
  });
});
