import type { StoryProject } from '../../types';
import { toCoreProjectCollections } from './coreBoundaryAdapter';

// QNBS-v3: TS has no persisted schemaVersion; this boundary mirrors envelope.rs for the shadow probe.
export const CORE_PROJECT_SCHEMA_VERSION = 2 as const;

/**
 * Builds the synthetic, partial Wave 2 envelope consumed by the Rust Core shadow validator.
 * Unknown TS-only project fields are intentionally not represented in this bounded contract.
 */
export function buildCoreProjectEnvelope(project: StoryProject): string {
  const collections = toCoreProjectCollections(project);
  const coreProject = {
    title: project.title,
    logline: project.logline,
    ...(project.author === undefined ? {} : { author: project.author }),
    ...collections,
    manuscript: project.manuscript,
  };

  return JSON.stringify({
    schemaVersion: CORE_PROJECT_SCHEMA_VERSION,
    project: coreProject,
  });
}
