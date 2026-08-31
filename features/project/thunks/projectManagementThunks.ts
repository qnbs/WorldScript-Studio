import { createAsyncThunk } from '@reduxjs/toolkit';
import type { RootState } from '../../../app/store';
import { parseImportedProjectJson } from '../../../services/projectImportSchema';
import { storageService } from '../../../services/storageService';
import type { Character, World } from '../../../types';
import { createPrototypeSafeEntityState } from '../adapters';
import type { ProjectData } from '../projectSlice';

const LEGACY_PROJECT_DIRECTORY_METADATA_KEY = '__worldscriptLegacyProjectDirectory';

type ImportedEntityCollection<T extends { id: string }> =
  | readonly T[]
  | { ids: readonly string[]; entities: Record<string, T> };

// QNBS-v3: validate normalized import correspondence before image I/O so malformed collections cannot create partial imports.
function extractImportedEntities<T extends { id: string }>(
  collection: ImportedEntityCollection<T> | undefined,
): T[] | undefined {
  if (collection === undefined) return [];
  if (!('ids' in collection)) return [...collection];
  if (
    !Array.isArray(collection.ids) ||
    typeof collection.entities !== 'object' ||
    collection.entities === null
  ) {
    return undefined;
  }

  const seenIds = new Set<string>();
  const importedEntities: T[] = [];
  for (const id of collection.ids) {
    if (typeof id !== 'string' || seenIds.has(id) || !Object.hasOwn(collection.entities, id)) {
      return undefined;
    }
    const entity = collection.entities[id];
    if (!entity || typeof entity !== 'object' || entity.id !== id) return undefined;
    seenIds.add(id);
    importedEntities.push(entity);
  }

  const entityKeys = Object.keys(collection.entities);
  if (entityKeys.length !== seenIds.size || entityKeys.some((id) => !seenIds.has(id))) {
    return undefined;
  }
  return importedEntities;
}

// QNBS-v3: compare only storage-owned target identity so mutable snapshot content cannot hide a project switch.
function restoreTargetIdentity(project: unknown): string | null {
  if (typeof project !== 'object' || project === null) return null;
  const record = project as Record<string, unknown>;
  if (typeof record['id'] === 'string' && record['id']) return `id:${record['id']}`;
  const legacyDirectory = record[LEGACY_PROJECT_DIRECTORY_METADATA_KEY];
  return typeof legacyDirectory === 'string' && legacyDirectory
    ? `legacy:${legacyDirectory}`
    : null;
}

export const importProjectThunk = createAsyncThunk('project/importProject', async (file: File) => {
  const text = await file.text();
  const projectDataJson = parseImportedProjectJson(text);

  const charactersToSet: Character[] = [];
  const worldsToSet: World[] = [];

  const characterArray = extractImportedEntities(
    projectDataJson.characters as
      | ImportedEntityCollection<Character & { avatarBase64?: string }>
      | undefined,
  );
  const worldArray = extractImportedEntities(
    projectDataJson.worlds as
      | ImportedEntityCollection<World & { ambianceImageBase64?: string }>
      | undefined,
  );
  if (!characterArray || !worldArray) {
    throw new Error('Invalid project file: entity IDs do not match their collection entries.');
  }

  if (
    !createPrototypeSafeEntityState(characterArray) ||
    !createPrototypeSafeEntityState(worldArray)
  ) {
    throw new Error('Invalid project file: duplicate character or world entity ID.');
  }

  for (const char of characterArray) {
    const newChar = { ...char };
    if (newChar.avatarBase64) {
      await storageService.saveImage(newChar.id, newChar.avatarBase64);
      newChar.hasAvatar = true;
      delete newChar.avatarBase64;
    }
    charactersToSet.push(newChar);
  }

  for (const world of worldArray) {
    const newWorld = { ...world };
    if (newWorld.ambianceImageBase64) {
      await storageService.saveImage(newWorld.id, newWorld.ambianceImageBase64);
      newWorld.hasAmbianceImage = true;
      delete newWorld.ambianceImageBase64;
    }
    worldsToSet.push(newWorld);
  }
  const charactersState = createPrototypeSafeEntityState(charactersToSet);
  const worldsState = createPrototypeSafeEntityState(worldsToSet);
  if (!charactersState || !worldsState) {
    throw new Error('Invalid project file: duplicate character or world entity ID.');
  }

  const manuscript = projectDataJson.manuscript ?? [];

  const result = {
    id: projectDataJson.id ?? 'default',
    title: projectDataJson.title,
    logline: projectDataJson.logline,
    author: projectDataJson.author,
    characters: charactersState,
    worlds: worldsState,
    outline: projectDataJson.outline ?? [],
    manuscript,
    relationships: projectDataJson.relationships,
    projectGoals: projectDataJson.projectGoals ?? {
      totalWordCount: 50000,
      targetDate: null,
    },
    writingHistory: projectDataJson.writingHistory ?? [],
    writingSessions: projectDataJson.writingSessions,
    writingGoals: projectDataJson.writingGoals,
    sceneBoardLayout: projectDataJson.sceneBoardLayout,
    binderNodes: projectDataJson.binderNodes ?? [],
    compileProfile: projectDataJson.compileProfile,
    persistedVersionControl: projectDataJson.persistedVersionControl,
  };

  // QNBS-v3: Zod inference uses | undefined for optional keys — ProjectData expects missing keys (exactOptionalPropertyTypes).
  return result as ProjectData;
});

export const restoreSnapshotThunk = createAsyncThunk(
  'project/restoreSnapshot',
  async (snapshotId: number, thunkApi) => {
    // QNBS-v3: capture ownership before snapshot I/O so payload contents cannot change the restore target.
    const currentProject = (thunkApi.getState() as RootState).project?.present?.data;
    if (!currentProject) {
      throw new Error('Cannot restore a snapshot without an active project.');
    }
    const capturedTargetIdentity = restoreTargetIdentity(currentProject);
    const restored = await storageService.restoreSnapshot(snapshotId, currentProject);
    const liveProject = (thunkApi.getState() as RootState).project?.present?.data;
    if (restoreTargetIdentity(liveProject) !== capturedTargetIdentity) {
      throw new Error('Cannot restore a snapshot after the active project changed.');
    }
    return restored;
  },
);
