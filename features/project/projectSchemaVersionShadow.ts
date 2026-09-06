import { logger } from '../../services/logger';
import {
  classifyProjectVersionFromObject,
  classifyRawProjectVersion,
  type ProjectVersionClassification,
} from './projectSchemaVersion';

/**
 * Universal ingress admission (contract section 2.8), staged as observation-only — the first
 * ingress caller wired to the classifiers built in Slice A. Matches this codebase's established
 * shadow-validation pattern (`coreValidationShadow.ts`): classify and log, never alter load
 * behavior, never throw. Actual admission gating (refusing `FUTURE`/`MALFORMED`, migrating
 * `LEGACY_UNVERSIONED`) is deferred to the #553 slice that implements section 2.4's fail-closed
 * mechanism and the `LEGACY_TO_V1` migration — this only proves the classifiers against real,
 * live ingress data first.
 */
function logClassification(
  classification: ProjectVersionClassification,
  ingressPath: string,
): void {
  const level = classification === 'MALFORMED' || classification === 'FUTURE' ? 'warn' : 'debug';
  logger[level]('project schema-version classification (observation-only)', {
    classification,
    ingressPath,
  });
}

/**
 * Observes an already-deserialized persisted-project object's schema-version classification
 * (e.g. from IndexedDB, which has no raw JSON text to classify — see
 * `classifyProjectVersionFromObject`'s own doc comment). Never throws; a classification failure
 * is itself logged, not propagated, so this can never delay or alter the caller's load result.
 */
export function observeProjectVersionClassificationFromObject(
  rawProjectData: unknown,
  ingressPath: string,
): void {
  try {
    logClassification(classifyProjectVersionFromObject(rawProjectData), ingressPath);
  } catch (error) {
    logger.warn('project schema-version classification observation failed', {
      ingressPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Observes raw persisted-project JSON text's schema-version classification (e.g. from the
 * filesystem/desktop backend, or a file/backup import, which do have raw text to classify — see
 * `classifyRawProjectVersion`). Never throws; a classification failure is itself logged, not
 * propagated.
 */
export function observeProjectVersionClassificationFromText(
  rawText: string,
  ingressPath: string,
): void {
  try {
    logClassification(classifyRawProjectVersion(rawText), ingressPath);
  } catch (error) {
    logger.warn('project schema-version classification observation failed', {
      ingressPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
