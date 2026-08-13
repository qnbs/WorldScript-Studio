/**
 * FsAssetFsStore — Image and Binder binary asset filesystem storage.
 * ENCRYPTION: plaintext — blob storage; at-rest encryption planned for Phase 2.
 * QNBS-v3: Extracted from fileSystemService.ts.
 */

import { logger } from '../logger';
import type { BinderAssetMeta, BinderAssetPayload } from '../storageBackend';
import { retryFs, sanitizePathSegment, writeFileAtomic, writeTextFileAtomic } from './fsCore';
import { FsSnapshotStore } from './snapshotFsStore';

interface BinderAssetManifest {
  version: 1;
  dataFile: string;
  meta: BinderAssetMeta;
}

function createBinderRevision(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function isBinderAssetManifest(value: unknown): value is BinderAssetManifest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<BinderAssetManifest>;
  return candidate.version === 1 && typeof candidate.dataFile === 'string' && !!candidate.meta;
}

export class FsAssetStore extends FsSnapshotStore {
  // --- Image Store Methods ---

  async saveImage(id: string, base64Data: string): Promise<void> {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const imagesPath = await apis.join(appDataPath, 'images');

    if (!(await apis.exists(imagesPath))) {
      await apis.mkdir(imagesPath, { recursive: true });
    }

    const imageFile = await apis.join(imagesPath, `${sanitizePathSegment(id, 'image')}.png`);
    // QNBS-v3: preserve the original data URL so JPEG/WebP uploads keep their MIME type; legacy raw base64 remains readable below.
    await writeTextFileAtomic(apis, imageFile, base64Data);
  }

  async getImage(id: string): Promise<string | null> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const imageFile = await apis.join(
        appDataPath,
        'images',
        `${sanitizePathSegment(id, 'image')}.png`,
      );

      if (!(await apis.exists(imageFile))) {
        return null;
      }

      const base64Data = await retryFs(() => apis.readTextFile(imageFile));
      return base64Data.startsWith('data:image/')
        ? base64Data
        : `data:image/png;base64,${base64Data}`;
    } catch (error) {
      logger.error('Failed to load image:', error);
      return null;
    }
  }

  async deleteImage(id: string): Promise<void> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const imageFile = await apis.join(
        appDataPath,
        'images',
        `${sanitizePathSegment(id, 'image')}.png`,
      );
      if (await apis.exists(imageFile)) {
        await retryFs(() => apis.remove(imageFile));
      }
    } catch (error) {
      logger.error('Failed to delete image:', error);
    }
  }

  // QNBS-v3: Research-Blobs pro Projekt unter projects/<id>/binder — rekursives deleteProject räumt mit auf.

  private async binderAssetPaths(projectId: string, assetId: string) {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const safeId = sanitizePathSegment(projectId, 'project');
    const safeAsset = sanitizePathSegment(assetId, 'asset');
    const dir = await apis.join(appDataPath, 'projects', safeId, 'binder');
    const binFile = await apis.join(dir, `${safeAsset}.bin`);
    const metaFile = await apis.join(dir, `${safeAsset}.meta.json`);
    return { apis, dir, binFile, metaFile, safeAsset };
  }

  private async readBinderManifest(
    apis: Awaited<ReturnType<FsAssetStore['binderAssetPaths']>>['apis'],
    metaFile: string,
    safeAsset: string,
  ): Promise<BinderAssetManifest | null> {
    try {
      const parsed = JSON.parse(await retryFs(() => apis.readTextFile(metaFile))) as unknown;
      if (!isBinderAssetManifest(parsed)) return null;
      if (
        !parsed.dataFile.startsWith(`${safeAsset}.`) ||
        !parsed.dataFile.endsWith('.bin') ||
        parsed.dataFile.includes('/') ||
        parsed.dataFile.includes('\\')
      ) {
        throw new Error('Binder asset manifest references an invalid data file');
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async saveBinderAsset(
    projectId: string,
    assetId: string,
    data: ArrayBuffer,
    meta: BinderAssetMeta,
  ): Promise<void> {
    const apis = await this.getApis();
    const { dir, binFile, metaFile, safeAsset } = await this.binderAssetPaths(projectId, assetId);
    if (!(await apis.exists(dir))) await apis.mkdir(dir, { recursive: true });
    const metaOut: BinderAssetMeta = { ...meta, byteSize: data.byteLength };
    const prior = await this.readBinderManifest(apis, metaFile, safeAsset);
    const dataFileName = `${safeAsset}.${createBinderRevision()}.bin`;
    const dataFile = await apis.join(dir, dataFileName);
    await writeFileAtomic(apis, dataFile, new Uint8Array(data));
    // QNBS-v3: publishing this manifest is the binder pair's commit point, so readers never combine new bytes with stale metadata.
    try {
      await writeTextFileAtomic(
        apis,
        metaFile,
        JSON.stringify({ version: 1, dataFile: dataFileName, meta: metaOut }),
      );
    } catch (error) {
      // QNBS-v3: the revision is unreachable until its manifest commits, so failed publication must not leak a new binary on every retry.
      await retryFs(() => apis.remove(dataFile)).catch((cleanupError) => {
        logger.warn('Failed to remove unpublished binder asset revision:', cleanupError);
      });
      throw error;
    }
    if (prior) {
      const priorFile = await apis.join(dir, prior.dataFile);
      if (priorFile !== dataFile && (await apis.exists(priorFile))) {
        await retryFs(() => apis.remove(priorFile)).catch((error) => {
          logger.warn('Failed to remove superseded binder asset revision:', error);
        });
      }
    } else if (await apis.exists(binFile)) {
      await retryFs(() => apis.remove(binFile)).catch((error) => {
        logger.warn('Failed to remove superseded legacy binder asset:', error);
      });
    }
  }

  async getBinderAsset(projectId: string, assetId: string): Promise<BinderAssetPayload | null> {
    try {
      const apis = await this.getApis();
      const { binFile, metaFile, dir, safeAsset } = await this.binderAssetPaths(projectId, assetId);
      if (!(await apis.exists(metaFile))) return null;
      const manifest = await this.readBinderManifest(apis, metaFile, safeAsset);
      const dataFile = manifest ? await apis.join(dir, manifest.dataFile) : binFile;
      if (!(await apis.exists(dataFile))) return null;
      const bytes = await retryFs(() => apis.readFile(dataFile));
      const meta = manifest
        ? manifest.meta
        : (JSON.parse(await retryFs(() => apis.readTextFile(metaFile))) as BinderAssetMeta);
      const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return { data: copy, meta };
    } catch (error) {
      logger.warn('getBinderAsset failed:', error);
      return null;
    }
  }

  async deleteBinderAsset(projectId: string, assetId: string): Promise<void> {
    try {
      const apis = await this.getApis();
      const { binFile, metaFile, dir, safeAsset } = await this.binderAssetPaths(projectId, assetId);
      const manifest = await this.readBinderManifest(apis, metaFile, safeAsset);
      const dataFile = manifest ? await apis.join(dir, manifest.dataFile) : binFile;
      if (await apis.exists(dataFile)) await retryFs(() => apis.remove(dataFile));
      if (dataFile !== binFile && (await apis.exists(binFile)))
        await retryFs(() => apis.remove(binFile));
      if (await apis.exists(metaFile)) await retryFs(() => apis.remove(metaFile));
    } catch (error) {
      logger.warn('deleteBinderAsset failed:', error);
    }
  }

  async listBinderAssetIds(projectId: string): Promise<string[]> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const safeId = sanitizePathSegment(projectId, 'project');
      const dir = await apis.join(appDataPath, 'projects', safeId, 'binder');
      if (!(await apis.exists(dir))) return [];
      const entries = await retryFs(() => apis.readDir(dir));
      const ids = new Set<string>();
      for (const e of entries) {
        const name = e.name ?? '';
        if (name.endsWith('.meta.json')) {
          ids.add(name.replace(/\.meta\.json$/, ''));
        }
      }
      return [...ids];
    } catch (error) {
      logger.warn('listBinderAssetIds failed:', error);
      return [];
    }
  }

  async deleteAllBinderAssetsForProject(projectId: string): Promise<void> {
    const ids = await this.listBinderAssetIds(projectId);
    await Promise.all(ids.map((id) => this.deleteBinderAsset(projectId, id)));
  }
}
