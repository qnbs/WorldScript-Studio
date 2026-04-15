import { useCallback, useMemo } from 'react';
import { useAppSelector, useAppDispatch } from '../app/hooks';
import { selectAllCharacters, selectProjectData } from '../features/project/projectSelectors';
import { projectActions } from '../features/project/projectSlice';
import { useTranslation } from '../hooks/useTranslation';
import type { CharacterRelationship } from '../types';

export const useCharacterGraphView = () => {
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const characters = useAppSelector(selectAllCharacters);
  const projectData = useAppSelector(selectProjectData);

  const relationships = useMemo(() => {
    return projectData?.relationships || [];
  }, [projectData?.relationships]);

  const onAddRelationship = useCallback(
    (fromId: string, toId: string, type: string, strength: number) => {
      const newRelationship: CharacterRelationship = {
        id: `rel_${Date.now()}`,
        fromCharacterId: fromId,
        toCharacterId: toId,
        type: type as CharacterRelationship['type'],
        strength,
        description: '',
      };
      dispatch(projectActions.addRelationship(newRelationship));
    },
    [dispatch]
  );

  const onUpdateRelationship = useCallback(
    (relationshipId: string, updates: Partial<CharacterRelationship>) => {
      dispatch(projectActions.updateRelationship({ id: relationshipId, changes: updates }));
    },
    [dispatch]
  );

  const onDeleteRelationship = useCallback(
    (relationshipId: string) => {
      dispatch(projectActions.deleteRelationship(relationshipId));
    },
    [dispatch]
  );

  const onConnect = useCallback(
    (fromId: string, toId: string) => {
      // Default relationship type
      onAddRelationship(fromId, toId, 'friend', 5);
    },
    [onAddRelationship]
  );

  return {
    t,
    characters,
    relationships,
    onAddRelationship,
    onUpdateRelationship,
    onDeleteRelationship,
    onConnect,
  };
};
