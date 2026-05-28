/**
 * services/dbService.ts — Backward-compatibility re-export facade.
 * QNBS-v3: Implementation moved to services/storage/. This file stays for two releases
 * to avoid breaking the many callers that import { dbService } from './dbService'.
 * Direct imports of IndexedDBService internals should migrate to services/storage/.
 */

export { dbService, IndexedDBService } from './storage';
