/**
 * services/fileSystemService.ts — Backward-compatibility re-export facade.
 * QNBS-v3: Implementation moved to services/fs/. This file stays for two releases
 * to avoid breaking callers that import { fileSystemService } from './fileSystemService'.
 */

export { FileSystemService, fileSystemService } from './fs';
