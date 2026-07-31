// QNBS-v3: SEC-6 — one-time backfill that re-encrypts pre-existing plaintext codex_mentions.excerpt
//          rows once IDB at-rest encryption becomes available. Mirrors ragVectorMigration.ts's
//          idempotent-marker + privacy-gated-batch pattern. Only meaningful once a session key is
//          unlocked (isIdbEncryptionReady()) — skips WITHOUT writing the done-marker otherwise, so it
//          retries automatically the next time analytics migrations run after unlock.

import { logger } from '../logger';
import { isIdbEncryptionReady } from '../storage/storageEncryptionService';
import { duckdbClient } from './duckdbClient';
import { encryptDuckDbData } from './duckdbEncryption';

const CODEX_EXCERPT_ENCRYPTION_KEY = 'codex_excerpt_encryption_v1_migrated';

/** Escape single-quotes in a SQL string literal. */
function esc(s: string): string {
  return s.replace(/'/g, "''");
}

interface PlaintextExcerptRow {
  entity_id: string;
  project_id: string;
  section_id: string;
  excerpt: string;
}

// QNBS-v3: SEC — marker is scoped per project (key includes projectId); a shared/global key would
// let the first migrated project's marker silently block the backfill for every other project.
function markerKey(projectId: string): string {
  return `${CODEX_EXCERPT_ENCRYPTION_KEY}:${projectId}`;
}

export async function isCodexExcerptEncryptionMigrationDone(projectId: string): Promise<boolean> {
  const res = await duckdbClient.query(
    `SELECT value FROM _meta WHERE key = '${esc(markerKey(projectId))}'`,
  );
  return Boolean(res.ok && res.rows?.length);
}

/**
 * Re-encrypt existing plaintext codex_mentions.excerpt rows for a project in place, moving the
 * ciphertext into excerpt_enc and nulling the plaintext column. Idempotent via a per-project _meta marker.
 */
export async function runCodexExcerptEncryptionMigration(
  projectId: string,
  // QNBS-v3: SEC — re-checked before each write so an analytics opt-out toggled mid-run aborts
  // before persisting further rows. Defaults to always-allow for callers without a privacy context.
  shouldPersist: () => boolean = () => true,
  // QNBS-v3: SEC — `aborted: true` means either a privacy opt-out stopped an in-progress (encryption
  // already unlocked) run, or the initial SELECT query failed — in both cases the done-marker is
  // never written, so callers MUST keep migration status retryable. When encryption simply isn't
  // unlocked yet this is NOT an abort (returns `aborted: false`): it's not applicable this session and
  // must not block the other migrations' 'done' status for the common (encryption-off) case. It
  // self-heals — the next time this function is invoked (next duckDbJustReady/analyticsJustEnabled
  // transition, e.g. next app load) it re-checks isIdbEncryptionReady() and backfills then if the user
  // has since unlocked/enabled encryption.
): Promise<{ migrated: number; aborted: boolean }> {
  if (await isCodexExcerptEncryptionMigrationDone(projectId)) {
    return { migrated: 0, aborted: false };
  }
  // Not applicable this session — no active encryption key. Not a failure; see doc comment above.
  if (!isIdbEncryptionReady()) {
    return { migrated: 0, aborted: false };
  }
  if (!shouldPersist()) {
    return { migrated: 0, aborted: true };
  }

  const res = await duckdbClient.query(
    `SELECT entity_id, project_id, section_id, excerpt FROM codex_mentions
     WHERE project_id = '${esc(projectId)}' AND excerpt IS NOT NULL`,
  );
  if (!res.ok) {
    logger.warn('[codexExcerptEncryptionMigration] Query failed (non-fatal):', res.error);
    return { migrated: 0, aborted: true };
  }

  let migrated = 0;
  const rows = (res.rows ?? []) as unknown as PlaintextExcerptRow[];
  for (const row of rows) {
    // QNBS-v3: SEC — re-check at each write so an opt-out mid-run stops further persistence.
    if (!shouldPersist()) return { migrated, aborted: true };

    const bytes = await encryptDuckDbData(row.excerpt);
    const updRes = await duckdbClient.exec(
      `UPDATE codex_mentions SET excerpt = NULL, excerpt_enc = ?
       WHERE entity_id = '${esc(row.entity_id)}' AND project_id = '${esc(row.project_id)}'
         AND section_id = '${esc(row.section_id)}'`,
      [bytes],
    );
    if (updRes.ok) migrated++;
    if (migrated % 10 === 0) await Promise.resolve();
  }

  // QNBS-v3: SEC — final gate check before the done-marker: an opt-out landing during the awaited
  // batch above must not let us record the migration as complete (else re-opt-in never reruns it).
  if (!shouldPersist()) {
    return { migrated, aborted: true };
  }

  await duckdbClient.exec(
    `INSERT INTO _meta (key, value) VALUES ('${esc(markerKey(projectId))}', '1')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
  );

  logger.debug('[codexExcerptEncryptionMigration] Complete:', migrated, 'rows');
  return { migrated, aborted: false };
}
