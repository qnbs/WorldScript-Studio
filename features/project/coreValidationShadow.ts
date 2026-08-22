import type { ProjectValidationResult } from '@domain/desktop-contracts';
import { desktopPlatform } from '../../services/desktopPlatform';
import { logger } from '../../services/logger';
import type { StoryProject } from '../../types';
import { CoreBoundaryValidationError } from './coreBoundaryAdapter';
import { buildCoreProjectEnvelope } from './coreEnvelope';

export const CORE_VALIDATION_MAX_ENVELOPE_BYTES = 8 * 1024 * 1024;

function classifyError(error: unknown): string {
  if (error instanceof CoreBoundaryValidationError) return 'core-boundary-validation';
  if (error instanceof Error && error.message.startsWith('worldscript_project_validate')) {
    return 'native-validation-error';
  }
  return 'unexpected-shadow-error';
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function logVerdict(
  result: ProjectValidationResult,
  startedAt: number,
  level: 'debug' | 'warn',
): void {
  const context = {
    verdict: result.valid ? 'valid' : 'invalid',
    schemaVersion: result.schemaVersion ?? null,
    contractVersion: result.contractVersion,
    errorClass: result.valid ? null : 'native-validation-failure',
    durationMs: elapsedMs(startedAt),
  };
  logger[level]('project Core shadow validation', context);
}

/**
 * Observes a desktop project through the bounded Core validator without changing load behavior.
 * The envelope is synthesized and partial: unknown TS fields are not validated by the Rust model.
 */
export function observeCoreProjectValidation(project: StoryProject): void {
  if (!desktopPlatform.runtime.isDesktop) return;

  const startedAt = Date.now();
  try {
    const envelopeJson = buildCoreProjectEnvelope(project);
    const byteLength = new TextEncoder().encode(envelopeJson).byteLength;
    if (byteLength > CORE_VALIDATION_MAX_ENVELOPE_BYTES) {
      logger.debug('project Core shadow validation', {
        verdict: 'skipped',
        schemaVersion: null,
        contractVersion: null,
        errorClass: null,
        durationMs: elapsedMs(startedAt),
        skipReason: 'size-cap',
      });
      return;
    }

    void desktopPlatform.project
      .validateProject(envelopeJson)
      .then((result) => logVerdict(result, startedAt, result.valid ? 'debug' : 'warn'))
      .catch((error: unknown) => {
        logger.warn('project Core shadow validation', {
          verdict: 'error',
          schemaVersion: null,
          contractVersion: null,
          errorClass: classifyError(error),
          durationMs: elapsedMs(startedAt),
        });
      });
  } catch (error: unknown) {
    logger.warn('project Core shadow validation', {
      verdict: 'error',
      schemaVersion: null,
      contractVersion: null,
      errorClass: classifyError(error),
      durationMs: elapsedMs(startedAt),
    });
  }
}
