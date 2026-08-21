// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  mutationFiles,
  mutationModules,
  selectMutationModules,
} from '../../../scripts/stryker-scope.mjs';
import config from '../../../stryker.config.mjs';

const workflowPath = fileURLToPath(
  new URL('../../../.github/workflows/mutation.yml', import.meta.url),
);
const workflow = readFileSync(workflowPath, 'utf8');

describe('Stryker workflow policy', () => {
  it('uses one explicit target source for config and the matrix', () => {
    expect(config.mutate).toEqual(mutationFiles);
    expect(mutationModules).toHaveLength(8);
    expect(new Set(mutationFiles).size).toBe(25);
    expect(mutationModules.every(({ riskTier }) => ['A', 'B'].includes(riskTier))).toBe(true);
    expect(selectMutationModules('tier-a').every(({ riskTier }) => riskTier === 'A')).toBe(true);
    expect(selectMutationModules('services-commands')).toHaveLength(1);
  });

  it('uses supported incremental plumbing and preserves shard identity', () => {
    expect(workflow).toContain('--incrementalFile "$INCREMENTAL_FILE"');
    expect(workflow).not.toContain('STRYKER_INCREMENTAL_FILE=');
    expect(workflow).toContain('merge-multiple: false');
    expect(workflow).toContain('if-no-files-found: error');
    expect(workflow).toContain('needs.stryker.result');
    expect(workflow).toContain('node scripts/aggregate-stryker-reports.mjs all-reports');
    expect(workflow).toContain('--selector "$SELECTOR"');
    expect(workflow).not.toContain('force-all-modules');
  });
});
