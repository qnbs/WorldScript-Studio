import { createAsyncThunk } from '@reduxjs/toolkit';
import type { RootState } from '../../../app/store';
import { parseImportedProjectJson } from '../../../services/projectImportSchema';
import { storageService } from '../../../services/storageService';
import type { Character, World } from '../../../types';
import { createPrototypeSafeEntityState } from '../adapters';
import { getProjectTargetIdentity, identityUnchanged } from '../projectIdentity';
import type { ProjectData } from '../projectSlice';

type ImportedEntityCollection<T extends { id: string }> =
  | readonly T[]
  | { ids: readonly string[]; entities: Record<string, T> };

// QNBS-v3: validate normalized import correspondence before image I/O so malformed collections cannot create partial imports.
/** Extracts imported entities while requiring exact ids-to-own-entities correspondence. */
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

  // QNBS-v3: images are project-qualified in storage now -- resolve the imported project's own id up front so both save loops use the same namespace the returned ProjectData below is assigned. A present-but-empty id is treated identically to a missing one (`||`, not `??`) and gets its own fresh generated id, not the shared 'default' fallback used elsewhere for "no active project" -- two independent no-id imports must land in two distinct namespaces, not silently collapse into the same one.
  const importedProjectId = projectDataJson.id || crypto.randomUUID();

  // QNBS-v3: an import that fails partway must not leave orphaned images behind for a project that will never be admitted into state -- best-effort cleanup of everything saved so far before re-throwing.
  const savedImageIds: string[] = [];
  try {
    for (const char of characterArray) {
      const newChar = { ...char };
      if (newChar.avatarBase64) {
        await storageService.saveImage(newChar.id, newChar.avatarBase64, importedProjectId);
        savedImageIds.push(newChar.id);
        newChar.hasAvatar = true;
        delete newChar.avatarBase64;
      }
      charactersToSet.push(newChar);
    }

    for (const world of worldArray) {
      const newWorld = { ...world };
      if (newWorld.ambianceImageBase64) {
        await storageService.saveImage(
          newWorld.id,
          newWorld.ambianceImageBase64,
          importedProjectId,
        );
        savedImageIds.push(newWorld.id);
        newWorld.hasAmbianceImage = true;
        delete newWorld.ambianceImageBase64;
      }
      worldsToSet.push(newWorld);
    }
  } catch (error) {
    await Promise.all(
      savedImageIds.map((id) =>
        storageService.deleteImage(id, importedProjectId).catch(() => undefined),
      ),
    );
    throw error;
  }
  const charactersState = createPrototypeSafeEntityState(charactersToSet);
  const worldsState = createPrototypeSafeEntityState(worldsToSet);
  if (!charactersState || !worldsState) {
    throw new Error('Invalid project file: duplicate character or world entity ID.');
  }

  const manuscript = projectDataJson.manuscript ?? [];

  const result = {
    id: importedProjectId,
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
    const currentSlice = (thunkApi.getState() as RootState).project?.present;
    if (!currentSlice?.data) {
      throw new Error('Cannot restore a snapshot without an active project.');
    }
    const capturedTargetIdentity = getProjectTargetIdentity(currentSlice);
    const restored = await storageService.restoreSnapshot(snapshotId, currentSlice.data);
    const liveSlice = (thunkApi.getState() as RootState).project?.present;
    if (!identityUnchanged(capturedTargetIdentity, getProjectTargetIdentity(liveSlice))) {
      throw new Error('Cannot restore a snapshot after the active project changed.');
    }
    return restored;
  },
);
