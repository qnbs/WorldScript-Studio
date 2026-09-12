import { configureStore } from '@reduxjs/toolkit';
import undoable from 'redux-undo';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// QNBS-v3: the thunk mock models the target-aware storage boundary used before snapshot I/O.
vi.mock('../../../services/storageService', () => ({
  storageService: {
    saveImage: vi.fn(),
    getImage: vi.fn(),
    deleteImage: vi.fn(),
    getQualifiedImage: vi.fn(),
    deleteQualifiedImage: vi.fn(),
    deleteBinderAsset: vi.fn(),
    saveBinderAsset: vi.fn(),
    getSnapshotData: vi.fn(),
    restoreSnapshot: vi.fn(),
  },
}));

vi.mock('../../../services/projectImportSchema', () => ({
  parseImportedProjectJson: vi.fn(),
}));

import featureFlagsReducer from '../../../features/featureFlags/featureFlagsSlice';
import { charactersAdapter, worldsAdapter } from '../../../features/project/adapters';
import projectReducer, { projectActions } from '../../../features/project/projectSlice';
import {
  importBinderFileThunk,
  removeBinderSubtreeWithAssetsThunk,
} from '../../../features/project/thunks/binderThunks';
import {
  importProjectThunk,
  restoreSnapshotThunk,
} from '../../../features/project/thunks/projectManagementThunks';
import settingsReducer from '../../../features/settings/settingsSlice';
import statusReducer from '../../../features/status/statusSlice';
import versionControlReducer from '../../../features/versionControl/versionControlSlice';
import writerReducer from '../../../features/writer/writerSlice';
import { parseImportedProjectJson } from '../../../services/projectImportSchema';
import { storageService } from '../../../services/storageService';
import type { BinderNode } from '../../../types';

function makeStore() {
  return configureStore({
    reducer: {
      project: undoable(projectReducer, { limit: 100 }),
      settings: settingsReducer,
      status: statusReducer,
      writer: writerReducer,
      versionControl: versionControlReducer,
      featureFlags: featureFlagsReducer,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(storageService.deleteBinderAsset).mockResolvedValue(undefined);
  vi.mocked(storageService.saveBinderAsset).mockResolvedValue(undefined);
  vi.mocked(storageService.saveImage).mockResolvedValue(undefined);
  // QNBS-v3: default "nothing stored yet" so import tests exercise the new-image (delete-on-rollback) path unless a test deliberately simulates a pre-existing image to exercise the restore-on-rollback path.
  vi.mocked(storageService.getImage).mockResolvedValue(null);
  vi.mocked(storageService.deleteImage).mockResolvedValue(undefined);
  vi.mocked(storageService.getQualifiedImage).mockResolvedValue(null);
  vi.mocked(storageService.deleteQualifiedImage).mockResolvedValue(undefined);
  vi.mocked(storageService.getSnapshotData).mockResolvedValue(null);
  vi.mocked(storageService.restoreSnapshot).mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// removeBinderSubtreeWithAssetsThunk
// ---------------------------------------------------------------------------
describe('removeBinderSubtreeWithAssetsThunk', () => {
  it('dispatches fulfilled action', async () => {
    const store = makeStore();
    const action = await store.dispatch(removeBinderSubtreeWithAssetsThunk('root-1'));
    expect(action.type).toBe('project/removeBinderSubtreeWithAssets/fulfilled');
  });

  it('does not call deleteBinderAsset when no nodes exist', async () => {
    const store = makeStore();
    await store.dispatch(removeBinderSubtreeWithAssetsThunk('root-1'));
    expect(storageService.deleteBinderAsset).not.toHaveBeenCalled();
  });

  it('calls deleteBinderAsset for nodes with binderAssetId in the subtree', async () => {
    const store = makeStore();
    // Add binder nodes to the store state
    const nodes: BinderNode[] = [
      {
        id: 'root-1',
        parentId: null,
        type: 'pdf',
        title: 'Root Doc',
        sortIndex: 0,
        binderAssetId: 'asset-root',
        mimeType: 'application/pdf',
        byteSize: 100,
        originalFileName: 'root.pdf',
      },
      {
        id: 'child-1',
        parentId: 'root-1',
        type: 'image',
        title: 'Image',
        sortIndex: 0,
        binderAssetId: 'asset-child',
        mimeType: 'image/png',
        byteSize: 50,
        originalFileName: 'img.png',
      },
    ];
    // Seed the store with binder nodes via the Redux action
    store.dispatch(projectActions.setBinderNodes(nodes));

    await store.dispatch(removeBinderSubtreeWithAssetsThunk('root-1'));

    // Both root and child asset should be deleted
    expect(storageService.deleteBinderAsset).toHaveBeenCalledTimes(2);
  });

  it('removes the node from Redux state after dispatch', async () => {
    const store = makeStore();
    const nodes: BinderNode[] = [
      {
        id: 'root-99',
        parentId: null,
        type: 'text',
        title: 'Root',
        sortIndex: 0,
        mimeType: 'text/plain',
        byteSize: 1,
        originalFileName: 'root.txt',
      },
    ];
    store.dispatch(projectActions.setBinderNodes(nodes));

    await store.dispatch(removeBinderSubtreeWithAssetsThunk('root-99'));

    // QNBS-v3: verify via state — inner dispatch bypasses spy
    const remainingNodes = store.getState().project.present.data?.binderNodes ?? [];
    expect(remainingNodes.find((n) => n.id === 'root-99')).toBeUndefined();
  });

  it('skips nodes without binderAssetId (text nodes)', async () => {
    const store = makeStore();
    const nodes: BinderNode[] = [
      {
        id: 'root-2',
        parentId: null,
        type: 'text',
        title: 'Text Note',
        sortIndex: 0,
        // no binderAssetId
        mimeType: 'text/plain',
        byteSize: 10,
        originalFileName: 'note.txt',
      },
    ];
    store.dispatch(projectActions.setBinderNodes(nodes));

    await store.dispatch(removeBinderSubtreeWithAssetsThunk('root-2'));

    expect(storageService.deleteBinderAsset).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// importBinderFileThunk
// ---------------------------------------------------------------------------
describe('importBinderFileThunk', () => {
  it('dispatches fulfilled with the new node id (string)', async () => {
    const store = makeStore();
    // Seed minimal project data
    store.dispatch(projectActions.updateTitle('Test Project'));

    const file = new File(['%PDF-1.4'], 'document.pdf', { type: 'application/pdf' });
    const action = await store.dispatch(importBinderFileThunk({ parentId: 'parent-1', file }));

    expect(action.type).toBe('project/importBinderFile/fulfilled');
    expect(typeof (action as { payload: string }).payload).toBe('string');
  });

  it('calls saveBinderAsset with the project id and asset metadata', async () => {
    const store = makeStore();
    const file = new File(['content'], 'notes.txt', { type: 'text/plain' });
    await store.dispatch(importBinderFileThunk({ parentId: 'parent-1', file }));

    expect(storageService.saveBinderAsset).toHaveBeenCalledWith(
      expect.any(String), // project id
      expect.any(String), // generated asset id (uuid)
      expect.any(ArrayBuffer),
      expect.objectContaining({
        mimeType: 'text/plain',
        originalFileName: 'notes.txt',
      }),
    );
  });

  it('assigns type "pdf" for PDF mime type', async () => {
    const store = makeStore();
    const file = new File(['%PDF'], 'report.pdf', { type: 'application/pdf' });
    await store.dispatch(importBinderFileThunk({ parentId: 'p1', file }));

    // QNBS-v3: check Redux state rather than dispatch spy — inner thunk dispatches bypass spy
    const nodes = store.getState().project.present.data?.binderNodes ?? [];
    const newNode = nodes.find((n) => n.title === 'report');
    expect(newNode?.type).toBe('pdf');
  });

  it('assigns type "image" for image mime type', async () => {
    const store = makeStore();
    const file = new File(['img'], 'photo.png', { type: 'image/png' });
    await store.dispatch(importBinderFileThunk({ parentId: 'p1', file }));

    const nodes = store.getState().project.present.data?.binderNodes ?? [];
    const newNode = nodes.find((n) => n.title === 'photo');
    expect(newNode?.type).toBe('image');
  });

  it('assigns type "text" for plain text mime type', async () => {
    const store = makeStore();
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    await store.dispatch(importBinderFileThunk({ parentId: 'p1', file }));

    const nodes = store.getState().project.present.data?.binderNodes ?? [];
    const newNode = nodes.find((n) => n.title === 'notes');
    expect(newNode?.type).toBe('text');
  });

  it('strips extension from filename for node title', async () => {
    const store = makeStore();
    const file = new File(['data'], 'chapter-one.pdf', { type: 'application/pdf' });
    await store.dispatch(importBinderFileThunk({ parentId: 'p1', file }));

    const nodes = store.getState().project.present.data?.binderNodes ?? [];
    expect(nodes.some((n) => n.title === 'chapter-one')).toBe(true);
  });

  it('sets sortIndex to max sibling sortIndex + 1', async () => {
    const store = makeStore();
    const existingNodes: BinderNode[] = [
      {
        id: 'n1',
        parentId: 'parent-1',
        type: 'text',
        title: 'A',
        sortIndex: 5,
        mimeType: 'text/plain',
        byteSize: 1,
        originalFileName: 'a.txt',
      },
      {
        id: 'n2',
        parentId: 'parent-1',
        type: 'text',
        title: 'B',
        sortIndex: 9,
        mimeType: 'text/plain',
        byteSize: 1,
        originalFileName: 'b.txt',
      },
    ];
    store.dispatch(projectActions.setBinderNodes(existingNodes));

    const file = new File(['data'], 'new.txt', { type: 'text/plain' });
    await store.dispatch(importBinderFileThunk({ parentId: 'parent-1', file }));

    const nodes = store.getState().project.present.data?.binderNodes ?? [];
    const newNode = nodes.find((n) => n.title === 'new');
    expect(newNode?.sortIndex).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// importProjectThunk
// ---------------------------------------------------------------------------
describe('importProjectThunk', () => {
  const minimalProject = {
    id: 'proj-1',
    title: 'Test Novel',
    logline: 'A test story',
    manuscript: [{ id: 's1', title: 'Chapter 1', content: 'Once upon a time.' }],
    characters: [] as unknown[],
    worlds: [] as unknown[],
    outline: [],
    projectGoals: { totalWordCount: 80000, targetDate: null },
    writingHistory: [],
    binderNodes: [],
  };

  it('dispatches fulfilled with imported project data', async () => {
    vi.mocked(parseImportedProjectJson).mockReturnValue(minimalProject as never);

    const store = makeStore();
    const file = new File([JSON.stringify(minimalProject)], 'novel.json', {
      type: 'application/json',
    });
    const action = await store.dispatch(importProjectThunk(file));

    expect(action.type).toBe('project/importProject/fulfilled');
  });

  it('handles array-format characters without avatarBase64', async () => {
    const projectWithChars = {
      ...minimalProject,
      characters: [{ id: 'c1', name: 'Alice', background: '' }],
    };
    vi.mocked(parseImportedProjectJson).mockReturnValue(projectWithChars as never);

    const store = makeStore();
    const file = new File([JSON.stringify(projectWithChars)], 'novel.json', {
      type: 'application/json',
    });
    const action = await store.dispatch(importProjectThunk(file));

    expect(action.type).toBe('project/importProject/fulfilled');
    expect(storageService.saveImage).not.toHaveBeenCalled();
  });

  it('saves avatarBase64 as image and sets hasAvatar = true', async () => {
    const projectWithAvatar = {
      ...minimalProject,
      characters: [{ id: 'c2', name: 'Bob', avatarBase64: 'base64imgdata' }],
    };
    vi.mocked(parseImportedProjectJson).mockReturnValue(projectWithAvatar as never);

    const store = makeStore();
    const file = new File([JSON.stringify(projectWithAvatar)], 'novel.json', {
      type: 'application/json',
    });
    const action = await store.dispatch(importProjectThunk(file));

    // saveImage called proves avatar was processed, project-qualified by the imported project's own id
    expect(storageService.saveImage).toHaveBeenCalledWith('c2', 'base64imgdata', 'proj-1');
    // hasAvatar flag set on the character entity in the payload
    const payload = (
      action as {
        payload: {
          characters: { entities: Record<string, { hasAvatar?: boolean; avatarBase64?: string }> };
        };
      }
    ).payload;
    const character = Object.values(payload.characters.entities)[0];
    expect(character?.hasAvatar).toBe(true);
    expect(character?.avatarBase64).toBeUndefined();
  });

  // QNBS-v3: `||`, not `??`, treats a present-but-empty id identically to a genuinely missing one -- both take the fresh-generated-id branch below, rather than an empty id alone diverging into its own '' namespace.
  it('generates a fresh project id when the imported project id is an empty string', async () => {
    const projectWithEmptyId = {
      ...minimalProject,
      id: '',
      characters: [{ id: 'c3', name: 'Eve', avatarBase64: 'emptyidimgdata' }],
    };
    vi.mocked(parseImportedProjectJson).mockReturnValue(projectWithEmptyId as never);

    const store = makeStore();
    const file = new File([JSON.stringify(projectWithEmptyId)], 'novel.json', {
      type: 'application/json',
    });
    const action = await store.dispatch(importProjectThunk(file));

    const payload = (action as { payload: { id: string } }).payload;
    expect(payload.id).toBeTruthy();
    expect(storageService.saveImage).toHaveBeenCalledWith('c3', 'emptyidimgdata', payload.id);
  });

  // QNBS-v3: the exact gap CodeAnt flagged -- two independent no-id imports with a colliding entity id must land in two distinct storage namespaces, not both fall back to the same shared 'default' string.
  it('does not collide two independent imports that both lack a project id', async () => {
    const firstNoIdProject = {
      ...minimalProject,
      id: '',
      characters: [{ id: 'shared-id', name: 'Alice', avatarBase64: 'first-avatar' }],
    };
    vi.mocked(parseImportedProjectJson).mockReturnValueOnce(firstNoIdProject as never);
    const firstStore = makeStore();
    const firstFile = new File([JSON.stringify(firstNoIdProject)], 'first.json', {
      type: 'application/json',
    });
    const firstAction = await firstStore.dispatch(importProjectThunk(firstFile));
    const firstPayload = (firstAction as { payload: { id: string } }).payload;

    const secondNoIdProject = {
      ...minimalProject,
      id: '',
      characters: [{ id: 'shared-id', name: 'Bob', avatarBase64: 'second-avatar' }],
    };
    vi.mocked(parseImportedProjectJson).mockReturnValueOnce(secondNoIdProject as never);
    const secondStore = makeStore();
    const secondFile = new File([JSON.stringify(secondNoIdProject)], 'second.json', {
      type: 'application/json',
    });
    const secondAction = await secondStore.dispatch(importProjectThunk(secondFile));
    const secondPayload = (secondAction as { payload: { id: string } }).payload;

    expect(firstPayload.id).not.toBe(secondPayload.id);
    expect(storageService.saveImage).toHaveBeenCalledWith(
      'shared-id',
      'first-avatar',
      firstPayload.id,
    );
    expect(storageService.saveImage).toHaveBeenCalledWith(
      'shared-id',
      'second-avatar',
      secondPayload.id,
    );
  });

  // QNBS-v3: a partial import failure must not leave orphaned images for a project that never gets admitted into state.
  it('cleans up already-saved images when a later image save fails during import', async () => {
    const projectWithTwoAvatars = {
      ...minimalProject,
      characters: [
        { id: 'c-ok', name: 'Ok', avatarBase64: 'ok-avatar' },
        { id: 'c-fail', name: 'Fail', avatarBase64: 'fail-avatar' },
      ],
    };
    vi.mocked(parseImportedProjectJson).mockReturnValue(projectWithTwoAvatars as never);
    vi.mocked(storageService.saveImage).mockImplementation(async (id: string) => {
      if (id === 'c-fail') throw new Error('disk full');
    });

    const store = makeStore();
    const file = new File([JSON.stringify(projectWithTwoAvatars)], 'novel.json', {
      type: 'application/json',
    });
    const action = await store.dispatch(importProjectThunk(file));

    expect(action.type).toBe('project/importProject/rejected');
    // QNBS-v3: rollback of a newly-created (previously-absent) qualified image uses the qualified-only delete, never the legacy-aware deleteImage, so an unrelated legacy image can never be touched by this cleanup.
    expect(storageService.deleteQualifiedImage).toHaveBeenCalledWith('c-ok', 'proj-1');
    expect(storageService.deleteImage).not.toHaveBeenCalled();
  });

  // QNBS-v3: re-importing into an existing project id can overwrite an already-present qualified image -- a failed later save must restore that exact prior image, not just delete this attempt's write (which would permanently destroy data that predates the failed import).
  it('restores the pre-existing image (not deletes it) when a later image save fails after an overwrite', async () => {
    const projectWithTwoAvatars = {
      ...minimalProject,
      characters: [
        { id: 'c-overwritten', name: 'Overwritten', avatarBase64: 'new-avatar' },
        { id: 'c-fail', name: 'Fail', avatarBase64: 'fail-avatar' },
      ],
    };
    vi.mocked(parseImportedProjectJson).mockReturnValue(projectWithTwoAvatars as never);
    vi.mocked(storageService.getQualifiedImage).mockImplementation(async (id: string) =>
      id === 'c-overwritten' ? 'pre-existing-avatar' : null,
    );
    vi.mocked(storageService.saveImage).mockImplementation(async (id: string) => {
      if (id === 'c-fail') throw new Error('disk full');
    });

    const store = makeStore();
    const file = new File([JSON.stringify(projectWithTwoAvatars)], 'novel.json', {
      type: 'application/json',
    });
    const action = await store.dispatch(importProjectThunk(file));

    expect(action.type).toBe('project/importProject/rejected');
    // QNBS-v3: restored via saveImage with the snapshotted prior value, never deleted.
    expect(storageService.saveImage).toHaveBeenCalledWith(
      'c-overwritten',
      'pre-existing-avatar',
      'proj-1',
    );
    expect(storageService.deleteQualifiedImage).not.toHaveBeenCalledWith('c-overwritten', 'proj-1');
  });

  // QNBS-v3: getQualifiedImage never falls through to a legacy-provenanced blob the way getImage does, so a legacy-only pre-existing image must snapshot as absent, not as a value to restore into the qualified slot.
  it('treats a legacy-only pre-existing image as absent, not as a qualified value to restore', async () => {
    const projectWithTwoAvatars = {
      ...minimalProject,
      characters: [
        { id: 'c-legacy-only', name: 'LegacyOnly', avatarBase64: 'new-avatar' },
        { id: 'c-fail', name: 'Fail', avatarBase64: 'fail-avatar' },
      ],
    };
    vi.mocked(parseImportedProjectJson).mockReturnValue(projectWithTwoAvatars as never);
    // QNBS-v3: getQualifiedImage correctly reports null (legacy fallback is out of scope for it) while getImage -- deliberately mocked to disagree -- reports the legacy blob, proving the snapshot uses the qualified-only read and not the merged one.
    vi.mocked(storageService.getQualifiedImage).mockResolvedValue(null);
    vi.mocked(storageService.getImage).mockResolvedValue('legacy-blob');
    vi.mocked(storageService.saveImage).mockImplementation(async (id: string) => {
      if (id === 'c-fail') throw new Error('disk full');
    });

    const store = makeStore();
    const file = new File([JSON.stringify(projectWithTwoAvatars)], 'novel.json', {
      type: 'application/json',
    });
    const action = await store.dispatch(importProjectThunk(file));

    expect(action.type).toBe('project/importProject/rejected');
    // QNBS-v3: rollback restores via deleteQualifiedImage (absent snapshot), never via a second saveImage call that would re-materialize the legacy blob into the qualified slot -- saveImage is called exactly once for this id (the initial forward write being rolled back), never a second time as a restore.
    expect(storageService.deleteQualifiedImage).toHaveBeenCalledWith('c-legacy-only', 'proj-1');
    const legacyOnlySaveCalls = vi
      .mocked(storageService.saveImage)
      .mock.calls.filter(([id]) => id === 'c-legacy-only');
    expect(legacyOnlySaveCalls).toHaveLength(1);
  });

  // QNBS-v3: a qualified-image read failure must abort the import before any write happens -- collapsing it to null (as getImage does) could make a later rollback destructively delete an unreadable pre-existing image it never actually observed.
  it('aborts the import before writing when the pre-write qualified snapshot read fails', async () => {
    const projectWithOneAvatar = {
      ...minimalProject,
      characters: [{ id: 'c-unreadable', name: 'Unreadable', avatarBase64: 'new-avatar' }],
    };
    vi.mocked(parseImportedProjectJson).mockReturnValue(projectWithOneAvatar as never);
    vi.mocked(storageService.getQualifiedImage).mockRejectedValue(new Error('decrypt failed'));

    const store = makeStore();
    const file = new File([JSON.stringify(projectWithOneAvatar)], 'novel.json', {
      type: 'application/json',
    });
    const action = await store.dispatch(importProjectThunk(file));

    expect(action.type).toBe('project/importProject/rejected');
    expect(storageService.saveImage).not.toHaveBeenCalled();
    expect(storageService.deleteQualifiedImage).not.toHaveBeenCalled();
  });

  // QNBS-v3: characterArray/worldArray are validated for duplicates separately, so a shared raw id between a character and a world would otherwise pass both checks while colliding in the same project-qualified image namespace.
  it('rejects an import where a character and a world share the same entity id and both have an image', async () => {
    const projectWithCollidingIds = {
      ...minimalProject,
      characters: [{ id: 'shared-id', name: 'Alice', avatarBase64: 'char-avatar' }],
      worlds: [{ id: 'shared-id', name: 'Alicia', ambianceImageBase64: 'world-avatar' }],
    };
    vi.mocked(parseImportedProjectJson).mockReturnValue(projectWithCollidingIds as never);

    const store = makeStore();
    const file = new File([JSON.stringify(projectWithCollidingIds)], 'novel.json', {
      type: 'application/json',
    });
    const action = await store.dispatch(importProjectThunk(file));

    expect(action.type).toBe('project/importProject/rejected');
    expect(storageService.saveImage).not.toHaveBeenCalled();
  });

  // QNBS-v3: characters and worlds are independent Redux entity collections and may legitimately share a raw id -- only actually colliding image writes (both sides carrying an image) are rejected, not the shared id alone.
  it('allows a character and a world to share the same entity id when only one of them has an image', async () => {
    const projectWithSharedIdNoCollision = {
      ...minimalProject,
      characters: [{ id: 'shared-id', name: 'Alice', avatarBase64: 'char-avatar' }],
      worlds: [{ id: 'shared-id', name: 'Alicia' }],
    };
    vi.mocked(parseImportedProjectJson).mockReturnValue(projectWithSharedIdNoCollision as never);

    const store = makeStore();
    const file = new File([JSON.stringify(projectWithSharedIdNoCollision)], 'novel.json', {
      type: 'application/json',
    });
    const action = await store.dispatch(importProjectThunk(file));

    expect(action.type).toBe('project/importProject/fulfilled');
    expect(storageService.saveImage).toHaveBeenCalledWith('shared-id', 'char-avatar', 'proj-1');
  });

  it('handles normalized entity format characters', async () => {
    const projectWithNormalizedChars = {
      ...minimalProject,
      characters: {
        ids: ['c3'],
        entities: { c3: { id: 'c3', name: 'Carol' } },
      },
    };
    vi.mocked(parseImportedProjectJson).mockReturnValue(projectWithNormalizedChars as never);

    const store = makeStore();
    const file = new File([JSON.stringify(projectWithNormalizedChars)], 'novel.json', {
      type: 'application/json',
    });
    const action = await store.dispatch(importProjectThunk(file));

    expect(action.type).toBe('project/importProject/fulfilled');
  });

  // QNBS-v3: imported prototype-named IDs must remain own properties through canonicalization and persistence.
  it('preserves prototype-named imported character and world IDs', async () => {
    const projectWithPrototypeIds = {
      ...minimalProject,
      characters: [
        { id: '__proto__', name: 'Prototype Character' },
        { id: 'constructor', name: 'Constructor Character' },
        { id: 'toString', name: 'ToString Character' },
      ],
      worlds: [
        { id: '__proto__', name: 'Prototype World' },
        { id: 'constructor', name: 'Constructor World' },
        { id: 'toString', name: 'ToString World' },
      ],
    };
    vi.mocked(parseImportedProjectJson).mockReturnValue(projectWithPrototypeIds as never);

    const store = makeStore();
    const file = new File([JSON.stringify(projectWithPrototypeIds)], 'novel.json', {
      type: 'application/json',
    });
    const action = await store.dispatch(importProjectThunk(file));
    const payload = (
      action as {
        payload: {
          characters: { ids: string[]; entities: Record<string, { id: string; name: string }> };
          worlds: { ids: string[]; entities: Record<string, { id: string; name: string }> };
        };
      }
    ).payload;

    for (const id of ['__proto__', 'constructor', 'toString']) {
      expect(payload.characters.ids).toContain(id);
      expect(Object.hasOwn(payload.characters.entities, id)).toBe(true);
      expect(Object.hasOwn(payload.worlds.entities, id)).toBe(true);
    }
    expect(JSON.stringify(payload.characters.entities)).toContain('Prototype Character');
    expect(JSON.stringify(payload.worlds.entities)).toContain('Prototype World');

    const state = store.getState().project.present.data;
    expect(Object.getPrototypeOf(state.characters.entities)).toBeNull();
    expect(Object.getPrototypeOf(state.worlds.entities)).toBeNull();
    expect(charactersAdapter.getSelectors().selectById(state.characters, '__proto__')?.name).toBe(
      'Prototype Character',
    );
    expect(worldsAdapter.getSelectors().selectById(state.worlds, 'constructor')?.name).toBe(
      'Constructor World',
    );

    store.dispatch(
      projectActions.updateCharacter({ id: '__proto__', changes: { name: 'Updated Character' } }),
    );
    const updatedCharacter = Reflect.get(
      store.getState().project.present.data.characters.entities,
      '__proto__',
    ) as { name?: string };
    expect(updatedCharacter.name).toBe('Updated Character');
  });

  // QNBS-v3: normalized imports must preserve own-ID correspondence instead of filtering malformed entries silently.
  it('preserves prototype-named IDs in normalized imported collections', async () => {
    const projectWithNormalizedPrototypeIds = {
      ...minimalProject,
      characters: {
        ids: ['__proto__', 'constructor'],
        entities: Object.fromEntries([
          ['__proto__', { id: '__proto__', name: 'Prototype Character' }],
          ['constructor', { id: 'constructor', name: 'Constructor Character' }],
        ]),
      },
      worlds: {
        ids: ['toString'],
        entities: Object.fromEntries([['toString', { id: 'toString', name: 'ToString World' }]]),
      },
    };
    const actualSchema = await vi.importActual<
      typeof import('../../../services/projectImportSchema')
    >('../../../services/projectImportSchema');
    vi.mocked(parseImportedProjectJson).mockImplementation(actualSchema.parseImportedProjectJson);

    const store = makeStore();
    const file = new File([JSON.stringify(projectWithNormalizedPrototypeIds)], 'novel.json', {
      type: 'application/json',
    });
    const action = await store.dispatch(importProjectThunk(file));

    expect(action.type).toBe('project/importProject/fulfilled');
    expect(store.getState().project.present.data.characters.ids).toEqual([
      '__proto__',
      'constructor',
    ]);
    expect(store.getState().project.present.data.worlds.ids).toEqual(['toString']);
  });

  // QNBS-v3: malformed normalized collections must fail before import side effects can create partial state.
  it.each([
    {
      name: 'missing entity',
      characters: { ids: ['missing'], entities: {} },
    },
    {
      name: 'orphan entity',
      characters: { ids: ['c1'], entities: { c1: { id: 'c1' }, orphan: { id: 'orphan' } } },
    },
  ])('rejects normalized collections with $name', async ({ characters }) => {
    const malformedProject = { ...minimalProject, characters };
    vi.mocked(parseImportedProjectJson).mockReturnValue(malformedProject as never);

    const store = makeStore();
    const file = new File([JSON.stringify(malformedProject)], 'novel.json', {
      type: 'application/json',
    });
    const action = await store.dispatch(importProjectThunk(file));

    expect(action.type).toBe('project/importProject/rejected');
    expect(store.getState().project.present.data.title).toBe('');
    expect(storageService.saveImage).not.toHaveBeenCalled();
  });

  // QNBS-v3: duplicate imported IDs are rejected instead of silently discarding project entities.
  it('rejects duplicate imported entity IDs without creating a partial project', async () => {
    const projectWithDuplicateIds = {
      ...minimalProject,
      characters: [
        { id: 'duplicate', name: 'First Character' },
        { id: 'duplicate', name: 'Second Character' },
      ],
    };
    vi.mocked(parseImportedProjectJson).mockReturnValue(projectWithDuplicateIds as never);

    const store = makeStore();
    const file = new File([JSON.stringify(projectWithDuplicateIds)], 'novel.json', {
      type: 'application/json',
    });
    const action = await store.dispatch(importProjectThunk(file));

    expect(action.type).toBe('project/importProject/rejected');
    expect(store.getState().project.present.data.title).toBe('');
  });
});

// ---------------------------------------------------------------------------
// restoreSnapshotThunk
// ---------------------------------------------------------------------------
describe('restoreSnapshotThunk', () => {
  it('dispatches fulfilled with snapshot data from storageService', async () => {
    const snapshotData = { title: 'Snapshot Title', manuscript: [] };
    vi.mocked(storageService.restoreSnapshot).mockResolvedValue(snapshotData as never);

    const store = makeStore();
    const action = await store.dispatch(restoreSnapshotThunk(42));

    expect(action.type).toBe('project/restoreSnapshot/fulfilled');
    expect((action as { payload: typeof snapshotData }).payload).toEqual(snapshotData);
    expect(storageService.restoreSnapshot).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ id: 'default' }),
    );
  });

  it('captures the current project before requesting snapshot data', async () => {
    vi.mocked(storageService.restoreSnapshot).mockResolvedValue(null);

    const store = makeStore();
    await store.dispatch(restoreSnapshotThunk(99));

    expect(storageService.restoreSnapshot).toHaveBeenCalledWith(
      99,
      expect.objectContaining({ id: 'default' }),
    );
  });

  // QNBS-v3: an async restore must not fulfill into a different Redux project than the captured target.
  it('rejects when the active project changes while snapshot I/O is pending', async () => {
    let releaseRestore!: (value: unknown) => void;
    vi.mocked(storageService.restoreSnapshot).mockReturnValue(
      new Promise((resolve) => {
        releaseRestore = resolve;
      }),
    );

    const store = makeStore();
    const pending = store.dispatch(restoreSnapshotThunk(100));
    const currentData = store.getState().project.present.data;
    store.dispatch({
      type: 'project/restoreSnapshot/fulfilled',
      payload: { ...currentData, id: 'p2' },
    });
    releaseRestore({ ...currentData, id: 'default' });

    const action = await pending;

    expect(action.type).toBe('project/restoreSnapshot/rejected');
    expect(store.getState().project.present.data.id).toBe('p2');
  });

  // QNBS-v3: a New Project reset keeps id:'default' (the same as almost every fresh project), so id alone cannot detect this race -- the generation counter must.
  it('rejects when the active project is reset (still id:default) while snapshot I/O is pending', async () => {
    let releaseRestore!: (value: unknown) => void;
    vi.mocked(storageService.restoreSnapshot).mockReturnValue(
      new Promise((resolve) => {
        releaseRestore = resolve;
      }),
    );

    const store = makeStore();
    const pending = store.dispatch(restoreSnapshotThunk(100));
    store.dispatch(
      projectActions.resetProject({ title: 'Fresh', logline: '', chapter1Title: 'Ch1' }),
    );
    releaseRestore({ title: 'Old snapshot content', id: 'default' });

    const action = await pending;

    expect(action.type).toBe('project/restoreSnapshot/rejected');
    expect(store.getState().project.present.data.title).toBe('Fresh');
  });

  it('dispatches rejected when storageService throws', async () => {
    vi.mocked(storageService.restoreSnapshot).mockRejectedValue(new Error('IDB error'));

    const store = makeStore();
    const action = await store.dispatch(restoreSnapshotThunk(1));

    expect(action.type).toBe('project/restoreSnapshot/rejected');
  });
});
