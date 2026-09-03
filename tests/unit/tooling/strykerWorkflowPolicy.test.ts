// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  mutationFiles,
  mutationModules,
  selectMutationModules,
  validateScope,
} from '../../../scripts/stryker-scope.mjs';
import config from '../../../stryker.config.mjs';

const workflowPath = fileURLToPath(
  new URL('../../../.github/workflows/mutation.yml', import.meta.url),
);
const workflow = readFileSync(workflowPath, 'utf8');
const scopeScriptPath = fileURLToPath(
  new URL('../../../scripts/stryker-scope.mjs', import.meta.url),
);
// QNBS-v3: the unescaped `${{ ${expr} }}` form Biome's own autofix suggests is a JS SyntaxError — `\$` escapes the literal dollar so only the inner `${expr}` interpolates.
const githubExpression = (expression: string) => `\${{ ${expression} }}`;

// QNBS-v3: Lock workflow/config invariants so mutation plumbing cannot silently drift.
describe('Stryker workflow policy', () => {
  it('uses one explicit target source for config and the matrix', () => {
    expect(config.mutate).toEqual(mutationFiles);
    expect(config['vitest']).toEqual(expect.objectContaining({ related: true }));
    expect(config.ignorePatterns).not.toContain('**/*.test.ts');
    expect(config.ignorePatterns).not.toContain('**/*.spec.ts');
    expect(mutationModules).toHaveLength(8);
    expect(new Set(mutationFiles).size).toBe(25);
    expect(mutationModules.every(({ riskTier }) => ['A', 'B'].includes(riskTier))).toBe(true);
    // QNBS-v3: [Validate the services-commands Stryker mapping / prevent test-scope drift / make the policy contract explicit]
    expect(selectMutationModules('services-commands')[0]?.testFiles).toEqual([
      'tests/unit/commands/fuzzyScore.test.ts',
      'tests/unit/commands/palettePreferences.test.ts',
      'tests/unit/services/commandBuilder.test.ts',
    ]);
    expect(selectMutationModules('tier-a').every(({ riskTier }) => riskTier === 'A')).toBe(true);
    expect(selectMutationModules('services-commands')).toHaveLength(1);
    // QNBS-v3: [Validate the services-ai-core Stryker mapping / prevent weak related-test selection / bind Tier-A mutants to direct tests]
    expect(selectMutationModules('services-ai-core')[0]?.testFiles).toEqual([
      'tests/unit/ai/modelRecommendations.test.ts',
      'tests/unit/ai/aiPolicy.test.ts',
      'tests/unit/ai/aiRetry.test.ts',
      'tests/unit/services/fetchAdapter.test.ts',
      'tests/unit/ai/routingLogger.test.ts',
      'tests/unit/ai/aiModeService.test.ts',
    ]);
    expect(selectMutationModules('copilot')[0]?.testFiles).toEqual([
      'tests/unit/copilot/heuristicEngine.test.ts',
      'tests/unit/copilot/insightGenerator.test.ts',
      'tests/unit/copilot/actionApplier.test.ts',
      'tests/unit/copilot/copilotContextService.test.ts',
    ]);
    const matrix = JSON.parse(
      execFileSync(process.execPath, [scopeScriptPath, '--matrix'], { encoding: 'utf8' }),
    );
    expect(matrix.include).toEqual(mutationModules);
  });

  it('uses supported incremental plumbing and preserves shard identity', () => {
    expect(workflow).toContain('--incrementalFile "$INCREMENTAL_FILE"');
    expect(workflow).toContain(`MATRIX_NAME: ${githubExpression('matrix.name')}`);
    expect(workflow).toContain(`MATRIX_MUTATE: ${githubExpression('matrix.mutate')}`);
    expect(workflow).toContain(
      `MATRIX_TEST_FILES: ${githubExpression("join(matrix.testFiles, ',')")}`,
    );
    expect(workflow).toContain('TEST_FILE_ARGS+=(--testFiles "$TEST_FILES")');
    expect(workflow).toContain('"${' + 'TEST_FILE_ARGS[@]}"');
    expect(workflow).not.toContain(
      `rm -f reports/stryker-incremental-${githubExpression('matrix.name')}.json`,
    );
    expect(workflow).not.toContain(`--mutate "${githubExpression('matrix.mutate')}"`);
    expect(workflow).not.toContain('STRYKER_INCREMENTAL_FILE=');
    expect(workflow).toContain('merge-multiple: false');
    expect(workflow).toContain('if-no-files-found: error');
    expect(workflow).toContain('needs.stryker.result');
    expect(workflow).toContain('the summary remains informational and this job will fail closed');
    expect(workflow).toContain(
      'node scripts/aggregate-stryker-reports.mjs all-reports --selector "$SELECTOR"',
    );
    expect(workflow).toContain('set -o pipefail');
    expect(workflow).toContain('--selector "$SELECTOR"');
    expect(workflow).toContain('SELECTOR: $' + "{{ github.event.inputs.module || 'all' }}");
    expect(workflow).not.toContain('force-all-modules');
  });

  it('validates optional module test-file mappings fail closed', () => {
    const validModule = {
      name: 'test-module',
      riskTier: 'A' as const,
      mutate: ['services/commands/fuzzyScore.ts'],
    };

    expect(() => validateScope({ modules: [validModule] })).not.toThrow();
    expect(() =>
      validateScope({ modules: [{ ...validModule, testFiles: 'not-an-array' }] }),
    ).toThrow('Stryker testFiles must be an array');
    expect(() => validateScope({ modules: [{ ...validModule, testFiles: [42] }] })).toThrow(
      'Stryker test file does not exist',
    );
    expect(() =>
      validateScope({ modules: [{ ...validModule, testFiles: ['tests/unit/missing.test.ts'] }] }),
    ).toThrow('Stryker test file does not exist');
  });
});
