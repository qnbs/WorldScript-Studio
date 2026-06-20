import { createAsyncThunk } from '@reduxjs/toolkit';
import { v4 as uuidv4 } from 'uuid';
import type { RootState } from '../../../app/store';
import { storageService } from '../../../services/storageService';
import type { BinderNode } from '../../../types';
import { selectProjectData } from '../projectSelectors';
import { projectActions } from '../projectSlice';

// QNBS-v3: exported for unit coverage of the cycle guard (mirrors the deleteBinderNode reducer).
export function collectSubtreeIds(nodes: BinderNode[], rootId: string): string[] {
  const out: string[] = [];
  // QNBS-v3: visited guard — a cyclic/corrupted parentId loop (a→b→a) would otherwise recurse
  // forever here, before deleteBinderNode's own guard is ever reached. Set also dedupes.
  const visited = new Set<string>();
  const walk = (pid: string) => {
    if (visited.has(pid)) return;
    visited.add(pid);
    out.push(pid);
    for (const n of nodes) {
      if (n.parentId === pid) walk(n.id);
    }
  };
  walk(rootId);
  return out;
}

function projectStorageId(data: { id?: string } | undefined): string {
  return data?.id && data.id.length > 0 ? data.id : 'browser-project';
}

/** QNBS-v3: Binder-Blobs aus StorageBackend entfernen bevor Redux-Knoten fallen — verhindert IDB-Toter Speicher. */
export const removeBinderSubtreeWithAssetsThunk = createAsyncThunk(
  'project/removeBinderSubtreeWithAssets',
  async (rootId: string, { getState, dispatch }) => {
    const state = getState() as RootState;
    const data = selectProjectData(state);
    const nodes = data?.binderNodes ?? [];
    const subtreeIds = collectSubtreeIds(nodes, rootId);
    const pid = projectStorageId(data);
    for (const nid of subtreeIds) {
      const node = nodes.find((n) => n.id === nid);
      if (node?.binderAssetId) {
        await storageService.deleteBinderAsset(pid, node.binderAssetId);
      }
    }
    dispatch(projectActions.deleteBinderNode(rootId));
  },
);

export const importBinderFileThunk = createAsyncThunk(
  'project/importBinderFile',
  async (payload: { parentId: string; file: File }, { getState, dispatch }) => {
    const state = getState() as RootState;
    const data = selectProjectData(state);
    if (!data) throw new Error('No project loaded');
    const pid = projectStorageId(data);
    const assetId = uuidv4();
    const buf = await payload.file.arrayBuffer();
    const mime = payload.file.type || 'application/octet-stream';
    await storageService.saveBinderAsset(pid, assetId, buf, {
      mimeType: mime,
      originalFileName: payload.file.name,
      byteSize: buf.byteLength,
    });
    const ext = payload.file.name.split('.').pop()?.toLowerCase() ?? '';
    const isPdf = mime === 'application/pdf' || ext === 'pdf';
    const isImage = mime.startsWith('image/') || /^(png|jpe?g|gif|webp|bmp|svg)$/.test(ext);
    const type: BinderNode['type'] = isPdf ? 'pdf' : isImage ? 'image' : 'text';
    const maxSort = (data.binderNodes ?? [])
      .filter((n) => n.parentId === payload.parentId)
      .reduce((m, n) => Math.max(m, n.sortIndex), -1);
    const node: BinderNode = {
      id: uuidv4(),
      parentId: payload.parentId,
      type,
      title: payload.file.name.replace(/\.[^.]+$/, '') || payload.file.name,
      sortIndex: maxSort + 1,
      binderAssetId: assetId,
      mimeType: mime,
      byteSize: buf.byteLength,
      originalFileName: payload.file.name,
    };
    dispatch(projectActions.addBinderNode(node));
    return node.id;
  },
);
