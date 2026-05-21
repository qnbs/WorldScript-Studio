import { createContext, useContext } from 'react';
import type { ObjectGroup, StoryObject, StoryObjectType } from '../types';

export interface ObjectsViewContextType {
  t: (key: string, replacements?: Record<string, string>) => string;
  objects: StoryObject[];
  groups: ObjectGroup[];
  activeTab: 'objects' | 'groups';
  setActiveTab: (tab: 'objects' | 'groups') => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  selectedGroupFilter: string | null;
  setSelectedGroupFilter: (id: string | null) => void;
  filteredObjects: StoryObject[];
  editingObject: StoryObject | null;
  editingGroup: ObjectGroup | null;
  isObjectFormOpen: boolean;
  isGroupFormOpen: boolean;
  handleAddObject: () => void;
  handleEditObject: (obj: StoryObject) => void;
  handleSaveObject: (data: {
    name: string;
    description: string;
    type: StoryObjectType;
    significance: string;
    notes: string;
  }) => void;
  handleDeleteObject: (id: string) => void;
  handleAddGroup: () => void;
  handleEditGroup: (group: ObjectGroup) => void;
  handleSaveGroup: (data: { name: string; description: string; color: string }) => void;
  handleDeleteGroup: (id: string) => void;
  handleAssignToGroup: (objectId: string, groupId: string) => void;
  handleRemoveFromGroup: (objectId: string, groupId: string) => void;
  handleCancelForm: () => void;
}

export const ObjectsViewContext = createContext<ObjectsViewContextType | null>(null);

export const useObjectsViewContext = () => {
  const ctx = useContext(ObjectsViewContext);
  if (!ctx)
    throw new Error('useObjectsViewContext must be used within ObjectsViewContext.Provider');
  return ctx;
};
