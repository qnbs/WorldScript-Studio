/**
 * FsAssetFsStore — Image and Binder binary asset filesystem storage.
 * ENCRYPTION: plaintext — blob storage; at-rest encryption planned for Phase 2.
 * QNBS-v3: Extracted from fileSystemService.ts.
 */

import { logger } from '../logger';
import type {
  BinderAssetMeta,
  BinderAssetPayload,
  ImageDeleteAdmission,
  ImageWriteAdmission,
} from '../storageBackend';
import { retryFs, sanitizePathSegment, writeFileAtomic, writeTextFileAtomic } from './fsCore';
import { FsSnapshotStore } from './snapshotFsStore';

export class FsAssetStore extends FsSnapshotStore {
  // --- Image Store Methods ---

  // QNBS-v3: shared digest primitive for both the project-namespace and entity-filename encodings below -- neither may rely on sanitizePathSegment alone, since it collapses distinct inputs (e.g. "alpha beta" and "alpha-beta") to the same output.
  private async digestHex(value: string): Promise<string> {
    const digestBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digestBuffer), (b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 16);
  }

  // QNBS-v3: sanitizePathSegment (and projectPathSegment, which wraps it for project.json's own directory) is a display sanitizer, not injective -- "alpha beta" and "alpha-beta" both normalize to "alpha-beta". Reusing it for images would let two distinct projects share one image directory, so this hashes the FULL untruncated projectId instead; the sanitized text is kept only as a human-readable prefix, never as the sole identity. Deliberately does not touch projectPathSegment itself -- that stays the project-directory/legacy-routing authority unchanged.
  private async projectNamespaceSegment(projectId: string): Promise<string> {
    const digest = await this.digestHex(projectId);
    const readablePrefix = sanitizePathSegment(projectId, 'project').slice(0, 40);
    return `${readablePrefix}--${digest}`;
  }

  // QNBS-v3: same non-injective-sanitizer risk as projectNamespaceSegment, but for the entity id within one project's namespace -- e.g. two characters named "alpha beta" and "alpha-beta" would otherwise share one qualified filename and silently overwrite each other's image.
  private async qualifiedImageFilename(id: string): Promise<string> {
    const digest = await this.digestHex(id);
    const readablePrefix = sanitizePathSegment(id, 'image').slice(0, 40);
    return `${readablePrefix}--${digest}.png`;
  }

  private async qualifiedImagePaths(
    projectId: string,
    id: string,
  ): Promise<{ dir: string; file: string }> {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const namespaceSegment = await this.projectNamespaceSegment(projectId);
    const dir = await apis.join(appDataPath, 'images', namespaceSegment);
    const file = await apis.join(dir, await this.qualifiedImageFilename(id));
    return { dir, file };
  }

  private async legacyImagePath(id: string): Promise<string> {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    return apis.join(appDataPath, 'images', `${sanitizePathSegment(id, 'image')}.png`);
  }

  private async legacyImageOwnerMarkerPath(): Promise<string> {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    return apis.join(appDataPath, 'images', '.legacy-owner');
  }

  // QNBS-v3: a legacy global image has no recorded owner -- the first project to consult it claims the whole legacy namespace for itself, permanently; every later project is checked against that claim instead of guessing. A live directory-count heuristic does NOT survive a delete-then-create cycle (delete project A, create project B: B would see "sole owner" and incorrectly inherit A's abandoned legacy images), so ownership is a persisted marker file, mirroring the IndexedDB backend's ownership marker.
  private async claimOrCheckLegacyImageOwnership(projectId: string): Promise<boolean> {
    const apis = await this.getApis();
    const markerPath = await this.legacyImageOwnerMarkerPath();
    if (await apis.exists(markerPath)) {
      const existing = await retryFs(() => apis.readTextFile(markerPath));
      return existing === projectId;
    }
    await writeTextFileAtomic(apis, markerPath, projectId);
    return true;
  }

  // QNBS-v3: read-only counterpart for deleteImage -- a destructive delete must never itself establish the first ownership claim, only act once ownership is already provable.
  private async checkLegacyImageOwnership(projectId: string): Promise<boolean> {
    const apis = await this.getApis();
    const markerPath = await this.legacyImageOwnerMarkerPath();
    if (!(await apis.exists(markerPath))) return false;
    const existing = await retryFs(() => apis.readTextFile(markerPath));
    return existing === projectId;
  }

  async saveImage(
    id: string,
    base64Data: string,
    projectId = 'default',
    writeAdmission?: ImageWriteAdmission,
  ): Promise<void> {
    // QNBS-v3: serialize replacement writes with deletes so a pending remove cannot erase the newly committed image.
    await this.withLegacyRoutingOperation(async () => {
      // QNBS-v3: [Admission before temp-file creation / Reject already-stale writes without disk residue / Preserve filesystem authority]
      writeAdmission?.();
      const apis = await this.getApis();
      const { dir, file } = await this.qualifiedImagePaths(projectId, id);
      if (!(await apis.exists(dir))) {
        await apis.mkdir(dir, { recursive: true });
      }
      // QNBS-v3: data URLs retain an uploaded image's MIME type; legacy raw payloads remain readable as PNG below.
      await writeTextFileAtomic(apis, file, base64Data, writeAdmission);
    }, projectId);
  }

  async getImage(id: string, projectId = 'default'): Promise<string | null> {
    try {
      const apis = await this.getApis();
      const qualifiedFile = (await this.qualifiedImagePaths(projectId, id)).file;
      if (await apis.exists(qualifiedFile)) {
        const imageData = await retryFs(() => apis.readTextFile(qualifiedFile));
        return imageData.startsWith('data:image/')
          ? imageData
          : `data:image/png;base64,${imageData}`;
      }
      // QNBS-v3: only the legacy-fallback branch touches shared/ambiguous ownership state -- restrict serialization to it so a qualified-path hit (the common case) can read concurrently with unrelated saveProject/deleteProject/saveBinderAsset operations instead of queuing behind them.
      return await this.withLegacyRoutingOperation(async () => {
        // QNBS-v3: preserve-first fail-closed -- a legacy unqualified image cannot be safely attributed to this project unless this project (or an already-deleted prior claimant) provably owns the legacy namespace.
        if (!(await this.claimOrCheckLegacyImageOwnership(projectId))) return null;
        const legacyFile = await this.legacyImagePath(id);
        if (!(await apis.exists(legacyFile))) return null;
        const imageData = await retryFs(() => apis.readTextFile(legacyFile));
        return imageData.startsWith('data:image/')
          ? imageData
          : `data:image/png;base64,${imageData}`;
      });
    } catch (error) {
      logger.error('Failed to load image:', error);
      return null;
    }
  }

  async deleteImage(
    id: string,
    projectId = 'default',
    deleteAdmission?: ImageDeleteAdmission,
  ): Promise<void> {
    try {
      // QNBS-v3: serialized + write-authority-checked like deleteBinderAsset -- an unserialized ownership check could go stale against a concurrent project creation and delete another project's unattributed legacy image.
      await this.withLegacyRoutingOperation(async () => {
        const apis = await this.getApis();
        const qualifiedFile = (await this.qualifiedImagePaths(projectId, id)).file;
        // QNBS-v3: preserve-first -- only remove the unattributed legacy copy when ownership is already provable; otherwise it may belong to a different (possibly already-deleted) project, so leave it untouched rather than risk destroying another project's image.
        const soleOwner = await this.checkLegacyImageOwnership(projectId);
        // QNBS-v3: legacy MUST be removed before the qualified file, not after -- if legacy removal throws, the catch below aborts before the qualified file is touched, so getImage's legacy fallback can never resurrect a half-deleted image. The reverse order would let a failure after the qualified delete leave the legacy copy to resurrect it.
        const removeImageFile = async (path: string) => {
          await retryFs(async () => {
            // QNBS-v3: re-admit every retry attempt so a same-ID replacement cannot be deleted after a transient filesystem failure.
            deleteAdmission?.();
            await apis.remove(path);
          });
        };
        if (soleOwner) {
          const legacyFile = await this.legacyImagePath(id);
          if (await apis.exists(legacyFile)) {
            await removeImageFile(legacyFile);
          }
        }
        if (await apis.exists(qualifiedFile)) {
          await removeImageFile(qualifiedFile);
        }
        // QNBS-v3: final delete admission / reject stale no-op deletions / keep entity mutation authority truthful.
        deleteAdmission?.();
      }, projectId);
    } catch (error) {
      if (deleteAdmission || this.isProjectWriteAuthorityError(error)) throw error;
      logger.error('Failed to delete image:', error);
    }
  }

  // QNBS-v3: qualified-only read for rollback/transaction callers -- deliberately does not enter the outer try/catch that getImage uses to fail closed to null on ANY error, since that would collapse "genuinely absent" and "read failed" into the same value; a rollback needs a read failure to reject and abort before it mutates anything. Also never consults the legacy fallback, so it can't return a differently-provenanced blob.
  async getQualifiedImage(id: string, projectId = 'default'): Promise<string | null> {
    const apis = await this.getApis();
    const qualifiedFile = (await this.qualifiedImagePaths(projectId, id)).file;
    if (!(await apis.exists(qualifiedFile))) return null;
    const imageData = await retryFs(() => apis.readTextFile(qualifiedFile));
    return imageData.startsWith('data:image/') ? imageData : `data:image/png;base64,${imageData}`;
  }

  // QNBS-v3: qualified-only delete for rollback/transaction callers -- never touches the legacy file or the legacy ownership marker, unlike deleteImage's user-facing "clear both, fail-closed-to-success" semantics, which could delete a legacy image that predates and is unrelated to the transaction being rolled back. No withLegacyRoutingOperation needed since this never reads/writes the shared legacy state saveImage also skips.
  async deleteQualifiedImage(id: string, projectId = 'default'): Promise<void> {
    const apis = await this.getApis();
    const qualifiedFile = (await this.qualifiedImagePaths(projectId, id)).file;
    if (await apis.exists(qualifiedFile)) {
      await retryFs(() => apis.remove(qualifiedFile));
    }
  }

  // QNBS-v3: Research-Blobs pro Projekt unter projects/<id>/binder — rekursives deleteProject räumt mit auf.

  private async binderAssetPaths(projectId: string, assetId: string) {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const safeAsset = sanitizePathSegment(assetId, 'asset');
    const safeId = sanitizePathSegment(
      this.resolveAuxiliaryProjectId(projectId, 'binder', safeAsset),
      'project',
    );
    const dir = await apis.join(appDataPath, 'projects', safeId, 'binder');
    const binFile = await apis.join(dir, `${safeAsset}.bin`);
    const metaFile = await apis.join(dir, `${safeAsset}.meta.json`);
    return { apis, dir, binFile, metaFile };
  }

  async saveBinderAsset(
    projectId: string,
    assetId: string,
    data: ArrayBuffer,
    meta: BinderAssetMeta,
  ): Promise<void> {
    await this.withLegacyRoutingOperation(async () => {
      const apis = await this.getApis();
      const { dir, binFile, metaFile } = await this.binderAssetPaths(projectId, assetId);
      if (!(await apis.exists(dir))) await apis.mkdir(dir, { recursive: true });
      const metaOut: BinderAssetMeta = { ...meta, byteSize: data.byteLength };
      await writeFileAtomic(apis, binFile, new Uint8Array(data));
      await writeTextFileAtomic(apis, metaFile, JSON.stringify(metaOut));
    }, projectId);
  }

  async getBinderAsset(projectId: string, assetId: string): Promise<BinderAssetPayload | null> {
    try {
      return await this.withLegacyRoutingOperation(async () => {
        const apis = await this.getApis();
        const { binFile, metaFile } = await this.binderAssetPaths(projectId, assetId);
        if (!(await apis.exists(binFile)) || !(await apis.exists(metaFile))) return null;
        const [bytes, metaRaw] = await Promise.all([
          retryFs(() => apis.readFile(binFile)),
          retryFs(() => apis.readTextFile(metaFile)),
        ]);
        const meta = JSON.parse(metaRaw) as BinderAssetMeta;
        // QNBS-v3: binary + metadata are two independent atomic writes, not one transaction — a byteSize mismatch is the cheapest reliable signal that a partial failure paired a new generation with a stale one.
        if (meta.byteSize !== bytes.byteLength) {
          logger.warn('getBinderAsset: byteSize/binary mismatch — treating pair as corrupt', {
            projectId,
            assetId,
            expected: meta.byteSize,
            actual: bytes.byteLength,
          });
          return null;
        }
        const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        return { data: copy, meta };
      });
    } catch (error) {
      logger.warn('getBinderAsset failed:', error);
      return null;
    }
  }

  async deleteBinderAsset(projectId: string, assetId: string): Promise<void> {
    try {
      await this.withLegacyRoutingOperation(
        () => this.deleteBinderAssetStrict(projectId, assetId),
        projectId,
      );
    } catch (error) {
      if (this.isProjectWriteAuthorityError(error)) throw error;
      logger.warn('deleteBinderAsset failed:', error);
    }
  }

  protected async deleteBinderAssetStrict(projectId: string, assetId: string): Promise<void> {
    const { apis, binFile, metaFile } = await this.binderAssetPaths(projectId, assetId);
    if (await apis.exists(binFile)) await retryFs(() => apis.remove(binFile));
    if (await apis.exists(metaFile)) await retryFs(() => apis.remove(metaFile));
  }

  async listBinderAssetIds(projectId: string): Promise<string[]> {
    try {
      return await this.withLegacyRoutingOperation(() =>
        this.listBinderAssetIdsUnlocked(projectId),
      );
    } catch (error) {
      logger.warn('listBinderAssetIds failed:', error);
      return [];
    }
  }

  private async listBinderAssetIdsUnlocked(projectId: string): Promise<string[]> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const ids = new Set<string>();
      const legacyProjectId = this.legacyBinderProjectId(projectId);
      const safeIds = new Set(
        [projectId, legacyProjectId]
          .filter((id): id is string => Boolean(id))
          .map((id) => sanitizePathSegment(id, 'project')),
      );
      for (const safeId of safeIds) {
        try {
          const dir = await apis.join(appDataPath, 'projects', safeId, 'binder');
          if (!(await apis.exists(dir))) continue;
          const legacyOnly =
            legacyProjectId !== null && safeId !== sanitizePathSegment(projectId, 'project');
          const allowed = legacyOnly
            ? new Set(this.legacyBinderAssetIdsForProject(projectId))
            : null;
          const entries = await retryFs(() => apis.readDir(dir));
          for (const e of entries) {
            const name = e.name ?? '';
            if (name.endsWith('.meta.json')) {
              const id = name.replace(/\.meta\.json$/, '');
              if (!allowed || allowed.has(id)) ids.add(id);
            }
          }
        } catch (error) {
          // QNBS-v3: one unreadable legacy directory must not erase IDs already collected from a healthy project directory.
          logger.warn('listBinderAssetIds: skipped unreadable project directory', {
            projectId,
            safeId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return [...ids];
    } catch (error) {
      logger.warn('listBinderAssetIds failed:', error);
      return [];
    }
  }

  async deleteAllBinderAssetsForProject(projectId: string): Promise<void> {
    await this.withLegacyRoutingOperation(async () => {
      const ids = await this.listBinderAssetIdsUnlocked(projectId);
      await Promise.all(
        ids.map(async (id) => {
          try {
            await this.deleteBinderAssetStrict(projectId, id);
          } catch (error) {
            logger.warn('deleteBinderAsset failed:', error);
          }
        }),
      );
    }, projectId);
  }
}
