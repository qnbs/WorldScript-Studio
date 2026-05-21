import { useCallback, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import type { ObjectsViewContextType } from '../contexts/ObjectsViewContext';
import { selectObjectGroups, selectStoryObjects } from '../features/project/projectSelectors';
import { projectActions } from '../features/project/projectSlice';
import type { ObjectGroup, StoryObject, StoryObjectType } from '../types';
import { useTranslation } from './useTranslation';

export function useObjectsView(): ObjectsViewContextType {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const objects = useAppSelector(selectStoryObjects);
  const groups = useAppSelector(selectObjectGroups);

  const [activeTab, setActiveTab] = useState<'objects' | 'groups'>('objects');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string | null>(null);
  const [editingObject, setEditingObject] = useState<StoryObject | null>(null);
  const [editingGroup, setEditingGroup] = useState<ObjectGroup | null>(null);
  const [isObjectFormOpen, setIsObjectFormOpen] = useState(false);
  const [isGroupFormOpen, setIsGroupFormOpen] = useState(false);

  const filteredObjects = useMemo(() => {
    let list = objects;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (o) =>
          o.name.toLowerCase().includes(q) ||
          o.description.toLowerCase().includes(q) ||
          o.type.toLowerCase().includes(q),
      );
    }
    if (selectedGroupFilter === 'ungrouped') {
      list = list.filter((o) => o.groupIds.length === 0);
    } else if (selectedGroupFilter) {
      list = list.filter((o) => o.groupIds.includes(selectedGroupFilter));
    }
    return list;
  }, [objects, searchQuery, selectedGroupFilter]);

  const handleAddObject = useCallback(() => {
    setEditingObject(null);
    setIsObjectFormOpen(true);
  }, []);

  const handleEditObject = useCallback((obj: StoryObject) => {
    setEditingObject(obj);
    setIsObjectFormOpen(true);
  }, []);

  const handleSaveObject = useCallback(
    (data: {
      name: string;
      description: string;
      type: StoryObjectType;
      significance: string;
      notes: string;
    }) => {
      const now = new Date().toISOString();
      if (editingObject) {
        dispatch(
          projectActions.updateStoryObject({
            id: editingObject.id,
            changes: { ...data, updatedAt: now },
          }),
        );
      } else {
        const newObj: StoryObject = {
          id: uuidv4(),
          groupIds: [],
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        dispatch(projectActions.addStoryObject(newObj));
      }
      setIsObjectFormOpen(false);
      setEditingObject(null);
    },
    [dispatch, editingObject],
  );

  const handleDeleteObject = useCallback(
    (id: string) => {
      dispatch(projectActions.deleteStoryObject(id));
    },
    [dispatch],
  );

  const handleAddGroup = useCallback(() => {
    setEditingGroup(null);
    setIsGroupFormOpen(true);
  }, []);

  const handleEditGroup = useCallback((group: ObjectGroup) => {
    setEditingGroup(group);
    setIsGroupFormOpen(true);
  }, []);

  const handleSaveGroup = useCallback(
    (data: { name: string; description: string; color: string }) => {
      const now = new Date().toISOString();
      if (editingGroup) {
        dispatch(
          projectActions.updateObjectGroup({
            id: editingGroup.id,
            changes: { ...data, updatedAt: now },
          }),
        );
      } else {
        const newGroup: ObjectGroup = {
          id: uuidv4(),
          objectIds: [],
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        dispatch(projectActions.addObjectGroup(newGroup));
      }
      setIsGroupFormOpen(false);
      setEditingGroup(null);
    },
    [dispatch, editingGroup],
  );

  const handleDeleteGroup = useCallback(
    (id: string) => {
      dispatch(projectActions.deleteObjectGroup(id));
      if (selectedGroupFilter === id) setSelectedGroupFilter(null);
    },
    [dispatch, selectedGroupFilter],
  );

  const handleAssignToGroup = useCallback(
    (objectId: string, groupId: string) => {
      dispatch(projectActions.assignObjectToGroup({ objectId, groupId }));
    },
    [dispatch],
  );

  const handleRemoveFromGroup = useCallback(
    (objectId: string, groupId: string) => {
      dispatch(projectActions.removeObjectFromGroup({ objectId, groupId }));
    },
    [dispatch],
  );

  const handleCancelForm = useCallback(() => {
    setIsObjectFormOpen(false);
    setIsGroupFormOpen(false);
    setEditingObject(null);
    setEditingGroup(null);
  }, []);

  return {
    t,
    objects,
    groups,
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    selectedGroupFilter,
    setSelectedGroupFilter,
    filteredObjects,
    editingObject,
    editingGroup,
    isObjectFormOpen,
    isGroupFormOpen,
    handleAddObject,
    handleEditObject,
    handleSaveObject,
    handleDeleteObject,
    handleAddGroup,
    handleEditGroup,
    handleSaveGroup,
    handleDeleteGroup,
    handleAssignToGroup,
    handleRemoveFromGroup,
    handleCancelForm,
  };
}
