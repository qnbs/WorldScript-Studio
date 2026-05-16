import { configureStore } from '@reduxjs/toolkit';
import undoable from 'redux-undo';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/storageService', () => ({
  storageService: {
    saveImage: vi.fn(),
    deleteBinderAsset: vi.fn(),
    saveBinderAsset: vi.fn(),
    getSnapshotData: vi.fn(),
  },
}));

vi.mock('../../../services/projectImportSchema', () => ({
  parseImportedProjectJson: vi.fn(),
}));

import featureFlagsReducer from '../../../features/featureFlags/featureFlagsSlice';
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
  vi.mocked(storageService.getSnapshotData).mockResolvedValue(null);
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

    // saveImage called proves avatar was processed
    expect(storageService.saveImage).toHaveBeenCalledWith('c2', 'base64imgdata');
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
});

// ---------------------------------------------------------------------------
// restoreSnapshotThunk
// ---------------------------------------------------------------------------
describe('restoreSnapshotThunk', () => {
  it('dispatches fulfilled with snapshot data from storageService', async () => {
    const snapshotData = { title: 'Snapshot Title', manuscript: [] };
    vi.mocked(storageService.getSnapshotData).mockResolvedValue(snapshotData as never);

    const store = makeStore();
    const action = await store.dispatch(restoreSnapshotThunk(42));

    expect(action.type).toBe('project/restoreSnapshot/fulfilled');
    expect((action as { payload: typeof snapshotData }).payload).toEqual(snapshotData);
  });

  it('calls storageService.getSnapshotData with the correct id', async () => {
    vi.mocked(storageService.getSnapshotData).mockResolvedValue(null);

    const store = makeStore();
    await store.dispatch(restoreSnapshotThunk(99));

    expect(storageService.getSnapshotData).toHaveBeenCalledWith(99);
  });

  it('dispatches rejected when storageService throws', async () => {
    vi.mocked(storageService.getSnapshotData).mockRejectedValue(new Error('IDB error'));

    const store = makeStore();
    const action = await store.dispatch(restoreSnapshotThunk(1));

    expect(action.type).toBe('project/restoreSnapshot/rejected');
  });
});
